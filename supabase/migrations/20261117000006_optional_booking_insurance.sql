begin;

-- Restored from the applied migration ledger; SQL statements match version 20261117000006.
alter table public.bookings
  add column insurance_selected boolean not null default true;

create or replace function public.apply_booking_insurance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_item_value numeric(10,2);
  v_handoff jsonb;
  v_listing public.listings;
  v_insurance_selected text;
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

    v_insurance_selected := nullif(current_setting('ybuy.checkout_insurance_selected', true), '');
    if v_insurance_selected is not null then
      if v_insurance_selected not in ('true', 'false') then
        raise exception 'Invalid insurance selection' using errcode = '22023';
      end if;
      new.insurance_selected := v_insurance_selected::boolean;
    end if;

    if new.insurance_selected then
      select estimated_value into v_item_value from public.listings where id = new.listing_id;
      if not found then raise exception 'Listing value is unavailable for insurance pricing'; end if;
      new.insurance_amount := round(coalesce(v_item_value, 0) * 0.01 * new.days * new.quantity, 2);
    else
      new.insurance_amount := 0;
    end if;
  elsif new.insurance_selected is distinct from old.insurance_selected then
    raise exception 'Booking insurance selection is immutable' using errcode = '42501';
  elsif new.insurance_amount is distinct from old.insurance_amount then
    raise exception 'Booking insurance amount is immutable' using errcode = '42501';
  end if;

  new.total := new.subtotal + new.service_fee_amount + new.deposit + new.insurance_amount + coalesce(new.delivery_fee_amount, 0);
  return new;
end;
$$;

create function public.create_booking_request(
  p_listing_id uuid,
  p_start_date date,
  p_end_date date,
  p_quantity integer,
  p_delivery_mode text,
  p_renter_note text,
  p_insurance_selected boolean
) returns public.bookings
language plpgsql
security definer
set search_path = '' as $$
declare
  v_previous_selection text := coalesce(current_setting('ybuy.checkout_insurance_selected', true), '');
  v_booking public.bookings;
begin
  if p_insurance_selected is null then
    raise exception 'Choose whether to add optional insurance' using errcode = '22023';
  end if;

  perform set_config('ybuy.checkout_insurance_selected', p_insurance_selected::text, true);
  v_booking := public.create_booking_request(
    p_listing_id, p_start_date, p_end_date, p_quantity, p_delivery_mode, p_renter_note
  );
  perform set_config('ybuy.checkout_insurance_selected', v_previous_selection, true);
  return v_booking;
exception when others then
  perform set_config('ybuy.checkout_insurance_selected', v_previous_selection, true);
  raise;
end;
$$;

revoke all on function public.create_booking_request(uuid, date, date, integer, text, text, boolean)
  from public, anon, service_role;
grant execute on function public.create_booking_request(uuid, date, date, integer, text, text, boolean)
  to authenticated;

create or replace function public.add_insurance_to_agreement_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = new.booking_id;
  if found then
    new.snapshot := new.snapshot || jsonb_build_object(
      'insurance_amount', v_booking.insurance_amount,
      'insurance_selected', v_booking.insurance_selected,
      'delivery_mode', v_booking.delivery_mode,
      'delivery_fee_amount', v_booking.delivery_fee_amount,
      'renter_note', v_booking.renter_note
    );
  end if;
  return new;
end;
$$;
revoke all on function public.add_insurance_to_agreement_snapshot() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
