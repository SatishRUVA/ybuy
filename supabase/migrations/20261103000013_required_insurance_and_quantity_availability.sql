begin;

create function public.get_listing_unavailable_dates_for_quantity(
  p_listing_id uuid,
  p_quantity integer,
  p_start date default current_date,
  p_end date default current_date + 366
) returns jsonb
language plpgsql
stable
security definer
set search_path = '' as $$
declare
  v_listing public.listings;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100
    or p_start is null or p_end is null or p_end <= p_start or p_end - p_start > 366 then
    raise exception 'Choose a valid quantity and availability range' using errcode = '22023';
  end if;

  select * into v_listing from public.listings where id = p_listing_id
    and (status = 'published' or (owner_id = auth.uid() and public.has_active_session()));
  if not found then raise exception 'Listing not found' using errcode = '42501'; end if;

  return jsonb_build_object(
    'blocked', coalesce((
      select jsonb_agg(a.date order by a.date) from public.listing_availability a
      where a.listing_id = p_listing_id and not a.is_available and a.date >= p_start and a.date < p_end
    ), '[]'::jsonb),
    'booked', coalesce((
      select jsonb_agg(day::date order by day) from generate_series(p_start::timestamp, (p_end - 1)::timestamp, interval '1 day') day
      where (
        select coalesce(sum(b.quantity), 0) from public.bookings b
        where b.listing_id = p_listing_id
          and b.status in ('requested', 'pending_payment', 'confirmed', 'active', 'return_pending')
          and (b.status <> 'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at > now())
          and b.start_date <= day::date and b.end_date > day::date
      ) + p_quantity > v_listing.available_quantity
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_listing_unavailable_dates_for_quantity(uuid, integer, date, date) from public;
grant execute on function public.get_listing_unavailable_dates_for_quantity(uuid, integer, date, date) to anon, authenticated;

create or replace function public.apply_booking_insurance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_item_value numeric(10,2);
  v_handoff jsonb;
  v_listing public.listings;
begin
  if tg_op = 'INSERT' then
    v_handoff := nullif(current_setting('ybuy.booking_handoff', true), '')::jsonb;
    if v_handoff is not null then
      new.delivery_mode := v_handoff->>'mode';
      new.renter_note := nullif(btrim(v_handoff->>'note'), '');
      select * into v_listing from public.listings where id = new.listing_id;
      if not found then raise exception 'Listing not found' using errcode = 'P0002'; end if;
      if new.delivery_mode = 'delivery' and not coalesce(v_listing.delivery_available, false) then
        raise exception 'Delivery is not available for this listing' using errcode = '23514';
      end if;
      new.delivery_fee_amount := case when new.delivery_mode = 'delivery' then round(coalesce(v_listing.delivery_fee, 0), 2) else 0 end;
    end if;
    select estimated_value into v_item_value from public.listings where id = new.listing_id;
    if not found then raise exception 'Listing value is unavailable for insurance pricing'; end if;
    new.insurance_amount := round(coalesce(v_item_value, 0) * 0.01 * new.days * new.quantity, 2);
  elsif new.insurance_amount is distinct from old.insurance_amount then
    raise exception 'Booking insurance amount is immutable' using errcode = '42501';
  end if;

  new.total := new.subtotal + new.service_fee_amount + new.deposit + new.insurance_amount + coalesce(new.delivery_fee_amount, 0);
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
