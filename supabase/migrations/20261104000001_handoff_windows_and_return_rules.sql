begin;

alter table public.listings
  add column if not exists pickup_windows text[] not null default array['morning','afternoon','evening'],
  add column if not exists return_windows text[] not null default array['morning','afternoon','evening'],
  add column if not exists return_rules text[] not null default '{}',
  add column if not exists return_note text not null default '';

do $$
begin
  if not exists(select 1 from pg_constraint where conname='listing_pickup_windows_valid') then
    alter table public.listings
      add constraint listing_pickup_windows_valid check (
        cardinality(pickup_windows) between 1 and 3
        and pickup_windows <@ array['morning','afternoon','evening']::text[]
      );
  end if;
  if not exists(select 1 from pg_constraint where conname='listing_return_windows_valid') then
    alter table public.listings
      add constraint listing_return_windows_valid check (
        cardinality(return_windows) between 1 and 3
        and return_windows <@ array['morning','afternoon','evening']::text[]
      );
  end if;
  if not exists(select 1 from pg_constraint where conname='listing_return_rules_valid') then
    alter table public.listings
      add constraint listing_return_rules_valid check (
        cardinality(return_rules) <= 5
        and return_rules <@ array[
          'Return all accessories',
          'Clean and dry before return',
          'Empty any stored contents',
          'Recharge batteries before return',
          'Repack in the original case'
        ]::text[]
      );
  end if;
end $$;

create or replace function public.validate_listing_item_details()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_text text;
begin
  if char_length(new.brand)>80 or char_length(new.model)>80 or char_length(new.additional_details)>500 or char_length(new.return_note)>240 then
    raise exception 'Item details must be plain text within their field limits' using errcode='23514';
  end if;
  foreach v_text in array array[new.brand,new.model,new.additional_details,new.return_note] || new.included_items loop
    if v_text is null
      or v_text ~* '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]' then
      raise exception 'Item details must be plain text within their field limits' using errcode='23514';
    end if;
  end loop;
  if cardinality(new.included_items)>12 or array_ndims(new.included_items)>1
    or exists(select 1 from unnest(new.included_items) item where char_length(btrim(item))=0 or char_length(item)>60)
    or (select count(distinct lower(btrim(item))) from unnest(new.included_items) item)<>cardinality(new.included_items) then
    raise exception 'Choose up to 12 unique included items, each 1 to 60 characters' using errcode='23514';
  end if;
  if cardinality(new.pickup_windows)=0 or cardinality(new.return_windows)=0 then
    raise exception 'Choose at least one pickup and return handoff window' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (
      new.brand,new.model,new.included_items,new.additional_details,new.delivery_radius_miles,
      new.pickup_windows,new.return_windows,new.return_rules,new.return_note
    ) is distinct from (
      old.brand,old.model,old.included_items,old.additional_details,old.delivery_radius_miles,
      old.pickup_windows,old.return_windows,old.return_rules,old.return_note
    )
    and exists(select 1 from public.bookings where listing_id=old.id
      and status in ('pending_payment','confirmed','active','return_pending')) then
    raise exception 'Item and handoff detail changes require existing approved rentals to finish' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function public.owner_save_listing_flow(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_new public.listings; v_details jsonb; v_result jsonb;
begin
  if not coalesce(p_details ? 'item_details',false) then
    return public.owner_save_listing_flow_before_item_details(p_listing_id,p_revision,p_details,p_pickup,p_publish);
  end if;
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if p_publish is null then raise exception 'Publish must be true or false' using errcode='22023';end if;
  v_details:=p_details->'item_details';
  if jsonb_typeof(v_details) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_details) key
    where key not in ('brand','model','included_items','additional_details','delivery_radius_miles','pickup_windows','return_windows','return_rules','return_note')) then
    raise exception 'Unsupported item details' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(v_details) e where
    (e.key in ('brand','model','additional_details','return_note') and jsonb_typeof(e.value)<>'string')
    or (e.key in ('included_items','pickup_windows','return_windows','return_rules') and jsonb_typeof(e.value)<>'array')) then
    raise exception 'Invalid item detail types' using errcode='22023';
  end if;
  if v_details ? 'included_items' and exists(select 1 from jsonb_array_elements(v_details->'included_items') item where jsonb_typeof(item)<>'string') then
    raise exception 'Included items must be text' using errcode='22023';
  end if;
  if v_details ? 'pickup_windows' and exists(select 1 from jsonb_array_elements_text(v_details->'pickup_windows') item where item not in ('morning','afternoon','evening')) then
    raise exception 'Pickup windows must be morning, afternoon, or evening' using errcode='22023';
  end if;
  if v_details ? 'return_windows' and exists(select 1 from jsonb_array_elements_text(v_details->'return_windows') item where item not in ('morning','afternoon','evening')) then
    raise exception 'Return windows must be morning, afternoon, or evening' using errcode='22023';
  end if;
  if v_details ? 'return_rules' and exists(select 1 from jsonb_array_elements_text(v_details->'return_rules') item where item not in (
    'Return all accessories','Clean and dry before return','Empty any stored contents','Recharge batteries before return','Repack in the original case'
  )) then
    raise exception 'Return rules include an unsupported value' using errcode='22023';
  end if;
  if v_details ? 'delivery_radius_miles' and jsonb_typeof(v_details->'delivery_radius_miles') not in ('number','null') then
    raise exception 'Delivery radius must be a number or null' using errcode='22023';
  end if;
  v_new:=jsonb_populate_record(v_listing,v_details);
  if (v_new.brand,v_new.model,v_new.included_items,v_new.additional_details,v_new.delivery_radius_miles,
      v_new.pickup_windows,v_new.return_windows,v_new.return_rules,v_new.return_note)
      is distinct from (v_listing.brand,v_listing.model,v_listing.included_items,v_listing.additional_details,v_listing.delivery_radius_miles,
        v_listing.pickup_windows,v_listing.return_windows,v_listing.return_rules,v_listing.return_note) then
    update public.listings set brand=v_new.brand,model=v_new.model,included_items=v_new.included_items,
      additional_details=v_new.additional_details,delivery_radius_miles=v_new.delivery_radius_miles,
      pickup_windows=v_new.pickup_windows,return_windows=v_new.return_windows,return_rules=v_new.return_rules,return_note=v_new.return_note
      where id=p_listing_id returning revision into p_revision;
  end if;
  v_result:=public.owner_save_listing_flow_before_item_details(p_listing_id,p_revision,p_details-'item_details',p_pickup,p_publish);
  return v_result;
