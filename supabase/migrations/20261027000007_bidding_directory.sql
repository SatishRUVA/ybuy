begin;

create function public.get_listing_auction_feed(p_category_id uuid default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_offset is null or p_offset<0 then
    raise exception 'Choose a valid auction page' using errcode='22023';
  end if;
  return (
    with eligible as materialized (
      select l.id as listing_id,l.title,l.category_id,c.name as category_name,
        coalesce(b.daily_rate,l.price_per_day) as daily_rate,b.daily_rate is not null as has_bids,
        a.start_date,a.end_date,a.ends_at as expires_at,
        (select url from public.listing_images where listing_id=l.id order by sort_order limit 1) as image_url
      from public.listing_auctions a
      join public.listings l on l.id=a.listing_id
      join public.categories c on c.id=l.category_id
      left join lateral (
        select max(bid.daily_rate) as daily_rate from public.listing_auction_bids bid
        where bid.auction_id=a.id and not exists (
          select 1 from public.user_restrictions where user_id=bid.renter_id
        )
      ) b on true
      where l.status='published' and a.status='open' and a.ends_at>statement_timestamp()
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
revoke all on function public.get_listing_auction_feed(uuid,integer) from public;
grant execute on function public.get_listing_auction_feed(uuid,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
