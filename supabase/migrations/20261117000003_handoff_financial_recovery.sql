begin;

-- A started pickup may recover its hold without reopening the pickup window.
alter function public.require_booking_precheckin(uuid,uuid,boolean) rename to require_booking_precheckin_before_recovery;
revoke all on function public.require_booking_precheckin_before_recovery(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function public.require_booking_precheckin(p_booking_id uuid,p_renter_id uuid,p_handoff boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not p_handoff and exists (
    select 1 from public.bookings b join public.booking_handoffs h on h.booking_id=b.id
    where b.id=p_booking_id and b.renter_id=p_renter_id and b.status='confirmed'
      and h.status in ('pickup_checkin_started','pickup_inspection','pickup_otp_pending')
  ) then
    perform 1 from public.bookings where id=p_booking_id and renter_id=p_renter_id for update;
    return;
  end if;
  perform public.require_booking_precheckin_before_recovery(p_booking_id,p_renter_id,p_handoff);
end;
$$;
revoke all on function public.require_booking_precheckin(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.require_booking_precheckin(uuid,uuid,boolean) to service_role;

alter function public.get_booking_precheckin(uuid) rename to get_booking_precheckin_before_recovery;
revoke all on function public.get_booking_precheckin_before_recovery(uuid) from public,anon,authenticated;
create function public.get_booking_precheckin(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; started boolean; pending boolean;
begin
  result := public.get_booking_precheckin_before_recovery(p_booking_id);
  select exists(select 1 from public.bookings b join public.booking_handoffs h on h.booking_id=b.id
    where b.id=p_booking_id and b.status='confirmed'
      and h.status in ('pickup_checkin_started','pickup_inspection','pickup_otp_pending')) into started;
  select coalesce((select a.status in ('scheduled','authorizing','requires_action')
    and (a.last_attempt_at is not null or a.authorization_checkout_session_id is not null)
    from public.booking_deposit_authorizations a where a.booking_id=p_booking_id and not a.is_claim_authorization
    order by a.attempt desc limit 1),false) into pending;
  return result || jsonb_build_object(
    'can_authorize', coalesce((result->>'can_authorize')::boolean,false) or started,
    'deposit_recovery_required', started and not coalesce((result->>'deposit_ready')::boolean,false),
    'deposit_recovery_pending', pending);
end;
$$;
revoke all on function public.get_booking_precheckin(uuid) from public,anon;
grant execute on function public.get_booking_precheckin(uuid) to authenticated;

alter function public.get_booking_pickup(uuid) rename to get_booking_pickup_before_recovery;
revoke all on function public.get_booking_pickup_before_recovery(uuid) from public,anon,authenticated;
create function public.get_booking_pickup(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if exists(select 1 from public.bookings b join public.booking_handoffs h on h.booking_id=b.id
    where b.id=p_booking_id and auth.uid() in (b.renter_id,b.owner_id) and b.status='confirmed'
      and h.status in ('pickup_checkin_started','pickup_inspection','pickup_otp_pending')) then
    return public.get_booking_pickup_before_precheckin(p_booking_id);
  end if;
  return public.get_booking_pickup_before_recovery(p_booking_id);
end;
$$;
revoke all on function public.get_booking_pickup(uuid) from public,anon;
grant execute on function public.get_booking_pickup(uuid) to authenticated;

-- Reserve one attempt before contacting Stripe; retry the same idempotency key.
alter function public.prepare_booking_deposit_authorization(uuid,uuid) rename to prepare_booking_deposit_authorization_before_recovery;
do $$
declare definition text;
begin
  select pg_get_functiondef('public.prepare_booking_deposit_authorization_before_recovery(uuid,uuid)'::regprocedure) into definition;
  if position('''pending_payment'',''confirmed'',''active'',''completed''' in definition)=0 then
    raise exception 'Unexpected deposit authorization preparation definition';
  end if;
  execute replace(definition,'''pending_payment'',''confirmed'',''active'',''completed''',
    '''pending_payment'',''confirmed'',''active'',''return_pending'',''completed''');
end;
$$;
revoke all on function public.prepare_booking_deposit_authorization_before_recovery(uuid,uuid) from public,anon,authenticated,service_role;
create function public.prepare_booking_deposit_authorization(p_booking_id uuid,p_renter_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; a public.booking_deposit_authorizations; result jsonb;
begin
  perform public.require_booking_precheckin(p_booking_id,p_renter_id);
  select * into b from public.bookings where id=p_booking_id and renter_id=p_renter_id for update;
  if not found or b.deposit_collection_model<>'authorization' or b.deposit<=0 or b.deposit_hold_consent_at is null
    or b.status not in ('pending_payment','confirmed','active','return_pending','completed','cancelled')
    or (b.status='cancelled' and not exists(select 1 from public.payments where booking_id=b.id and status='succeeded')) then
    raise exception 'Booking is not eligible for deposit authorization' using errcode='55000';
  end if;
  select * into a from public.booking_deposit_authorizations where booking_id=b.id order by attempt desc limit 1 for update;
  if a.last_attempt_at is not null and a.authorization_checkout_session_id is null
    and a.status not in ('scheduled','authorizing','requires_action','authorized') then
    raise exception 'Authorization outcome requires support reconciliation' using errcode='55000';
  end if;
  if (a.status in ('scheduled','authorizing','requires_action')
      and (a.last_attempt_at is not null or a.authorization_checkout_session_id is not null))
    or (a.status in ('failed','released') and a.authorization_checkout_session_id is not null
      and a.failure_reason is distinct from 'Authorization session expired.') then
    if a.authorization_checkout_session_id is null and a.last_attempt_at < clock_timestamp()-interval '20 hours' then
      raise exception 'Authorization outcome is unknown; contact support for reconciliation' using errcode='55000';
    end if;
    return to_jsonb(a)||jsonb_build_object('ready',false,'already_authorized',false);
  end if;
  result := public.prepare_booking_deposit_authorization_before_recovery(p_booking_id,p_renter_id);
  if coalesce((result->>'ready')::boolean,false) then return result; end if;
  update public.booking_deposit_authorizations set last_attempt_at=coalesce(last_attempt_at,clock_timestamp())
    where id=(result->>'id')::uuid returning * into a;
  return to_jsonb(a)||jsonb_build_object('ready',false,'already_authorized',false);
end;
$$;
revoke all on function public.prepare_booking_deposit_authorization(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_booking_deposit_authorization(uuid,uuid) to service_role;

create or replace function public.bind_deposit_authorization_checkout_session(p_authorization_id uuid,p_session_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_session_id,'') not like 'cs_%' then raise exception 'Invalid authorization Checkout Session' using errcode='22023'; end if;
  update public.booking_deposit_authorizations set authorization_checkout_session_id=p_session_id,
    status=case when status='scheduled' then 'authorizing' else status end,updated_at=clock_timestamp()
    where id=p_authorization_id and status in ('scheduled','authorizing','requires_action','authorized')
      and (authorization_checkout_session_id is null or authorization_checkout_session_id=p_session_id);
  if not found then raise exception 'Authorization session binding requires reconciliation' using errcode='40001'; end if;
end;
$$;

create function public.booking_financial_settlement_eligible(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.bookings b where b.id=p_booking_id
    and b.status='completed' and b.return_confirmed_at is not null
    and not exists(select 1 from public.operations_cases c
      where c.booking_id=b.id and c.kind='dispute' and c.status<>'closed'));
$$;
revoke all on function public.booking_financial_settlement_eligible(uuid) from public,anon,authenticated;
grant execute on function public.booking_financial_settlement_eligible(uuid) to service_role;

create function public.flag_deposit_recovery_support(p_booking_id uuid,p_renter_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id=p_booking_id and renter_id=p_renter_id for update;
  if not found or b.status not in ('active','return_pending') then return; end if;
  if not exists(select 1 from public.operations_cases where booking_id=b.id and kind='support'
    and category='payment' and subject='Deposit authorization recovery requires review' and status not in ('resolved','closed')) then
    insert into public.operations_cases(kind,booking_id,created_by,participant_id,category,subject,priority)
    values('support',b.id,b.renter_id,b.renter_id,'payment','Deposit authorization recovery requires review','high');
  end if;
end;
$$;
revoke all on function public.flag_deposit_recovery_support(uuid,uuid) from public,anon,authenticated;
grant execute on function public.flag_deposit_recovery_support(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
