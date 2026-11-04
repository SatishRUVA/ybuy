begin;

create or replace function public.get_booking_precheckin(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; s public.booking_pickup_slots; a public.booking_deposit_authorizations;
  v_now timestamptz := clock_timestamp(); v_hold_ready boolean;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id and auth.uid() in (owner_id,renter_id);
  if not found then raise exception 'Booking not found' using errcode = '42501'; end if;
  select * into s from public.booking_pickup_slots where booking_id = b.id;
  select * into a from public.booking_deposit_authorizations where booking_id = b.id
    and not is_claim_authorization order by attempt desc limit 1;
  v_hold_ready := b.deposit <= 0 or (a.status = 'authorized' and a.authorized_amount >= b.deposit
    and a.capture_before > greatest(v_now, s.ends_at));
  return jsonb_build_object('payment_first', b.payment_first,
    'slot', case when s.booking_id is not null then to_jsonb(s) end, 'server_now', v_now,
    'can_authorize', b.status in ('active','return_pending','completed') or coalesce(b.status = 'confirmed' and s.status = 'approved'
      and v_now >= s.starts_at - interval '24 hours' and v_now < s.ends_at, false),
    'handoff_ready', coalesce(b.status = 'confirmed' and s.status = 'approved'
      and v_now >= s.starts_at and v_now < s.ends_at and coalesce(v_hold_ready, false), false),
    'deposit_ready', coalesce(v_hold_ready, false), 'delivery_mode', b.delivery_mode,
    'consented', b.deposit_hold_consent_at is not null);
end;
$$;

notify pgrst, 'reload schema';
commit;
