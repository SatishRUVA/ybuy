-- Run against an isolated, seeded database after migrations 00005-00007.
begin;
do $$
declare
  b public.bookings; p public.payments; admin_id uuid; admin_session uuid:=gen_random_uuid();
  renter_session uuid:=gen_random_uuid(); owner_session uuid:=gen_random_uuid();
  v_case_id uuid; claim_id uuid; first_result jsonb; result jsonb;
begin
  select user_id into admin_id from public.admin_users where active and role='super_admin' limit 1;
  select b1.* into b from public.bookings b1
    join public.payments p1 on p1.booking_id=b1.id and p1.status='succeeded' and p1.amount=b1.total and p1.currency='usd'
    where b1.delivery_trip is not null and coalesce(b1.delivery_fee_amount,0)+coalesce(b1.delivery_setup_amount,0)>0
      and b1.renter_id<>admin_id and p1.stripe_payment_intent_id like 'pi_%'
      and b1.owner_id<>b1.renter_id and b1.owner_id<>admin_id
      and not exists(select 1 from public.admin_users a where a.user_id=b1.owner_id and a.active
        and (a.role='super_admin' or 'support.manage'=any(a.permissions)))
      and not exists(select 1 from public.admin_users a where a.user_id=b1.renter_id and a.active
        and (a.role='super_admin' or 'refunds.approve'=any(a.permissions) or 'refunds.senior'=any(a.permissions)))
      and b1.status in ('confirmed','active','return_pending','completed')
      and (select count(*) from public.payments p2 where p2.booking_id=b1.id and p2.status='succeeded')=1
      and not exists(select 1 from public.delivery_handoff_refund_claims r where r.booking_id=b1.id)
      and not exists(select 1 from public.cancellation_refund_cases c where c.booking_id=b1.id)
      and not exists(select 1 from public.refund_requests r where r.payment_id=p1.id)
      and not exists(select 1 from public.payouts x where x.booking_id=b1.id)
      and not exists(select 1 from public.rental_settlements s where s.booking_id=b1.id
        and (s.transfer_status<>'pending' or s.refund_status='processing'))
    limit 1;
  if admin_id is null or b.id is null then raise exception 'Super admin and paid delivery booking fixtures required'; end if;
  select * into p from public.payments where booking_id=b.id and status='succeeded';
  insert into auth.sessions(id,user_id) values
    (admin_session,admin_id),(renter_session,b.renter_id),(owner_session,b.owner_id);
  insert into public.operations_cases(kind,booking_id,created_by,participant_id,category,subject)
    values('support',b.id,b.renter_id,b.renter_id,'pickup_return','Missed delivery test') returning id into v_case_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b.owner_id,'role','authenticated',
    'session_id',owner_session,'exp',extract(epoch from now()+interval '1 hour'))::text,true);
  begin
    perform public.create_delivery_handoff_refund_claim(v_case_id);
    raise exception 'Owner submitted a renter refund claim';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.delivery_handoff_refund_claims where booking_id=b.id)
    or exists(select 1 from public.operations_case_events e where e.case_id=v_case_id and e.event_type='delivery_refund_claim_submitted') then
    raise exception 'Denied claim submission left a claim or audit event';
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated',
    'session_id',admin_session,'exp',extract(epoch from now()+interval '1 hour'))::text,true);
  begin
    result:=public.create_delivery_handoff_refund_claim(v_case_id);
    if result->>'status'<>'pending_review' then raise exception 'Staff submission failed'; end if;
    raise exception 'rollback staff submission' using errcode='P0001';
  exception when raise_exception then
    if sqlerrm<>'rollback staff submission' then raise; end if;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b.renter_id,'role','authenticated',
    'session_id',renter_session,'exp',extract(epoch from now()+interval '1 hour'))::text,true);
  result:=public.create_delivery_handoff_refund_claim(v_case_id);
  claim_id:=(result->>'id')::uuid;
  if (result->>'amount')::numeric<>coalesce(b.delivery_fee_amount,0)+coalesce(b.delivery_setup_amount,0)
    or (public.create_delivery_handoff_refund_claim(v_case_id)->>'id')::uuid<>claim_id then
    raise exception 'Claim amount or idempotency is incorrect';
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b.owner_id,'role','authenticated',
    'session_id',owner_session,'exp',extract(epoch from now()+interval '1 hour'))::text,true);
  begin
    perform public.create_delivery_handoff_refund_claim(v_case_id);
    raise exception 'Owner accessed an existing renter refund claim';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b.renter_id,'role','authenticated',
    'session_id',renter_session,'exp',extract(epoch from now()+interval '1 hour'))::text,true);
  begin
    perform public.admin_decide_delivery_handoff_refund(claim_id,'approve','Reviewed missed handoff');
    raise exception 'Renter approved a refund';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.begin_delivery_handoff_refund(claim_id);
    raise exception 'Renter processed a refund';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated',
    'session_id',admin_session,'exp',extract(epoch from now()+interval '1 hour'))::text,true);
  result:=public.admin_decide_delivery_handoff_refund(claim_id,'approve','Reviewed missed handoff');
  if result->>'status'<>'approved' then raise exception 'Pre-transfer claim was not approved'; end if;
  first_result:=public.begin_delivery_handoff_refund(claim_id);
  result:=public.begin_delivery_handoff_refund(claim_id);
  if result<>first_result or result->>'status'<>'processing' then raise exception 'Processing retry was not idempotent'; end if;

  -- Model an already-issued transfer; no provider refund may be started in this state.
  insert into public.rental_settlements(booking_id,payment_id,deposit_amount,owner_amount,refund_status)
    values(b.id,p.id,0,b.subtotal,'not_required') on conflict(booking_id) do nothing;
  update public.rental_settlements set transfer_status='succeeded',transfer_id='tr_test_delivery'
    where booking_id=b.id;
  update public.delivery_handoff_refund_claims set status='pending_review',processing_started_at=null where id=claim_id;
  result:=public.admin_decide_delivery_handoff_refund(claim_id,'approve','Reviewed missed handoff after transfer');
  if result->>'status'<>'reconciliation' then raise exception 'Post-transfer claim was not flagged for reconciliation'; end if;
  begin
    perform public.begin_delivery_handoff_refund(claim_id);
    raise exception 'Post-transfer refund was processed';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
rollback;
