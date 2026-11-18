begin;

alter table public.listing_pickup_locations add column time_zone text;
alter table public.booking_pickup_slots
  drop constraint booking_pickup_slots_check,
  add constraint booking_handoff_positive_duration check (ends_at > starts_at);

-- Existing rentals must still be returnable without a newly imposed scheduling gate.
alter table public.bookings add column return_scheduling_required boolean not null default false;
alter table public.bookings alter column return_scheduling_required set default true;

create function public.enforce_return_scheduling_required()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if auth.uid() is not null then new.return_scheduling_required:=true; end if;
  elsif new.return_scheduling_required is distinct from old.return_scheduling_required then
    raise exception 'Booking return scheduling policy is immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_return_scheduling_required() from public,anon,authenticated;
create trigger booking_return_scheduling_policy before insert or update on public.bookings
  for each row execute function public.enforce_return_scheduling_required();

create function public.validate_pickup_time_zone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.time_zone is not null and not exists(
    select 1 from pg_catalog.pg_timezone_names where name = new.time_zone
  ) then raise exception 'Choose a valid pickup location timezone' using errcode='22023'; end if;
  if tg_op='UPDATE' and (new.latitude,new.longitude) is distinct from (old.latitude,old.longitude)
    and new.time_zone is null then
    raise exception 'The updated pickup location needs a timezone' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_pickup_time_zone() from public,anon,authenticated;
create trigger pickup_time_zone_valid before insert or update on public.listing_pickup_locations
  for each row execute function public.validate_pickup_time_zone();

