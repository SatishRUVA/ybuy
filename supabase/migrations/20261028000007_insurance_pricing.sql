begin;

alter table public.bookings
  add column if not exists insurance_amount numeric(10,2) not null default 0
  check (insurance_amount >= 0 and insurance_amount < 100000000);

create or replace function public.apply_booking_insurance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_item_value numeric(10,2);
begin
  if tg_op = 'INSERT' then
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

  new.total := new.subtotal + new.service_fee_amount + new.deposit + new.insurance_amount;
  return new;
end;
$$;
revoke all on function public.apply_booking_insurance() from public, anon, authenticated;
drop trigger if exists zzzz_bookings_apply_insurance on public.bookings;
create trigger zzzz_bookings_apply_insurance before insert or update on public.bookings
  for each row execute function public.apply_booking_insurance();

create or replace function public.add_insurance_to_agreement_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_insurance_amount numeric(10,2);
begin
  select insurance_amount into v_insurance_amount from public.bookings where id = new.booking_id;
  if found then new.snapshot := new.snapshot || jsonb_build_object('insurance_amount', v_insurance_amount); end if;
  return new;
end;
$$;
revoke all on function public.add_insurance_to_agreement_snapshot() from public, anon, authenticated;
drop trigger if exists rental_agreement_insurance_snapshot on public.rental_agreements;
create trigger rental_agreement_insurance_snapshot before insert on public.rental_agreements
  for each row execute function public.add_insurance_to_agreement_snapshot();

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
    or v_row.deposit_amount <> v_booking.deposit or v_row.owner_amount <> v_booking.subtotal
    or v_booking.total <> v_booking.subtotal + v_booking.service_fee_amount + v_booking.deposit + v_booking.insurance_amount then
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