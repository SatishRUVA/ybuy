do $$
declare
  v_admin uuid;
  v_booking public.bookings;
  v_case uuid;
  v_admin_session uuid := gen_random_uuid();
  v_customer_session uuid := gen_random_uuid();
  v_result jsonb;
  v_name text;
begin
  select a.user_id, nullif(btrim(p.full_name), '') into v_admin, v_name
  from public.admin_users a join public.profiles p on p.id=a.user_id
  where a.active and (a.role='super_admin' or 'support.manage'=any(a.permissions)) limit 1;
  select * into v_booking from public.bookings where booking_reference is not null limit 1;
  if v_admin is null or v_booking.id is null then raise exception 'Admin and booking fixtures are required'; end if;

  insert into auth.sessions(id,user_id,created_at,updated_at) values
    (v_admin_session,v_admin,now(),now()), (v_customer_session,v_booking.renter_id,now(),now());
  insert into public.operations_cases(kind,booking_id,created_by,participant_id,assigned_to,category,subject)
    values ('support',v_booking.id,v_booking.renter_id,v_booking.renter_id,v_admin,'booking','Display test')
    returning id into v_case;
  insert into public.operations_case_events(case_id,actor_id,event_type,detail)
    values (v_case,v_admin,'updated','{}');

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_admin,'session_id',v_admin_session,'exp',extract(epoch from now())+3600
  )::text,true);
  v_result := public.get_case_detail(v_case);
  if v_result->'booking'->>'reference' is distinct from v_booking.booking_reference
     or v_result->>'assigned_name' is distinct from v_name
     or jsonb_array_length(v_result->'events') <> 1 then
    raise exception 'Staff case display details are incorrect';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_booking.renter_id,'session_id',v_customer_session,'exp',extract(epoch from now())+3600
  )::text,true);
  v_result := public.get_case_detail(v_case);
  if v_result->'booking'->>'reference' is distinct from v_booking.booking_reference
     or v_result->>'assigned_name' is not null
     or jsonb_array_length(v_result->'events') <> 0 then
    raise exception 'Customer case display or privacy is incorrect';
  end if;

  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.get_case_detail(v_case);
    raise exception 'Unauthorized case access succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
