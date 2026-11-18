begin;

create function public.get_booking_pickup(p_booking_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_pickup jsonb;
begin
  perform public.operations_require_session();
  select jsonb_build_object(
    'address', p.address, 'city', p.city, 'state', p.state, 'postalCode', p.postal_code
  ) into v_pickup
  from public.bookings b
  join public.listing_pickup_locations p on p.listing_id = b.listing_id and p.owner_id = b.owner_id
  where b.id = p_booking_id
    and auth.uid() in (b.owner_id, b.renter_id)
    and b.status in ('confirmed', 'active', 'return_pending');
  if v_pickup is null then
    raise exception 'Pickup address is available only to participants of a confirmed booking' using errcode = '42501';
  end if;
  return v_pickup;
end;
$$;

revoke all on function public.get_booking_pickup(uuid) from public, anon;
grant execute on function public.get_booking_pickup(uuid) to authenticated;

commit;
