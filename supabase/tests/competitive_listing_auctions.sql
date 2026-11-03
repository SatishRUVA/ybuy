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
update public.app_settings set value='0.2'::jsonb where key='listing_offer_below_pct';
update public.app_settings set value='0.1'::jsonb where key='listing_offer_above_pct';
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end,brand,model)
select ('84000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',
  'Auction camera '||n,'A camera and carrying case.',20,'draft',100,'good',0,0,current_date+1,current_date+14,'Sony','FX3'
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
  jsonb_build_object('availability_timezone','UTC','auction_preferences',jsonb_build_object('enabled',true,'start_date',current_date+7,'end_date',current_date+10,
    'bidding_starts_at',(current_date+2)::timestamp at time zone 'UTC',
    'bidding_ends_at',((current_date+7)::timestamp at time zone 'UTC')-interval '3 hours')))$$,
  'Owner can save auction preferences on a private draft');
select is((select count(*)::integer from public.listing_auctions),0,'Saving a draft never opens bidding');
select throws_ok($$select public.owner_save_listing_flow('84000000-0000-4000-8000-000000000001',1,'{}')$$,
  '40001','This listing changed in another session. Reload before saving.','Stale saves are rejected');
select lives_ok($$select public.owner_save_listing_flow('84000000-0000-4000-8000-000000000001',
  (select revision from public.listings where id='84000000-0000-4000-8000-000000000001'),
  jsonb_build_object('auction_preferences',jsonb_build_object('enabled',true,'start_date',current_date+7,'end_date',current_date+10,
    'bidding_starts_at',(current_date+2)::timestamp at time zone 'UTC',
    'bidding_ends_at',(current_date+3)::timestamp at time zone 'UTC')),null,true)$$,
  'Validated owner publication opens a configured auction');
reset request.jwt.claims;
update public.listings set auction_enabled=true,auction_start_date=current_date+7,auction_end_date=current_date+10,
  auction_bidding_starts_at=(current_date+2)::timestamp at time zone 'UTC',
  auction_bidding_ends_at=(current_date+3)::timestamp at time zone 'UTC'
where id in ('84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000005');
update public.listings set estimated_value=2000 where id='84000000-0000-4000-8000-000000000005';
update public.listings set status='published' where category_id='83000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.listing_auctions),3,'Publication starts auctions only for opted-in listings');
select is((select status from public.listings where id='84000000-0000-4000-8000-000000000005'),'pending_approval','High-value listing still requires approval');
select is((select count(*)::integer from public.listing_auctions where listing_id='84000000-0000-4000-8000-000000000005'),0,'Pending approval never opens bidding');
select is((select ends_at-starts_at from public.listing_auctions where listing_id='84000000-0000-4000-8000-000000000001'),
  interval '24 hours','Auction lasts 24 hours');
update public.listing_auctions set starts_at=clock_timestamp()-interval '1 second'
where listing_id in ('84000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000003');
select throws_ok($$update public.listings set price_per_day=22 where id='84000000-0000-4000-8000-000000000001'$$,
  '23514','Auction listing terms cannot change after bidding starts','Auction rate cannot change while bidding is open');
select throws_ok($$update public.listing_images set url='https://example.test/other.png' where listing_id='84000000-0000-4000-8000-000000000001'$$,
  '23514','Photos, pickup and blocked dates cannot change during competitive bidding','Owner cannot replace the item after bidders commit');
select throws_ok($$update public.listing_pickup_locations set address='Other address' where listing_id='84000000-0000-4000-8000-000000000001'$$,
  '23514','Photos, pickup and blocked dates cannot change during competitive bidding','Private pickup terms are locked');

