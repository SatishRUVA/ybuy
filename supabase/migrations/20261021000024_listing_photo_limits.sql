begin;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'listing-images';

drop policy if exists "listing_images_storage_public_read" on storage.objects;
create policy "listing_images_storage_published_or_own_read" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'listing-images'
    and exists (
      select 1 from public.listings l
      where l.id::text = (storage.foldername(name))[1]
        and (l.status = 'published' or l.owner_id = auth.uid())
    )
  );

create function public.enforce_listing_photo_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  photo_count integer;
begin
  perform 1 from public.listings where id = new.listing_id for update;
  select count(*) into photo_count from public.listing_images where listing_id = new.listing_id;
  if photo_count >= 6 then
    raise exception 'A listing can have at most six photos.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_listing_photo_limit() from public, anon, authenticated;
create trigger listing_images_enforce_photo_limit
  before insert on public.listing_images
  for each row execute function public.enforce_listing_photo_limit();

commit;
