begin;

alter function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb)
  rename to owner_configure_listing_negotiation_before_immediate_start;
revoke all on function public.owner_configure_listing_negotiation_before_immediate_start(uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated;

create function public.owner_configure_listing_negotiation(
  p_listing_id uuid,p_revision bigint,p_offers jsonb,p_auction jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_auction jsonb:=p_auction;
  v_immediate boolean:=false;
  v_listing public.listings;
  v_timezone text;
begin
  perform public.operations_require_session();
  if p_auction ? 'starts_immediately' then
    if jsonb_typeof(p_auction->'starts_immediately') is distinct from 'boolean' then
      raise exception 'Invalid auction preferences' using errcode='22023';
    end if;
    v_immediate:=(p_auction->>'starts_immediately')::boolean;
  end if;
  if p_auction ? 'availability_timezone' then
    if jsonb_typeof(p_auction->'availability_timezone') is distinct from 'string' then
      raise exception 'Invalid availability timezone' using errcode='22023';
    end if;
    v_timezone:=p_auction->>'availability_timezone';
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then
      raise exception 'Invalid availability timezone' using errcode='22023';
    end if;
    perform pg_catalog.set_config('TimeZone',v_timezone,true);
  end if;
  if v_immediate then
    if p_auction->>'enabled' is distinct from 'true' then
      raise exception 'Immediate bidding requires an enabled auction' using errcode='22023';
    end if;
    select * into v_listing from public.listings
      where id=p_listing_id and owner_id=auth.uid() and status='published' for update;
    if not found then raise exception 'Listing not found or not owned' using errcode='42501';end if;
    if v_listing.availability_start is null or v_listing.availability_start>current_date+1 then
      raise exception 'Immediate bidding is available only when this listing starts today or tomorrow' using errcode='22023';
    end if;
    v_auction:=jsonb_set(v_auction,'{bidding_starts_at}',to_jsonb(clock_timestamp()),true);
  end if;
  v_auction:=v_auction-'starts_immediately'-'availability_timezone';
  perform pg_catalog.set_config('ybuy.auction_start_immediately',case when v_immediate then 'true' else 'false' end,true);
  return public.owner_configure_listing_negotiation_before_immediate_start(p_listing_id,p_revision,p_offers,v_auction);
end;
$$;
revoke all on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) to authenticated;

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_immediate_auction;
revoke all on function public.owner_save_listing_flow_before_immediate_auction(uuid,bigint,jsonb,jsonb,boolean)
  from public,anon,authenticated;

create function public.owner_save_listing_flow(
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
      ('enabled','start_date','end_date','starts_immediately','bidding_starts_at','bidding_ends_at')) then
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
  if v_immediate then
    select * into v_listing from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
    if not found then raise exception 'Listing not found or not owned' using errcode='42501';end if;
    v_availability_start:=coalesce((p_details->>'availability_start')::date,v_listing.availability_start);
    if v_availability_start is null or v_availability_start>current_date+1 then
      raise exception 'Immediate bidding is available only when this listing starts today or tomorrow' using errcode='22023';
    end if;
  end if;
  if p_publish is null then raise exception 'Publish must be true or false' using errcode='22023';end if;
  v_opens:=case when v_immediate then clock_timestamp() else (v_preferences->>'bidding_starts_at')::timestamptz end;
  v_closes:=(v_preferences->>'bidding_ends_at')::timestamptz;
  if v_enabled and ((v_preferences->>'start_date') is null or (v_preferences->>'end_date') is null
    or v_opens is null or v_closes is null) then
    raise exception 'Choose bidding dates and a closing time' using errcode='22023';
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
    auction_bidding_starts_at=v_opens,
    auction_bidding_ends_at=v_closes
    where id=p_listing_id;
  select jsonb_build_object('revision',revision,'status',status,'deposit',deposit)
    into v_result from public.listings where id=p_listing_id;
  return v_result;
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

create or replace function public.guard_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_timezone text:=current_setting('TimeZone');
  v_immediate boolean:=coalesce(current_setting('ybuy.auction_start_immediately',true),'false')='true';
  v_requested_opens timestamptz:=nullif(current_setting('ybuy.auction_bidding_starts_at',true),'')::timestamptz;
  v_requested_closes timestamptz:=nullif(current_setting('ybuy.auction_bidding_ends_at',true),'')::timestamptz;
  v_opens timestamptz;
begin
  if tg_op='UPDATE' and exists(select 1 from public.listing_auctions where listing_id=old.id and status in ('open','owner_selection','awaiting_payment'))
    and (to_jsonb(new)-array['revision','updated_at','status']) is distinct from (to_jsonb(old)-array['revision','updated_at','status']) then
    raise exception 'Auction listing terms cannot change after bidding starts' using errcode='23514';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.listing_auctions where listing_id=old.id)
    and (new.auction_enabled,new.auction_start_date,new.auction_end_date,new.auction_bidding_starts_at,new.auction_bidding_ends_at)
      is distinct from (old.auction_enabled,old.auction_start_date,old.auction_end_date,old.auction_bidding_starts_at,old.auction_bidding_ends_at) then
    raise exception 'A completed auction cannot be restarted or reconfigured' using errcode='23514';
  end if;
  if new.auction_enabled and (tg_op='INSERT' or
    (new.auction_enabled,new.auction_start_date,new.auction_end_date,new.auction_bidding_starts_at,new.auction_bidding_ends_at,new.availability_start,new.availability_end)
      is distinct from (old.auction_enabled,old.auction_start_date,old.auction_end_date,old.auction_bidding_starts_at,old.auction_bidding_ends_at,old.availability_start,old.availability_end)) then
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled) then
      raise exception 'Bidding is not enabled' using errcode='55000';
    end if;
    if new.auction_start_date is null or new.auction_end_date is null or new.availability_start is null or new.availability_end is null
      or new.auction_start_date<new.availability_start or new.auction_end_date>new.availability_end
      or new.auction_end_date<=new.auction_start_date then
      raise exception 'Auction rental dates must fit listing availability' using errcode='23514';
    end if;
    if v_immediate or v_requested_opens is not null or new.auction_bidding_starts_at is not null then
      v_opens:=case when v_immediate then clock_timestamp() else coalesce(v_requested_opens,new.auction_bidding_starts_at) end;
      new.auction_bidding_starts_at:=v_opens;
      new.auction_bidding_ends_at:=coalesce(v_requested_closes,new.auction_bidding_ends_at);
      if new.status<>'published' or not isfinite(new.auction_bidding_starts_at) or not isfinite(new.auction_bidding_ends_at)
        or (not v_immediate and new.auction_bidding_starts_at<clock_timestamp())
        or (not v_immediate and new.auction_bidding_starts_at<(new.availability_start::timestamp at time zone v_timezone))
        or new.auction_bidding_ends_at>=((new.availability_end+1)::timestamp at time zone v_timezone)
        or new.auction_bidding_ends_at<=v_opens
        or new.auction_bidding_ends_at+interval '2 hours'>(new.auction_start_date::timestamp at time zone v_timezone) then
        raise exception 'Bidding must fit published availability and close at least 2 hours before pickup' using errcode='23514';
      end if;
    elsif new.auction_start_date::timestamp at time zone v_timezone <= clock_timestamp()+interval '26 hours' then
      raise exception 'Auction dates must fit availability and allow more than 26 hours before pickup' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.start_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_opens timestamptz;
  v_closes timestamptz;
  v_hard_end timestamptz;
  v_pickup_cutoff timestamptz;
  v_timezone text:=current_setting('TimeZone');
  v_immediate boolean:=coalesce(current_setting('ybuy.auction_start_immediately',true),'false')='true';