end;
$$;

alter table public.booking_pickup_slots
  add column if not exists kind text not null default 'pickup',
  add column if not exists slot_window text not null default 'afternoon',
  add column if not exists selected_date date,
  add column if not exists note text not null default '';

update public.booking_pickup_slots
set kind='pickup',
  slot_window=case
    when extract(hour from starts_at at time zone coalesce(time_zone,'UTC'))<12 then 'morning'
    when extract(hour from starts_at at time zone coalesce(time_zone,'UTC'))<17 then 'afternoon'
    else 'evening'
  end,
  selected_date=coalesce(selected_date, (starts_at at time zone coalesce(time_zone,'UTC'))::date)
where kind is null or selected_date is null;

do $$
begin
  if exists(select 1 from pg_constraint where conname='booking_pickup_slots_pkey') then
    alter table public.booking_pickup_slots drop constraint booking_pickup_slots_pkey;
  end if;
end $$;

alter table public.booking_pickup_slots
  add primary key (booking_id, kind);

do $$
begin
  if not exists(select 1 from pg_constraint where conname='booking_handoff_slot_kind_valid') then
    alter table public.booking_pickup_slots add constraint booking_handoff_slot_kind_valid check (kind in ('pickup','return'));
  end if;
  if not exists(select 1 from pg_constraint where conname='booking_handoff_slot_window_valid') then
    alter table public.booking_pickup_slots add constraint booking_handoff_slot_window_valid check (slot_window in ('morning','afternoon','evening'));
  end if;
  if not exists(select 1 from pg_constraint where conname='booking_handoff_slot_note_valid') then
    alter table public.booking_pickup_slots add constraint booking_handoff_slot_note_valid check (
      char_length(note) <= 240 and note !~* '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]'
    );
  end if;
end $$;

