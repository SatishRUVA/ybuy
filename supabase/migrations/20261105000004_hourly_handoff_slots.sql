begin;

create function public.handoff_hour_bounds(p_date date,p_window text,p_hour integer,p_time_zone text)
returns table(starts_at timestamptz,ends_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_date is null or p_window is null or p_hour is null
    or not coalesce(case p_window when 'morning' then p_hour between 7 and 11
      when 'afternoon' then p_hour between 12 and 16
      when 'evening' then p_hour between 17 and 19 else false end,false)
    or p_time_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_time_zone) then
    raise exception 'Choose an available hour in the pickup location timezone' using errcode='22023';
  end if;
  starts_at:=(p_date+make_time(p_hour,0,0)) at time zone p_time_zone;
  ends_at:=(p_date+make_time(p_hour+1,0,0)) at time zone p_time_zone;
  return next;
end;
$$;
revoke all on function public.handoff_hour_bounds(date,text,integer,text) from public,anon,authenticated;
grant execute on function public.handoff_hour_bounds(date,text,integer,text) to service_role;

-- Retain the audited permission/payment/approval guards and legacy broad-window endpoint.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.propose_booking_handoff_slot(uuid,text,text,text)'::regprocedure);
  if position('public.handoff_slot_bounds(v_date,p_slot_window,v_zone)' in definition)=0
    or position('v_ends<=clock_timestamp()' in definition)=0 then
    raise exception 'Unexpected handoff proposal handler';
  end if;
  definition:=replace(definition,
    'public.propose_booking_handoff_slot(p_booking_id uuid, p_kind text, p_slot_window text, p_note text',
    'public.propose_booking_handoff_slot_at_hour(p_booking_id uuid, p_kind text, p_slot_window text, p_hour integer, p_note text');
  definition:=replace(definition,'public.handoff_slot_bounds(v_date,p_slot_window,v_zone)',
    'public.handoff_hour_bounds(v_date,p_slot_window,p_hour,v_zone)');
  definition:=replace(definition,'v_ends<=clock_timestamp()','v_starts<=clock_timestamp()');
  definition:=replace(definition,
    'This handoff window has passed. Contact support, or request a rental extension for a changed return date.',
    'This handoff time has passed. Choose a future hour, or request a rental extension for a changed return date.');
  definition:=replace(definition,'''note'',p_note)', '''note'',p_note,''hour'',p_hour)');
  definition:=replace(definition,''' window on ''||v_date',
    ''' window at ''||to_char(v_starts at time zone v_zone,''FMHH12:MI AM'')||'' on ''||v_date');
  if position('FUNCTION public.propose_booking_handoff_slot_at_hour(' in definition)=0 then
    raise exception 'Could not create hourly handoff handler';
  end if;
  execute definition;
end;
$$;
revoke all on function public.propose_booking_handoff_slot_at_hour(uuid,text,text,integer,text) from public,anon;
grant execute on function public.propose_booking_handoff_slot_at_hour(uuid,text,text,integer,text) to authenticated;

notify pgrst,'reload schema';
commit;
