begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email)
select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'auction-'||n||'@example.test' from generate_series(1,5) n;
insert into auth.sessions(id,user_id)
select ('82000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into public.categories(id,name) values('83000000-0000-4000-8000-000000000001','Auction fixtures');
update public.feature_flags set enabled=true where key='bidding';
update public.feature_flags set enabled=true where key='duration_discounts';
update public.app_settings set value='true'::jsonb where key='listing_offers_configured';
update public.app_settings set value='0.2'::jsonb where key='listing_offer_below_pct';
update public.app_settings set value='0.1'::jsonb where key='listing_offer_above_pct';
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end,brand,model)
select ('84000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',
  'Auction camera '||n,'A camera and carrying case.',20,'draft',100,'good',0,0,current_date+7,current_date+14,'Sony','FX3'
from generate_series(1,5) n;
update public.listings set duration_discount_min_days=2,duration_discount_percent=10
where id='84000000-0000-4000-8000-000000000001';
insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/auction.png',0 from public.listings where category_id='83000000-0000-4000-8000-000000000001';
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
select id,owner_id,'Private pickup','Dallas','TX','75201','US',0,0
from public.listings where category_id='83000000-0000-4000-8000-000000000001';

select ok(not has_table_privilege('authenticated','public.listing_auction_bids','SELECT'),'Bid ledger is not readable by clients');
select ok(not has_table_privilege('authenticated','public.listing_auctions','UPDATE'),'Clients cannot change auction deadlines');
select ok(not has_function_privilege('authenticated','public.advance_listing_auction(uuid,uuid)','EXECUTE'),'Lifecycle worker is private');
select ok(not has_function_privilege('authenticated','public.process_listing_auctions()','EXECUTE'),'Scheduler is private');
select ok(not has_function_privilege('authenticated','public.owner_save_listing_flow_before_auctions(uuid,bigint,jsonb,jsonb,boolean)','EXECUTE'),'Previous save RPC cannot bypass auction guards');
select ok(not has_function_privilege('authenticated','public.confirm_booking_payment(uuid,text,text,numeric)','EXECUTE'),'Clients cannot confirm payment');
select ok(has_function_privilege('service_role','public.confirm_booking_payment(uuid,text,text,numeric)','EXECUTE'),'Trusted verification retains payment access');
select ok(not has_function_privilege('service_role','public.confirm_booking_payment_before_auctions(uuid,text,text,numeric)','EXECUTE'),'Payment bypass is private');

set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.owner_save_listing_flow('84000000-0000-4000-8000-000000000001',
  (select revision from public.listings where id='84000000-0000-4000-8000-000000000001'),
  '{"auction_preferences":{"enabled":"yes"}}')$$,'22023','Invalid auction preferences','Malformed preferences fail closed');
select lives_ok($$select public.owner_save_listing_flow('84000000-0000-4000-8000-000000000001',
  (select revision from public.listings where id='84000000-0000-4000-8000-000000000001'),
  jsonb_build_object('auction_preferences',jsonb_build_object('enabled',true,'start_date',current_date+7,'end_date',current_date+10)))$$,
  'Owner can save auction preferences on a private draft');
select is((select count(*)::integer from public.listing_auctions),0,'Saving a draft never opens bidding');
select throws_ok($$select public.owner_save_listing_flow('84000000-0000-4000-8000-000000000001',1,'{}')$$,
  '40001','This listing changed in another session. Reload before saving.','Stale saves are rejected');
select lives_ok($$select public.owner_save_listing_flow('84000000-0000-4000-8000-000000000001',
  (select revision from public.listings where id='84000000-0000-4000-8000-000000000001'),'{}',null,true)$$,
  'Validated owner publication opens a configured auction');
reset request.jwt.claims;
update public.listings set auction_enabled=true,auction_start_date=current_date+7,auction_end_date=current_date+10
where id in ('84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000005');
update public.listings set estimated_value=2000 where id='84000000-0000-4000-8000-000000000005';
update public.listings set status='published' where category_id='83000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.listing_auctions),3,'Publication starts auctions only for opted-in listings');
select is((select status from public.listings where id='84000000-0000-4000-8000-000000000005'),'pending_approval','High-value listing still requires approval');
select is((select count(*)::integer from public.listing_auctions where listing_id='84000000-0000-4000-8000-000000000005'),0,'Pending approval never opens bidding');
select ok((select ends_at between created_at+interval '23 hours 59 minutes' and created_at+interval '24 hours 1 minute'
  from public.listing_auctions where listing_id='84000000-0000-4000-8000-000000000001'),'Auction lasts 24 hours');
select throws_ok($$update public.listings set price_per_day=22 where id='84000000-0000-4000-8000-000000000001'$$,
  '23514','Auction listing terms cannot change after bidding starts','Auction rate cannot change while bidding is open');
