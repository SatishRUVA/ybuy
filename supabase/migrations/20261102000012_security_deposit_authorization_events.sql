begin;

alter table public.booking_deposit_authorizations
  add column if not exists setup_attempt integer not null default 1 check(setup_attempt>0),
  add column if not exists is_claim_authorization boolean not null default false,
  add column if not exists authorization_checkout_session_id text
    check(authorization_checkout_session_id is null or authorization_checkout_session_id like 'cs_%'),
  add column if not exists supersedes_authorization_id uuid references public.booking_deposit_authorizations(id),
  add column if not exists last_attempt_at timestamptz;
alter table public.booking_deposit_authorizations alter column stripe_customer_id drop not null;
alter table public.booking_deposit_authorization_events add column if not exists operation_key text unique;
create unique index if not exists booking_deposit_auth_checkout_session_unique
  on public.booking_deposit_authorizations(authorization_checkout_session_id)
  where authorization_checkout_session_id is not null;

insert into public.app_settings(key,value,value_type,min_value,max_value,description,is_public) values
  ('deposit_authorization_lead_hours','24','integer',1,168,'Hours before rental pickup to request the initial security-deposit authorization.',false),
  ('deposit_reauthorization_safety_hours','24','integer',1,72,'Hours before an authorization expires to request a replacement hold.',false)
on conflict(key) do nothing;

