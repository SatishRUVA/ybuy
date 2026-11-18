-- JWT expiry alone does not revoke an access token when the user signs out.
create or replace function public.has_active_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = (auth.jwt() ->> 'session_id')::uuid
      and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
      and (auth.jwt() ->> 'exp')::numeric > extract(epoch from now())
  );
$$;

revoke all on function public.has_active_session() from public, anon;
grant execute on function public.has_active_session() to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'categories', 'listings', 'listing_images', 'listing_availability',
    'favorites', 'bookings', 'payments', 'payouts', 'conversations', 'messages',
    'reviews', 'listing_flags', 'listing_pickup_locations'
  ] loop
    execute format(
      'create policy active_session_required on public.%I as restrictive for all to authenticated
       using ((select public.has_active_session())) with check ((select public.has_active_session()))',
      table_name
    );
  end loop;
end;
$$;

create policy listing_images_active_session on storage.objects
as restrictive for all to authenticated
using (bucket_id <> 'listing-images' or (select public.has_active_session()))
with check (bucket_id <> 'listing-images' or (select public.has_active_session()));

-- SECURITY DEFINER booking RPCs bypass RLS; a statement trigger also guards their writes.
create or replace function public.require_active_booking_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not public.has_active_session() then
    raise exception 'Your session has expired. Please sign in again.' using errcode = '28000';
  end if;
  return null;
end;
$$;

revoke all on function public.require_active_booking_session() from public, anon, authenticated;
create trigger bookings_require_active_session
  before insert or update or delete on public.bookings
  for each statement execute function public.require_active_booking_session();

-- Preserve public profile joins without exposing contact details through the Data API.
revoke select on public.profiles from public, anon, authenticated;
revoke select (id, full_name, email, avatar_url, phone, location, created_at)
  on public.profiles from public, anon, authenticated;
grant select (id, full_name, avatar_url, created_at) on public.profiles to anon, authenticated;

create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.profiles where id = auth.uid() and public.has_active_session();
$$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- GRANT to a specific role does not remove PostgreSQL's default PUBLIC execution.
revoke execute on function public.create_booking_request(uuid, date, date, int) from public, anon;
revoke execute on function public.respond_to_booking_request(uuid, boolean) from public, anon;
revoke execute on function public.cancel_booking(uuid) from public, anon;
revoke execute on function public.mark_booking_active(uuid) from public, anon;
revoke execute on function public.start_booking_return(uuid) from public, anon;
revoke execute on function public.complete_booking_return(uuid) from public, anon;
revoke execute on function public.confirm_booking_payment(uuid, text, text, numeric)
  from public, anon, authenticated;

grant execute on function public.confirm_booking_payment(uuid, text, text, numeric) to service_role;
