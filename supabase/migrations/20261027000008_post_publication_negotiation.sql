begin;

alter table public.listings
  add column auction_bidding_starts_at timestamptz,
  add column auction_bidding_ends_at timestamptz,
  add constraint listing_bidding_schedule check (
    (auction_bidding_starts_at is null and auction_bidding_ends_at is null) or
    (auction_bidding_starts_at is not null and auction_bidding_ends_at is not null
      and auction_bidding_ends_at > auction_bidding_starts_at)
  );
alter table public.listing_auctions add column starts_at timestamptz;
update public.listing_auctions set starts_at=created_at;
alter table public.listing_auctions alter column starts_at set default clock_timestamp(),
  alter column starts_at set not null;

create or replace function public.guard_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
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
        or new.auction_bidding_starts_at<(new.availability_start::timestamp at time zone 'UTC')
        or new.auction_bidding_ends_at>(new.availability_end::timestamp at time zone 'UTC')
        or new.auction_bidding_ends_at<=new.auction_bidding_starts_at
        or new.auction_bidding_ends_at+interval '2 hours'>(new.auction_start_date::timestamp at time zone 'UTC') then
        raise exception 'Bidding must fit published availability and close at least 2 hours before pickup' using errcode='23514';
      end if;
    elsif new.auction_start_date::timestamp at time zone 'UTC' <= clock_timestamp()+interval '26 hours' then
      raise exception 'Auction dates must fit availability and allow more than 26 hours before pickup' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.start_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_opens timestamptz; v_closes timestamptz;
begin
  if new.status='published' and new.auction_enabled
    and not exists(select 1 from public.listing_auctions where listing_id=new.id) then
    v_opens:=coalesce(new.auction_bidding_starts_at,clock_timestamp());
    v_closes:=coalesce(new.auction_bidding_ends_at,v_opens+interval '24 hours');
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled)
      or exists(select 1 from public.user_restrictions where user_id=new.owner_id)
      or (new.auction_start_date::timestamp at time zone 'UTC')<v_closes+interval '2 hours'
      or not public.auction_has_capacity(new.id,new.auction_start_date,new.auction_end_date) then
      raise exception 'Auction dates or inventory are no longer available' using errcode='23514';
    end if;
    insert into public.listing_auctions(listing_id,start_date,end_date,opening_daily_rate,starts_at,ends_at,selection_deadline)
      values(new.id,new.auction_start_date,new.auction_end_date,new.price_per_day,v_opens,v_closes,v_closes+interval '1 hour');
  end if;
  return new;
end;
$$;

create function public.owner_configure_listing_negotiation(p_listing_id uuid,p_revision bigint,p_offers jsonb,p_auction jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.listings; v_enabled boolean; v_start date; v_end date; v_opens timestamptz; v_closes timestamptz;
begin
  perform public.operations_require_session();
  if public.is_current_user_restricted() then raise exception 'This account is restricted' using errcode='42501';end if;
  select * into l from public.listings where id=p_listing_id for update;
  if not found or l.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if l.status<>'published' then raise exception 'Publish your listing before configuring negotiation' using errcode='23514';end if;
  if p_revision is null or l.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if jsonb_typeof(p_auction) is distinct from 'object' or jsonb_typeof(p_auction->'enabled') is distinct from 'boolean'
    or exists(select 1 from jsonb_object_keys(p_auction) k where k not in ('enabled','start_date','end_date','bidding_starts_at','bidding_ends_at'))
    or exists(select 1 from jsonb_each(p_auction) e where e.key<>'enabled' and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'Invalid auction preferences' using errcode='22023';
  end if;
  v_enabled:=(p_auction->>'enabled')::boolean;
  v_start:=case when v_enabled then (p_auction->>'start_date')::date end;
  v_end:=case when v_enabled then (p_auction->>'end_date')::date end;
  v_opens:=case when v_enabled then (p_auction->>'bidding_starts_at')::timestamptz end;
  v_closes:=case when v_enabled then (p_auction->>'bidding_ends_at')::timestamptz end;
  if v_enabled and not exists(select 1 from public.listing_auctions where listing_id=l.id)
    and (v_opens is null or v_closes is null) then
    raise exception 'Choose bidding opening and closing times' using errcode='23514';
  end if;
  perform public.owner_save_offer_preferences(l.id,p_revision,p_offers);
  if (v_enabled,v_start,v_end,v_opens,v_closes) is distinct from
    (l.auction_enabled,l.auction_start_date,l.auction_end_date,l.auction_bidding_starts_at,l.auction_bidding_ends_at) then
    update public.listings set auction_enabled=v_enabled,auction_start_date=v_start,auction_end_date=v_end,
      auction_bidding_starts_at=v_opens,auction_bidding_ends_at=v_closes where id=l.id;
  end if;
  return (select jsonb_build_object('revision',revision,'status',status,'deposit',deposit) from public.listings where id=l.id);
end;
$$;
revoke all on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) to authenticated;

create function public.guard_bid_opening()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.listing_auctions where id=new.auction_id and starts_at>clock_timestamp()) then
    raise exception 'Bidding has not opened yet' using errcode='55000';
  end if;
  return new;
