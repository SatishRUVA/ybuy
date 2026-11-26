begin;

alter table public.bookings
  add column delivery_trip text check (delivery_trip is null or delivery_trip in ('dropoff','return','both')),
  add column delivery_setup_amount numeric(10,2) not null default 0
    check (delivery_setup_amount >= 0);

create table public.booking_delivery_addresses (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  address_line1 text not null check (length(btrim(address_line1)) between 1 and 200),
  address_line2 text not null default '' check (length(address_line2) <= 200),
  city text not null check (length(btrim(city)) between 1 and 100),
  state text not null check (length(btrim(state)) between 1 and 100),
  postal_code text not null check (length(btrim(postal_code)) between 1 and 20)
);
alter table public.booking_delivery_addresses enable row level security;
revoke all on public.booking_delivery_addresses from public, anon, authenticated;
grant select on public.booking_delivery_addresses to authenticated;
create policy booking_delivery_address_participants on public.booking_delivery_addresses
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id=booking_id and auth.uid() in (b.owner_id,b.renter_id)
  ));

create function public.delivery_window_bounds(p_date date,p_window text,p_zone text)
returns table(starts_at timestamptz,ends_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare v_hour integer;
begin
  v_hour:=case p_window when 'morning' then 9 when 'afternoon' then 12 when 'evening' then 15 end;
  if p_date is null or v_hour is null or p_zone is null
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then
    raise exception 'Choose a valid delivery window and time zone' using errcode='22023';
  end if;
  starts_at:=(p_date::timestamp+make_interval(hours=>v_hour)) at time zone p_zone;
  ends_at:=((p_date::timestamp+make_interval(hours=>v_hour+3)) at time zone p_zone);
  return next;
end;
$$;
revoke all on function public.delivery_window_bounds(date,text,text) from public,anon,authenticated;

create function public.delivery_window_available(
  p_owner_id uuid,p_start timestamptz,p_end timestamptz,p_exclude_booking uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  select p_start>clock_timestamp() and not exists(
    select 1 from public.booking_pickup_slots s
    join public.bookings b on b.id=s.booking_id
    where b.owner_id=p_owner_id and s.status='approved'
      and b.status in ('requested','pending_payment','confirmed','active','return_pending')
      and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>clock_timestamp())
      and (p_exclude_booking is null or b.id<>p_exclude_booking)
      and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(p_start,p_end,'[)')
  );
$$;
revoke all on function public.delivery_window_available(uuid,timestamptz,timestamptz,uuid)
  from public,anon,authenticated;

create function public.get_checkout_delivery_windows(p_listing_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_listing public.listings; v_zone text; v_result jsonb;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id and status='published';
  if not found or not v_listing.delivery_available then
    raise exception 'Delivery is not available for this listing' using errcode='22023';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date<=p_start_date
    or p_end_date-p_start_date>366 then
    raise exception 'Choose valid rental dates' using errcode='22023';
  end if;
  select time_zone into v_zone from public.listing_pickup_locations where listing_id=p_listing_id;
  if v_zone is null then raise exception 'The owner must set a delivery time zone' using errcode='55000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'window',w.name,
    'dropoff_available',public.delivery_window_available(v_listing.owner_id,d.starts_at,d.ends_at),
    'return_available',public.delivery_window_available(v_listing.owner_id,r.starts_at,r.ends_at)
  ) order by w.ordinality),'[]'::jsonb) into v_result
  from unnest(v_listing.delivery_guaranteed_windows) with ordinality as w(name,ordinality)
  cross join lateral public.delivery_window_bounds(p_start_date,w.name,v_zone) d
  cross join lateral public.delivery_window_bounds(p_end_date,w.name,v_zone) r;
  return jsonb_build_object('time_zone',v_zone,'windows',v_result);
end;
$$;
revoke all on function public.get_checkout_delivery_windows(uuid,date,date) from public,anon;
grant execute on function public.get_checkout_delivery_windows(uuid,date,date) to authenticated;