create function public.prepare_booking_deposit_authorization(p_booking_id uuid,p_renter_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  a public.booking_deposit_authorizations;
  v_customer public.renter_stripe_customers;
  v_attempt integer;
  v_lead_hours integer;
  v_safety_hours integer;
  v_rental_return timestamptz;
  v_claim_id uuid;
  v_claim_status text;
  v_claim_approved numeric;
  v_has_claim boolean:=false;
  v_authorized_amount numeric;
begin
  select * into b from public.bookings where id=p_booking_id and renter_id=p_renter_id for update;
  if not found or b.deposit_collection_model<>'authorization' or b.deposit<=0 or b.deposit_hold_consent_at is null
    or (b.status not in ('pending_payment','confirmed','active','completed')
      and not (b.status='cancelled' and exists(select 1 from public.payments where booking_id=b.id and status='succeeded'))
      and not (b.status='completed' and exists(select 1 from public.booking_deposit_claims claim
        where claim.booking_id=b.id and claim.status in ('approved','payment_required')))) then
    raise exception 'Booking is not eligible for deposit authorization' using errcode='55000';
  end if;
  select * into v_customer from public.renter_stripe_customers where renter_id=p_renter_id;
  if not found or v_customer.default_payment_method_id is null then
    raise exception 'Save a payment method before authorizing the security deposit' using errcode='55000';
  end if;
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key='deposit_authorization_lead_hours'),24),
         coalesce((select (value #>> '{}')::integer from public.app_settings where key='deposit_reauthorization_safety_hours'),24)
    into v_lead_hours,v_safety_hours;
  if b.status in ('confirmed','active') and (b.start_date::timestamp at time zone current_setting('TimeZone'))>clock_timestamp()+make_interval(hours=>v_lead_hours) then
    raise exception 'Deposit authorization is scheduled closer to pickup' using errcode='55000';
  end if;
  v_rental_return:=((b.end_date+1)::timestamp at time zone current_setting('TimeZone'));
  select id,status,approved_amount into v_claim_id,v_claim_status,v_claim_approved
    from public.booking_deposit_claims where booking_id=b.id for update;
  v_has_claim:=found;
  v_authorized_amount:=case when v_has_claim and v_claim_status in ('approved','payment_required') and v_claim_approved>0
    then v_claim_approved else b.deposit end;
  select * into a from public.booking_deposit_authorizations where booking_id=b.id order by attempt desc limit 1 for update;
  if not found then raise exception 'Deposit authorization record is missing' using errcode='55000';end if;
  if a.status='authorized' and a.authorized_amount>=v_authorized_amount and a.capture_before>v_rental_return then
    return to_jsonb(a)||jsonb_build_object('ready',true,'already_authorized',true);
  end if;
  if a.status='authorized' and a.authorized_amount>=v_authorized_amount
    and a.capture_before>clock_timestamp()+make_interval(hours=>v_safety_hours) then
    return to_jsonb(a)||jsonb_build_object('ready',true,'already_authorized',true,'reauthorize_after',a.capture_before-make_interval(hours=>v_safety_hours));
  end if;
  if a.status in ('scheduled','authorizing','requires_action') and a.authorization_checkout_session_id is not null then
    return to_jsonb(a)||jsonb_build_object('ready',false,'already_authorized',false);
  end if;
  if a.status not in ('setup_required','scheduled','authorizing','requires_action','failed','expired','released','authorized','superseded') then
    raise exception 'Deposit authorization is not available for retry' using errcode='55000';
  end if;
  v_attempt:=a.attempt+1;
  insert into public.booking_deposit_authorizations(
    booking_id,attempt,renter_id,owner_id,stripe_customer_id,stripe_payment_method_id,authorized_amount,
    status,idempotency_key,supersedes_authorization_id,is_claim_authorization
  ) values(b.id,v_attempt,b.renter_id,b.owner_id,v_customer.stripe_customer_id,v_customer.default_payment_method_id,
    v_authorized_amount,'scheduled','deposit-auth:'||b.id::text||':'||v_attempt,
    case when a.status='authorized' then a.id else a.supersedes_authorization_id end,
    v_has_claim and v_claim_status in ('approved','payment_required'))
    returning * into a;
  if v_has_claim and v_claim_status in ('approved','payment_required') then
    update public.booking_deposit_claims set authorization_id=a.id where id=v_claim_id;
  end if;
  return to_jsonb(a)||jsonb_build_object('ready',false,'already_authorized',false);
end;
$$;
revoke all on function public.prepare_booking_deposit_authorization(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_booking_deposit_authorization(uuid,uuid) to service_role;

create function public.bind_deposit_authorization_checkout_session(p_authorization_id uuid,p_session_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_session_id,'') not like 'cs_%' then raise exception 'Invalid authorization Checkout Session' using errcode='22023';end if;
  update public.booking_deposit_authorizations set authorization_checkout_session_id=p_session_id,
    last_attempt_at=clock_timestamp(),status='authorizing',updated_at=clock_timestamp()
    where id=p_authorization_id and status='scheduled';
  if not found then raise exception 'Deposit authorization attempt is no longer available' using errcode='40001';end if;
end;
$$;
revoke all on function public.bind_deposit_authorization_checkout_session(uuid,text) from public,anon,authenticated;
grant execute on function public.bind_deposit_authorization_checkout_session(uuid,text) to service_role;

create or replace function public.record_deposit_authorization_event(
  p_event_id text,p_event_type text,p_authorization_id uuid,p_booking_id uuid,p_payment_intent_id text,
  p_payment_intent_status text,p_payment_method_id text,p_amount numeric,p_captured_amount numeric,p_amount_capturable numeric,
  p_capture_before timestamptz,p_failure_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.booking_deposit_authorizations;
  v_status text;
  v_inserted integer;
begin
  if coalesce(p_event_id,'') !~ '^evt_[A-Za-z0-9]+$'
    or p_event_type not in ('payment_intent.amount_capturable_updated','payment_intent.succeeded','payment_intent.canceled',
      'payment_intent.payment_failed','payment_intent.requires_action')
    or coalesce(p_payment_intent_id,'') not like 'pi_%'
    or (p_payment_method_id is not null and p_payment_method_id not like 'pm_%') or p_amount is null or p_amount<0
    or p_captured_amount is null or p_captured_amount<0 or p_amount_capturable is null or p_amount_capturable<0 then
    raise exception 'Invalid deposit authorization event' using errcode='22023';
  end if;
  select * into a from public.booking_deposit_authorizations where id=p_authorization_id and booking_id=p_booking_id for update;
  if not found or p_amount<>a.authorized_amount
    or (a.stripe_payment_intent_id is not null and a.stripe_payment_intent_id<>p_payment_intent_id) then
    raise exception 'Deposit PaymentIntent does not match the authorization record' using errcode='23514';
  end if;
  insert into public.booking_deposit_authorization_events(authorization_id,stripe_event_id,event_type,status,amount,detail)
    values(a.id,p_event_id,p_event_type,p_payment_intent_status,p_captured_amount,
      jsonb_build_object('amount',p_amount,'amount_capturable',p_amount_capturable,'capture_before',p_capture_before))
    on conflict(stripe_event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return;end if;
  v_status:=case p_payment_intent_status
    when 'requires_capture' then 'authorized'
    when 'succeeded' then 'captured'
    when 'canceled' then case
      when exists(select 1 from public.booking_deposit_authorizations newer
        where newer.booking_id=a.booking_id and newer.attempt>a.attempt and newer.status='authorized') then 'superseded'
      when a.capture_before is not null and a.capture_before<=clock_timestamp() then 'expired' else 'released' end
    when 'requires_payment_method' then 'failed'
    when 'requires_action' then 'requires_action'
    when 'processing' then 'authorizing'
    else a.status
  end;
  if p_payment_intent_status='requires_capture'
    and (p_payment_intent_status<>'requires_capture' or p_amount_capturable<>p_amount
      or p_capture_before is null or p_capture_before<=clock_timestamp()) then
    raise exception 'Deposit authorization is not capturable or has no valid expiry' using errcode='23514';
  end if;
  if p_payment_intent_status='succeeded'
    and (p_payment_intent_status<>'succeeded' or p_captured_amount>p_amount) then
    raise exception 'Deposit capture amount is invalid' using errcode='23514';
  end if;
  if p_payment_intent_status='succeeded' and not exists(
    select 1 from public.booking_deposit_claims claim where claim.authorization_id=a.id
      and claim.status in ('approved','capturing','captured') and claim.approved_amount=p_captured_amount
  ) then raise exception 'Deposit capture has no matching approved damage claim' using errcode='23514';end if;
  update public.booking_deposit_authorizations set stripe_payment_intent_id=p_payment_intent_id,
    stripe_payment_method_id=coalesce(p_payment_method_id,stripe_payment_method_id),status=v_status,
    captured_amount=case when p_payment_intent_status='succeeded' then p_captured_amount else captured_amount end,
    authorization_at=case when p_payment_intent_status='requires_capture' then coalesce(authorization_at,clock_timestamp()) else authorization_at end,
    capture_before=coalesce(p_capture_before,capture_before),
    released_at=case when v_status in ('released','expired') then clock_timestamp() else released_at end,
    captured_at=case when v_status='captured' then clock_timestamp() else captured_at end,
    failure_reason=case when v_status='failed' then left(coalesce(p_failure_reason,'Authorization failed'),500) else null end,
    updated_at=clock_timestamp()
    where id=a.id;
  if p_payment_intent_status='succeeded' then
    update public.booking_deposit_claims set status='captured',captured_at=clock_timestamp()
      where authorization_id=a.id and status in ('approved','capturing') and approved_amount=p_captured_amount;
  end if;
end;
$$;
revoke all on function public.record_deposit_authorization_event(text,text,uuid,uuid,text,text,text,numeric,numeric,numeric,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.record_deposit_authorization_event(text,text,uuid,uuid,text,text,text,numeric,numeric,numeric,timestamptz,text)
  to service_role;

notify pgrst,'reload schema';
commit;