-- Put the expanded item-details handler back at its original place in the chain.
-- The first handoff migration replaced the outermost wrapper by mistake.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)'::regprocedure);
  if position('owner_save_listing_flow_before_item_details' in definition)=0 then
    raise exception 'Unexpected listing-save handler; cannot restore its wrapper chain';
  end if;
  execute replace(definition,
    'CREATE OR REPLACE FUNCTION public.owner_save_listing_flow(',
    'CREATE OR REPLACE FUNCTION public.owner_save_listing_flow_before_auctions(');
  definition:=pg_get_functiondef('public.validate_listing_item_details()'::regprocedure);
  definition:=replace(definition,
    'if cardinality(new.pickup_windows)=0 or cardinality(new.return_windows)=0 then',
    'if cardinality(new.pickup_windows)=0 or cardinality(new.return_windows)=0
      or array_ndims(new.pickup_windows)>1 or array_ndims(new.return_windows)>1 or array_ndims(new.return_rules)>1
      or exists(select 1 from unnest(new.pickup_windows || new.return_windows || new.return_rules) item where item is null)
      or (select count(distinct item) from unnest(new.pickup_windows) item)<>cardinality(new.pickup_windows)
      or (select count(distinct item) from unnest(new.return_windows) item)<>cardinality(new.return_windows)
      or (select count(distinct item) from unnest(new.return_rules) item)<>cardinality(new.return_rules) then');
  execute definition;
end;
$$;

create or replace function public.owner_save_listing_flow(
  p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_zone text; v_result jsonb;
begin
  perform public.operations_require_session();
  perform 1 from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Listing not found or not owned' using errcode='42501'; end if;
  if p_pickup ? 'timeZone' then
    if jsonb_typeof(p_pickup->'timeZone') is distinct from 'string' then
      raise exception 'Choose a valid pickup location timezone' using errcode='22023';
    end if;
    v_zone := p_pickup->>'timeZone';
  else
    select time_zone into v_zone from public.listing_pickup_locations where listing_id=p_listing_id;
  end if;
  if v_zone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then
    raise exception 'Choose a valid pickup location timezone' using errcode='22023';
  end if;
  if p_pickup is not null and not (p_pickup ? 'timeZone') and exists(
    select 1 from public.listing_pickup_locations where listing_id=p_listing_id
      and (latitude,longitude) is distinct from
        ((p_pickup->>'latitude')::double precision,(p_pickup->>'longitude')::double precision)
  ) then
    raise exception 'The updated pickup location needs a timezone. Refresh the listing editor.' using errcode='22023';
  end if;
  if p_publish and v_zone is null then
    raise exception 'Confirm the pickup location to determine its timezone before publishing' using errcode='55000';
  end if;
  -- Caller/device timezones never override the pickup location.
  p_details := p_details - 'availability_timezone';
  if v_zone is not null then
    p_details := p_details || jsonb_build_object('availability_timezone',v_zone);
  end if;
  if p_details->'auction_preferences' ? 'date_flexible'
    and jsonb_typeof(p_details->'auction_preferences'->'date_flexible') is distinct from 'boolean' then
    raise exception 'Invalid auction preferences' using errcode='22023';
  end if;
  if p_details->'auction_preferences'->'enabled'='true'::jsonb
    and not exists(select 1 from public.listing_auctions where listing_id=p_listing_id) then
    p_details:=jsonb_set(p_details,'{auction_preferences,date_flexible}','true'::jsonb);
  end if;
  v_result := public.owner_save_listing_flow_before_required_windows(
    p_listing_id,p_revision,p_details,p_pickup-'timeZone',p_publish);
  if p_pickup is not null and v_zone is not null then
    update public.listing_pickup_locations set time_zone=v_zone where listing_id=p_listing_id;
  end if;
  return v_result;
end;
$$;

create or replace function public.handoff_slot_bounds(p_date date,p_window text,p_time_zone text)
returns table(starts_at timestamptz,ends_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare start_hour integer; end_hour integer;
begin
  if p_date is null or p_window is null or p_window not in ('morning','afternoon','evening')
    or p_time_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_time_zone) then
    raise exception 'Choose a valid booking date, handoff window and pickup timezone' using errcode='22023';
  end if;
  start_hour := case p_window when 'morning' then 9 when 'afternoon' then 12 else 17 end;
  end_hour := case p_window when 'morning' then 12 when 'afternoon' then 17 else 21 end;
  starts_at := (p_date + make_time(start_hour,0,0)) at time zone p_time_zone;
  ends_at := (p_date + make_time(end_hour,0,0)) at time zone p_time_zone;
  return next;
end;
$$;

create or replace function public.propose_booking_handoff_slot(
  p_booking_id uuid,p_kind text,p_slot_window text,p_note text default ''
)
returns void language plpgsql security definer set search_path='' as $$
declare b public.bookings; l public.listings; v_zone text; v_date date;
  v_starts timestamptz; v_ends timestamptz; v_windows text[]; v_version timestamptz;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.renter_id is distinct from auth.uid() then
    raise exception 'Only the renter can propose a handoff slot' using errcode='42501';
  end if;
  if p_kind is null or p_kind not in ('pickup','return') then
    raise exception 'Choose pickup or return scheduling' using errcode='22023';
  end if;
  if p_slot_window is null or p_slot_window not in ('morning','afternoon','evening') then
    raise exception 'Choose morning, afternoon, or evening' using errcode='22023';
  end if;
  p_note := btrim(coalesce(p_note,''));
  if char_length(p_note)>240 or p_note ~* '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    raise exception 'Use plain text for handoff notes (up to 240 characters)' using errcode='22023';
  end if;
  select * into l from public.listings where id=b.listing_id;
  if p_kind='pickup' then
    if b.status<>'confirmed' then raise exception 'Confirm payment before scheduling pickup' using errcode='55000'; end if;
    v_date:=b.start_date; v_windows:=l.pickup_windows;
  else
    if b.status<>'active' then raise exception 'Return scheduling opens after pickup confirmation and before return starts' using errcode='55000'; end if;
    v_date:=b.end_date; v_windows:=l.return_windows;
  end if;
  if not (p_slot_window=any(v_windows)) then
    raise exception 'This window is not available for this listing' using errcode='22023';
  end if;
  select time_zone into v_zone from public.listing_pickup_locations where listing_id=b.listing_id;
  if v_zone is null then
    raise exception 'Pickup location timezone is missing. Ask the owner to confirm the pickup location or contact support.' using errcode='55000';
  end if;
  select starts_at,ends_at into v_starts,v_ends from public.handoff_slot_bounds(v_date,p_slot_window,v_zone);
  if v_ends<=clock_timestamp() then
    raise exception 'This handoff window has passed. Contact support, or request a rental extension for a changed return date.' using errcode='22023';
  end if;
  if exists(select 1 from public.booking_pickup_slots where booking_id=b.id and kind=p_kind and status='approved') then
    raise exception 'The agreed slot is locked; contact support to reschedule' using errcode='55000';
  end if;
  insert into public.booking_pickup_slots(booking_id,kind,selected_date,slot_window,starts_at,ends_at,time_zone,status,proposed_by,note)
    values(b.id,p_kind,v_date,p_slot_window,v_starts,v_ends,v_zone,'proposed',auth.uid(),p_note)
  on conflict(booking_id,kind) do update set selected_date=excluded.selected_date,slot_window=excluded.slot_window,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,time_zone=excluded.time_zone,status='proposed',
    proposed_by=excluded.proposed_by,approved_by=null,note=excluded.note,updated_at=clock_timestamp()
  returning updated_at into v_version;
  perform public.record_booking_handoff_event(b.id,p_kind||'_slot_proposed',
    jsonb_build_object('window',p_slot_window,'selected_date',v_date,'time_zone',v_zone,'note',p_note));
  perform public.create_notification(b.owner_id,p_kind||'-slot-proposed:'||b.id||':'||v_version,'bookings',
    case when p_kind='pickup' then 'Review the proposed pickup window' else 'Review the proposed return window' end,
    left('Your renter proposed the '||p_slot_window||' window on '||v_date||' ('||v_zone||').'
      ||case when p_note<>'' then ' Note: '||p_note else ' Approve or decline it in handoff scheduling.' end,500),
    case when p_kind='pickup' then '/check-in/'||b.id else '/check-out/'||b.id end);
end;
$$;

create function public.respond_to_booking_handoff_slot(
  p_booking_id uuid,p_kind text,p_approve boolean,p_expected_updated_at timestamptz
)
returns void language plpgsql security definer set search_path='' as $$
declare b public.bookings; s public.booking_pickup_slots;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can approve the handoff slot' using errcode='42501';
  end if;
  if p_kind is null or p_kind not in ('pickup','return') or p_approve is null then
    raise exception 'Choose pickup or return and approve or decline' using errcode='22023';
  end if;
  select * into s from public.booking_pickup_slots where booking_id=b.id and kind=p_kind for update;
  if not found or s.status<>'proposed' or s.ends_at<=clock_timestamp()
    or p_expected_updated_at is null or s.updated_at is distinct from p_expected_updated_at
    or (p_kind='pickup' and (b.status<>'confirmed' or b.start_date<>s.selected_date))
    or (p_kind='return' and (b.status<>'active' or b.end_date<>s.selected_date)) then
    raise exception 'This slot changed or is no longer available. Refresh check-in.' using errcode='55000';
  end if;
  update public.booking_pickup_slots set status=case when p_approve then 'approved' else 'declined' end,
    approved_by=case when p_approve then auth.uid() end,updated_at=clock_timestamp()
    where booking_id=b.id and kind=p_kind;
  perform public.record_booking_handoff_event(b.id,p_kind||case when p_approve then '_slot_approved' else '_slot_declined' end,
    jsonb_build_object('window',s.slot_window,'selected_date',s.selected_date));
  perform public.create_notification(b.renter_id,p_kind||'-slot-response:'||b.id||':'||clock_timestamp(),'bookings',
    case when p_approve then 'Handoff window approved' else 'Choose another handoff window' end,
    case when p_approve then 'Your owner approved the '||s.slot_window||' window on '||s.selected_date||' ('||s.time_zone||').'
      else 'The owner declined this window. Propose another one.' end,
    case when p_kind='pickup' then '/check-in/'||b.id else '/check-out/'||b.id end);
end;
$$;
revoke all on function public.respond_to_booking_handoff_slot(uuid,text,boolean,timestamptz) from public,anon;
grant execute on function public.respond_to_booking_handoff_slot(uuid,text,boolean,timestamptz) to authenticated;

create or replace function public.respond_to_booking_handoff_slot(p_booking_id uuid,p_kind text,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Refresh check-in before responding to this proposal' using errcode='55000';
end;
$$;

create or replace function public.respond_to_booking_pickup_slot(p_booking_id uuid,p_starts_at timestamptz,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare s public.booking_pickup_slots;
begin
  perform public.operations_require_session();
  perform 1 from public.bookings where id=p_booking_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Only the owner can approve the handoff slot' using errcode='42501'; end if;
  select * into s from public.booking_pickup_slots where booking_id=p_booking_id and kind='pickup';
  if not found or s.starts_at is distinct from p_starts_at or s.note<>'' then
    raise exception 'This slot changed or is no longer available. Refresh check-in.' using errcode='55000';
  end if;
  perform public.respond_to_booking_handoff_slot(p_booking_id,'pickup',p_approve,s.updated_at);
end;
$$;

do $$
declare definition text; target regprocedure;
begin
  target := 'public.get_booking_precheckin(uuid)'::regprocedure;
  definition := pg_get_functiondef(target);
  definition := replace(definition,'''server_now'', v_now,',
    '''time_zone'', (select time_zone from public.listing_pickup_locations where listing_id=b.listing_id), ''server_now'', v_now,');
  definition := replace(definition,'''return_handoff_ready'', coalesce(',
    '''return_handoff_ready'', not b.return_scheduling_required or coalesce(');
  execute definition;
  target := 'public.start_booking_return(uuid)'::regprocedure;
  definition := pg_get_functiondef(target);
  definition := replace(definition,
    'if not found or s.status <> ''approved'' or clock_timestamp() < s.starts_at or clock_timestamp() >= s.ends_at then',
    'if b.return_scheduling_required and (s.booking_id is null or s.status <> ''approved'' or s.selected_date <> b.end_date or clock_timestamp() < s.starts_at or clock_timestamp() >= s.ends_at) then');
  execute definition;
  for target in select oid::regprocedure from pg_proc
    where pronamespace='public'::regnamespace and prosrc like '%pre-check-in%'
  loop
    execute replace(pg_get_functiondef(target),'pre-check-in','check-in');
  end loop;
end;
$$;

create function public.process_handoff_window_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare s record; recipient uuid; v_created integer:=0;
begin
  for s in select slots.*,b.owner_id,b.renter_id from public.booking_pickup_slots slots
    join public.bookings b on b.id=slots.booking_id
    where slots.status='approved' and slots.starts_at>clock_timestamp()
      and slots.starts_at<=clock_timestamp()+interval '24 hours'
      and ((slots.kind='pickup' and b.status='confirmed') or (slots.kind='return' and b.status='active'))
  loop
    foreach recipient in array array[s.owner_id,s.renter_id] loop
      if not exists(select 1 from public.notifications where event_key=
        'handoff-reminder:'||s.booking_id||':'||s.kind||':'||s.starts_at||':'||recipient) then
        perform public.create_notification(recipient,
        'handoff-reminder:'||s.booking_id||':'||s.kind||':'||s.starts_at||':'||recipient,'bookings',
        case when s.kind='pickup' then 'Pickup window reminder' else 'Return window reminder' end,
        'Your agreed '||s.slot_window||' window is on '||s.selected_date||' ('||s.time_zone||'). Open the booking for details.',
        case when s.kind='pickup' then '/check-in/'||s.booking_id else '/check-out/'||s.booking_id end);
        v_created:=v_created+1;
      end if;
    end loop;
  end loop;
  return v_created;
end;
$$;
revoke all on function public.process_handoff_window_reminders() from public,anon,authenticated;
grant execute on function public.process_handoff_window_reminders() to service_role;
select cron.schedule('handoff-window-reminders','*/5 * * * *','select public.process_handoff_window_reminders();');

notify pgrst,'reload schema';
commit;