create function public.get_checkout_delivery_quote(
  p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer,
  p_delivery_mode text,p_insurance_selected boolean,p_delivery_trip text,p_setup_selected boolean
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_listing public.listings; v_quote jsonb; v_fee numeric; v_setup numeric;
begin
  if p_setup_selected is null or (p_delivery_mode='pickup' and
    (p_delivery_trip is not null or p_setup_selected))
    or (p_delivery_mode='delivery' and p_delivery_trip not in ('dropoff','return','both'))
    or (p_delivery_mode='delivery' and p_delivery_trip is null) then
    raise exception 'Choose valid delivery options' using errcode='22023';
  end if;
  v_quote:=public.get_checkout_price_quote(p_listing_id,p_start_date,p_end_date,p_quantity,
    p_delivery_mode,p_insurance_selected);
  select * into v_listing from public.listings where id=p_listing_id and status='published';
  if p_delivery_mode='delivery' and cardinality(v_listing.delivery_guaranteed_windows)=0 then
    raise exception 'Guaranteed delivery windows are not available for this listing' using errcode='22023';
  end if;
  if p_setup_selected and (not v_listing.delivery_setup_available or p_delivery_trip='return') then
    raise exception 'Setup assistance is not available for this delivery' using errcode='22023';
  end if;
  v_fee:=case when p_delivery_mode='pickup' then 0
    when p_delivery_trip='both' then 2*v_listing.delivery_fee-v_listing.delivery_round_trip_discount
    else v_listing.delivery_fee end;
  v_setup:=case when p_setup_selected then v_listing.delivery_setup_fee else 0 end;
  return v_quote||jsonb_build_object(
    'delivery_fee_amount',v_fee,'delivery_setup_amount',v_setup,
    'renter_checkout_total',(v_quote->>'renter_checkout_total')::numeric
      -(v_quote->>'delivery_fee_amount')::numeric+v_fee+v_setup,
    'expected_owner_net',(v_quote->>'expected_owner_net')::numeric
      -(v_quote->>'delivery_fee_amount')::numeric+v_fee+v_setup);
end;
$$;
revoke all on function public.get_checkout_delivery_quote(uuid,date,date,integer,text,boolean,text,boolean)
  from public,anon;
grant execute on function public.get_checkout_delivery_quote(uuid,date,date,integer,text,boolean,text,boolean)
  to authenticated;

create function public.snapshot_booking_delivery_options()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_selection jsonb; v_listing public.listings; v_original_fee numeric;
begin
  if tg_op='INSERT' then
    v_selection:=nullif(current_setting('ybuy.delivery_selection',true),'')::jsonb;
    if v_selection is not null then
      select * into v_listing from public.listings where id=new.listing_id;
      if new.delivery_mode<>'delivery' or not v_listing.delivery_available
        or (v_selection->>'trip') not in ('dropoff','return','both')
        or jsonb_typeof(v_selection->'setup') is distinct from 'boolean'
        or cardinality(v_listing.delivery_guaranteed_windows)=0 then
        raise exception 'Invalid guaranteed delivery selection' using errcode='22023';
      end if;
      if (v_selection->>'setup')::boolean and
        (not v_listing.delivery_setup_available or v_selection->>'trip'='return') then
        raise exception 'Setup assistance is not available for this delivery' using errcode='22023';
      end if;
      v_original_fee:=new.delivery_fee_amount;
      new.delivery_trip:=v_selection->>'trip';
      new.delivery_fee_amount:=case when new.delivery_trip='both'
        then 2*v_listing.delivery_fee-v_listing.delivery_round_trip_discount else v_listing.delivery_fee end;
      new.delivery_setup_amount:=case when (v_selection->>'setup')::boolean then v_listing.delivery_setup_fee else 0 end;
      new.total:=new.total-v_original_fee+new.delivery_fee_amount+new.delivery_setup_amount;
    elsif new.delivery_mode='delivery' then
      select * into v_listing from public.listings where id=new.listing_id;
      if cardinality(v_listing.delivery_guaranteed_windows)>0 then
        raise exception 'Choose delivery options and guaranteed windows at checkout' using errcode='22023';
      end if;
    end if;
  else
    if (new.delivery_trip,new.delivery_setup_amount,new.delivery_fee_amount,new.delivery_mode)
      is distinct from (old.delivery_trip,old.delivery_setup_amount,old.delivery_fee_amount,old.delivery_mode) then
      raise exception 'Booking delivery selections are immutable' using errcode='42501';
    end if;
    new.total:=new.total+new.delivery_setup_amount;
  end if;
  return new;
end;
$$;
revoke all on function public.snapshot_booking_delivery_options() from public,anon,authenticated;
create trigger zzzzzzzzzzzzzz_booking_delivery_options
  before insert or update on public.bookings for each row execute function public.snapshot_booking_delivery_options();

create function public.protect_guaranteed_delivery_slots()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_booking public.bookings; v_old_booking public.bookings; v_conflict boolean;
begin
  if tg_op='UPDATE' then
    select * into v_old_booking from public.bookings where id=old.booking_id;
    if v_old_booking.delivery_trip is not null and old.status='approved'
      and (new.starts_at,new.ends_at,new.status,new.kind,new.booking_id)
        is distinct from (old.starts_at,old.ends_at,old.status,old.kind,old.booking_id) then
      raise exception 'A guaranteed delivery window cannot be changed here; contact support' using errcode='55000';
    end if;
  end if;
  if new.status<>'approved' then return new; end if;
  select * into v_booking from public.bookings where id=new.booking_id;
  perform pg_advisory_xact_lock(hashtextextended('delivery-owner:'||v_booking.owner_id::text,0));
  select exists(
    select 1 from public.booking_pickup_slots s join public.bookings b on b.id=s.booking_id
    where b.owner_id=v_booking.owner_id and s.status='approved'
      and (s.booking_id,s.kind) is distinct from (new.booking_id,new.kind)
      and b.status in ('requested','pending_payment','confirmed','active','return_pending')
      and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>clock_timestamp())
      and (v_booking.delivery_trip is not null or b.delivery_trip is not null)
      and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')
  ) into v_conflict;
  if v_conflict then raise exception 'This handoff overlaps another owner commitment' using errcode='23P01'; end if;
  return new;
