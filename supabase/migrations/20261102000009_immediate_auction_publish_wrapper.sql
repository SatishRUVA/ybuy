begin;

create or replace function public.owner_save_listing_flow(
  p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_details jsonb;
  v_preferences jsonb;
  v_listing public.listings;
  v_enabled boolean;
  v_immediate boolean;
  v_availability_start date;
  v_timezone text;
  v_opening_rate numeric;
  v_maximum_rate numeric;
  v_opens timestamptz;
  v_closes timestamptz;
  v_result jsonb;
begin
  if jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'Invalid listing details' using errcode='22023';
  end if;
  if not coalesce(p_details ? 'auction_preferences',false) then
    return public.owner_save_listing_flow_before_immediate_auction(p_listing_id,p_revision,p_details,p_pickup,p_publish);
  end if;
  v_preferences:=p_details->'auction_preferences';
  if jsonb_typeof(v_preferences) is distinct from 'object'
    or jsonb_typeof(v_preferences->'enabled') is distinct from 'boolean'
    or (v_preferences ? 'starts_immediately' and jsonb_typeof(v_preferences->'starts_immediately') is distinct from 'boolean')
    or exists(select 1 from jsonb_object_keys(v_preferences) key where key not in
      ('enabled','start_date','end_date','starts_immediately','bidding_starts_at','bidding_ends_at','opening_daily_rate'))
    or (v_preferences ? 'opening_daily_rate' and jsonb_typeof(v_preferences->'opening_daily_rate') not in ('number','null')) then
    raise exception 'Invalid auction preferences' using errcode='22023';
  end if;
  v_enabled:=(v_preferences->>'enabled')::boolean;
  v_immediate:=coalesce((v_preferences->>'starts_immediately')::boolean,false);
  if v_immediate and not v_enabled then
    raise exception 'Immediate bidding requires an enabled auction' using errcode='22023';
  end if;
  if p_details ? 'availability_timezone' then
    v_timezone:=p_details->>'availability_timezone';
    if v_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then
      raise exception 'Invalid availability timezone' using errcode='22023';
    end if;
    perform pg_catalog.set_config('TimeZone',v_timezone,true);
  end if;
  v_opens:=case when v_immediate then clock_timestamp() else (v_preferences->>'bidding_starts_at')::timestamptz end;
  v_closes:=(v_preferences->>'bidding_ends_at')::timestamptz;
  if v_enabled and p_publish and ((v_preferences->>'start_date') is null or (v_preferences->>'end_date') is null
    or v_opens is null or v_closes is null) then
    raise exception 'Choose bidding dates and a closing time' using errcode='22023';
  end if;
  if v_immediate then
    select * into v_listing from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
    if not found then raise exception 'Listing not found or not owned' using errcode='42501';end if;
    v_availability_start:=coalesce((p_details->>'availability_start')::date,v_listing.availability_start);
    if v_availability_start is null or v_availability_start>current_date+1 then
      raise exception 'Immediate bidding is available only when this listing starts today or tomorrow' using errcode='22023';
    end if;
  end if;
  if v_enabled then
    select coalesce((value #>> '{}')::numeric,100000) into v_maximum_rate
      from public.app_settings where key='auction_max_opening_daily_rate';
    select price_per_day into v_opening_rate from public.listings where id=p_listing_id;
    v_opening_rate:=coalesce((v_preferences->>'opening_daily_rate')::numeric,v_opening_rate);
    if v_opening_rate<=0 or v_opening_rate>coalesce(v_maximum_rate,100000) then
      raise exception 'Starting bid must be within the configured auction price limit' using errcode='22023';
    end if;
  end if;
  v_details:=p_details-'auction_preferences';
  perform pg_catalog.set_config('ybuy.auction_start_immediately',case when v_immediate then 'true' else 'false' end,true);
  perform pg_catalog.set_config('ybuy.auction_bidding_starts_at',coalesce(v_opens::text,''),true);
  perform pg_catalog.set_config('ybuy.auction_bidding_ends_at',coalesce(v_closes::text,''),true);
  v_result:=public.owner_save_listing_flow_before_immediate_auction(p_listing_id,p_revision,v_details,p_pickup,p_publish);
  if not v_enabled or not p_publish or v_result->>'status'<>'published' then return v_result;end if;
  select * into v_listing from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if not exists(select 1 from public.feature_flags where key='bidding' and enabled) then
    raise exception 'Bidding is not enabled' using errcode='55000';
  end if;
  if exists(select 1 from public.user_restrictions where user_id=auth.uid()) then
    raise exception 'This account is restricted' using errcode='42501';
  end if;
  update public.listings set auction_enabled=true,
    auction_start_date=(v_preferences->>'start_date')::date,
    auction_end_date=(v_preferences->>'end_date')::date,
    auction_opening_daily_rate=v_opening_rate,
    auction_bidding_starts_at=v_opens,
    auction_bidding_ends_at=v_closes
    where id=p_listing_id;
  select jsonb_build_object('revision',revision,'status',status,'deposit',deposit)
    into v_result from public.listings where id=p_listing_id;
  return v_result;
end;
$$;

notify pgrst,'reload schema';
commit;