create or replace function public.handoff_slot_bounds(p_date date, p_window text, p_time_zone text)
returns table(starts_at timestamptz, ends_at timestamptz) language plpgsql immutable security definer set search_path = '' as $$
begin
  if p_window='morning' then
    starts_at := ((p_date::text || ' 09:00:00')::timestamp at time zone p_time_zone);
    ends_at := ((p_date::text || ' 12:00:00')::timestamp at time zone p_time_zone);
  elsif p_window='afternoon' then
    starts_at := ((p_date::text || ' 12:00:00')::timestamp at time zone p_time_zone);
    ends_at := ((p_date::text || ' 17:00:00')::timestamp at time zone p_time_zone);
  elsif p_window='evening' then
    starts_at := ((p_date::text || ' 17:00:00')::timestamp at time zone p_time_zone);
    ends_at := ((p_date::text || ' 21:00:00')::timestamp at time zone p_time_zone);
  else
    raise exception 'Choose morning, afternoon, or evening' using errcode='22023';
  end if;
  return next;
end;
$$;
revoke all on function public.handoff_slot_bounds(date,text,text) from public,anon,authenticated;
grant execute on function public.handoff_slot_bounds(date,text,text) to service_role;

create or replace function public.propose_booking_handoff_slot(p_booking_id uuid, p_kind text, p_slot_window text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; l public.listings; v_time_zone text; v_date date; v_starts timestamptz; v_ends timestamptz; v_windows text[];
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.renter_id is distinct from auth.uid() then
    raise exception 'Only the renter can propose a handoff slot' using errcode = '42501';
  end if;
  if p_kind not in ('pickup','return') then raise exception 'Choose pickup or return scheduling' using errcode='22023'; end if;
  if p_slot_window not in ('morning','afternoon','evening') then raise exception 'Choose morning, afternoon, or evening' using errcode='22023'; end if;
  if p_note is null then p_note := ''; end if;
  if char_length(p_note) > 240 or p_note ~* '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    raise exception 'Use plain text for handoff notes (up to 240 characters)' using errcode='22023';
  end if;
  select * into l from public.listings where id = b.listing_id;
  if p_kind='pickup' then
    if b.status <> 'confirmed' then raise exception 'Confirm payment before scheduling pickup' using errcode='55000'; end if;
    v_date := b.start_date;
    v_windows := coalesce(l.pickup_windows, array['morning','afternoon','evening']::text[]);
  else
    if b.status not in ('active','return_pending') then raise exception 'Return scheduling opens after pickup confirmation' using errcode='55000'; end if;
    v_date := b.end_date;
    v_windows := coalesce(l.return_windows, array['morning','afternoon','evening']::text[]);
  end if;
  if not (p_slot_window = any(v_windows)) then
    raise exception 'This window is not available for this listing' using errcode='22023';
  end if;
  v_time_zone := coalesce(nullif(l.availability_timezone, ''), current_setting('TimeZone'));
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = v_time_zone) then
    raise exception 'Listing timezone is invalid. Update listing availability and retry.' using errcode='22023';
  end if;
  select starts_at, ends_at into v_starts, v_ends from public.handoff_slot_bounds(v_date, p_slot_window, v_time_zone);
  if v_ends <= clock_timestamp() then
    raise exception 'Choose a future handoff window' using errcode='22023';
  end if;
  if exists(select 1 from public.booking_pickup_slots where booking_id = b.id and kind = p_kind and status = 'approved') then
    raise exception 'The agreed slot is locked; contact support to reschedule' using errcode='55000';
  end if;
  insert into public.booking_pickup_slots(booking_id, kind, selected_date, slot_window, starts_at, ends_at, time_zone, status, proposed_by, note)
    values (b.id, p_kind, v_date, p_slot_window, v_starts, v_ends, v_time_zone, 'proposed', auth.uid(), btrim(p_note))
    on conflict(booking_id, kind) do update set selected_date = excluded.selected_date, slot_window = excluded.slot_window,
      starts_at = excluded.starts_at, ends_at = excluded.ends_at, time_zone = excluded.time_zone, status = 'proposed',
      proposed_by = excluded.proposed_by, approved_by = null, note = excluded.note, updated_at = clock_timestamp();
  perform public.record_booking_handoff_event(b.id, p_kind || '_slot_proposed',
    jsonb_build_object('window', p_slot_window, 'selected_date', v_date, 'time_zone', v_time_zone, 'note', left(p_note, 240)));
  perform public.create_notification(b.owner_id, p_kind || '-slot-proposed:' || b.id || ':' || v_date::text || ':' || p_slot_window, 'bookings',
    case when p_kind='pickup' then 'Review the proposed pickup window' else 'Review the proposed return window' end,
    case when p_note <> '' then left('Your renter proposed the ' || p_slot_window || ' window and added a note: ' || p_note, 500)
      else 'Your renter proposed the ' || p_slot_window || ' window. Approve or decline it in handoff scheduling.' end,
    case when p_kind='pickup' then '/check-in/' || b.id else '/check-out/' || b.id end);