end;
$$;
revoke all on function public.protect_guaranteed_delivery_slots() from public,anon,authenticated;
create trigger guaranteed_delivery_slot_guard before insert or update on public.booking_pickup_slots
  for each row execute function public.protect_guaranteed_delivery_slots();

create function public.capture_delivery_agreement_details()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_booking public.bookings; v_selection jsonb;
begin
  select * into v_booking from public.bookings where id=new.booking_id;
  if v_booking.delivery_trip is not null then
    v_selection:=nullif(current_setting('ybuy.delivery_selection',true),'')::jsonb;
    new.snapshot:=new.snapshot||jsonb_build_object(
      'delivery_trip',v_booking.delivery_trip,'delivery_setup_amount',v_booking.delivery_setup_amount,
      'delivery_dropoff_window',coalesce(v_selection->>'dropoff_window',
        (select slot_window from public.booking_pickup_slots where booking_id=v_booking.id and kind='pickup')),
      'delivery_return_window',coalesce(v_selection->>'return_window',
        (select slot_window from public.booking_pickup_slots where booking_id=v_booking.id and kind='return')));
  end if;
  return new;
end;
$$;
revoke all on function public.capture_delivery_agreement_details() from public,anon,authenticated;
create trigger rental_agreement_delivery_options before insert on public.rental_agreements
  for each row execute function public.capture_delivery_agreement_details();

create function public.create_booking_request_with_delivery(
  p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer,
  p_insurance_selected boolean,p_delivery jsonb
) returns public.bookings language plpgsql security definer set search_path='' as $$
declare
  v_listing public.listings; v_booking public.bookings; v_zone text;
  v_trip text; v_start timestamptz; v_end timestamptz; v_window text; v_kind text;
  v_date date; v_address jsonb; v_previous text:=coalesce(current_setting('ybuy.delivery_selection',true),'');
