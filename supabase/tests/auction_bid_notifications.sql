begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('a1000000-0000-4000-8000-000000000001','bid-notification-owner@example.test'),
 ('a1000000-0000-4000-8000-000000000002','bid-notification-renter@example.test');
insert into auth.sessions(id,user_id) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001'),
 ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002');
insert into public.categories(id,name) values
 ('a3000000-0000-4000-8000-000000000001','Bid notification fixtures');
update public.feature_flags set enabled=true where key='bidding';
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end,brand,model)
values ('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001','Notification camera','A camera and carrying case.',20,'draft',100,'good',
  0,0,current_date+7,current_date+14,'Sony','FX3');
insert into public.listing_images(listing_id,url,sort_order) values
 ('a4000000-0000-4000-8000-000000000001','https://example.test/notification.png',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
values ('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'Private pickup','Dallas','TX','75201','US',0,0);
update public.listings set status='published' where id='a4000000-0000-4000-8000-000000000001';
update public.listings set auction_enabled=true,auction_start_date=current_date+7,auction_end_date=current_date+10,
  auction_bidding_starts_at=clock_timestamp()+interval '1 hour',auction_bidding_ends_at=clock_timestamp()+interval '2 days'
where id='a4000000-0000-4000-8000-000000000001';
update public.listing_auctions set starts_at=clock_timestamp()-interval '1 minute'
where listing_id='a4000000-0000-4000-8000-000000000001';

select ok(not has_function_privilege('authenticated','public.notify_listing_auction_bid()','EXECUTE'),
  'Clients cannot invoke the notification trigger directly');
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002","exp":4102444800}';
select lives_ok($$select public.place_listing_auction_bid('a4000000-0000-4000-8000-000000000001',20,'a5000000-0000-4000-8000-000000000001')$$,
  'Accepted bid creates its notification atomically');
select is((select count(*)::integer from public.notifications where user_id='a1000000-0000-4000-8000-000000000001'
  and event_key like 'auction-bid:%'),1,'Owner receives one new bid notification');
select ok((select in_app_enabled and read_at is null and category='bookings' and destination='/bidding'
  and body like '%Notification camera%$20.00 per day%'
  from public.notifications where user_id='a1000000-0000-4000-8000-000000000001' and event_key like 'auction-bid:%'),
  'Notification is unread, identifies the listing and rate, and opens owner bidding');
select is((select count(*)::integer from public.notifications where user_id='a1000000-0000-4000-8000-000000000002'
  and event_key like 'auction-bid:%'),0,'Bidder does not receive the owner alert');
select lives_ok($$select public.place_listing_auction_bid('a4000000-0000-4000-8000-000000000001',20,'a5000000-0000-4000-8000-000000000001')$$,
  'Bid retry succeeds');
select is((select count(*)::integer from public.notifications where user_id='a1000000-0000-4000-8000-000000000001'
  and event_key like 'auction-bid:%'),1,'Bid retries do not duplicate notifications');
select throws_ok($$select public.place_listing_auction_bid('a4000000-0000-4000-8000-000000000001',19,gen_random_uuid())$$,
  '23514','Bid at least $21.00 per day','Rejected bid creates no alert');
update public.notification_preferences set bookings_in_app=false where user_id='a1000000-0000-4000-8000-000000000001';
select lives_ok($$select public.place_listing_auction_bid('a4000000-0000-4000-8000-000000000001',21,'a5000000-0000-4000-8000-000000000002')$$,
  'Second bid succeeds with owner alerts disabled');
select is((select count(*)::integer from public.notifications where user_id='a1000000-0000-4000-8000-000000000001'
  and event_key like 'auction-bid:%' and in_app_enabled),1,'Owner notification preference is respected');
select is((select count(*)::integer from public.notification_email_jobs where event_key like 'auction-bid:%'),0,
  'In-app bid alerts do not add email jobs');
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001","exp":4102444800}';
set local role authenticated;
select is((select count(*)::integer from public.notifications where event_key like 'auction-bid:%'),1,
  'Owner can read the enabled alert through inbox RLS');
reset role;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002","exp":4102444800}';
set local role authenticated;
select is((select count(*)::integer from public.notifications where event_key like 'auction-bid:%'),0,
  'Renter cannot read owner alerts');
reset role;
select is((select count(*)::integer from public.notifications where event_key like 'auction-bid-accepted:%'
  and user_id='a1000000-0000-4000-8000-000000000002'),2,'Renter receives accepted alerts for distinct bids only');
select is((select count(*)::integer from public.notifications where event_key like 'auction-outbid:%'
  and user_id='a1000000-0000-4000-8000-000000000002'),0,'Raising your own bid does not outbid yourself');
insert into auth.users(id,email) values
 ('a1000000-0000-4000-8000-000000000003','bid-notification-other@example.test');
insert into auth.sessions(id,user_id) values
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003');
update public.listing_auctions set ends_at=clock_timestamp()+interval '1 minute'
where listing_id='a4000000-0000-4000-8000-000000000001';
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000003","exp":4102444800}';
select lives_ok($$select public.place_listing_auction_bid('a4000000-0000-4000-8000-000000000001',22,'a5000000-0000-4000-8000-000000000003')$$,
  'Another renter places a late bid');
select is((select count(*)::integer from public.notifications where event_key like 'auction-outbid:%'
  and user_id='a1000000-0000-4000-8000-000000000002'),1,'Previous leading renter receives outbid alert');
select is((select count(*)::integer from public.notifications where event_key like 'auction-extended:%'),3,
  'Extension notifies owner and each distinct participant');
select is((select count(*)::integer from public.notifications where event_key like 'auction-extended:%' and in_app_enabled),2,
  'Extension respects disabled owner preference');
select lives_ok($$select public.place_listing_auction_bid('a4000000-0000-4000-8000-000000000001',22,'a5000000-0000-4000-8000-000000000003')$$,
  'Late bid retry is idempotent');
select is((select count(*)::integer from public.notifications where event_key like 'auction-extended:%'),3,
  'Retry creates no duplicate extension alerts');
select ok(not has_function_privilege('authenticated','public.create_auction_in_app_notification(uuid,text,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.process_auction_payment_reminders()','EXECUTE'),
  'Clients cannot forge alerts or run reminders');
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.select_listing_auction_winner('a4000000-0000-4000-8000-000000000001',
  (select id from public.listing_auction_bids where idempotency_key='a5000000-0000-4000-8000-000000000003'))$$,
  'Owner selects a winner while bidding is open');
select is((select count(*)::integer from public.notifications where event_key like 'auction-closed:%'),3,
  'Closing bidding notifies owner and each participant');
select is((select count(*)::integer from public.notifications where event_key like 'auction-winner:%'
  and user_id='a1000000-0000-4000-8000-000000000003'),1,'Selected renter receives existing winner alert exactly once');
select is((select count(*)::integer from public.notifications where event_key like 'auction-not-selected:%'),0,
  'Runner-up is not told they lost while checkout is pending');
select public.process_auction_payment_reminders();
select is((select count(*)::integer from public.notifications where event_key like 'auction-payment-reminder:%'
  and user_id='a1000000-0000-4000-8000-000000000003'),0,'No reminder before final 15 minutes');
update public.bookings set checkout_expires_at=statement_timestamp()+interval '15 minutes'
where listing_id='a4000000-0000-4000-8000-000000000001';
select public.process_auction_payment_reminders();
select public.process_auction_payment_reminders();
select is((select count(*)::integer from public.notifications where event_key like 'auction-payment-reminder:%'
  and user_id='a1000000-0000-4000-8000-000000000003'),1,'Final-15-minute reminder is sent only once');
update public.bookings set checkout_expires_at=statement_timestamp()-interval '1 second'
where listing_id='a4000000-0000-4000-8000-000000000001';
select public.process_auction_payment_reminders();
select is((select count(*)::integer from public.notifications where event_key like 'auction-payment-reminder:%'
  and user_id='a1000000-0000-4000-8000-000000000003'),1,'Expired checkout receives no additional reminder');
select lives_ok($$select public.advance_listing_auction('a4000000-0000-4000-8000-000000000001')$$,
  'Expired selected renter advances checkout to runner-up');
select is((select count(*)::integer from public.notifications where event_key like 'auction-winner:%'
  and user_id='a1000000-0000-4000-8000-000000000002'),1,'Runner-up receives a selected alert');
select is((select count(*)::integer from public.notifications where event_key like 'auction-not-selected:%'),0,
  'Runner-up fallback still does not emit premature final outcomes');
-- Simulate the state written by trusted payment verification, not a client payment call.
update public.bookings set status='confirmed'
where listing_id='a4000000-0000-4000-8000-000000000001' and renter_id='a1000000-0000-4000-8000-000000000002';
select public.advance_listing_auction('a4000000-0000-4000-8000-000000000001');
select public.advance_listing_auction('a4000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.notifications where event_key like 'auction-not-selected:%'
  and user_id='a1000000-0000-4000-8000-000000000003'),1,'Non-winning renter receives one final not-selected alert');
select is((select count(*)::integer from public.notifications where event_key like 'auction-not-selected:%'
  and user_id='a1000000-0000-4000-8000-000000000002'),0,'Final winner never receives not-selected alert');
select is((select count(*)::integer from public.notifications where title='Booking confirmed'
  and user_id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002')),2,
  'Existing booking confirmations cover both parties without duplicate auction confirmations');
select is((select count(*)::integer from public.notification_email_jobs where event_key like 'auction-bid-%'
  or event_key like 'auction-outbid:%' or event_key like 'auction-extended:%' or event_key like 'auction-closed:%'
  or event_key like 'auction-not-selected:%' or event_key like 'auction-payment-reminder:%'),0,
  'New lifecycle alerts are in-app only');
select * from finish();
rollback;
