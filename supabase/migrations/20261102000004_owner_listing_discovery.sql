begin;

create or replace function public.search_available_listings(
  p_latitude double precision default null,p_longitude double precision default null,
  p_radius_miles integer default 5,p_start_date date default null,p_end_date date default null,
  p_keyword text default null,p_category_id uuid default null,p_max_price numeric default null,
  p_verified_only boolean default false,p_instant_only boolean default false,
  p_protection_only boolean default false,p_delivery_only boolean default false,
  p_sort text default 'recommended',p_limit integer default 24,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_origin extensions.geography;v_result jsonb;
begin
  if auth.role()='authenticated' and not public.has_active_session() then
    raise exception 'An active signed-in session is required' using errcode='42501';
  end if;
  if (p_latitude is null)<>(p_longitude is null)
    or (p_latitude is not null and not(p_latitude between -90 and 90 and p_longitude between -180 and 180)) then
    raise exception 'Choose valid search coordinates' using errcode='22023';
  end if;
  if p_radius_miles is not null and p_radius_miles not in (5,10,25,50) then
    raise exception 'Radius must be 5, 10, 25, 50 miles or unlimited' using errcode='22023';
  end if;
  if (p_start_date is null)<>(p_end_date is null)
    or (p_start_date is not null and (p_start_date<current_date or p_end_date<=p_start_date or p_end_date-p_start_date>366)) then
    raise exception 'Choose both dates, starting today or later, with an end after the start and a range of at most 366 days' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000
    or length(coalesce(p_keyword,''))>200 or p_max_price<0 or p_max_price::text in ('NaN','Infinity','-Infinity')
    or p_sort is null or p_sort not in ('recommended','newest','price-low','price-high','distance') then
    raise exception 'Invalid search filters or pagination' using errcode='22023';
  end if;
  if p_latitude is not null then
    v_origin:=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography;
  end if;
  with candidates as materialized (
    select l.*,case when v_origin is not null and l.location_lat between -90 and 90 and l.location_lng between -180 and 180
      then extensions.st_distance(extensions.st_setsrid(extensions.st_makepoint(l.location_lng,l.location_lat),4326)::extensions.geography,v_origin)/1609.344 end as distance_miles
    from public.listings l where l.status='published'
      and (l.availability_end is null or l.availability_end>current_date)
      and (p_category_id is null or l.category_id=p_category_id)
      and (p_max_price is null or l.price_per_day<=p_max_price)
      and (not coalesce(p_verified_only,false) or l.owner_verified)
      and (not coalesce(p_instant_only,false) or l.instant_booking)
      and (not coalesce(p_protection_only,false) or l.protection_eligible)
      and (not coalesce(p_delivery_only,false) or l.delivery_available)
      and (nullif(btrim(p_keyword),'') is null or strpos(lower(l.title||' '||coalesce(l.description,'')),lower(btrim(p_keyword)))>0)
      and (v_origin is null or p_radius_miles is null or (l.location_lat between -90 and 90 and l.location_lng between -180 and 180
        and extensions.st_dwithin(extensions.st_setsrid(extensions.st_makepoint(l.location_lng,l.location_lat),4326)::extensions.geography,v_origin,p_radius_miles*1609.344)))
      and (p_start_date is null or public.listing_has_capacity(l.id,p_start_date,p_end_date))
  ),page as (
    select * from candidates order by
      case when p_sort='price-low' then price_per_day end asc,
      case when p_sort='price-high' then price_per_day end desc,
      case when p_sort='distance' then distance_miles end asc nulls last,
      case when p_sort='recommended' then owner_verified end desc,
      case when p_sort='recommended' then instant_booking end desc,created_at desc,id
    limit p_limit offset p_offset
  )
  select jsonb_build_object('total',(select count(*) from candidates),'rows',coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'listing_images',coalesce((select jsonb_agg(jsonb_build_object('url',i.url,'sort_order',i.sort_order) order by i.sort_order,i.id)
        from public.listing_images i where i.listing_id=p.id),'[]'::jsonb),
      'owner',(select jsonb_build_object('id',o.id,'full_name',o.full_name,'avatar_url',o.avatar_url) from public.profiles o where o.id=p.owner_id),
      'categories',(select jsonb_build_object('name',c.name) from public.categories c where c.id=p.category_id))
      order by case when p_sort='price-low' then p.price_per_day end asc,
      case when p_sort='price-high' then p.price_per_day end desc,
      case when p_sort='distance' then p.distance_miles end asc nulls last,
      case when p_sort='recommended' then p.owner_verified end desc,
      case when p_sort='recommended' then p.instant_booking end desc,p.created_at desc,p.id)
    from page p),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_top_listing_bids()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.listing_id),'[]'::jsonb) from (
    select l.id as listing_id,l.title,coalesce(b.daily_rate,a.opening_daily_rate) as daily_rate,
      a.start_date,a.end_date,a.ends_at as expires_at,a.created_at,
      (select url from public.listing_images where listing_id=l.id order by sort_order limit 1) as image_url
    from public.listing_auctions a join public.listings l on l.id=a.listing_id
    left join lateral (
      select max(bid.daily_rate) as daily_rate from public.listing_auction_bids bid where bid.auction_id=a.id and not bid.passed
        and not exists(select 1 from public.user_restrictions where user_id=bid.renter_id)
    ) b on true
    where l.status='published' and (l.availability_end is null or l.availability_end>current_date)
      and a.status='open' and a.starts_at<=statement_timestamp() and a.ends_at>statement_timestamp()
      and not exists(select 1 from public.user_restrictions where user_id=l.owner_id)
      and exists(select 1 from public.feature_flags where key='bidding' and enabled)
    order by a.created_at desc,l.id limit 24
  ) t
$$;

create or replace function public.get_listing_auction_feed(p_category_id uuid default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_offset is null or p_offset<0 then raise exception 'Choose a valid auction page' using errcode='22023';end if;
  return (
    with eligible as materialized (
      select l.id as listing_id,l.title,l.category_id,c.name as category_name,
        coalesce(b.daily_rate,a.opening_daily_rate) as daily_rate,b.daily_rate is not null as has_bids,
        a.start_date,a.end_date,a.ends_at as expires_at,
        (select url from public.listing_images where listing_id=l.id order by sort_order limit 1) as image_url
      from public.listing_auctions a join public.listings l on l.id=a.listing_id
      join public.categories c on c.id=l.category_id
      left join lateral (
        select max(bid.daily_rate) as daily_rate from public.listing_auction_bids bid where bid.auction_id=a.id and not bid.passed
          and not exists(select 1 from public.user_restrictions where user_id=bid.renter_id)
      ) b on true
      where l.status='published' and (l.availability_end is null or l.availability_end>current_date)
        and a.status='open' and a.starts_at<=statement_timestamp() and a.ends_at>statement_timestamp()
        and l.owner_id is distinct from auth.uid()
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

comment on function public.search_available_listings(double precision,double precision,integer,date,date,text,uuid,numeric,boolean,boolean,boolean,boolean,text,integer,integer) is
  'Public discovery excludes expired availability before counting and pagination. End dates are exclusive in database UTC. Owner inventory and existing rental history remain readable.';

notify pgrst,'reload schema';
update public.feature_flags set enabled=false where key='private_offers';
commit;
