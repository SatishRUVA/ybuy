begin;

create function public.create_auction_in_app_notification(
  p_user_id uuid, p_event_key text, p_title text, p_body text, p_destination text
) returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(user_id,event_key,category,title,body,destination,in_app_enabled)
  values(p_user_id,p_event_key,'bookings',p_title,left(p_body,500),p_destination,
    public.notification_preference_enabled(p_user_id,'bookings','in_app'))
  on conflict(event_key) do nothing;
$$;
revoke all on function public.create_auction_in_app_notification(uuid,text,text,text,text) from public,anon,authenticated;

create or replace function public.notify_listing_auction_bid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l public.listings; previous_bid public.listing_auction_bids;
begin
  select listings.* into strict l from public.listings
    join public.listing_auctions a on a.listing_id=listings.id where a.id=new.auction_id;
  perform public.create_auction_in_app_notification(l.owner_id,'auction-bid:'||new.id,
    'New bid on your auction',
    'Your listing "'||l.title||'" received a bid of $'||new.daily_rate::text||' per day. Open Bidding to review your bids.',
    '/bidding');
  perform public.create_auction_in_app_notification(new.renter_id,'auction-bid-accepted:'||new.id,
    'Bid accepted','Your bid of $'||new.daily_rate::text||'/day for "'||l.title||'" has been accepted.',
    '/bidding/'||l.id);
  select bid.* into previous_bid from public.listing_auction_bids bid
    where bid.auction_id=new.auction_id and bid.id<>new.id and not bid.passed
      and not exists(select 1 from public.user_restrictions where user_id=bid.renter_id)
    order by bid.daily_rate desc,bid.created_at,bid.id limit 1;
  if found and previous_bid.renter_id<>new.renter_id and new.daily_rate>previous_bid.daily_rate then
    perform public.create_auction_in_app_notification(previous_bid.renter_id,'auction-outbid:'||new.id,
      'You have been outbid','A higher bid has been placed on "'||l.title||'". Open the auction to review your remaining bids.',
      '/bidding/'||l.id);
  end if;
  return new;
end;
$$;

create function public.notify_listing_auction_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l public.listings; recipient uuid; winner uuid;
begin
  select * into strict l from public.listings where id=new.listing_id;
  if new.ends_at>old.ends_at and new.status='open' then
    for recipient in select l.owner_id union select renter_id from public.listing_auction_bids where auction_id=new.id loop
      perform public.create_auction_in_app_notification(recipient,
        'auction-extended:'||new.id||':'||new.ends_at::text||':'||recipient,
        'Auction extended','A late bid extended bidding for "'||l.title||'". Check the updated deadline.',
        case when recipient=l.owner_id then '/bidding' else '/bidding/'||l.id end);
    end loop;
  end if;
  if old.status='open' and new.status<>'open' then
    for recipient in select l.owner_id union select renter_id from public.listing_auction_bids where auction_id=new.id loop
      perform public.create_auction_in_app_notification(recipient,'auction-closed:'||new.id||':'||recipient,
        case when new.status='cancelled' then 'Auction cancelled' else 'Auction ended' end,
        'Bidding for "'||l.title||'" has closed. Open Bidding to view the current result.',
        case when recipient=l.owner_id then '/bidding' else '/bidding/'||l.id end);
    end loop;
  end if;
  -- Runner-ups remain eligible until payment succeeds or no further selection is possible.
  if new.status in ('completed','ended','cancelled') and new.status is distinct from old.status then
    if new.status='completed' then
      select renter_id into winner from public.listing_auction_bids where id=new.selected_bid_id;
    end if;
    for recipient in select distinct renter_id from public.listing_auction_bids
      where auction_id=new.id and renter_id is distinct from winner loop
      perform public.create_auction_in_app_notification(recipient,'auction-not-selected:'||new.id||':'||recipient,
        'Not selected',
        case when new.status='completed' then 'Another renter completed payment for "'||l.title||'".'
          else 'The auction for "'||l.title||'" ended without a completed booking.' end,
        '/bidding/'||l.id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_listing_auction_status() from public,anon,authenticated;
create trigger listing_auction_status_notifications after update on public.listing_auctions
  for each row execute function public.notify_listing_auction_status();

create function public.process_auction_payment_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_created integer;
begin
  insert into public.notifications(user_id,event_key,category,title,body,destination,in_app_enabled)
  select bk.renter_id,'auction-payment-reminder:'||bk.id,'bookings','Payment reminder',
    left('You have 15 minutes or less to complete payment for "'||l.title||'". Check your booking for the exact deadline.',500),
    '/confirmation/'||bk.id,public.notification_preference_enabled(bk.renter_id,'bookings','in_app')
  from public.listing_auctions a
  join public.listing_auction_bids bid on bid.id=a.selected_bid_id
  join public.bookings bk on bk.id=bid.booking_id
  join public.listings l on l.id=a.listing_id
  where a.status='awaiting_payment' and bk.status='pending_payment'
    and bk.checkout_expires_at>statement_timestamp()
    and bk.checkout_expires_at<=statement_timestamp()+interval '15 minutes'
    and not exists(select 1 from public.payments where booking_id=bk.id and status='succeeded')
  on conflict(event_key) do nothing;
  get diagnostics v_created=row_count;
  return v_created;
end;
$$;
revoke all on function public.process_auction_payment_reminders() from public,anon,authenticated;
grant execute on function public.process_auction_payment_reminders() to service_role;
select cron.schedule('auction-payment-reminders','* * * * *','select public.process_auction_payment_reminders();');

commit;
