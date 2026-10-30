-- Charge-and-refund deposits. Execution is separately gated to Stripe test mode in the worker.
alter table public.bookings add column return_confirmed_at timestamptz;

create unique index payments_checkout_unique on public.payments(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null and stripe_checkout_session_id <> 'demo_seed';
create unique index payments_intent_unique on public.payments(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null and stripe_payment_intent_id <> 'demo_seed';

create table public.owner_connect_accounts (
  owner_id uuid primary key references public.profiles(id),
  stripe_account_id text not null unique check (stripe_account_id like 'acct_%'),
  created_at timestamptz not null default now()
);
alter table public.owner_connect_accounts enable row level security;
revoke all on public.owner_connect_accounts from public, anon, authenticated;
grant select on public.owner_connect_accounts to authenticated;
grant all on public.owner_connect_accounts to service_role;
create policy owner_connect_read on public.owner_connect_accounts for select to authenticated
  using (owner_id = auth.uid() and public.has_active_session());

create table public.rental_settlements (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  deposit_amount numeric(10,2) not null check (deposit_amount >= 0),
  owner_amount numeric(10,2) not null check (owner_amount > 0),
  refund_status text not null check (refund_status in ('pending','processing','succeeded','not_required','failed')),
  refund_id text unique,
  refund_started_at timestamptz,
  transfer_status text not null default 'pending' check (transfer_status in ('pending','processing','succeeded','reversed')),
  transfer_id text unique,
  transfer_started_at timestamptz,
  destination_account text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger rental_settlements_updated before update on public.rental_settlements
  for each row execute function public.set_updated_at();
alter table public.rental_settlements enable row level security;
revoke all on public.rental_settlements from public, anon, authenticated;
grant select on public.rental_settlements to authenticated;
grant all on public.rental_settlements to service_role;
create policy settlement_participants on public.rental_settlements for select to authenticated
  using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id = booking_id and auth.uid() in (b.owner_id,b.renter_id)
  ));

-- A client can no longer claim that money moved by inserting a bookkeeping row.
drop policy if exists payouts_insert_own on public.payouts;
drop policy if exists payouts_update_own on public.payouts;
revoke insert, update, delete on public.payouts from authenticated;

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
    values(p_booking_id,v_payment.id,v_booking.deposit,v_booking.subtotal,
      case when v_booking.deposit=0 then 'not_required' else 'pending' end);
  return v_booking;
end;
$$;

create or replace function public.confirm_booking_payment(
  p_booking_id uuid,p_checkout_session_id text,p_payment_intent_id text,p_amount numeric
) returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_payment public.payments;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'booking not found'; end if;
  if p_amount is null or p_amount<>v_booking.total or p_amount<=0
    or coalesce(p_checkout_session_id,'') not like 'cs_%' or coalesce(p_payment_intent_id,'') not like 'pi_%' then
    raise exception 'Payment details do not match the booking';
  end if;
  select * into v_payment from public.payments where stripe_checkout_session_id=p_checkout_session_id;
  if found then
    if v_payment.booking_id<>p_booking_id or v_payment.stripe_payment_intent_id<>p_payment_intent_id
      or v_payment.amount<>p_amount or v_payment.status<>'succeeded' then
      raise exception 'Payment receipt conflicts with existing payment';
    end if;
    return v_booking;
  end if;
  if v_booking.status<>'pending_payment' then raise exception 'booking is not awaiting payment'; end if;
  if exists(select 1 from public.payments where booking_id=p_booking_id and status='succeeded') then
    raise exception 'Booking already has a successful payment';
  end if;
  insert into public.payments(booking_id,stripe_checkout_session_id,stripe_payment_intent_id,amount,status)
    values(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount,'succeeded');
  update public.bookings set status='confirmed' where id=p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

-- Lock eligibility and the fixed provider key together. Unknown outcomes cannot be re-created
-- after Stripe's 24-hour idempotency retention; they require operator reconciliation instead.
create function public.claim_rental_settlement(p_booking_id uuid,p_step text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_payment public.payments; v_row public.rental_settlements; v_account text;
begin
  if p_step not in ('refund','transfer') or p_step is null then raise exception 'Invalid settlement step'; end if;
  select * into v_booking from public.bookings where id=p_booking_id for update;
  select * into v_row from public.rental_settlements where booking_id=p_booking_id for update;
  if not found or v_booking.status<>'completed' or v_booking.return_confirmed_at is null then
    raise exception 'Owner-confirmed completed return required';
  end if;
  select * into v_payment from public.payments where id=v_row.payment_id for update;
  if v_payment.status<>'succeeded' or v_payment.amount<>v_booking.total or v_payment.currency<>'usd'
    or v_row.deposit_amount<>v_booking.deposit or v_row.owner_amount<>v_booking.subtotal
    or v_booking.total<>v_booking.subtotal+v_booking.service_fee_amount+v_booking.deposit then
    raise exception 'Payment or settlement amounts do not match the booking';
  end if;
  if exists(select 1 from public.operations_cases where booking_id=p_booking_id and kind='dispute' and status<>'closed') then
    raise exception 'Settlement blocked by an unresolved dispute';
  end if;
  if exists(select 1 from public.refund_requests where payment_id=v_payment.id) then
    raise exception 'Existing manual refund request requires reconciliation';
  end if;
  if p_step='refund' then
    if v_row.refund_status='failed' then raise exception 'Failed deposit refund requires manual reconciliation'; end if;
    if v_row.refund_status in ('pending','processing') then
      if v_row.refund_id is null and v_row.refund_started_at < now()-interval '20 hours' then
        raise exception 'Unknown refund outcome requires manual reconciliation';
      end if;
      update public.rental_settlements set refund_status='processing',
        refund_started_at=coalesce(refund_started_at,now()) where booking_id=p_booking_id returning * into v_row;
    end if;
  else
    if v_row.refund_status not in ('succeeded','not_required') then raise exception 'Deposit refund must succeed before owner transfer'; end if;
    if exists(select 1 from public.payouts where booking_id=p_booking_id) then
      raise exception 'Legacy payout record requires manual reconciliation';
    end if;
    if v_row.transfer_status='reversed' then raise exception 'Reversed transfer requires manual reconciliation'; end if;
    if v_row.transfer_status in ('pending','processing') then
      select stripe_account_id into v_account from public.owner_connect_accounts where owner_id=v_booking.owner_id;
      if v_account is null then raise exception 'Owner must complete Stripe Connect setup'; end if;
      if v_row.destination_account is not null and v_row.destination_account<>v_account then
        raise exception 'Transfer destination changed; manual reconciliation required';
      end if;
      if v_row.transfer_id is null and v_row.transfer_started_at < now()-interval '20 hours' then
        raise exception 'Unknown transfer outcome requires manual reconciliation';
      end if;
      update public.rental_settlements set transfer_status='processing',destination_account=v_account,
        transfer_started_at=coalesce(transfer_started_at,now()) where booking_id=p_booking_id returning * into v_row;
    end if;
  end if;
  return to_jsonb(v_row)||jsonb_build_object('payment_intent_id',v_payment.stripe_payment_intent_id,
    'payment_amount',v_payment.amount,'owner_id',v_booking.owner_id);
end;
$$;
revoke all on function public.claim_rental_settlement(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_rental_settlement(uuid,text) to service_role;

create function public.record_rental_settlement(p_booking_id uuid,p_step text,p_provider_id text,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.rental_settlements; v_booking public.bookings;
begin
  select * into v_row from public.rental_settlements where booking_id=p_booking_id for update;
  if not found then raise exception 'Settlement not found'; end if;
  if p_step='refund' and p_provider_id like 're_%' and p_status in ('processing','succeeded','failed')
    and v_row.refund_status in ('processing',p_status)
    and (v_row.refund_id is null or v_row.refund_id=p_provider_id) then
    update public.rental_settlements set refund_id=p_provider_id,refund_status=p_status where booking_id=p_booking_id;
  elsif p_step='transfer' and p_provider_id like 'tr_%' and p_status in ('succeeded','reversed')
    and v_row.transfer_status in ('processing','succeeded',p_status)
    and not (v_row.transfer_status='reversed' and p_status='succeeded')
    and (v_row.transfer_id is null or v_row.transfer_id=p_provider_id) then
    update public.rental_settlements set transfer_id=p_provider_id,transfer_status=p_status where booking_id=p_booking_id;
  else raise exception 'Conflicting settlement receipt'; end if;
  select * into v_booking from public.bookings where id=p_booking_id;
  if p_step='refund' and v_row.refund_status<>p_status then
    perform public.create_notification(v_booking.renter_id,'deposit:'||p_booking_id||':'||p_status,'payments',
      case when p_status='succeeded' then 'Deposit refunded' when p_status='failed' then 'Deposit refund needs attention' else 'Deposit refund processing' end,
      'Deposit refund status: '||p_status||'. Check your rental for details.','/confirmation/'||p_booking_id);
  elsif p_step='transfer' and v_row.transfer_status<>p_status then
    perform public.create_notification(v_booking.owner_id,'transfer:'||p_booking_id||':'||p_status,'payments',
      case when p_status='succeeded' then 'Earnings transferred to Stripe' else 'Earnings transfer reversed' end,
      'Stripe Connect transfer status: '||p_status||'. This is not confirmation of a bank payout.','/dashboard');
  end if;
end;
$$;
revoke all on function public.record_rental_settlement(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_rental_settlement(uuid,text,text,text) to service_role;
