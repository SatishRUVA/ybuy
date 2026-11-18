begin;

alter table public.bookings
  add column if not exists delivery_mode text not null default 'pickup'
  check (delivery_mode in ('pickup', 'delivery')),
  add column if not exists delivery_fee_amount numeric(10,2) not null default 0
  check (delivery_fee_amount >= 0 and delivery_fee_amount < 1000000),
  add column if not exists renter_note text check (renter_note is null or length(renter_note) <= 500);

create or replace function public.create_booking_request(
  p_listing_id uuid,
  p_start_date date,
  p_end_date date,
  p_quantity integer,
  p_delivery_mode text,
  p_renter_note text
) returns public.bookings
language plpgsql
security definer
set search_path = '' as $$
declare
  v_mode text := lower(btrim(coalesce(p_delivery_mode, 'pickup')));
  v_note text := nullif(btrim(coalesce(p_renter_note, '')), '');
  v_listing public.listings;
  v_previous_handoff text := coalesce(current_setting('ybuy.booking_handoff', true), '');
  v_booking public.bookings;
begin
  perform public.operations_require_session();
  if v_mode not in ('pickup', 'delivery') then
    raise exception 'Choose pickup or delivery for handoff' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'Keep the booking note under 500 characters' using errcode = '22023';
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_mode = 'delivery' then
    if not coalesce(v_listing.delivery_available, false) then
      raise exception 'Delivery is not available for this listing' using errcode = '23514';
    end if;
  end if;

  -- Price handoff on INSERT, before the immutable rental agreement is captured.
  perform set_config('ybuy.booking_handoff', jsonb_build_object('mode', v_mode, 'note', v_note)::text, true);
  v_booking := public.create_booking_request(p_listing_id, p_start_date, p_end_date, p_quantity);
  perform set_config('ybuy.booking_handoff', v_previous_handoff, true);
  return v_booking;
end;
$$;

revoke all on function public.create_booking_request(uuid, date, date, integer, text, text) from public, anon;
grant execute on function public.create_booking_request(uuid, date, date, integer, text, text) to authenticated;

create or replace function public.create_booking_request_with_owner_promo(
  p_listing_id uuid,
  p_start_date date,
  p_end_date date,
  p_quantity integer,
  p_code text,
  p_delivery_mode text,
  p_renter_note text
) returns public.bookings
language plpgsql
security definer
set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  perform public.operations_require_session();
  perform set_config('ybuy.owner_promotion_code', coalesce(p_code, ''), true);
  v_booking := public.create_booking_request(
    p_listing_id,
    p_start_date,
    p_end_date,
    p_quantity,
    p_delivery_mode,
    p_renter_note
  );
  perform set_config('ybuy.owner_promotion_code', '', true);
  return v_booking;
end;
$$;

revoke all on function public.create_booking_request_with_owner_promo(uuid, date, date, integer, text, text, text) from public, anon;
grant execute on function public.create_booking_request_with_owner_promo(uuid, date, date, integer, text, text, text) to authenticated;

create or replace function public.apply_booking_insurance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_item_value numeric(10,2); v_handoff jsonb; v_listing public.listings;
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
    if exists (select 1 from public.feature_flags where key = 'insurance' and enabled) then
      select estimated_value into v_item_value from public.listings where id = new.listing_id;
      if not found then raise exception 'Listing value is unavailable for insurance pricing'; end if;
      new.insurance_amount := round(coalesce(v_item_value, 0) * 0.01 * new.days * new.quantity, 2);
    else
      new.insurance_amount := 0;
    end if;
  elsif new.insurance_amount is distinct from old.insurance_amount then
    raise exception 'Booking insurance amount is immutable' using errcode = '42501';
  end if;

  new.total := new.subtotal + new.service_fee_amount + new.deposit + new.insurance_amount + coalesce(new.delivery_fee_amount, 0);
  return new;
end;
$$;

