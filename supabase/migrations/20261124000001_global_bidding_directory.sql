begin;

create or replace function public.get_global_bidding_feed(
  p_category_id uuid, p_offset integer, p_status text,
  p_search text, p_only_mine boolean, p_sort text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_offset is null or p_offset < 0 then
    raise exception 'Choose a valid bidding page' using errcode='22023';
  end if;
  if p_status is null or p_status not in ('all','live','scheduled','completed','closed','past') then
    raise exception 'Choose a valid bidding status' using errcode='22023';
  end if;
  if p_search is null or length(p_search)>120 or p_only_mine is null
    or p_sort is null or p_sort not in ('ending','low','high') then
    raise exception 'Choose valid bidding filters' using errcode='22023';
  end if;
  return (
    with eligible as materialized (
      select l.id as listing_id,l.title,l.category_id,c.name as category_name,
        coalesce(b.daily_rate,a.opening_daily_rate) as daily_rate,b.daily_rate is not null as has_bids,
        a.opening_daily_rate,coalesce(l.owner_id=auth.uid(),false) as is_mine,
        a.start_date,a.end_date,a.starts_at,a.ends_at as expires_at,
        case when a.status='open' and a.ends_at<=statement_timestamp() then 'ended'
          when a.status='open' and a.starts_at>statement_timestamp() then 'scheduled'
          else a.status end as status,
        (select url from public.listing_images where listing_id=l.id order by sort_order limit 1) as image_url
      from public.listing_auctions a join public.listings l on l.id=a.listing_id
      join public.categories c on c.id=l.category_id
      left join lateral (
        select max(bid.daily_rate) as daily_rate from public.listing_auction_bids bid
        where bid.auction_id=a.id and not bid.passed
          and not exists(select 1 from public.user_restrictions r where r.user_id=bid.renter_id)
      ) b on true
      where l.status='published'
        and (not p_only_mine or l.owner_id=auth.uid())
        and strpos(lower(l.title),lower(trim(p_search)))>0
        and not exists(select 1 from public.user_restrictions r where r.user_id=l.owner_id)
        and exists(select 1 from public.feature_flags f where f.key='bidding' and f.enabled)
    ), classified as (
      select *, case
        when status='open' then 'live'
        when status='scheduled' then 'scheduled'
        when status='completed' then 'completed'
        else 'closed' end as directory_status
      from eligible
    ), matching_status as (
      select * from classified where p_status='all' or directory_status=p_status
        or (p_status='past' and directory_status in ('completed','closed'))
    ), filtered as (
      select * from matching_status where p_category_id is null or category_id=p_category_id
    ), page as (
      select *,row_number() over (order by
        case directory_status when 'live' then 0 when 'scheduled' then 1 else 2 end,
        case when p_sort='low' then opening_daily_rate end asc,
        case when p_sort='high' then opening_daily_rate end desc,
        case when directory_status in ('live','scheduled') then expires_at end asc,
        expires_at desc,listing_id) as position
      from filtered
      order by position
      limit 24 offset p_offset
    ), categories as (
      select category_id as id,category_name as name,count(*) as count
      from matching_status group by category_id,category_name
      union all
      select category_id,category_name,0::bigint
      from classified where category_id=p_category_id
        and not exists(select 1 from matching_status where category_id=p_category_id)
      group by category_id,category_name
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(to_jsonb(page)-'directory_status'-'position' order by position) from page),'[]'::jsonb),
      'total',(select count(*) from filtered),
      'status_counts',(select jsonb_build_object(
        'all',count(*),
        'live',count(*) filter (where directory_status='live'),
        'scheduled',count(*) filter (where directory_status='scheduled'),
        'completed',count(*) filter (where directory_status='completed'),
        'closed',count(*) filter (where directory_status='closed')
      ) from classified where p_category_id is null or category_id=p_category_id),
      'categories',coalesce((select jsonb_agg(to_jsonb(categories) order by name) from categories),'[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_global_bidding_feed(
  p_category_id uuid default null, p_offset integer default 0, p_status text default 'all'
)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.get_global_bidding_feed(p_category_id,p_offset,p_status,'',false,'ending')
$$;

revoke all on function public.get_global_bidding_feed(uuid,integer,text) from public;
grant execute on function public.get_global_bidding_feed(uuid,integer,text) to anon,authenticated;
revoke all on function public.get_global_bidding_feed(uuid,integer,text,text,boolean,text) from public;
grant execute on function public.get_global_bidding_feed(uuid,integer,text,text,boolean,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