set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20,gen_random_uuid(),true)$$,
  '42501','Bidding is unavailable for this listing or account','Owner cannot bid on their own listing');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20,gen_random_uuid(),false)$$,
  '42501','Consent to the temporary security-deposit authorization is required to bid','Deposit-bearing auction requires consent');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001','NaN',gen_random_uuid(),true)$$,
  '22023','Enter a finite daily bid with at most two decimal places','NaN money is rejected');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20.001,gen_random_uuid(),true)$$,
  '22023','Enter a finite daily bid with at most two decimal places','Fractional cents are rejected');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20,'85000000-0000-4000-8000-000000000001',true)$$,'Opening bid equals asking price');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20,'85000000-0000-4000-8000-000000000001',true)$$,'Identical retries are idempotent');
select is((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'my_bid_count')::integer,1,'Retry does not use another bid');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',25,'85000000-0000-4000-8000-000000000001',true)$$,
  '22023','This retry key belongs to a different bid','Retry cannot silently change price');
select is((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'minimum_increment')::numeric,1::numeric,
  'Competitive bid increment comes from the platform setting');
update public.app_settings set value='2.5' where key='auction_minimum_increment';
select is((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'minimum_next_bid')::numeric,22.5::numeric,
  'Changing the platform setting changes the next bid floor');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',22,gen_random_uuid(),true)$$,
  '23514','Bid at least $22.50 per day','Configured minimum increase is enforced server-side');
update public.app_settings set value='1' where key='auction_minimum_increment';
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',20.99,gen_random_uuid(),true)$$,
  '23514','Bid at least $21.00 per day','Bids must meet the configured minimum increase');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',21,gen_random_uuid(),true)$$,'Second bid accepted');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',22,gen_random_uuid(),true)$$,'Auction is not constrained by private-offer ceiling');
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',23,gen_random_uuid(),true)$$,
  '23514','You have used all three bids for this auction','Fourth submission is rejected');
select lives_ok($$select public.create_booking_request('84000000-0000-4000-8000-000000000001',current_date+7,current_date+10,1)$$,
  'Regular booking requests can coexist while bidding remains open');
select lives_ok($$select public.create_booking_request('84000000-0000-4000-8000-000000000004',current_date+7,current_date+10,1)$$,
  'Ordinary booking behavior remains available on other listings');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000003","exp":4102444800}';
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',35,gen_random_uuid(),true)$$,'Second renter bids');
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000002',20,gen_random_uuid(),true)$$,'Second auction receives a bid');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000004","exp":4102444800}';
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',40,gen_random_uuid(),true)$$,'Third renter bids');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000005","exp":4102444800}';
select lives_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',45,gen_random_uuid(),true)$$,'Fourth renter bids');
select is(jsonb_array_length(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'top_bids'),3,'Public leaderboard contains only top three bidders');
select ok(not ((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'top_bids')::text like '%renter_id%'),'Leaderboard does not expose renter identity');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'owner_bids','null'::jsonb,
  'Renters do not receive owner-only bidder profiles or full history');
select is((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'top_bids'->0->>'daily_rate')::numeric,45::numeric,'Highest bid ranks first');
select is(jsonb_array_length(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'my_bids'),1,
  'Renter can see their own bid history');
select is((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'my_rank')::integer,1,
  'Renter can see their current rank');
select is(jsonb_array_length(public.get_top_listing_bids()),3,'Ticker includes published open auctions, including those without bids');

set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
select is(jsonb_array_length(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'owner_bids'),6,
  'Owner receives full bid history with each bidder profile');
select ok((public.get_listing_auction('84000000-0000-4000-8000-000000000001')->'owner_bids'->0->'renter'->>'full_name') is not null,
  'Owner bidder profile includes a display name');

reset request.jwt.claims;
select is((select count(*)::integer from public.bookings where auction_bid_id is not null),0,'Open bidding does not create bookings');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.select_listing_auction_winner('84000000-0000-4000-8000-000000000001',gen_random_uuid())$$,
  '42501','Only the listing owner can select a winner','Renters cannot select themselves');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
update public.listing_auctions set ends_at=clock_timestamp()-interval '1 second'
where listing_id='84000000-0000-4000-8000-000000000001';
select lives_ok($$select public.process_listing_auctions()$$,'Closed bidding opens the one-hour owner decision window');
select ok((select selection_deadline between ends_at+interval '59 minutes' and ends_at+interval '61 minutes'
  from public.listing_auctions where listing_id='84000000-0000-4000-8000-000000000001'),
  'Owner receives a full one-hour decision window after bidding closes');
