begin;

-- Accept the owner's IANA timezone for schedule validation only. The timezone is
-- stripped before the existing negotiation RPC persists its JSON fields.
alter function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb)
  rename to owner_configure_listing_negotiation_before_local_times;
revoke all on function public.owner_configure_listing_negotiation_before_local_times(uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated;

create function public.owner_configure_listing_negotiation(
  p_listing_id uuid,p_revision bigint,p_offers jsonb,p_auction jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_timezone text;
begin
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
  return public.owner_configure_listing_negotiation_before_local_times(
    p_listing_id,p_revision,p_offers,p_auction-'availability_timezone'
  );
end;
$$;
revoke all on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) to authenticated;

create or replace function public.guard_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_timezone text:=current_setting('TimeZone');
begin
  if tg_op='UPDATE' and exists(select 1 from public.listing_auctions where listing_id=old.id and status in ('open','owner_selection','awaiting_payment'))
    and (to_jsonb(new)-array['revision','updated_at','status'])
      is distinct from (to_jsonb(old)-array['revision','updated_at','status']) then
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
    if new.auction_bidding_starts_at is not null then
      if new.status<>'published' or not isfinite(new.auction_bidding_starts_at) or not isfinite(new.auction_bidding_ends_at)
        or new.auction_bidding_starts_at<clock_timestamp()
        or new.auction_bidding_starts_at<(new.availability_start::timestamp at time zone v_timezone)
        or new.auction_bidding_ends_at>(new.availability_end::timestamp at time zone v_timezone)
        or new.auction_bidding_ends_at<=new.auction_bidding_starts_at
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
declare v_opens timestamptz; v_closes timestamptz; v_timezone text:=current_setting('TimeZone');
begin
  if new.status='published' and new.auction_enabled
    and not exists(select 1 from public.listing_auctions where listing_id=new.id) then
    v_opens:=coalesce(new.auction_bidding_starts_at,clock_timestamp());
    v_closes:=coalesce(new.auction_bidding_ends_at,v_opens+interval '24 hours');
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled)
      or exists(select 1 from public.user_restrictions where user_id=new.owner_id)
      or (new.auction_start_date::timestamp at time zone v_timezone)<v_closes+interval '2 hours'
      or not public.auction_has_capacity(new.id,new.auction_start_date,new.auction_end_date) then
      raise exception 'Auction dates or inventory are no longer available' using errcode='23514';
    end if;
    insert into public.listing_auctions(listing_id,start_date,end_date,opening_daily_rate,starts_at,ends_at,selection_deadline)
      values(new.id,new.auction_start_date,new.auction_end_date,new.price_per_day,v_opens,v_closes,v_closes+interval '1 hour');
  end if;
  return new;
end;
$$;

commit;