create or replace function public.complete_booking_return(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_payment public.payments;
begin
  perform public.operations_require_session();
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking not found'; end if;
  if v_booking.owner_id <> auth.uid() then raise exception 'Only the owner can confirm return' using errcode='42501'; end if;
  if v_booking.status = 'completed' and v_booking.return_confirmed_at is not null then return v_booking; end if;
  if v_booking.status <> 'return_pending' then raise exception 'booking must be in return_pending to complete'; end if;
  select * into v_payment from public.payments where booking_id=p_booking_id and status='succeeded';
  if not found or v_payment.amount <> v_booking.total or v_payment.currency <> 'usd'
    or v_payment.stripe_payment_intent_id is null
    or (select count(*) from public.payments where booking_id=p_booking_id and status='succeeded') <> 1 then
    raise exception 'A single verified full payment is required before return settlement';
  end if;
  update public.bookings set status='completed',return_confirmed_at=now() where id=p_booking_id returning * into v_booking;
  insert into public.rental_settlements(booking_id,payment_id,deposit_amount,owner_amount,refund_status)
    values(p_booking_id,v_payment.id,v_booking.deposit,v_booking.subtotal + coalesce(v_booking.delivery_fee_amount, 0),
      case when v_booking.deposit=0 then 'not_required' else 'pending' end);
  return v_booking;
end;
$$;

create or replace function public.add_insurance_to_agreement_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = new.booking_id;
  if found then
    new.snapshot := new.snapshot || jsonb_build_object(
      'insurance_amount', v_booking.insurance_amount,
      'delivery_mode', v_booking.delivery_mode,
      'delivery_fee_amount', v_booking.delivery_fee_amount,
      'renter_note', v_booking.renter_note
    );
  end if;
  return new;
end;
$$;

create or replace function public.claim_rental_settlement(p_booking_id uuid, p_step text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_payment public.payments; v_row public.rental_settlements; v_account text;
begin
  if p_step not in ('refund', 'transfer') or p_step is null then raise exception 'Invalid settlement step'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  select * into v_row from public.rental_settlements where booking_id = p_booking_id for update;
  if not found or v_booking.status <> 'completed' or v_booking.return_confirmed_at is null then
    raise exception 'Owner-confirmed completed return required';
  end if;
  select * into v_payment from public.payments where id = v_row.payment_id for update;
  if v_payment.status <> 'succeeded' or v_payment.amount <> v_booking.total or v_payment.currency <> 'usd'
    or v_row.deposit_amount <> v_booking.deposit or v_row.owner_amount <> v_booking.subtotal + coalesce(v_booking.delivery_fee_amount, 0)
    or v_booking.total <> v_booking.subtotal + v_booking.service_fee_amount + v_booking.deposit + v_booking.insurance_amount + coalesce(v_booking.delivery_fee_amount, 0) then
    raise exception 'Payment or settlement amounts do not match the booking';
  end if;
  if exists (select 1 from public.operations_cases where booking_id = p_booking_id and kind = 'dispute' and status <> 'closed') then
    raise exception 'Settlement blocked by an unresolved dispute';
  end if;
  if exists (select 1 from public.refund_requests where payment_id = v_payment.id) then
    raise exception 'Existing manual refund request requires reconciliation';
  end if;
  if p_step = 'refund' then
    if v_row.refund_status = 'failed' then raise exception 'Failed deposit refund requires manual reconciliation'; end if;
    if v_row.refund_status in ('pending', 'processing') then
      if v_row.refund_id is null and v_row.refund_started_at < now() - interval '20 hours' then
        raise exception 'Unknown refund outcome requires manual reconciliation';
      end if;
      update public.rental_settlements set refund_status = 'processing',
        refund_started_at = coalesce(refund_started_at, now()) where booking_id = p_booking_id returning * into v_row;
    end if;
  else
    if v_row.refund_status not in ('succeeded', 'not_required') then raise exception 'Deposit refund must succeed before owner transfer'; end if;
    if exists (select 1 from public.payouts where booking_id = p_booking_id) then
      raise exception 'Legacy payout record requires manual reconciliation';
    end if;
    if v_row.transfer_status = 'reversed' then raise exception 'Reversed transfer requires manual reconciliation'; end if;
    if v_row.transfer_status in ('pending', 'processing') then
      select stripe_account_id into v_account from public.owner_connect_accounts where owner_id = v_booking.owner_id;
      if v_account is null then raise exception 'Owner must complete Stripe Connect setup'; end if;
      if v_row.destination_account is not null and v_row.destination_account <> v_account then
        raise exception 'Transfer destination changed; manual reconciliation required';
      end if;
      if v_row.transfer_id is null and v_row.transfer_started_at < now() - interval '20 hours' then
        raise exception 'Unknown transfer outcome requires manual reconciliation';
      end if;
      update public.rental_settlements set transfer_status = 'processing', destination_account = v_account,
        transfer_started_at = coalesce(transfer_started_at, now()) where booking_id = p_booking_id returning * into v_row;
    end if;
  end if;
  return to_jsonb(v_row) || jsonb_build_object('payment_intent_id', v_payment.stripe_payment_intent_id,
    'payment_amount', v_payment.amount, 'owner_id', v_booking.owner_id);
end;
$$;

commit;
