begin;

-- A renter can review only their own bid history without opening the private bid ledger.
create function public.get_my_listing_auction_bids(p_offset integer default 0, p_limit integer default 20)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_items jsonb;
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your bids' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Choose a valid bid history page' using errcode = '22023';
  end if;

  select count(distinct a.id)::integer into v_total
  from public.listing_auction_bids b
  join public.listing_auctions a on a.id = b.auction_id
  where b.renter_id = auth.uid();

  with page as (
    select a.id as auction_id, a.listing_id, a.status, a.date_flexible,
      a.start_date, a.end_date, a.starts_at, a.ends_at, a.selection_deadline, a.selected_bid_id,
      a.opening_daily_rate, l.title,
      (select image.url from public.listing_images image
        where image.listing_id = l.id order by image.sort_order, image.created_at limit 1) as image_url,
      max(b.created_at) as last_bid_at
    from public.listing_auction_bids b
    join public.listing_auctions a on a.id = b.auction_id
    join public.listings l on l.id = a.listing_id
    where b.renter_id = auth.uid()
    group by a.id, a.listing_id, a.status, a.date_flexible, a.start_date, a.end_date,
      a.starts_at, a.ends_at, a.selection_deadline, a.selected_bid_id, a.opening_daily_rate, l.id, l.title
    order by max(b.created_at) desc, a.id
    offset p_offset limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'auction_id', page.auction_id,
    'listing_id', page.listing_id,
    'title', page.title,
    'image_url', page.image_url,
    'status', case when page.status = 'open' and page.starts_at > clock_timestamp() then 'scheduled' else page.status end,
    'date_flexible', page.date_flexible,
    'start_date', page.start_date,
    'end_date', page.end_date,
    'starts_at', page.starts_at,
    'ends_at', page.ends_at,
    'selection_deadline', page.selection_deadline,
    'opening_daily_rate', page.opening_daily_rate,
    'last_bid_at', page.last_bid_at,
    'bids', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id,
        'daily_rate', b.daily_rate,
        'submitted_at', b.created_at,
        'passed', b.passed,
        'is_current', r.bid_id is not null,
        'rank', r.rank,
        'selected', coalesce(case when page.date_flexible then b.selected_at is not null and not b.passed
          else b.id = page.selected_bid_id end, false),
        'start_date', b.start_date,
        'end_date', b.end_date,
        'total_value', b.total_value,
        'booking_id', bk.id,
        'payment_deadline', bk.checkout_expires_at,
        'payment_status', case
          when bk.id is null then null
          when exists(select 1 from public.payments payment where payment.booking_id = bk.id and payment.status = 'succeeded') then 'paid'
          when bk.status <> 'pending_payment' or bk.checkout_expires_at <= clock_timestamp() or b.passed then 'expired'
          else 'pending' end
      ) order by b.created_at desc), '[]'::jsonb)
      from public.listing_auction_bids b
      left join public.listing_auction_ranked_bids(page.auction_id) r on r.bid_id = b.id
      left join public.bookings bk on bk.id = b.booking_id
      where b.auction_id = page.auction_id and b.renter_id = auth.uid()
    )
  ) order by page.last_bid_at desc), '[]'::jsonb)
  into v_items
  from page;

  return jsonb_build_object('items', v_items, 'total', v_total, 'offset', p_offset, 'limit', p_limit);
end;
$$;

revoke all on function public.get_my_listing_auction_bids(integer, integer) from public, anon;
grant execute on function public.get_my_listing_auction_bids(integer, integer) to authenticated;

commit;
