begin;

-- Pickup opens two hours early; agreed scheduling and financial checks still apply.
do $$
declare definition text; old_fragment text;
begin
  definition:=replace(pg_get_functiondef('public.begin_booking_handoff(uuid,text,bigint)'::regprocedure),chr(13),'');
  old_fragment:='s.selected_date<>b.start_date
      or v_now<s.starts_at or v_now>=s.ends_at';
  old_fragment:=replace(old_fragment,chr(13),'');
  if position(old_fragment in definition)=0 then
    raise exception 'Unexpected pickup start gate; cannot enable early pickup';
  end if;
  definition:=replace(definition,old_fragment,'s.selected_date<>b.start_date
      or v_now<s.starts_at-interval ''2 hours'' or v_now>=s.ends_at');
  definition:=replace(definition,'Pickup can start only during the approved pickup window',
    'Pickup requires an approved window, opening 2 hours before its start and closing at its end');
  execute definition;

  definition:=replace(pg_get_functiondef('public.booking_handoff_workflow_json(uuid,text,uuid)'::regprocedure),chr(13),'');
  old_fragment:='when p_kind=''pickup'' then s.status=''approved'' and s.selected_date=b.start_date
      and clock_timestamp()>=s.starts_at and clock_timestamp()<s.ends_at';
  old_fragment:=replace(old_fragment,chr(13),'');
  if position(old_fragment in definition)=0 then
    raise exception 'Unexpected pickup workflow gate; cannot enable early pickup';
  end if;
  execute replace(definition,old_fragment,
    'when p_kind=''pickup'' then s.status=''approved'' and s.selected_date=b.start_date
      and clock_timestamp()>=s.starts_at-interval ''2 hours'' and clock_timestamp()<s.ends_at');

  definition:=replace(pg_get_functiondef('public.get_booking_precheckin_before_recovery(uuid)'::regprocedure),chr(13),'');
  old_fragment:='pickup_slot.status=''approved'' and v_now>=pickup_slot.starts_at and v_now<pickup_slot.ends_at';
  if position(old_fragment in definition)=0 then
    raise exception 'Unexpected pickup readiness gate; cannot enable early pickup';
  end if;
  execute replace(definition,old_fragment,
    'pickup_slot.status=''approved'' and pickup_slot.selected_date=b.start_date
        and v_now>=pickup_slot.starts_at-interval ''2 hours'' and v_now<pickup_slot.ends_at');
end;
$$;

notify pgrst,'reload schema';
commit;
