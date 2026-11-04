begin;

alter table public.bookings add column payment_first boolean not null default false;
alter table public.bookings alter column payment_first set default true;

create or replace function public.capture_booking_deposit_authorization_model()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then new.payment_first := true; end if;
  if new.payment_first or new.auction_bid_id is not null or auth.uid() is not null then
    new.deposit_collection_model := 'authorization';
  end if;
  if new.deposit_collection_model = 'authorization' then
    new.total := new.total - new.deposit;
    if new.total < 0 then raise exception 'Booking payment cannot be negative' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;

create function public.prevent_booking_payment_first_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.payment_first is distinct from old.payment_first then
    raise exception 'Booking payment sequence is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_booking_payment_first_change() from public,anon,authenticated;
create trigger booking_payment_first_immutable before update of payment_first on public.bookings
  for each row execute function public.prevent_booking_payment_first_change();

create table public.booking_pickup_slots (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null,
  status text not null check (status in ('proposed', 'approved', 'declined')),
  proposed_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  check (ends_at = starts_at + interval '30 minutes')
);
alter table public.booking_pickup_slots enable row level security;
revoke all on public.booking_pickup_slots from public, anon, authenticated;
grant select on public.booking_pickup_slots to authenticated;
grant select on public.booking_pickup_slots to service_role;
create policy booking_pickup_slots_participant_read on public.booking_pickup_slots
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id = booking_id and auth.uid() in (b.owner_id, b.renter_id)
  ));

create or replace function public.initialize_booking_confirmation_gate()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.confirmation_gate := case
    when not new.payment_first and new.deposit_collection_model = 'authorization' and new.deposit > 0
      then 'awaiting_authorization' else 'awaiting_payment' end;
  if new.status in ('confirmed','active','return_pending','completed') then new.confirmation_gate := 'confirmed'; end if;
  return new;
end;
$$;

create or replace function public.enforce_booking_confirmation_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.booking_deposit_authorizations;
begin
  if new.status <> 'confirmed' or old.status = 'confirmed' then return new; end if;
  if not exists(select 1 from public.payments p where p.booking_id = new.id and p.status = 'succeeded'
    and p.amount = new.total and p.currency = 'usd' and p.stripe_payment_intent_id is not null) then
    new.status := 'pending_payment'; new.confirmation_gate := 'awaiting_payment'; return new;
  end if;
  if not new.payment_first and new.deposit_collection_model = 'authorization' and new.deposit > 0 then
    select * into a from public.booking_deposit_authorizations
      where booking_id = new.id and not is_claim_authorization order by attempt desc limit 1;
    if not found or a.status <> 'authorized' or a.authorized_amount < new.deposit
      or a.capture_before is null or a.capture_before <= clock_timestamp() then
      new.status := 'pending_payment';
      new.confirmation_gate := case when a.status = 'requires_action' then 'authorization_action_required'
        when a.status = 'failed' then 'authorization_failed'
        when a.status = 'expired' or (a.status = 'authorized' and a.capture_before <= clock_timestamp())
          then 'authorization_expired' else 'awaiting_authorization' end;
      return new;
    end if;
  end if;
  new.confirmation_gate := 'confirmed';
  return new;
end;
$$;

create or replace function public.sync_booking_confirmation_after_authorization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_paid boolean; v_available boolean; v_payment public.payments;
begin
  select * into b from public.bookings where id = new.booking_id for update;
  if not found or b.payment_first or b.deposit_collection_model <> 'authorization' or b.deposit <= 0
    or new.is_claim_authorization or b.status not in ('requested','pending_payment') then return new; end if;
  v_paid := exists(select 1 from public.payments where booking_id = b.id and status = 'succeeded');
  if new.status = 'authorized' and new.authorized_amount >= b.deposit and new.capture_before > clock_timestamp() then
    if not v_paid then
      update public.bookings set confirmation_gate = 'awaiting_payment' where id = b.id;
      return new;
    end if;
    perform 1 from public.listings where id = b.listing_id for update;
    if b.auction_bid_id is not null then
      v_available := coalesce(public.auction_has_capacity(b.listing_id,b.start_date,b.end_date,b.id),false);
    else
      v_available := coalesce(public.listing_has_capacity(b.listing_id,b.start_date,b.end_date,b.quantity,b.id),false);
    end if;
    if v_available then
      update public.bookings set status = 'confirmed', confirmation_gate = 'confirmed' where id = b.id;
    else
      update public.bookings set confirmation_gate = 'availability_conflict' where id = b.id;
      select * into v_payment from public.payments where booking_id = b.id and status = 'succeeded' order by created_at desc limit 1;
      if found then
        insert into public.checkout_payment_exceptions(booking_id,checkout_session_id,payment_intent_id,amount,reason)
          values(b.id,v_payment.stripe_checkout_session_id,v_payment.stripe_payment_intent_id,v_payment.amount,
            'Payment and deposit authorization succeeded after the reserved inventory became unavailable.')
          on conflict(checkout_session_id) do nothing;
      end if;
    end if;
  elsif new.status = 'requires_action' then
    update public.bookings set confirmation_gate = 'authorization_action_required' where id = b.id;
  elsif new.status = 'failed' then
    update public.bookings set confirmation_gate = 'authorization_failed' where id = b.id;
  elsif new.status = 'expired' or (new.status = 'authorized' and new.capture_before <= clock_timestamp()) then
    update public.bookings set confirmation_gate = 'authorization_expired' where id = b.id;
  elsif new.status in ('setup_required','scheduled','authorizing') then
    update public.bookings set confirmation_gate = 'awaiting_authorization' where id = b.id;
  end if;
  return new;
