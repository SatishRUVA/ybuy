begin;

alter table public.bookings
  add column deposit_collection_model text not null default 'captured'
    check(deposit_collection_model in ('captured','authorization')),
  add column deposit_hold_consent_at timestamptz;

create table public.renter_stripe_customers (
  renter_id uuid primary key references public.profiles(id) on delete restrict,
  stripe_customer_id text not null unique check(stripe_customer_id like 'cus_%'),
  default_payment_method_id text check(default_payment_method_id is null or default_payment_method_id like 'pm_%'),
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.renter_stripe_customers enable row level security;
revoke all on public.renter_stripe_customers from public,anon,authenticated;
grant select on public.renter_stripe_customers to authenticated;
grant all on public.renter_stripe_customers to service_role;
create policy renter_stripe_customer_read on public.renter_stripe_customers
  for select to authenticated using(public.has_active_session() and renter_id=auth.uid());

create table public.booking_deposit_authorizations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  attempt integer not null check(attempt>0),
  renter_id uuid not null references public.profiles(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  stripe_customer_id text check(stripe_customer_id is null or stripe_customer_id like 'cus_%'),
  stripe_payment_method_id text check(stripe_payment_method_id is null or stripe_payment_method_id like 'pm_%'),
  stripe_setup_intent_id text check(stripe_setup_intent_id is null or stripe_setup_intent_id like 'seti_%'),
  stripe_checkout_session_id text check(stripe_checkout_session_id is null or stripe_checkout_session_id like 'cs_%'),
  stripe_payment_intent_id text unique check(stripe_payment_intent_id is null or stripe_payment_intent_id like 'pi_%'),
  authorized_amount numeric(10,2) not null check(authorized_amount>=0),
  captured_amount numeric(10,2) not null default 0 check(captured_amount>=0 and captured_amount<=authorized_amount),
  status text not null check(status in ('setup_required','scheduled','authorizing','requires_action','authorized','releasing','released','capturing','captured','expired','failed','superseded')),
  authorization_at timestamptz,
  capture_before timestamptz,
  released_at timestamptz,
  captured_at timestamptz,
  failure_reason text check(failure_reason is null or length(failure_reason)<=500),
  is_claim_authorization boolean not null default false,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(booking_id,attempt)
);
create index booking_deposit_auth_booking_idx on public.booking_deposit_authorizations(booking_id,attempt desc);
create index booking_deposit_auth_due_idx on public.booking_deposit_authorizations(status,capture_before);
alter table public.booking_deposit_authorizations enable row level security;
revoke all on public.booking_deposit_authorizations from public,anon,authenticated;
grant select on public.booking_deposit_authorizations to authenticated;
grant all on public.booking_deposit_authorizations to service_role;
create policy booking_deposit_auth_participant_read on public.booking_deposit_authorizations
  for select to authenticated using(public.has_active_session() and auth.uid() in (renter_id,owner_id));

create table public.booking_deposit_authorization_events (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references public.booking_deposit_authorizations(id) on delete restrict,
  stripe_event_id text unique,
  event_type text not null,
  status text not null,
  amount numeric(10,2) not null default 0 check(amount>=0),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.booking_deposit_authorization_events enable row level security;
revoke all on public.booking_deposit_authorization_events from public,anon,authenticated;
grant select on public.booking_deposit_authorization_events to authenticated;
grant all on public.booking_deposit_authorization_events to service_role;
create policy booking_deposit_auth_events_participant_read on public.booking_deposit_authorization_events
  for select to authenticated using(public.has_active_session() and exists(
    select 1 from public.booking_deposit_authorizations a where a.id=authorization_id and auth.uid() in (a.renter_id,a.owner_id)
  ));

create function public.capture_booking_deposit_authorization_model()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.auction_bid_id is not null or auth.uid() is not null then
    new.deposit_collection_model:='authorization';
  end if;
  if new.deposit_collection_model='authorization' then
    new.total:=new.total-new.deposit;
    if new.total<0 then raise exception 'Booking payment cannot be negative' using errcode='23514';end if;
  end if;
  return new;
end;
$$;
revoke all on function public.capture_booking_deposit_authorization_model() from public,anon,authenticated;
create trigger zzzzzz_bookings_deposit_authorization_model
  before insert on public.bookings for each row execute function public.capture_booking_deposit_authorization_model();

create function public.create_booking_deposit_authorization_record()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deposit_collection_model='authorization' and new.deposit>0 then
    insert into public.booking_deposit_authorizations(
      booking_id,attempt,renter_id,owner_id,stripe_customer_id,authorized_amount,status,idempotency_key
    ) select new.id,1,new.renter_id,new.owner_id,c.stripe_customer_id,new.deposit,'scheduled',
      'deposit-auth:'||new.id::text||':1'
      from public.renter_stripe_customers c where c.renter_id=new.renter_id
    on conflict(booking_id,attempt) do nothing;
    if not found then
      insert into public.booking_deposit_authorizations(
        booking_id,attempt,renter_id,owner_id,stripe_customer_id,authorized_amount,status,idempotency_key
      ) values(new.id,1,new.renter_id,new.owner_id,null,new.deposit,
        'setup_required','deposit-auth:'||new.id::text||':1') on conflict(booking_id,attempt) do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.create_booking_deposit_authorization_record() from public,anon,authenticated;
create trigger booking_deposit_authorization_record
  after insert on public.bookings for each row execute function public.create_booking_deposit_authorization_record();

create function public.record_deposit_hold_consent(p_booking_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_consented timestamptz;
begin
  perform public.operations_require_session();
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found or v_booking.renter_id is distinct from auth.uid() then raise exception 'Booking not found' using errcode='42501';end if;
  if v_booking.deposit_collection_model<>'authorization' or v_booking.deposit<=0 then
    raise exception 'This booking does not require a separate deposit authorization' using errcode='22023';
  end if;
  if v_booking.status not in ('requested','pending_payment','confirmed') then raise exception 'Deposit consent is no longer available' using errcode='55000';end if;
  update public.bookings set deposit_hold_consent_at=coalesce(deposit_hold_consent_at,clock_timestamp())
    where id=p_booking_id returning deposit_hold_consent_at into v_consented;
  return v_consented;
end;
$$;
revoke all on function public.record_deposit_hold_consent(uuid) from public,anon;
grant execute on function public.record_deposit_hold_consent(uuid) to authenticated;

create function public.complete_booking_deposit_setup(
  p_booking_id uuid,p_setup_intent_id text,p_checkout_session_id text,p_customer_id text,p_payment_method_id text
) returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; a public.booking_deposit_authorizations;
begin
  if coalesce(p_setup_intent_id,'') not like 'seti_%' or coalesce(p_checkout_session_id,'') not like 'cs_%'
    or coalesce(p_customer_id,'') not like 'cus_%' or coalesce(p_payment_method_id,'') not like 'pm_%' then
    raise exception 'Invalid Stripe setup receipt' using errcode='22023';
  end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.deposit_collection_model<>'authorization' or b.deposit<=0 or b.deposit_hold_consent_at is null then
    raise exception 'Booking is not eligible for deposit setup' using errcode='55000';
  end if;
  insert into public.renter_stripe_customers(renter_id,stripe_customer_id,default_payment_method_id,consent_at)
    values(b.renter_id,p_customer_id,p_payment_method_id,b.deposit_hold_consent_at)
    on conflict(renter_id) do update set stripe_customer_id=excluded.stripe_customer_id,
      default_payment_method_id=excluded.default_payment_method_id,consent_at=excluded.consent_at,updated_at=clock_timestamp()
      where public.renter_stripe_customers.stripe_customer_id=excluded.stripe_customer_id;
  select * into a from public.booking_deposit_authorizations where booking_id=p_booking_id order by attempt desc limit 1 for update;
  if not found then raise exception 'Deposit authorization record is missing' using errcode='55000';end if;
  update public.booking_deposit_authorizations set stripe_customer_id=p_customer_id,stripe_payment_method_id=p_payment_method_id,
    stripe_setup_intent_id=p_setup_intent_id,stripe_checkout_session_id=p_checkout_session_id,
    status=case when status='setup_required' then 'scheduled' else status end,updated_at=clock_timestamp()
    where id=a.id;
end;
$$;
revoke all on function public.complete_booking_deposit_setup(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_booking_deposit_setup(uuid,text,text,text,text) to service_role;

create or replace function public.mark_booking_active(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;
begin
  perform public.operations_require_session();
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode='P0002';end if;
  if v_booking.renter_id<>auth.uid() and v_booking.owner_id<>auth.uid() then raise exception 'Not a participant in this booking' using errcode='42501';end if;
  if v_booking.status<>'confirmed' then raise exception 'Booking must be confirmed before check-in' using errcode='55000';end if;
  if v_booking.deposit_collection_model='authorization' and v_booking.deposit>0 and not exists(
    select 1 from public.booking_deposit_authorizations a where a.booking_id=v_booking.id and a.status='authorized'
      and a.capture_before>clock_timestamp()
  ) then raise exception 'Security deposit authorization must be confirmed before pickup' using errcode='55000';end if;
  update public.bookings set status='active' where id=p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;
revoke all on function public.mark_booking_active(uuid) from public,anon;
grant execute on function public.mark_booking_active(uuid) to authenticated;

create function public.settle_deposit_model_for_rental_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.bookings b where b.id=new.booking_id and b.deposit_collection_model='authorization') then
    new.deposit_amount:=0;
    new.refund_status:='not_required';
  end if;
  return new;
end;
$$;
revoke all on function public.settle_deposit_model_for_rental_settlement() from public,anon,authenticated;
create trigger rental_settlement_deposit_model before insert on public.rental_settlements
  for each row execute function public.settle_deposit_model_for_rental_settlement();

create or replace function public.claim_rental_settlement(p_booking_id uuid,p_step text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_payment public.payments; v_row public.rental_settlements; v_account text; v_expected_total numeric;
begin
  if p_step not in ('refund','transfer') or p_step is null then raise exception 'Invalid settlement step';end if;
  select * into v_booking from public.bookings where id=p_booking_id for update;
  select * into v_row from public.rental_settlements where booking_id=p_booking_id for update;
  if not found or v_booking.status<>'completed' or v_booking.return_confirmed_at is null then
    raise exception 'Owner-confirmed completed return required';
  end if;
  select * into v_payment from public.payments where id=v_row.payment_id for update;
  v_expected_total:=v_booking.subtotal+v_booking.service_fee_amount+v_booking.insurance_amount
    +coalesce(v_booking.delivery_fee_amount,0)+v_booking.tax_amount
    +case when v_booking.deposit_collection_model='captured' then v_booking.deposit else 0 end;
  if v_payment.status<>'succeeded' or v_payment.amount<>v_booking.total or v_payment.currency<>'usd'
    or v_booking.total<>v_expected_total
    or (v_booking.deposit_collection_model='captured' and v_row.deposit_amount<>v_booking.deposit)
    or (v_booking.deposit_collection_model='authorization' and (v_row.deposit_amount<>0 or v_row.refund_status<>'not_required'))
    or v_row.owner_amount<>v_booking.subtotal+coalesce(v_booking.delivery_fee_amount,0) then
    raise exception 'Payment or settlement amounts do not match the booking';
  end if;
  if exists(select 1 from public.operations_cases where booking_id=p_booking_id and kind='dispute' and status<>'closed') then
    raise exception 'Settlement blocked by an unresolved dispute';
  end if;
  if exists(select 1 from public.refund_requests where payment_id=v_payment.id) then
    raise exception 'Existing manual refund request requires reconciliation';
  end if;
  if p_step='refund' then
    if v_row.refund_status='failed' then raise exception 'Failed deposit refund requires manual reconciliation';end if;
    if v_row.refund_status in ('pending','processing') then
      if v_row.refund_id is null and v_row.refund_started_at<now()-interval '20 hours' then raise exception 'Unknown refund outcome requires manual reconciliation';end if;
      update public.rental_settlements set refund_status='processing',refund_started_at=coalesce(refund_started_at,now())
        where booking_id=p_booking_id returning * into v_row;
    end if;
  else
    if v_row.refund_status not in ('succeeded','not_required') then raise exception 'Deposit refund must succeed before owner transfer';end if;
    if exists(select 1 from public.payouts where booking_id=p_booking_id) then raise exception 'Legacy payout record requires manual reconciliation';end if;
    if v_row.transfer_status='reversed' then raise exception 'Reversed transfer requires manual reconciliation';end if;
    if v_row.transfer_status in ('pending','processing') then
      select stripe_account_id into v_account from public.owner_connect_accounts where owner_id=v_booking.owner_id;
      if v_account is null then raise exception 'Owner must complete Stripe Connect setup';end if;
      if v_row.destination_account is not null and v_row.destination_account<>v_account then raise exception 'Transfer destination changed; manual reconciliation required';end if;
      if v_row.transfer_id is null and v_row.transfer_started_at<now()-interval '20 hours' then raise exception 'Unknown transfer outcome requires manual reconciliation';end if;
      update public.rental_settlements set transfer_status='processing',destination_account=v_account,transfer_started_at=coalesce(transfer_started_at,now())
        where booking_id=p_booking_id returning * into v_row;
    end if;
  end if;
  return to_jsonb(v_row)||jsonb_build_object('payment_intent_id',v_payment.stripe_payment_intent_id,'payment_amount',v_payment.amount,'owner_id',v_booking.owner_id);
end;
$$;
revoke all on function public.claim_rental_settlement(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_rental_settlement(uuid,text) to service_role;

commit;