end;
$$;
revoke all on function public.propose_booking_handoff_slot(uuid,text,text,text) from public,anon;
grant execute on function public.propose_booking_handoff_slot(uuid,text,text,text) to authenticated;

create or replace function public.respond_to_booking_handoff_slot(p_booking_id uuid, p_kind text, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; s public.booking_pickup_slots;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can approve the handoff slot' using errcode = '42501';
  end if;
  if p_kind not in ('pickup','return') then raise exception 'Choose pickup or return scheduling' using errcode='22023'; end if;
  select * into s from public.booking_pickup_slots where booking_id = b.id and kind = p_kind for update;
  if not found or s.status <> 'proposed' or s.ends_at <= clock_timestamp() or p_approve is null then
    raise exception 'This slot changed or is no longer available. Refresh handoff scheduling.' using errcode = '55000';
  end if;
  update public.booking_pickup_slots set status = case when p_approve then 'approved' else 'declined' end,
    approved_by = case when p_approve then auth.uid() end, updated_at = clock_timestamp()
    where booking_id = b.id and kind = p_kind;
  perform public.record_booking_handoff_event(b.id, p_kind || case when p_approve then '_slot_approved' else '_slot_declined' end,
    jsonb_build_object('window', s.slot_window, 'selected_date', s.selected_date));
  perform public.create_notification(b.renter_id, p_kind || '-slot-response:' || b.id || ':' || clock_timestamp(), 'bookings',
    case when p_approve then 'Handoff window approved' else 'Choose another handoff window' end,
    case when p_approve then 'Your owner approved the ' || s.slot_window || ' window.'
      else 'The owner declined this window. Propose another one.' end,
    case when p_kind='pickup' then '/check-in/' || b.id else '/check-out/' || b.id end);
end;
$$;
revoke all on function public.respond_to_booking_handoff_slot(uuid,text,boolean) from public,anon;
grant execute on function public.respond_to_booking_handoff_slot(uuid,text,boolean) to authenticated;

create or replace function public.propose_booking_pickup_slot(p_booking_id uuid, p_starts_at timestamptz, p_time_zone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_window text;
begin
  if p_starts_at is null or p_time_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Choose a future slot and valid time zone' using errcode = '22023';
  end if;
  v_window := case
    when extract(hour from (p_starts_at at time zone p_time_zone)) < 12 then 'morning'
    when extract(hour from (p_starts_at at time zone p_time_zone)) < 17 then 'afternoon'
    else 'evening'
  end;
  perform public.propose_booking_handoff_slot(p_booking_id, 'pickup', v_window, '');
end;
$$;

create or replace function public.respond_to_booking_pickup_slot(p_booking_id uuid, p_starts_at timestamptz, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.booking_pickup_slots;
begin
  select * into s from public.booking_pickup_slots where booking_id = p_booking_id and kind = 'pickup';
  if not found or s.starts_at is distinct from p_starts_at then
    raise exception 'This slot changed or is no longer available. Refresh pre-check-in.' using errcode = '55000';
  end if;
  perform public.respond_to_booking_handoff_slot(p_booking_id, 'pickup', p_approve);
end;
$$;

create or replace function public.get_booking_precheckin(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; l public.listings; pickup_slot public.booking_pickup_slots; return_slot public.booking_pickup_slots; a public.booking_deposit_authorizations;
  v_now timestamptz := clock_timestamp(); v_hold_ready boolean;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id and auth.uid() in (owner_id,renter_id);
  if not found then raise exception 'Booking not found' using errcode = '42501'; end if;
  select * into l from public.listings where id = b.listing_id;
  select * into pickup_slot from public.booking_pickup_slots where booking_id = b.id and kind = 'pickup';
  select * into return_slot from public.booking_pickup_slots where booking_id = b.id and kind = 'return';
  select * into a from public.booking_deposit_authorizations where booking_id = b.id
    and not is_claim_authorization order by attempt desc limit 1;
  v_hold_ready := b.deposit <= 0 or (a.status = 'authorized' and a.authorized_amount >= b.deposit
    and a.capture_before > greatest(v_now, coalesce(pickup_slot.ends_at, v_now)));
  return jsonb_build_object('payment_first', b.payment_first,
    'slot', case when pickup_slot.booking_id is not null then to_jsonb(pickup_slot) end,
    'pickup_slot', case when pickup_slot.booking_id is not null then to_jsonb(pickup_slot) end,
    'return_slot', case when return_slot.booking_id is not null then to_jsonb(return_slot) end,
    'pickup_windows', coalesce(l.pickup_windows, array['morning','afternoon','evening']::text[]),
    'return_windows', coalesce(l.return_windows, array['morning','afternoon','evening']::text[]),
    'return_rules', coalesce(l.return_rules, '{}'::text[]),
    'return_note', coalesce(l.return_note, ''),
    'server_now', v_now,
    'can_authorize', b.status in ('active','return_pending','completed') or coalesce(b.status = 'confirmed' and pickup_slot.status = 'approved'
      and v_now >= pickup_slot.starts_at - interval '24 hours' and v_now < pickup_slot.ends_at, false),
    'handoff_ready', coalesce(b.status = 'confirmed' and pickup_slot.status = 'approved'
      and v_now >= pickup_slot.starts_at and v_now < pickup_slot.ends_at and coalesce(v_hold_ready, false), false),
    'return_handoff_ready', coalesce(return_slot.status = 'approved' and v_now >= return_slot.starts_at and v_now < return_slot.ends_at, false),
    'deposit_ready', coalesce(v_hold_ready, false), 'delivery_mode', b.delivery_mode,
    'consented', b.deposit_hold_consent_at is not null);
end;
$$;

create or replace function public.require_booking_precheckin(p_booking_id uuid, p_renter_id uuid, p_handoff boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; s public.booking_pickup_slots; v_now timestamptz := clock_timestamp();
begin
  select * into b from public.bookings where id = p_booking_id and renter_id = p_renter_id for update;
  if not found then raise exception 'Booking not found' using errcode = '42501'; end if;
  if not b.payment_first then return; end if;
  if b.status in ('active','return_pending','completed') and not p_handoff then return; end if;
  select * into s from public.booking_pickup_slots where booking_id = b.id and kind = 'pickup' for update;
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

create or replace function public.start_booking_return(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs; s public.booking_pickup_slots;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.renter_id <> auth.uid() then raise exception 'Only the renter can start a return' using errcode = '42501'; end if;
  if b.status = 'return_pending' then
    select * into h from public.booking_handoffs where booking_id = p_booking_id;
    if h.status in ('return_initiated', 'return_inspection', 'return_otp_pending') then return b; end if;
  end if;
  if b.status <> 'active' then raise exception 'Booking must be active to start a return' using errcode = '55000'; end if;
  select * into s from public.booking_pickup_slots where booking_id = p_booking_id and kind = 'return';
  if not found or s.status <> 'approved' or clock_timestamp() < s.starts_at or clock_timestamp() >= s.ends_at then
    raise exception 'Get owner approval for the return window before starting return' using errcode = '55000';
  end if;
  insert into public.booking_handoffs(booking_id, status, return_initiated_at)
    values (p_booking_id, 'return_initiated', clock_timestamp())
  on conflict (booking_id) do update set status = 'return_initiated', return_initiated_at = clock_timestamp()
    where public.booking_handoffs.status = 'rental_active'
  returning * into h;
  if h.booking_id is null then raise exception 'A return handoff is already in progress' using errcode = '55000'; end if;
  update public.bookings set status = 'return_pending' where id = p_booking_id returning * into b;
  perform public.record_booking_handoff_event(p_booking_id, 'return_initiated');
  perform public.create_notification(b.owner_id, 'return-started:' || p_booking_id, 'bookings',
    'Your renter started a return', 'Open the booking to inspect the item and accessories.', '/check-out/' || p_booking_id);
  return b;
end;
$$;

notify pgrst, 'reload schema';
commit;
