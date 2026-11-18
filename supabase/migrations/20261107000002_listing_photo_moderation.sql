begin;

update public.app_settings
set value = '4'::jsonb, min_value = 1, max_value = 4,
    description = 'Maximum photos per listing; hard limit is four.'
where key = 'listing_max_photos';

update public.app_settings
set value = '3145728'::jsonb, min_value = 1, max_value = 3145728,
    description = 'Maximum uploaded photo bytes; hard limit is 3 MiB.'
where key = 'listing_max_photo_bytes';

update storage.buckets
set file_size_limit = 3145728,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'listing-images';

alter table public.listing_flags
  add column resolved_at timestamptz,
  add column resolution_source text check (resolution_source is null or resolution_source in ('clean_photo_recheck')),
  add column resolution_reason text;

create table public.listing_photo_reviews (
  id bigint generated always as identity primary key,
  listing_id uuid not null,
  photo_url text not null,
  decision text not null check (decision in ('approved', 'replace', 'rejected', 'manual_review')),
  reason text not null check (length(reason) between 1 and 600),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  review_method text not null check (review_method in ('ai', 'system', 'manual_review')),
  created_at timestamptz not null default now()
);

create index listing_photo_reviews_latest_idx
  on public.listing_photo_reviews(listing_id, photo_url, created_at desc, id desc);

alter table public.listing_photo_reviews enable row level security;
revoke all on public.listing_photo_reviews from public, anon, authenticated;

create function public.enforce_listing_photo_moderation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status not in ('published', 'pending_approval')
    or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return new;
  end if;

  if exists (
    select 1
    from public.listing_images i
    left join lateral (
      select r.decision
      from public.listing_photo_reviews r
      where r.listing_id = new.id and r.photo_url = i.url
      order by r.created_at desc, r.id desc
      limit 1
    ) latest on true
    where i.listing_id = new.id and latest.decision is distinct from 'approved'
  ) then
    raise exception 'Every current listing photo must pass moderation before publication' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_listing_photo_moderation() from public, anon, authenticated;
create trigger z_listing_photo_moderation_guard
  before insert or update on public.listings
  for each row execute function public.enforce_listing_photo_moderation();

commit;