begin
  perform public.operations_require_session();
  if jsonb_typeof(p_delivery) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_delivery) k
      where k not in ('trip','setup','dropoff_window','return_window','address'))
    or jsonb_typeof(p_delivery->'setup') is distinct from 'boolean'
    or jsonb_typeof(p_delivery->'address') is distinct from 'object' then
    raise exception 'Choose valid delivery details' using errcode='22023';
  end if;
  v_trip:=p_delivery->>'trip';
  if v_trip is null or v_trip not in ('dropoff','return','both') then
    raise exception 'Choose drop-off, return pickup, or both' using errcode='22023';
  end if;
  v_address:=p_delivery->'address';
  if exists(select 1 from jsonb_object_keys(v_address) k
      where k not in ('address_line1','address_line2','city','state','postal_code'))
    or jsonb_typeof(v_address->'address_line1') is distinct from 'string'
    or jsonb_typeof(v_address->'city') is distinct from 'string'
    or jsonb_typeof(v_address->'state') is distinct from 'string'
    or jsonb_typeof(v_address->'postal_code') is distinct from 'string'
    or (v_address ? 'address_line2' and jsonb_typeof(v_address->'address_line2') is distinct from 'string')
    or length(btrim(v_address->>'address_line1')) not between 1 and 200
    or length(coalesce(v_address->>'address_line2',''))>200
    or length(btrim(v_address->>'city')) not between 1 and 100
    or length(btrim(v_address->>'state')) not between 1 and 100
    or length(btrim(v_address->>'postal_code')) not between 1 and 20 then
    raise exception 'Enter a complete delivery address' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id and status='published' for update;
  if not found or not v_listing.delivery_available then
    raise exception 'Delivery is not available for this listing' using errcode='22023';
  end if;
  select time_zone into v_zone from public.listing_pickup_locations where listing_id=p_listing_id;
  if v_zone is null then raise exception 'The owner must set a delivery time zone' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('delivery-owner:'||v_listing.owner_id::text,0));
  for v_kind in select unnest(case v_trip when 'both' then array['pickup','return']
      when 'dropoff' then array['pickup'] else array['return'] end) loop
    v_window:=p_delivery->>case when v_kind='pickup' then 'dropoff_window' else 'return_window' end;
    v_date:=case when v_kind='pickup' then p_start_date else p_end_date end;
    if v_window is null or not (v_window=any(v_listing.delivery_guaranteed_windows)) then
      raise exception 'Choose an available delivery window' using errcode='22023';
    end if;
    select starts_at,ends_at into v_start,v_end from public.delivery_window_bounds(v_date,v_window,v_zone);
    if not public.delivery_window_available(v_listing.owner_id,v_start,v_end) then
      raise exception 'The chosen delivery window is no longer available' using errcode='23P01';
    end if;
  end loop;
  perform set_config('ybuy.delivery_selection',p_delivery::text,true);
  v_booking:=public.create_booking_request(p_listing_id,p_start_date,p_end_date,p_quantity,'delivery',null,p_insurance_selected);
  insert into public.booking_delivery_addresses(booking_id,address_line1,address_line2,city,state,postal_code)
    values(v_booking.id,btrim(v_address->>'address_line1'),btrim(coalesce(v_address->>'address_line2','')),
      btrim(v_address->>'city'),btrim(v_address->>'state'),btrim(v_address->>'postal_code'));
  for v_kind in select unnest(case v_trip when 'both' then array['pickup','return']
      when 'dropoff' then array['pickup'] else array['return'] end) loop
    v_window:=p_delivery->>case when v_kind='pickup' then 'dropoff_window' else 'return_window' end;
    v_date:=case when v_kind='pickup' then p_start_date else p_end_date end;
    select starts_at,ends_at into v_start,v_end from public.delivery_window_bounds(v_date,v_window,v_zone);
    insert into public.booking_pickup_slots(booking_id,kind,selected_date,slot_window,starts_at,ends_at,
      time_zone,status,proposed_by,approved_by,note)
    values(v_booking.id,v_kind,v_date,v_window,v_start,v_end,v_zone,'approved',auth.uid(),v_listing.owner_id,'');
  end loop;
  perform set_config('ybuy.delivery_selection',v_previous,true);
  return v_booking;
exception when others then
  perform set_config('ybuy.delivery_selection',v_previous,true);
  raise;
end;
$$;
revoke all on function public.create_booking_request_with_delivery(uuid,date,date,integer,boolean,jsonb)
  from public,anon;
grant execute on function public.create_booking_request_with_delivery(uuid,date,date,integer,boolean,jsonb)
  to authenticated;

notify pgrst,'reload schema';
commit;
