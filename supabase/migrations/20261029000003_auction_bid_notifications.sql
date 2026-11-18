begin;

create function public.notify_listing_auction_bid()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (
    user_id, event_key, category, title, body, destination, in_app_enabled
  )
  select l.owner_id, 'auction-bid:' || new.id::text, 'bookings',
    'New bid on your auction',
    left('Your listing "' || l.title || '" received a bid of $' || new.daily_rate::text || ' per day. Open Bidding to review your bids.', 500),
    '/bidding',
    public.notification_preference_enabled(l.owner_id, 'bookings', 'in_app')
  from public.listing_auctions a
  join public.listings l on l.id = a.listing_id
  where a.id = new.auction_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;
revoke all on function public.notify_listing_auction_bid() from public, anon, authenticated;

create trigger listing_auction_bid_notification
  after insert on public.listing_auction_bids
  for each row execute function public.notify_listing_auction_bid();

commit;