select throws_ok($$update public.listing_images set url='https://example.test/other.png' where listing_id='84000000-0000-4000-8000-000000000001'$$,
  '23514','Photos, pickup and blocked dates cannot change during competitive bidding','Owner cannot replace the item after bidders commit');
select throws_ok($$update public.listing_pickup_locations set address='Other address' where listing_id='84000000-0000-4000-8000-000000000001'$$,
  '23514','Photos, pickup and blocked dates cannot change during competitive bidding','Private pickup terms are locked');

set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.owner_save_offer_preferences('84000000-0000-4000-8000-000000000004',
  (select revision from public.listings where id='84000000-0000-4000-8000-000000000004'),
  jsonb_build_object('negotiation_enabled',true,'offer_minimum_daily',16,'offer_maximum_daily',22,'offer_target_daily',20,
    'offer_start_date',current_date+7,'offer_end_date',current_date+14,'offer_expiration_hours',24))$$,
  'Existing private offers can be enabled independently');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20,gen_random_uuid())$$,
  '42501','Bidding is unavailable for this listing or account','Owner cannot bid on their own listing');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000002","exp":4102444800}';
select lives_ok($$select public.create_marketplace_offer(null,'84000000-0000-4000-8000-000000000004',current_date+7,current_date+10,20,null,gen_random_uuid())$$,
  'Private negotiation remains available');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001','NaN',gen_random_uuid())$$,
  '22023','Enter a finite daily bid with at most two decimal places','NaN money is rejected');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20.001,gen_random_uuid())$$,
  '22023','Enter a finite daily bid with at most two decimal places','Fractional cents are rejected');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20,'85000000-0000-4000-8000-000000000001')$$,'Opening bid equals asking price');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20,'85000000-0000-4000-8000-000000000001')$$,'Identical retries are idempotent');
select is((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'my_bid_count')::integer,1,'Retry does not use another bid');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',25,'85000000-0000-4000-8000-000000000001')$$,
  '22023','This retry key belongs to a different bid','Retry cannot silently change price');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',24,gen_random_uuid())$$,
  '23514','Bid at least $25.00 per day','Subsequent bids must increase by at least five dollars');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',25,gen_random_uuid())$$,'Second bid accepted');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',30,gen_random_uuid())$$,'Auction is not constrained by private-offer ceiling');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',35,gen_random_uuid())$$,
  '23514','You have used all three bids for this auction','Fourth submission is rejected');
select throws_ok($$select public.create_booking_request('84000000-0000-4000-8000-000000000001',current_date+7,current_date+10,1)$$,
  '23P01','One unit is reserved for competitive bidding on these dates','Normal bookings cannot consume auction inventory');
select lives_ok($$select public.create_booking_request('84000000-0000-4000-8000-000000000004',current_date+7,current_date+10,1)$$,
  'Ordinary booking behavior remains available on other listings');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000003","exp":4102444800}';
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',35,gen_random_uuid())$$,'Second renter bids');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000002',20,gen_random_uuid())$$,'Second auction receives a bid');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000004","exp":4102444800}';
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',40,gen_random_uuid())$$,'Third renter bids');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000005","exp":4102444800}';
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',45,gen_random_uuid())$$,'Fourth renter bids');
select is(jsonb_array_length(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'top_bids'),3,'Public leaderboard contains only top three bidders');
select ok(not ((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'top_bids')::text like '%renter_id%'),'Leaderboard does not expose renter identity');
select is((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'top_bids'->0->>'daily_rate')::numeric,45::numeric,'Highest bid ranks first');
select is(jsonb_array_length(public.get_top_listing_bids()),2,'Ticker contains competitive auction listings only');

reset request.jwt.claims;
select is((select count(*)::integer from public.bookings where auction_bid_id is not null),0,'Open bidding does not create bookings');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.select_listing_auction_winner('84000000-0000-4000-8000-000000000001',gen_random_uuid())$$,
  '42501','Only the listing owner can select a winner','Renters cannot select themselves');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.select_listing_auction_winner('84000000-0000-4000-8000-000000000001',
  (select id from public.listing_auction_bids where daily_rate=40))$$,'Owner may select an eligible non-highest bidder while bidding is open');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'status','awaiting_payment','Manual selection closes bidding immediately');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',50,gen_random_uuid())$$,
  '55000','Bidding is closed','Bids after owner selection are rejected');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select daily_rate from public.bookings where auction_bid_id is not null),40::numeric,'Booking uses selected auction price');
select is((select status from public.bookings where auction_bid_id is not null),'pending_payment','Winner is not confirmed without payment');
select ok((select checkout_expires_at between clock_timestamp()+interval '59 minutes' and clock_timestamp()+interval '61 minutes'
  from public.bookings where auction_bid_id is not null),'Winner receives one hour to pay');
