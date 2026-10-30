-- Incomplete private drafts remain saveable; submission and live edits require a description.
create or replace function public.require_listing_description()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('published', 'pending_approval')
    and (tg_op = 'INSERT' or new.status is distinct from old.status
      or new.description is distinct from old.description) then
    if char_length(regexp_replace(coalesce(new.description, ''), '^\s+|\s+$', '', 'g')) < 10 then
      raise exception 'Description must be at least 10 characters.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.require_listing_description() from public, anon, authenticated;

create trigger listings_require_description
  before insert or update on public.listings
  for each row execute function public.require_listing_description();