end;
$$;

create function public.propose_booking_pickup_slot(p_booking_id uuid, p_starts_at timestamptz, p_time_zone text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.renter_id is distinct from auth.uid() then
    raise exception 'Only the renter can propose a pickup or delivery slot' using errcode = '42501';
  end if;
  if b.status <> 'confirmed' or not b.payment_first then
    raise exception 'Pay the rental before scheduling pre-check-in' using errcode = '55000';
  end if;
  if p_starts_at is null or p_starts_at <= clock_timestamp() or p_time_zone is null
    or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Choose a future slot and valid time zone' using errcode = '22023';
  end if;
  if (p_starts_at at time zone p_time_zone)::date <> b.start_date then
    raise exception 'Choose a slot on the rental start date' using errcode = '22023';
  end if;
  if exists(select 1 from public.booking_pickup_slots where booking_id = b.id and status = 'approved') then
    raise exception 'The agreed slot is locked; contact support to reschedule' using errcode = '55000';
  end if;
  insert into public.booking_pickup_slots(booking_id, starts_at, ends_at, time_zone, status, proposed_by)
    values(b.id, p_starts_at, p_starts_at + interval '30 minutes', p_time_zone, 'proposed', auth.uid())
    on conflict(booking_id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
      time_zone = excluded.time_zone, status = 'proposed', approved_by = null, updated_at = clock_timestamp();
  perform public.record_booking_handoff_event(b.id, 'pickup_slot_proposed',
    jsonb_build_object('starts_at', p_starts_at, 'time_zone', p_time_zone, 'delivery_mode', b.delivery_mode));
  perform public.create_notification(b.owner_id, 'pickup-slot-proposed:' || b.id || ':' || p_starts_at, 'bookings',
    'Review the proposed handoff slot', 'Your renter proposed a pickup or delivery time. Approve or decline it in pre-check-in.',
    '/check-in/' || b.id);
end;
$$;
revoke all on function public.propose_booking_pickup_slot(uuid,timestamptz,text) from public,anon;
grant execute on function public.propose_booking_pickup_slot(uuid,timestamptz,text) to authenticated;

create function public.respond_to_booking_pickup_slot(p_booking_id uuid, p_starts_at timestamptz, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; s public.booking_pickup_slots;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can approve the handoff slot' using errcode = '42501';
  end if;
  select * into s from public.booking_pickup_slots where booking_id = b.id for update;
  if not found or b.status <> 'confirmed' or s.status <> 'proposed'
    or p_approve is null or s.starts_at is distinct from p_starts_at or s.starts_at <= clock_timestamp() then
    raise exception 'This slot changed or is no longer available. Refresh pre-check-in.' using errcode = '55000';
  end if;
  update public.booking_pickup_slots set status = case when p_approve then 'approved' else 'declined' end,
    approved_by = case when p_approve then auth.uid() end, updated_at = clock_timestamp() where booking_id = b.id;
  perform public.record_booking_handoff_event(b.id, case when p_approve then 'pickup_slot_approved' else 'pickup_slot_declined' end,
    jsonb_build_object('starts_at', s.starts_at));
  perform public.create_notification(b.renter_id, 'pickup-slot-response:' || b.id || ':' || clock_timestamp(), 'bookings',
    case when p_approve then 'Handoff slot approved' else 'Choose another handoff slot' end,
    case when p_approve then 'Authorize the separate security hold within 24 hours before your agreed slot.'
      else 'The owner declined the proposed time. Propose another slot.' end, '/check-in/' || b.id);
end;
$$;
revoke all on function public.respond_to_booking_pickup_slot(uuid,timestamptz,boolean) from public,anon;
grant execute on function public.respond_to_booking_pickup_slot(uuid,timestamptz,boolean) to authenticated;

create function public.get_booking_precheckin(p_booking_id uuid)
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
  return jsonb_build_object('payment_first', b.payment_first, 'slot', to_jsonb(s), 'server_now', v_now,
    'can_authorize', b.status in ('active','return_pending','completed') or coalesce(b.status = 'confirmed' and s.status = 'approved'
      and v_now >= s.starts_at - interval '24 hours' and v_now < s.ends_at, false),
    'handoff_ready', coalesce(b.status = 'confirmed' and s.status = 'approved'
      and v_now >= s.starts_at and v_now < s.ends_at and coalesce(v_hold_ready, false), false),
    'deposit_ready', coalesce(v_hold_ready, false), 'delivery_mode', b.delivery_mode,
    'consented', b.deposit_hold_consent_at is not null);
end;
$$;
revoke all on function public.get_booking_precheckin(uuid) from public,anon;
grant execute on function public.get_booking_precheckin(uuid) to authenticated;

alter function public.get_booking_pickup(uuid) rename to get_booking_pickup_before_precheckin;
revoke all on function public.get_booking_pickup_before_precheckin(uuid) from public,anon,authenticated;
create function public.get_booking_pickup(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id and auth.uid() in (owner_id,renter_id);
  if not found then raise exception 'Booking not found' using errcode = '42501'; end if;
  if b.payment_first and b.status = 'confirmed'
    and not ((public.get_booking_precheckin(b.id)->>'deposit_ready')::boolean
      and (public.get_booking_precheckin(b.id)->>'can_authorize')::boolean) then
    raise exception 'Complete pre-check-in before accessing the private handoff address' using errcode = '55000';
  end if;
  return public.get_booking_pickup_before_precheckin(p_booking_id);
end;
$$;
revoke all on function public.get_booking_pickup(uuid) from public,anon;
grant execute on function public.get_booking_pickup(uuid) to authenticated;

create function public.require_booking_precheckin(p_booking_id uuid, p_renter_id uuid, p_handoff boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; s public.booking_pickup_slots; v_now timestamptz := clock_timestamp();
begin
  select * into b from public.bookings where id = p_booking_id and renter_id = p_renter_id for update;
  if not found then raise exception 'Booking not found' using errcode = '42501'; end if;
  if not b.payment_first then return; end if;
  if b.status in ('active','return_pending','completed') and not p_handoff then return; end if;
  select * into s from public.booking_pickup_slots where booking_id = b.id for update;
  if not found or b.status <> 'confirmed' or s.status <> 'approved' then
    raise exception 'Rental payment and an owner-approved slot are required before deposit setup or handoff' using errcode = '55000';
  end if;
  if v_now < s.starts_at - (case when p_handoff then interval '0 hours' else interval '24 hours' end)
    or v_now >= s.ends_at then
    raise exception 'Deposit authorization opens 24 hours before the slot; handoff is available only during the agreed slot' using errcode = '55000';
  end if;
  if p_handoff and b.deposit > 0 and not exists(
    select 1 from public.booking_deposit_authorizations a where a.booking_id = b.id and not a.is_claim_authorization
      and a.status = 'authorized' and a.authorized_amount >= b.deposit and a.capture_before > s.ends_at
  ) then raise exception 'Authorize the separate security hold before pickup or delivery' using errcode = '55000'; end if;
end;
$$;
revoke all on function public.require_booking_precheckin(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.require_booking_precheckin(uuid,uuid,boolean) to service_role;

create or replace function public.prepare_booking_deposit_authorization(p_booking_id uuid,p_renter_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings; a public.booking_deposit_authorizations; v_customer public.renter_stripe_customers;
  v_attempt integer; v_lead_hours integer; v_safety_hours integer; v_rental_return timestamptz;
  v_claim_id uuid; v_claim_status text; v_claim_approved numeric; v_has_claim boolean := false;
  v_authorized_amount numeric;
begin
  perform public.require_booking_precheckin(p_booking_id, p_renter_id);
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
  if not b.payment_first and b.status in ('confirmed','active')
    and (b.start_date::timestamp at time zone current_setting('TimeZone'))>clock_timestamp()+make_interval(hours=>v_lead_hours) then
    raise exception 'Deposit authorization is scheduled closer to pickup' using errcode='55000';
  end if;
  v_rental_return:=((b.end_date+1)::timestamp at time zone current_setting('TimeZone'));
  select id,status,approved_amount into v_claim_id,v_claim_status,v_claim_approved
    from public.booking_deposit_claims where booking_id=b.id for update;
  v_has_claim:=found;
  v_authorized_amount:=case when v_has_claim and v_claim_status in ('approved','payment_required') and v_claim_approved>0
    then v_claim_approved else b.deposit end;
  select * into a from public.booking_deposit_authorizations where booking_id=b.id order by attempt desc limit 1 for update;
  if not found then raise exception 'Deposit authorization record is missing' using errcode='55000'; end if;
  if a.status='authorized' and a.authorized_amount>=v_authorized_amount and a.capture_before>v_rental_return then
    return to_jsonb(a)||jsonb_build_object('ready',true,'already_authorized',true);
  end if;
  if a.status='authorized' and a.authorized_amount>=v_authorized_amount
    and a.capture_before>clock_timestamp()+make_interval(hours=>v_safety_hours) then
    return to_jsonb(a)||jsonb_build_object('ready',true,'already_authorized',true,
      'reauthorize_after',a.capture_before-make_interval(hours=>v_safety_hours));
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
    v_has_claim and v_claim_status in ('approved','payment_required')) returning * into a;
  if v_has_claim and v_claim_status in ('approved','payment_required') then
    update public.booking_deposit_claims set authorization_id=a.id where id=v_claim_id;
  end if;
  return to_jsonb(a)||jsonb_build_object('ready',false,'already_authorized',false);
end;
$$;

alter function public.record_deposit_hold_consent(uuid) rename to record_deposit_hold_consent_before_precheckin;
revoke all on function public.record_deposit_hold_consent_before_precheckin(uuid) from public,anon,authenticated;
create function public.record_deposit_hold_consent(p_booking_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  perform public.require_booking_precheckin(p_booking_id, auth.uid());
  return public.record_deposit_hold_consent_before_precheckin(p_booking_id);
end;
$$;
revoke all on function public.record_deposit_hold_consent(uuid) from public,anon;
grant execute on function public.record_deposit_hold_consent(uuid) to authenticated;

alter function public.start_booking_pickup(uuid) rename to start_booking_pickup_before_precheckin;
revoke all on function public.start_booking_pickup_before_precheckin(uuid) from public,anon,authenticated;
create function public.start_booking_pickup(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  perform public.require_booking_precheckin(p_booking_id, auth.uid(), true);
  return public.start_booking_pickup_before_precheckin(p_booking_id);
end;
$$;
revoke all on function public.start_booking_pickup(uuid) from public,anon;
grant execute on function public.start_booking_pickup(uuid) to authenticated;

alter function public.start_booking_handoff(uuid) rename to start_booking_handoff_before_precheckin;
revoke all on function public.start_booking_handoff_before_precheckin(uuid) from public,anon,authenticated;
create function public.start_booking_handoff(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id and owner_id = auth.uid();
  if not found then raise exception 'Only the owner can start handoff' using errcode = '42501'; end if;
  perform public.require_booking_precheckin(p_booking_id, b.renter_id, true);
  return public.start_booking_handoff_before_precheckin(p_booking_id);
end;
$$;
revoke all on function public.start_booking_handoff(uuid) from public,anon;
grant execute on function public.start_booking_handoff(uuid) to authenticated;

create function public.capture_rental_first_agreement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = new.booking_id;
  if b.payment_first then
    new.snapshot := new.snapshot || jsonb_build_object('payment_first', true,
      'deposit_collection_model', 'authorization',
      'deposit_model', 'Separate temporary card hold within 24 hours before an owner-approved pickup or delivery slot. Not included in rental payment. Released after return unless a damage claim is approved.');
  end if;
  return new;
end;
$$;
revoke all on function public.capture_rental_first_agreement() from public,anon,authenticated;
create trigger rental_agreement_payment_first before insert on public.rental_agreements
  for each row execute function public.capture_rental_first_agreement();

notify pgrst, 'reload schema';
commit;