select lives_ok($$select public.select_listing_auction_winner('84000000-0000-4000-8000-000000000001',
  (select id from public.listing_auction_bids where daily_rate=40))$$,'Owner may select an eligible bidder during the decision window');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'status','awaiting_payment','Manual selection closes bidding immediately');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.place_listing_auction_bid('84000000-0000-4000-8000-000000000001',50,gen_random_uuid(),true)$$,
  '55000','Bidding is closed','Bids after owner selection are rejected');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select daily_rate from public.bookings where auction_bid_id is not null),40::numeric,'Booking uses selected auction price');
select is((select status from public.bookings where auction_bid_id is not null),'pending_payment','Winner is not confirmed without payment');
select ok((select deposit_hold_consent_at is not null from public.bookings where auction_bid_id is not null),
  'Winning booking inherits consent from its bid');
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
select is((select status from public.bookings where checkout_session_id='cs_auction_winner'),'pending_payment',
  'Auction winner remains pending after payment until the security hold succeeds');
select is((select selected_bid_id from public.listing_auctions where listing_id='84000000-0000-4000-8000-000000000001'),
  (select auction_bid_id from public.bookings where checkout_session_id='cs_auction_winner'),
  'Runner-up bid is the selected bid when payment is reconciled');
select is((select count(*)::integer from public.checkout_payment_exceptions where checkout_session_id='cs_auction_winner'),0,
  'Selected runner-up payment is not routed to late-payment support');
select lives_ok($$select public.complete_booking_deposit_setup(
  (select id from public.bookings where checkout_session_id='cs_auction_winner'),
  'seti_auction_winner','cs_auction_setup','cus_auction_winner','pm_auction_winner')$$,
  'Winner saves a payment method for the security hold');
create temporary table auction_winner_authorization as
  select public.prepare_booking_deposit_authorization(id,renter_id) as result
  from public.bookings where checkout_session_id='cs_auction_winner';
select lives_ok($$select public.record_deposit_authorization_event(
  'evt_auctionauthorization','payment_intent.amount_capturable_updated',
  ((select result->>'id' from auction_winner_authorization)::uuid),
  (select id from public.bookings where checkout_session_id='cs_auction_winner'),
  'pi_auction_deposit','requires_capture','pm_auction_winner',
  (select deposit from public.bookings where checkout_session_id='cs_auction_winner'),0,
  (select deposit from public.bookings where checkout_session_id='cs_auction_winner'),
  clock_timestamp()+interval '30 days',null)$$,
  'Successful separate security hold confirms the auction booking');
select is((select status from public.bookings where checkout_session_id='cs_auction_winner'),'confirmed',
  'Both verified rental payment and deposit authorization are required for booking confirmation');
select lives_ok($$select public.process_listing_auctions()$$,'Paid auction is completed');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000001')->>'status','completed','Successful payment ends auction');
select is((select status from public.bookings where checkout_session_id='cs_auction_winner'),'confirmed','Booking confirmation requires verified payment');

update public.listing_auctions set ends_at=clock_timestamp()-interval '61 minutes',selection_deadline=clock_timestamp()-interval '1 minute'
where listing_id in ('84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000003');
insert into public.auction_lifecycle_heartbeats(run_at)
select run_at from generate_series(
  (select min(selection_deadline)-interval '3 minutes' from public.listing_auctions
    where listing_id in ('84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000003')),
  clock_timestamp(),interval '1 minute') run_at;
select lives_ok($$select public.process_listing_auctions()$$,'Missed owner selection automatically processes eligible highest bids');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000002')->>'status','awaiting_payment','Highest eligible bid selected after owner timeout');
select ok((public.get_listing_auction('84000000-0000-4000-8000-000000000002')->>'owner_decision_missed_at') is not null,
  'Missed owner decision is recorded');
