begin;

create table public.delivery_handoff_refund_claims (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  case_id uuid not null references public.operations_cases(id) on delete restrict,
  created_by uuid not null references public.profiles(id),
  status text not null default 'pending_review' check (status in
    ('pending_review','rejected','approved','processing','refunded','reconciliation')),
  amount numeric(10,2) not null check (amount>0),
  payment_id uuid not null references public.payments(id),
  approved_by uuid references public.profiles(id),
  decision_reason text,
  provider_refund_id text unique,
  processing_started_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.delivery_handoff_refund_claims enable row level security;
revoke all on public.delivery_handoff_refund_claims from public,anon,authenticated;
grant select on public.delivery_handoff_refund_claims to authenticated;
grant all on public.delivery_handoff_refund_claims to service_role;
create policy delivery_claim_read on public.delivery_handoff_refund_claims for select to authenticated
  using (public.has_active_session() and
    (public.operations_can_view_refunds() or public.operations_case_staff('support')));

create function public.create_delivery_handoff_refund_claim(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.operations_cases; b public.bookings; p public.payments; r public.delivery_handoff_refund_claims;
begin
  perform public.operations_require_session();
  select * into c from public.operations_cases where id=p_case_id;
  if not found or c.kind<>'support' or c.booking_id is null or c.status in ('resolved','closed') then
    raise exception 'An open booking support case is required' using errcode='22023';
  end if;
  select * into b from public.bookings where id=c.booking_id for update;
  if auth.uid() is distinct from b.renter_id and not public.operations_case_staff('support') then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select * into r from public.delivery_handoff_refund_claims where booking_id=b.id;
  if found then return jsonb_build_object('id',r.id,'booking_id',r.booking_id,'status',r.status,'amount',r.amount); end if;
  if b.delivery_trip not in ('dropoff','return','both') or b.delivery_trip is null
    or b.status in ('cancelled','requested','pending_payment')
    or coalesce(b.delivery_fee_amount,0)+coalesce(b.delivery_setup_amount,0)<=0 then
    raise exception 'Booking is not eligible for a guaranteed delivery claim' using errcode='23514';
  end if;
  if (select count(*) from public.payments where booking_id=b.id and status='succeeded')<>1 then
    raise exception 'A single verified payment is required' using errcode='23514';
  end if;
  select * into p from public.payments where booking_id=b.id and status='succeeded';
  if p.amount<>b.total or p.currency<>'usd' or coalesce(p.stripe_payment_intent_id,'') not like 'pi_%'
    or exists(select 1 from public.cancellation_refund_cases where booking_id=b.id)
    or exists(select 1 from public.refund_requests where payment_id=p.id) then
    raise exception 'Payment requires reconciliation' using errcode='23514';
  end if;
  insert into public.delivery_handoff_refund_claims(booking_id,case_id,created_by,amount,payment_id)
    values(b.id,c.id,auth.uid(),coalesce(b.delivery_fee_amount,0)+coalesce(b.delivery_setup_amount,0),p.id)
    returning * into r;
  perform public.operations_record_case_event(c.id,'delivery_refund_claim_submitted',
    jsonb_build_object('claim_id',r.id,'amount',r.amount));
  return jsonb_build_object('id',r.id,'booking_id',r.booking_id,'status',r.status,'amount',r.amount);
end;
$$;
revoke all on function public.create_delivery_handoff_refund_claim(uuid) from public,anon;
grant execute on function public.create_delivery_handoff_refund_claim(uuid) to authenticated;

create function public.admin_decide_delivery_handoff_refund(p_claim_id uuid,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.delivery_handoff_refund_claims; b public.bookings; s public.rental_settlements; reason text;
begin
  perform public.operations_require_session();
  if not (public.has_admin_permission('refunds.approve') or public.has_admin_permission('refunds.senior')) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select * into r from public.delivery_handoff_refund_claims where id=p_claim_id;
  if not found then raise exception 'Claim not found' using errcode='P0002'; end if;
  select * into b from public.bookings where id=r.booking_id for update;
  select * into s from public.rental_settlements where booking_id=b.id for update;
  select * into r from public.delivery_handoff_refund_claims where id=p_claim_id for update;
  if r.status<>'pending_review' or p_action not in ('approve','reject') then
    raise exception 'Claim cannot be decided' using errcode='55000';
  end if;
  reason:=public.admin_clean_reason(p_reason);
  if p_action='approve' and (b.delivery_trip is null or r.amount<>coalesce(b.delivery_fee_amount,0)+coalesce(b.delivery_setup_amount,0)) then
    raise exception 'Delivery amount changed; reconciliation required' using errcode='23514';
  end if;
  update public.delivery_handoff_refund_claims set
    status=case when p_action='reject' then 'rejected'
      when s.transfer_status in ('processing','succeeded','reversed') or s.refund_status='processing'
        or exists(select 1 from public.payouts where booking_id=b.id) then 'reconciliation'
      else 'approved' end,
    approved_by=case when p_action='approve' then auth.uid() else null end,
    decision_reason=reason,updated_at=clock_timestamp()
    where id=r.id returning * into r;
  if r.status='reconciliation' then
    update public.operations_cases set priority='high' where id=r.case_id and priority not in ('high','urgent');
  end if;
  perform public.operations_record_case_event(r.case_id,'delivery_refund_'||r.status,
    jsonb_build_object('claim_id',r.id,'amount',r.amount,'reason',reason,
      'support_reconciliation_required',r.status='reconciliation'));
  perform public.admin_write_audit('delivery_refund.'||r.status,'delivery_handoff_refund_claim',r.id::text,null,to_jsonb(r),reason);
  return to_jsonb(r);
end;
$$;
revoke all on function public.admin_decide_delivery_handoff_refund(uuid,text,text) from public,anon;
grant execute on function public.admin_decide_delivery_handoff_refund(uuid,text,text) to authenticated;

create function public.begin_delivery_handoff_refund(p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.delivery_handoff_refund_claims; b public.bookings; p public.payments; s public.rental_settlements;
begin
  perform public.operations_require_session();
  if not (public.has_admin_permission('refunds.approve') or public.has_admin_permission('refunds.senior')) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select * into r from public.delivery_handoff_refund_claims where id=p_claim_id;
  if not found then raise exception 'Claim not found' using errcode='P0002'; end if;
  select * into b from public.bookings where id=r.booking_id for update;
  select * into s from public.rental_settlements where booking_id=b.id for update;
  select * into r from public.delivery_handoff_refund_claims where id=p_claim_id for update;
  if r.status='refunded' then return jsonb_build_object('status','refunded'); end if;
  if r.status not in ('approved','processing') then raise exception 'Approved claim required' using errcode='55000'; end if;
  if r.status='processing' and r.processing_started_at<clock_timestamp()-interval '20 hours' then
    update public.delivery_handoff_refund_claims set status='reconciliation',updated_at=clock_timestamp() where id=r.id;
    update public.operations_cases set priority='high' where id=r.case_id and priority not in ('high','urgent');
    perform public.operations_record_case_event(r.case_id,'delivery_refund_reconciliation',
      jsonb_build_object('claim_id',r.id,'reason','Provider outcome requires reconciliation'));
    return jsonb_build_object('status','reconciliation');
  end if;
  select * into p from public.payments where id=r.payment_id;
  if b.delivery_trip is null or r.amount<>coalesce(b.delivery_fee_amount,0)+coalesce(b.delivery_setup_amount,0)
    or p.status<>'succeeded' or p.amount<>b.total or p.currency<>'usd'
    or (select count(*) from public.payments where booking_id=b.id and status='succeeded')<>1
    or exists(select 1 from public.cancellation_refund_cases where booking_id=b.id)
    or exists(select 1 from public.refund_requests where payment_id=p.id)
    or exists(select 1 from public.payouts where booking_id=b.id)
    or s.transfer_status in ('processing','succeeded','reversed') or s.refund_status='processing' then
    raise exception 'Payment or owner transfer requires support reconciliation' using errcode='23514';
  end if;
  if s.refund_status='failed' then raise exception 'Deposit refund requires reconciliation' using errcode='23514'; end if;
  if r.status='approved' then
    update public.delivery_handoff_refund_claims set status='processing',processing_started_at=clock_timestamp(),
      updated_at=clock_timestamp() where id=r.id returning * into r;
    perform public.operations_record_case_event(r.case_id,'delivery_refund_processing',jsonb_build_object('claim_id',r.id));
  end if;
  return jsonb_build_object('status',r.status,'case_id',r.id,'booking_id',b.id,
    'payment_intent_id',p.stripe_payment_intent_id,'payment_amount',p.amount,'amount',r.amount,'currency',p.currency,
    'deposit_refund_id',case when s.refund_status='succeeded' then s.refund_id else null end,
    'deposit_amount',case when s.refund_status='succeeded' then s.deposit_amount else 0 end);
end;
$$;
revoke all on function public.begin_delivery_handoff_refund(uuid) from public,anon;
grant execute on function public.begin_delivery_handoff_refund(uuid) to authenticated;

create function public.flag_delivery_handoff_refund_reconciliation(p_claim_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.delivery_handoff_refund_claims;
begin
  select * into r from public.delivery_handoff_refund_claims where id=p_claim_id for update;
  if r.status<>'processing' then raise exception 'Processing claim required'; end if;
  update public.delivery_handoff_refund_claims set status='reconciliation',updated_at=clock_timestamp() where id=r.id;
  update public.operations_cases set priority='high' where id=r.case_id and priority not in ('high','urgent');
  insert into public.operations_case_events(case_id,actor_id,event_type,detail)
    values(r.case_id,r.approved_by,'delivery_refund_reconciliation',
      jsonb_build_object('claim_id',r.id,'reason',left(coalesce(p_reason,'Provider reconciliation required'),200)));
end;
$$;
revoke all on function public.flag_delivery_handoff_refund_reconciliation(uuid,text) from public,anon,authenticated;
grant execute on function public.flag_delivery_handoff_refund_reconciliation(uuid,text) to service_role;

create function public.record_delivery_handoff_refund(p_claim_id uuid,p_refund_id text,p_status text,
  p_amount numeric,p_currency text,p_payment_intent_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.delivery_handoff_refund_claims; p public.payments; v_status text;
begin
  select * into r from public.delivery_handoff_refund_claims where id=p_claim_id for update;
  select * into p from public.payments where id=r.payment_id;
  if r.id is null or r.status not in ('processing','refunded') or coalesce(p_refund_id,'') not like 're_%'
    or (r.provider_refund_id is not null and r.provider_refund_id<>p_refund_id)
    or p_amount is distinct from r.amount or p_currency is distinct from p.currency
    or p_payment_intent_id is distinct from p.stripe_payment_intent_id
    or p_status is null or p_status not in ('succeeded','pending','failed','canceled') then
    raise exception 'Conflicting refund receipt' using errcode='23514';
  end if;
  if r.status='refunded' and p_status<>'succeeded' then raise exception 'Conflicting refund status'; end if;
  v_status:=case when p_status='succeeded' then 'refunded' when p_status='pending' then 'processing' else 'reconciliation' end;
  update public.delivery_handoff_refund_claims set status=v_status,provider_refund_id=p_refund_id,updated_at=clock_timestamp()
    where id=r.id;
  if v_status='reconciliation' then
    update public.operations_cases set priority='high' where id=r.case_id and priority not in ('high','urgent');
  end if;
  if r.status<>v_status then
    insert into public.operations_case_events(case_id,actor_id,event_type,detail)
      values(r.case_id,r.approved_by,'delivery_refund_'||v_status,
        jsonb_build_object('claim_id',r.id,'provider_refund_id',p_refund_id,'provider_status',p_status,'amount',p_amount));
  end if;
end;
$$;
revoke all on function public.record_delivery_handoff_refund(uuid,text,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.record_delivery_handoff_refund(uuid,text,text,numeric,text,text) to service_role;

-- A cancellation may be recorded while support is reviewing delivery. Do not let
-- its provider request race the delivery refund and refund the same fee twice.
alter function public.begin_cancellation_refund_processing(uuid) rename to begin_cancellation_refund_before_delivery_handoff;
revoke all on function public.begin_cancellation_refund_before_delivery_handoff(uuid)
  from public,anon,authenticated,service_role;
create function public.begin_cancellation_refund_processing(p_refund_case_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare booking uuid; refund_case public.cancellation_refund_cases; b public.bookings;
begin
  perform public.operations_require_session();
  select * into refund_case from public.cancellation_refund_cases where id=p_refund_case_id;
  if not found then raise exception 'Refund case not found' using errcode='P0002'; end if;
  booking:=refund_case.booking_id;
  select * into b from public.bookings where id=booking for update;
  if not (public.has_admin_permission('refunds.approve') or public.has_admin_permission('refunds.senior')
    or (refund_case.automatic_processing and auth.uid() in (b.renter_id,b.owner_id))) then
    raise exception 'Not authorized to process this refund' using errcode='42501';
  end if;
  if exists(select 1 from public.delivery_handoff_refund_claims where booking_id=booking and status<>'rejected') then
    raise exception 'Delivery refund claim requires support reconciliation before cancellation refund' using errcode='55000';
  end if;
  return public.begin_cancellation_refund_before_delivery_handoff(p_refund_case_id);
end;
$$;
revoke all on function public.begin_cancellation_refund_processing(uuid) from public,anon;
grant execute on function public.begin_cancellation_refund_processing(uuid) to authenticated;

create or replace function public.apply_rental_settlement_owner_fee()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b public.bookings; refunded numeric;
begin
  select * into b from public.bookings where id=new.booking_id;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  select coalesce(sum(amount),0) into refunded from public.delivery_handoff_refund_claims where booking_id=b.id and status='refunded';
  new.owner_service_fee_pct:=coalesce(b.owner_service_fee_pct,0);
  new.owner_service_fee_amount:=coalesce(b.owner_service_fee_amount,0);
  new.owner_amount:=b.subtotal+coalesce(b.delivery_fee_amount,0)+coalesce(b.delivery_setup_amount,0)-new.owner_service_fee_amount-refunded;
  if new.owner_amount<=0 then raise exception 'Owner settlement amount must be positive' using errcode='23514'; end if;
  return new;
end;
$$;

-- Keep the existing payment, dispute, deposit and transfer checks, extending only the amount guards.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.claim_rental_settlement(uuid,text)'::regprocedure);
  if position('+coalesce(v_booking.delivery_fee_amount,0)+v_booking.tax_amount' in definition)=0
    or position('v_booking.subtotal+coalesce(v_booking.delivery_fee_amount,0)-v_row.owner_service_fee_amount then' in definition)=0 then
    raise exception 'Unexpected settlement definition';
  end if;
  definition:=replace(definition,'+coalesce(v_booking.delivery_fee_amount,0)+v_booking.tax_amount',
    '+coalesce(v_booking.delivery_fee_amount,0)+coalesce(v_booking.delivery_setup_amount,0)+v_booking.tax_amount');
  definition:=replace(definition,'v_booking.subtotal+coalesce(v_booking.delivery_fee_amount,0)-v_row.owner_service_fee_amount then',
    'v_booking.subtotal+coalesce(v_booking.delivery_fee_amount,0)+coalesce(v_booking.delivery_setup_amount,0)-v_row.owner_service_fee_amount-coalesce((select sum(amount) from public.delivery_handoff_refund_claims where booking_id=p_booking_id and status=''refunded''),0) then');
  execute definition;
end;
$$;
alter function public.claim_rental_settlement(uuid,text) rename to claim_rental_settlement_before_delivery_handoff;
revoke all on function public.claim_rental_settlement_before_delivery_handoff(uuid,text) from public,anon,authenticated,service_role;
create function public.claim_rental_settlement(p_booking_id uuid,p_step text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; r public.delivery_handoff_refund_claims; result jsonb;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  select * into r from public.delivery_handoff_refund_claims where booking_id=p_booking_id;
  if r.status in ('pending_review','approved','processing','reconciliation') then
    raise exception 'Delivery claim requires support resolution before settlement';
  end if;
  update public.rental_settlements set owner_amount=b.subtotal+coalesce(b.delivery_fee_amount,0)
    +coalesce(b.delivery_setup_amount,0)-owner_service_fee_amount
    -case when r.status='refunded' then r.amount else 0 end
    where booking_id=p_booking_id and transfer_status='pending';
  result:=public.claim_rental_settlement_before_delivery_handoff(p_booking_id,p_step);
  return result||jsonb_build_object('delivery_refund_id',case when r.status='refunded' then r.provider_refund_id else null end,
    'delivery_refund_amount',case when r.status='refunded' then r.amount else 0 end);
end;
$$;
revoke all on function public.claim_rental_settlement(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_rental_settlement(uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