begin
  if new.status='published' and new.auction_enabled
    and not exists(select 1 from public.listing_auctions where listing_id=new.id) then
    v_opens:=case when v_immediate then clock_timestamp()-interval '1 second' else new.auction_bidding_starts_at end;
    v_closes:=new.auction_bidding_ends_at;
    v_pickup_cutoff:=(new.auction_start_date::timestamp at time zone v_timezone)-interval '2 hours';
    v_hard_end:=least(v_closes+interval '10 minutes',v_pickup_cutoff);
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled)
      or exists(select 1 from public.user_restrictions where user_id=new.owner_id)
      or v_opens is null or v_closes is null or (v_opens<clock_timestamp() and not v_immediate)
      or v_closes-v_opens<interval '10 minutes' or v_closes>v_pickup_cutoff
      or not public.auction_has_capacity(new.id,new.auction_start_date,new.auction_end_date) then
      raise exception 'Auction dates or inventory are no longer available' using errcode='23514';
    end if;
    insert into public.listing_auctions(
      listing_id,start_date,end_date,opening_daily_rate,starts_at,ends_at,selection_deadline,hard_ends_at
    ) values(
      new.id,new.auction_start_date,new.auction_end_date,new.price_per_day,
      v_opens,v_closes,v_closes+interval '1 hour',v_hard_end
    );
  end if;
  return new;
end;
$$;

notify pgrst,'reload schema';
commit;