select is(public.get_listing_auction('84000000-0000-4000-8000-000000000003')->>'status','ended','No-bid auction ends without booking');
select is((select rating_eligible from public.listing_auction_decision_events where listing_id='84000000-0000-4000-8000-000000000002'),true,
  'Healthy scheduler and eligible bidder make a missed decision attributable');
select is((select eligible_bid_count from public.listing_auction_decision_events where listing_id='84000000-0000-4000-8000-000000000002'),1,
  'Eligible bidder is present when the rating event is recorded');
select is((select exclusion_reason from public.listing_auction_decision_events where listing_id='84000000-0000-4000-8000-000000000002'),null::text,
  'Healthy scheduler window has no exclusion reason');
select ok((select count(*)>=5 from public.auction_lifecycle_heartbeats h join public.listing_auction_decision_events e
  on e.listing_id='84000000-0000-4000-8000-000000000002' and h.run_at between e.deadline_at-interval '5 minutes' and e.detected_at),
  'Scheduler has continuous heartbeat samples around the decision window');
select ok((select min(h.run_at)<=min(e.deadline_at)+interval '5 minutes' and max(h.run_at)>=max(e.detected_at)-interval '5 minutes'
  from public.auction_lifecycle_heartbeats h join public.listing_auction_decision_events e
    on e.listing_id='84000000-0000-4000-8000-000000000002'
    and h.run_at between e.deadline_at-interval '5 minutes' and e.detected_at),
  'Scheduler heartbeat samples cover both ends of the owner decision window');
select ok((select detected_at<=deadline_at+interval '5 minutes' from public.listing_auction_decision_events
  where listing_id='84000000-0000-4000-8000-000000000002'),'Decision timeout is processed within scheduler grace');
select is((select rating_eligible from public.listing_auction_decision_events where listing_id='84000000-0000-4000-8000-000000000003'),false,
  'Auction without an eligible bidder does not affect owner rating');
insert into public.reviews(booking_id,reviewer_id,reviewee_id,rating)
select id,renter_id,owner_id,5 from public.bookings where listing_id='84000000-0000-4000-8000-000000000002' and auction_bid_id is not null;
select is((select rating from public.get_owner_rating_stats(array['81000000-0000-4000-8000-000000000001']::uuid[])),4.9::numeric,
  'Attributable missed decision reduces the actual owner rating');
update public.app_settings set value='0.2'::jsonb where key='auction_missed_decision_rating_penalty';
select is((select rating from public.get_owner_rating_stats(array['81000000-0000-4000-8000-000000000001']::uuid[])),4.8::numeric,
  'Admin-configured penalty changes the owner rating');
select is((select rating_adjustment from public.get_owner_rating_stats(array['81000000-0000-4000-8000-000000000001']::uuid[])),0.2::numeric,
  'Applied owner-rating adjustment is returned for audit visibility');
insert into public.admin_users(user_id,role,permissions,active)
  values('81000000-0000-4000-8000-000000000001','super_admin','{}',true);
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
set local role authenticated;
select lives_ok($$select public.admin_exclude_auction_decision_event(
  (select id from public.listing_auction_decision_events where listing_id='84000000-0000-4000-8000-000000000002'),
  'Verified service interruption outside owner control')$$,
  'Admin can exclude an incident with a required reason');
reset role;
reset request.jwt.claims;
select is((select rating from public.get_owner_rating_stats(array['81000000-0000-4000-8000-000000000001']::uuid[])),5::numeric,
  'Excluded incident no longer affects owner rating');
select is((select count(*)::integer from public.admin_audit_log where action='auction_decision.exclude'),1,
  'Decision exclusion is recorded in the append-only admin audit log');
select is((select schedule from cron.job where jobname='competitive-listing-auctions'),'* * * * *','Auction lifecycle runs each minute');
select is((select command from cron.job where jobname='competitive-listing-auctions'),
  'select public.process_scheduled_listing_auctions();','Auction cron records scheduler health for fair rating');
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
