begin;

create function public.get_listing_time_zone(p_listing_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select p.time_zone from public.listing_pickup_locations p
  join public.listings l on l.id=p.listing_id
  where l.id=p_listing_id and (l.status='published'
    or (l.owner_id=auth.uid() and public.has_active_session()));
$$;
revoke all on function public.get_listing_time_zone(uuid) from public;
grant execute on function public.get_listing_time_zone(uuid) to anon,authenticated;

create function public.listing_local_today(p_listing_id uuid)
returns date language sql stable security definer set search_path='' as $$
  select (current_timestamp at time zone coalesce(
    (select time_zone from public.listing_pickup_locations where listing_id=p_listing_id),
    current_setting('TimeZone')))::date;
$$;
revoke all on function public.listing_local_today(uuid) from public,anon,authenticated;

-- The existing booking wrappers retain payment, capacity, price and agreement checks.
do $$
declare definition text; signature text;
begin
  definition:=pg_get_functiondef('public.create_booking_request_before_reservations(uuid,date,date,integer)'::regprocedure);
  if position('p_start_date < current_date' in definition)=0 then
    raise exception 'Unexpected booking date guard';
  end if;
  definition:=replace(definition,'p_start_date < current_date',
    'p_start_date < public.listing_local_today(p_listing_id)');
  execute definition;

  definition:=pg_get_functiondef('public.respond_to_booking_request(uuid,boolean)'::regprocedure);
  definition:=replace(definition,'v_booking.start_date<current_date',
    'v_booking.start_date<public.listing_local_today(v_booking.listing_id)');
  execute definition;

  definition:=pg_get_functiondef('public.enforce_listing_scheduling_window()'::regprocedure);
  definition:=replace(definition,'current_date','public.listing_local_today(new.id)');
  execute definition;

  definition:=pg_get_functiondef('public.enforce_listing_flow()'::regprocedure);
  definition:=replace(definition,'new.availability_end<=current_date',
    'new.availability_end<=public.listing_local_today(new.id)');
  execute definition;

  definition:=pg_get_functiondef('public.owner_save_listing_availability(uuid,bigint,date,date,date[],text)'::regprocedure);
  definition:=replace(definition,
    'perform pg_catalog.set_config(''TimeZone'',p_timezone,true);',
    'p_timezone:=coalesce(public.get_listing_time_zone(p_listing_id),p_timezone);
  perform pg_catalog.set_config(''TimeZone'',p_timezone,true);');
  execute definition;

  definition:=pg_get_functiondef('public.search_available_listings(double precision,double precision,integer,date,date,text,uuid,numeric,boolean,boolean,boolean,boolean,text,integer,integer)'::regprocedure);
  definition:=replace(definition,'p_start_date<current_date or ','');
  definition:=replace(definition,'l.availability_end>current_date',
    'l.availability_end>public.listing_local_today(l.id)');
  definition:=replace(definition,
    'p_start_date is null or public.listing_has_capacity(l.id,p_start_date,p_end_date)',
    'p_start_date is null or (p_start_date>=public.listing_local_today(l.id)
        and public.listing_has_capacity(l.id,p_start_date,p_end_date))');
  definition:=replace(definition,'''listing_images'',coalesce((',
    '''pickup_time_zone'',public.get_listing_time_zone(p.id),
      ''listing_images'',coalesce((');
  execute definition;

  -- A UTC-default range must include yesterday in locations west of UTC.
  foreach signature in array array[
    'public.get_listing_unavailable_dates(uuid,date,date)',
    'public.get_listing_unavailable_dates_for_quantity(uuid,integer,date,date)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    definition:=replace(definition,'p_start date DEFAULT CURRENT_DATE','p_start date DEFAULT (CURRENT_DATE - 1)');
    definition:=replace(definition,'p_end date DEFAULT (CURRENT_DATE + 366)','p_end date DEFAULT (CURRENT_DATE + 365)');
    execute definition;
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;
