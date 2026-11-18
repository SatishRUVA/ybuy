begin;

create or replace function public.can_access_booking_inspection_photo(p_path text, p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_booking_id uuid;
  v_user_id uuid;
  v_kind text;
  v_booking public.bookings;
  v_handoff public.booking_handoffs;
begin
  if not public.has_active_session() or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(pickup|return)/[A-Za-z0-9._-]{1,140}$'
    or split_part(p_path, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or split_part(p_path, '/', 2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_booking_id := split_part(p_path, '/', 1)::uuid;
  v_user_id := split_part(p_path, '/', 2)::uuid;
  v_kind := split_part(p_path, '/', 3);
  select * into v_booking from public.bookings where id = v_booking_id;
  if not found or auth.uid() not in (v_booking.owner_id, v_booking.renter_id) then return false; end if;
  select * into v_handoff from public.booking_handoffs where booking_id = v_booking_id;
  if not found then return false; end if;
  if p_write then
    return v_user_id = auth.uid() and auth.uid() = v_booking.owner_id and (
      (v_kind = 'pickup' and v_booking.status = 'confirmed'
        and v_handoff.status in ('pickup_checkin_started', 'pickup_inspection'))
      or (v_kind = 'return' and v_booking.status = 'return_pending'
        and v_handoff.status = 'return_inspection')
    );
  end if;
  return exists (
    select 1 from public.booking_inspection_photos p
    join public.booking_inspections i on i.id = p.inspection_id
    where p.object_path = p_path and i.booking_id = v_booking_id and i.kind = v_kind
  );
end;
$$;

revoke all on function public.can_access_booking_inspection_photo(text, boolean) from public, anon;
grant execute on function public.can_access_booking_inspection_photo(text, boolean) to authenticated;

commit;