select is((select subtotal from public.bookings where auction_bid_id is not null),120::numeric,'Winning daily rate is multiplied by rental days');
select is((select owner_discount_amount from public.bookings where auction_bid_id is not null),0::numeric,'Duration discounts do not alter the winning rate');
select is((select count(*)::integer from public.payments p join public.bookings b on b.id=p.booking_id
  where b.auction_bid_id is not null),0,'Bidding never creates payment receipts');
select lives_ok($$select public.respond_to_booking_request(
  (select id from public.bookings where listing_id='84000000-0000-4000-8000-000000000004'),true)$$,
  'Ordinary owner approval still works');
select ok((select checkout_expires_at between clock_timestamp()+interval '14 minutes' and clock_timestamp()+interval '16 minutes'
  from public.bookings where listing_id='84000000-0000-4000-8000-000000000004'),'Ordinary checkout retains its fifteen-minute deadline');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000004","exp":4102444800}';
select ok((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'my_booking_id') is not null,'Selected renter gets payment link');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000005","exp":4102444800}';
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'my_booking_id',null::text,'Other bidders never receive winner booking ID');
reset request.jwt.claims;
update public.bookings set checkout_expires_at=clock_timestamp()-interval '1 second',checkout_session_id='cs_auction_first' where auction_bid_id is not null;
select lives_ok($$select public.process_listing_auctions()$$,'Expiry is processed safely');
select is((select count(*)::integer from public.bookings where auction_bid_id is not null),1,'No runner-up reservation while Stripe session may settle');
update public.bookings set checkout_session_closed_at=clock_timestamp() where checkout_session_id='cs_auction_first';
select lives_ok($$select public.process_listing_auctions()$$,'Runner-up proceeds after Stripe closure is verified');
select is((select count(*)::integer from public.bookings where auction_bid_id is not null),2,'Runner-up gets a new reservation');
select is((select daily_rate from public.bookings where auction_bid_id is not null and status='pending_payment'),45::numeric,'Highest remaining eligible renter is runner-up');
select lives_ok($$select public.confirm_booking_payment(
  (select id from public.bookings where checkout_session_id='cs_auction_first'),'cs_auction_first','pi_late_auction',
  (select total from public.bookings where checkout_session_id='cs_auction_first'))$$,
  'Late payment is reconciled without displacing the new winner');
select is((select count(*)::integer from public.checkout_payment_exceptions where checkout_session_id='cs_auction_first'),1,
  'Late payment creates a support exception');
select is((select status from public.bookings where checkout_session_id='cs_auction_first'),'cancelled','Passed bidder cannot reclaim the rental');
select lives_ok($$select public.bind_checkout_session((select id from public.bookings where auction_bid_id is not null and status='pending_payment'),'cs_auction_winner')$$,
  'Selected runner-up can bind verified checkout session');
select lives_ok($$select public.confirm_booking_payment(
  (select id from public.bookings where checkout_session_id='cs_auction_winner'),'cs_auction_winner','pi_auction_winner',
  (select total from public.bookings where checkout_session_id='cs_auction_winner'))$$,'Verified payment confirms selected winner');
select lives_ok($$select public.process_listing_auctions()$$,'Paid auction is completed');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'status','completed','Successful payment ends auction');
select is((select status from public.bookings where checkout_session_id='cs_auction_winner'),'confirmed','Booking confirmation requires verified payment');

update public.listing_auctions set ends_at=clock_timestamp()-interval '2 hours',selection_deadline=clock_timestamp()-interval '1 hour'
where listing_id in ('84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000003');
select lives_ok($$select public.process_listing_auctions()$$,'Missed owner selection automatically processes eligible highest bids');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000002')->>'status','awaiting_payment','Highest eligible bid selected after owner timeout');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000003')->>'status','ended','No-bid auction ends without booking');
select is((select schedule from cron.job where jobname='competitive-listing-auctions'),'* * * * *','Auction lifecycle runs each minute');
select is((select count(*)::integer from public.notifications where event_key like 'auction-winner:%'),3,'Winners and runner-ups receive notifications');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000002","exp":4102444800}';
set local role authenticated;
select throws_ok($$select * from public.listing_auction_bids$$,'42501',null,'RLS clients cannot inspect other bidder identities');
reset role;
set local request.jwt.claims='{"role":"anon"}';
set local role anon;
select lives_ok($$select public.get_listing_auction('84000000-0000-4000-8000-000000000001')$$,'Anonymous clients can read the public anonymous leaderboard');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000002',25,gen_random_uuid())$$,
  '42501',null,'Anonymous clients cannot submit bids');
reset role;
reset request.jwt.claims;
select * from finish();
rollback;