end;
$$;
create trigger auction_bid_opening before insert on public.listing_auction_bids
  for each row execute function public.guard_bid_opening();
revoke all on function public.guard_bid_opening() from public,anon,authenticated;

create or replace function public.process_listing_auctions()
returns integer language plpgsql security definer set search_path = '' as $$
declare l record; v_count integer:=0;
begin
  for l in select listings.id from public.listings join public.listing_auctions a on a.listing_id=listings.id
    where (a.status='open' and a.ends_at<=clock_timestamp())
      or (a.status='owner_selection' and a.selection_deadline<=clock_timestamp())
      or a.status='awaiting_payment'
    order by listings.id limit 100 for update of listings skip locked loop
    perform public.advance_listing_auction(l.id);v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

alter function public.get_listing_auction(uuid) rename to get_listing_auction_before_schedule;
revoke all on function public.get_listing_auction_before_schedule(uuid) from public,anon,authenticated;
create function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; a public.listing_auctions;
begin
  v_result:=public.get_listing_auction_before_schedule(p_listing_id);
  if v_result is null then return null;end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  return v_result || jsonb_build_object('starts_at',a.starts_at,
    'status',case when a.status='open' and a.starts_at>clock_timestamp() then 'scheduled' else a.status end);
end;
$$;
revoke all on function public.get_listing_auction(uuid) from public;
grant execute on function public.get_listing_auction(uuid) to anon,authenticated;

create or replace function public.get_top_listing_bids()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.daily_rate desc),'[]') from (
    select l.id as listing_id,l.title,max(b.daily_rate) as daily_rate,a.start_date,a.end_date,a.ends_at as expires_at,
      (select url from public.listing_images where listing_id=l.id order by sort_order limit 1) as image_url
    from public.listing_auctions a join public.listings l on l.id=a.listing_id
      join public.listing_auction_bids b on b.auction_id=a.id
    where l.status='published' and a.status='open' and a.starts_at<=statement_timestamp() and a.ends_at>statement_timestamp()
      and not exists(select 1 from public.user_restrictions where user_id in (b.renter_id,l.owner_id))
      and exists(select 1 from public.feature_flags where key='bidding' and enabled)
    group by l.id,a.id order by max(b.daily_rate) desc,l.id limit 5
  ) t
$$;

create or replace function public.get_listing_auction_feed(p_category_id uuid default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_offset is null or p_offset<0 then raise exception 'Choose a valid auction page' using errcode='22023';end if;
  return (
    with eligible as materialized (
      select l.id as listing_id,l.title,l.category_id,c.name as category_name,
        coalesce(b.daily_rate,l.price_per_day) as daily_rate,b.daily_rate is not null as has_bids,
        a.start_date,a.end_date,a.ends_at as expires_at,
        (select url from public.listing_images where listing_id=l.id order by sort_order limit 1) as image_url
      from public.listing_auctions a join public.listings l on l.id=a.listing_id
      join public.categories c on c.id=l.category_id
      left join lateral (
        select max(bid.daily_rate) as daily_rate from public.listing_auction_bids bid where bid.auction_id=a.id
          and not exists(select 1 from public.user_restrictions where user_id=bid.renter_id)
      ) b on true
      where l.status='published' and a.status='open' and a.starts_at<=statement_timestamp() and a.ends_at>statement_timestamp()
        and not exists(select 1 from public.user_restrictions where user_id=l.owner_id)
        and exists(select 1 from public.feature_flags where key='bidding' and enabled)
    ), filtered as (
      select * from eligible where p_category_id is null or category_id=p_category_id
    ), page as (
      select * from filtered order by expires_at,listing_id limit 24 offset p_offset
    ), categories as (
      select category_id as id,category_name as name,count(*) as count from eligible group by category_id,category_name
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(to_jsonb(page) order by expires_at,listing_id) from page),'[]'::jsonb),
      'total',(select count(*) from filtered),
      'categories',coalesce((select jsonb_agg(to_jsonb(categories) order by name) from categories),'[]'::jsonb)
    )
  );
end;
$$;
notify pgrst,'reload schema';
commit;
