begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local timezone='UTC';

insert into auth.users(id,email)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'date-auction-'||n||'@example.test'
  from generate_series(1,6) n;
insert into auth.sessions(id,user_id)
select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
insert into public.categories(id,name) values('93000000-0000-4000-8000-000000000001','Date auction fixtures');
update public.feature_flags set enabled=true where key='bidding';
update public.app_settings set value='1' where key in ('auction_minimum_increment','auction_owner_decision_hours','auction_winner_payment_hours');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end,brand,model)
select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
  'Date auction camera '||n,'A camera and carrying case.',20,'draft',100,'good',0,0,current_date+1,current_date+30,'Sony','FX3'
  from generate_series(1,6) n;
insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/date-auction.png',0 from public.listings where category_id='93000000-0000-4000-8000-000000000001';
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
select id,owner_id,'Private pickup','Dallas','TX','75201','US',0,0
  from public.listings where category_id='93000000-0000-4000-8000-000000000001';
update public.listings set status='published' where category_id='93000000-0000-4000-8000-000000000001';

create function pg_temp.date_auction_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub','91000000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated',
    'session_id','92000000-0000-4000-8000-'||lpad(n::text,12,'0'),'exp',4102444800)::text,true)::text::void
$$;
select pg_temp.date_auction_user(1);
select ok((select bool_and(auction_date_flexible) from public.listings where category_id='93000000-0000-4000-8000-000000000001'),
  'New listings default to renter-selected auction windows');
select throws_ok($$select public.owner_configure_listing_negotiation(
  '94000000-0000-4000-8000-000000000001',
  (select revision from public.listings where id='94000000-0000-4000-8000-000000000001'),null,
  '{"enabled":true,"date_flexible":"invalid"}')$$,
  '22023','Invalid auction preferences','Deprecated mode field still validates its type');
select lives_ok($$select public.owner_configure_listing_negotiation(
  '94000000-0000-4000-8000-000000000001',
  (select revision from public.listings where id='94000000-0000-4000-8000-000000000001'),null,
  jsonb_build_object('enabled',true,'date_flexible',false,'opening_daily_rate',20,
    'start_date',current_date+7,'end_date',current_date+20,
    'bidding_starts_at',(current_date+2)::timestamptz,'bidding_ends_at',(current_date+3)::timestamptz))$$,
  'Owner configuration accepts older clients through legacy validators');
select is((select date_flexible from public.listing_auctions where listing_id='94000000-0000-4000-8000-000000000001'),true,'New auctions use date windows even when an older client sends fixed mode');
select throws_ok($$select public.owner_configure_listing_negotiation(
  '94000000-0000-4000-8000-000000000001',1,null,'{"enabled":true,"date_flexible":true}')$$,
  '40001','This listing changed in another session. Reload before saving.','Stale mode saves remain rejected');
select throws_ok($$update public.listings set auction_date_flexible=false where id='94000000-0000-4000-8000-000000000001'$$,
  '23514','An auction cannot be restarted or reconfigured','Mode immutable after auction creation');
reset request.jwt.claims;
update public.listings set auction_date_flexible=true where id in
  ('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000005');
update public.listings set auction_enabled=true,auction_start_date=current_date+7,auction_end_date=current_date+20,
  auction_bidding_starts_at=(current_date+2)::timestamptz,auction_bidding_ends_at=(current_date+3)::timestamptz
  where id in ('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000003',
    '94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000005','94000000-0000-4000-8000-000000000006');
-- Emulate historical fixed auctions, which remain supported after selection.
update public.listing_auctions set date_flexible=false
  where listing_id in ('94000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000006');
update public.listing_auctions set starts_at=clock_timestamp()-interval '1 second'
  where listing_id in (select id from public.listings where category_id='93000000-0000-4000-8000-000000000001');

select ok(not has_function_privilege('authenticated','public.advance_listing_auction(uuid,uuid)','EXECUTE'),'Lifecycle private');
select ok(not has_function_privilege('authenticated','public.place_listing_auction_bid_before_date_bids(uuid,numeric,uuid,boolean)','EXECUTE'),'Legacy bypass private');
select ok(not has_table_privilege('authenticated','public.listing_auction_bids','SELECT'),'Bid ledger private');
select pg_temp.date_auction_user(1);
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,gen_random_uuid(),true,current_date+7,current_date+12)$$,
  '42501','Bidding is unavailable for this listing or account','Owner cannot bid');
select pg_temp.date_auction_user(2);
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,gen_random_uuid(),true)$$,
  '22023','Bid dates must fit the auction rental window','Flexible bids require dates');
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,gen_random_uuid(),false,current_date+7,current_date+12)$$,
  '42501','Consent to the temporary security-deposit authorization is required to bid','Consent remains mandatory');
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,gen_random_uuid(),true,current_date+6,current_date+12)$$,
  '22023','Bid dates must fit the auction rental window','Out of range dates rejected');
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,gen_random_uuid(),true,current_date+7,current_date+7)$$,
  '22023','Bid dates must fit the auction rental window','Empty exclusive range rejected');
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001','NaN',gen_random_uuid(),true,current_date+7,current_date+12)$$,
  '22023','Enter a finite daily bid with at most two decimal places','Nonfinite money rejected');
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20.001,gen_random_uuid(),true,current_date+7,current_date+12)$$,
  '22023','Enter a finite daily bid with at most two decimal places','Fractional cents rejected');
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,
  '95000000-0000-4000-8000-000000000001',true,current_date+7,current_date+12)$$,'Five-day starting bid accepted');
select is((select total_value from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000001'),100::numeric,'Rental value uses exclusive days');
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,
  '95000000-0000-4000-8000-000000000001',true,current_date+7,current_date+12)$$,'Same retry is idempotent');
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,
  '95000000-0000-4000-8000-000000000001',true,current_date+8,current_date+13)$$,
  '22023','This retry key belongs to a different bid','Retry cannot change range');
select is((public.get_listing_auction('94000000-0000-4000-8000-000000000001',current_date+8,current_date+10)->>'minimum_next_bid')::numeric,
  51::numeric,'Two-day quote beats five-day total, plus daily increment');
select pg_temp.date_auction_user(3);
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',40,gen_random_uuid(),true,current_date+8,current_date+10)$$,
  '23514','Bid at least $51.0000000000000000 per day','Higher daily but lower rental value cannot outbid');
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',51,
  '95000000-0000-4000-8000-000000000002',true,current_date+8,current_date+10)$$,'Higher total overlapping bid accepted');
select pg_temp.date_auction_user(4);
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,
  '95000000-0000-4000-8000-000000000003',true,current_date+12,current_date+15)$$,'Touching exclusive boundary is nonoverlapping');
select pg_temp.date_auction_user(5);
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,
  '95000000-0000-4000-8000-000000000004',true,current_date+15,current_date+18)$$,'Another nonoverlap bid accepted');
select is(jsonb_array_length(public.get_listing_auction('94000000-0000-4000-8000-000000000001')->'top_bids'),4,'Unfiltered flexible leaderboard not capped at three');
select is((public.get_listing_auction('94000000-0000-4000-8000-000000000001')->>'participant_count')::integer,4,'Participant count counts people');
select is((public.get_listing_auction('94000000-0000-4000-8000-000000000001')->>'total_bid_count')::integer,4,'Bid count counts submissions');
select is(jsonb_array_length(public.get_listing_auction('94000000-0000-4000-8000-000000000001',current_date+8,current_date+10)->'top_bids'),2,'Filtered leaderboard includes overlaps only');
select is(public.get_listing_auction('94000000-0000-4000-8000-000000000001')->'owner_bids','null'::jsonb,'Renter cannot read owner identity details');
reset request.jwt.claims;
select is(public.get_listing_auction('94000000-0000-4000-8000-000000000001')->'my_bids','[]'::jsonb,'Anonymous read exposes no personal bids');
select lives_ok($$select public.advance_listing_auction('94000000-0000-4000-8000-000000000001')$$,'Worker never selects a bidder without owner decision');
select is((select count(*)::integer from public.bookings where listing_id='94000000-0000-4000-8000-000000000001'),0,'Highest total does not win automatically');
select pg_temp.date_auction_user(1);
select lives_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000001',
  (select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000002'))$$,'Owner chooses highest total overlapping bid');
select lives_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000001',
  (select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000003'))$$,'Owner chooses second disjoint bid');
select lives_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000001',
  (select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000004'))$$,'Owner chooses third disjoint bid');
reset request.jwt.claims;
update public.listing_auctions set ends_at=clock_timestamp()-interval '1 second'
  where listing_id='94000000-0000-4000-8000-000000000001';
select public.advance_listing_auction('94000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.listing_auction_bids b join public.listing_auctions a on a.id=b.auction_id
  where a.listing_id='94000000-0000-4000-8000-000000000001' and b.selected_at is not null),3,'Three nonoverlapping winners');
select ok((select selected_at is null from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000001'),'Overlapping lower total loses');
select is((select status from public.listing_auctions where listing_id='94000000-0000-4000-8000-000000000001'),'awaiting_payment','Aggregate awaits independent payments');
select lives_ok($$select public.advance_listing_auction('94000000-0000-4000-8000-000000000001')$$,'Lifecycle retry creates no duplicate bookings');
select is((select count(*)::integer from public.bookings where listing_id='94000000-0000-4000-8000-000000000001'),3,'Booking creation idempotent');
select pg_temp.date_auction_user(3);
select isnt(public.get_listing_auction('94000000-0000-4000-8000-000000000001')->>'my_booking_id',null,'Each winner retrieves own booking');
select is((public.get_listing_auction('94000000-0000-4000-8000-000000000001')->>'my_payment_status'),'pending','Own independent payment status');
select pg_temp.date_auction_user(2);
select is(public.get_listing_auction('94000000-0000-4000-8000-000000000001')->>'my_booking_id',null,'Loser cannot retrieve winner booking');

update public.app_settings set value='2' where key='auction_winner_payment_hours';
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000002',20,
  '95000000-0000-4000-8000-000000000005',true,current_date+7,current_date+9)$$,'Manual first range bid');
select pg_temp.date_auction_user(3);
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000002',20,
  '95000000-0000-4000-8000-000000000006',true,current_date+9,current_date+11)$$,'Manual second nonoverlap bid');
select pg_temp.date_auction_user(4);
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000002',21,
  '95000000-0000-4000-8000-000000000007',true,current_date+7,current_date+9)$$,'Manual overlapping higher bid');
select pg_temp.date_auction_user(1);
select lives_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000002',
  (select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000005'))$$,
  'Owner may choose eligible lower total bid');
select lives_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000002',
  (select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000006'))$$,
  'Owner selects multiple nonoverlap bids');
select throws_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000002',
  (select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000007'))$$,
  '23P01','Bid dates conflict with a winner or unavailable inventory','Owner cannot select overlapping winner');
select lives_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000002',
  (select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000005'))$$,'Owner selection retries idempotent');
select is((select count(*)::integer from public.bookings where listing_id='94000000-0000-4000-8000-000000000002'),2,'Manual winners have separate bookings');
select ok((select bool_and(checkout_expires_at>clock_timestamp()+interval '119 minutes')
  from public.bookings where listing_id='94000000-0000-4000-8000-000000000002'),'Configured two-hour windows survive legacy checkout trigger');
select pg_temp.date_auction_user(2);
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000003',20,gen_random_uuid(),true)$$,'Legacy fixed four-argument bidding works');
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000003',21,gen_random_uuid(),true,current_date+7,current_date+9)$$,
  '22023','Fixed auctions require the owner rental dates','Fixed auction cannot change dates');
select pg_temp.date_auction_user(1);
select lives_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000003',
  (select b.id from public.listing_auction_bids b join public.listing_auctions a on a.id=b.auction_id
    where a.listing_id='94000000-0000-4000-8000-000000000003'))$$,'Legacy fixed winner still selected');
select is((select count(*)::integer from public.bookings where listing_id='94000000-0000-4000-8000-000000000003'),1,'Fixed mode remains one booking');
select is((select status from public.listing_auctions where listing_id='94000000-0000-4000-8000-000000000003'),'awaiting_payment','Fixed mode singular lifecycle preserved');
select pg_temp.date_auction_user(2);
select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000004',20,gen_random_uuid(),true,current_date+7,current_date+8);
select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000004',21,gen_random_uuid(),true,current_date+7,current_date+8);
select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000004',22,gen_random_uuid(),true,current_date+7,current_date+8);
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000004',23,gen_random_uuid(),true,current_date+9,current_date+10)$$,
  '23514','You have used all three bids for this auction','Three-attempt limit applies across ranges');

reset request.jwt.claims;
update public.bookings set checkout_session_id='cs_date_'||id where listing_id='94000000-0000-4000-8000-000000000001';
select lives_ok($$select public.confirm_booking_payment(bk.id,bk.checkout_session_id,'pi_date_'||bk.id,bk.total)
  from public.bookings bk where bk.listing_id='94000000-0000-4000-8000-000000000001'$$,'All separate winners can pay through trusted payment validation');
select is((select count(*)::integer from public.payments p join public.bookings b on b.id=p.booking_id
  where b.listing_id='94000000-0000-4000-8000-000000000001' and p.status='succeeded'),3,'Each winning payment recorded');
select lives_ok($$select public.confirm_booking_payment(bk.id,bk.checkout_session_id,'pi_date_'||bk.id,bk.total)
  from public.bookings bk where bk.listing_id='94000000-0000-4000-8000-000000000001'$$,'Payment receipt retry is idempotent');
select lives_ok($$select public.advance_listing_auction('94000000-0000-4000-8000-000000000001')$$,'All paid winners complete auction');
select is((select status from public.listing_auctions where listing_id='94000000-0000-4000-8000-000000000001'),'completed','Completed only after all surviving winners paid');
select is((select count(*)::integer from public.notifications where event_key like 'auction-not-selected:%'
  and user_id in ('91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000005')),0,
  'Paid flexible winners never receive loser notifications');

update public.bookings set checkout_session_id='cs_date_expiring',checkout_expires_at=clock_timestamp()-interval '1 second'
  where auction_bid_id=(select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000005');
select lives_ok($$select public.advance_listing_auction('94000000-0000-4000-8000-000000000002')$$,'Expired winner with unresolved Stripe session does not release range');
select is((select count(*)::integer from public.bookings where listing_id='94000000-0000-4000-8000-000000000002'),2,'Unclosed Stripe session blocks replacement');
select is((select passed from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000005'),false,'Unresolved winner not passed');
update public.bookings set checkout_session_closed_at=clock_timestamp() where checkout_session_id='cs_date_expiring';
select lives_ok($$select public.advance_listing_auction('94000000-0000-4000-8000-000000000002')$$,'Closed expired session releases only its range');
select is((select count(*)::integer from public.bookings where listing_id='94000000-0000-4000-8000-000000000002'),2,'Runner-up is never selected automatically');
select pg_temp.date_auction_user(1);
select lives_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000002',
  (select id from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000007'))$$,'Owner may choose replacement while decision window remains open');
reset request.jwt.claims;
select is((select count(*)::integer from public.bookings where listing_id='94000000-0000-4000-8000-000000000002'),3,'Explicit replacement gets independent booking');
select is((select passed from public.listing_auction_bids where idempotency_key='95000000-0000-4000-8000-000000000005'),true,'Expired winner passed after session closure');
select lives_ok($$select public.confirm_booking_payment(bk.id,'cs_date_expiring','pi_date_late',bk.total)
  from public.bookings bk where bk.checkout_session_id='cs_date_expiring'$$,'Late passed payment routed to support, never confirms old winner');
select is((select count(*)::integer from public.checkout_payment_exceptions where checkout_session_id='cs_date_expiring'),1,'Late receipt exception recorded');
select lives_ok($$select public.confirm_booking_payment(bk.id,'cs_date_expiring','pi_date_late',bk.total)
  from public.bookings bk where bk.checkout_session_id='cs_date_expiring'$$,'Late receipt exception idempotent');
select is((select count(*)::integer from public.checkout_payment_exceptions where checkout_session_id='cs_date_expiring'),1,'No duplicate late exceptions');
select throws_ok($$select public.confirm_booking_payment(bk.id,'cs_date_expiring','pi_date_conflict',bk.total)
  from public.bookings bk where bk.checkout_session_id='cs_date_expiring'$$,
  '23514','Payment receipt conflicts with recorded exception','Conflicting late payment rejected');
update public.bookings set checkout_expires_at=clock_timestamp()+interval '10 minutes'
  where listing_id='94000000-0000-4000-8000-000000000002' and status='pending_payment';
select lives_ok($$select public.process_auction_payment_reminders()$$,'Reminders cover every pending winner');
select is((select count(*)::integer from public.notifications n join public.bookings b on n.event_key='auction-payment-reminder:'||b.id
  where b.listing_id='94000000-0000-4000-8000-000000000002'),2,'Both remaining winners receive payment reminders');

insert into public.bookings(listing_id,renter_id,owner_id,start_date,end_date,quantity,status,daily_rate,
  days,subtotal,service_fee_pct,service_fee_amount,deposit,total)
values('94000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000006',
  '91000000-0000-4000-8000-000000000001',current_date+7,current_date+9,1,'confirmed',20,2,40,0.1,4,0,44);
select is((select status from public.listing_auctions where listing_id='94000000-0000-4000-8000-000000000005'),'open','Ordinary booking only consumes its dates, not whole flexible auction');
select pg_temp.date_auction_user(2);
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000005',20,gen_random_uuid(),true,current_date+7,current_date+8)$$,
  '23P01','Auction dates are no longer available','Already-booked dates fail capacity validation at bid time');
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000005',20,gen_random_uuid(),true,current_date+9,current_date+11)$$,
  'Unoccupied dates remain eligible');
select pg_temp.date_auction_user(3);
select throws_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000005',
  (select b.id from public.listing_auction_bids b join public.listing_auctions a on a.id=b.auction_id
    where a.listing_id='94000000-0000-4000-8000-000000000005'))$$,
  '42501','Only the listing owner can select a winner','Nonowner cannot select flexible winners');
reset request.jwt.claims;
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000005',21,gen_random_uuid(),true,current_date+9,current_date+11)$$,
  '42501','Active session required','Unauthenticated bids rejected');

select pg_temp.date_auction_user(2);
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000006',20,gen_random_uuid(),true)$$,'Undecided fixed auction has eligible bidder');
reset request.jwt.claims;
update public.listing_auctions set ends_at=clock_timestamp()-interval '1 second'
  where listing_id in ('94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000006');
select lives_ok($$select public.advance_listing_auction('94000000-0000-4000-8000-000000000004')$$,'Flexible auction without owner decision expires');
select lives_ok($$select public.advance_listing_auction('94000000-0000-4000-8000-000000000006')$$,'Fixed auction without owner decision expires');
select is((select count(*)::integer from public.bookings where listing_id in
  ('94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000006')),0,'No automatic bookings in either mode');
select is((select count(*)::integer from public.listing_auctions where listing_id in
  ('94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000006') and status='ended'),2,'Both undecided auctions ended');
select is((select count(*)::integer from public.listing_auctions where listing_id in
  ('94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000006') and owner_decision_missed_at is not null),2,
  'Both owner nondecisions flagged');
select is((select count(*)::integer from public.listing_auction_decision_events e join public.listing_auctions a on a.id=e.listing_auction_id
  where a.listing_id in ('94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000006')),2,'Both nondecisions use existing rating audit path');
select is((select owner_decision_missed_at from public.listing_auctions where listing_id='94000000-0000-4000-8000-000000000001'),
  null::timestamptz,'Owner who chose bidders is not marked undecided');
select pg_temp.date_auction_user(1);
select throws_ok($$select public.select_listing_auction_winner('94000000-0000-4000-8000-000000000004',
  (select b.id from public.listing_auction_bids b join public.listing_auctions a on a.id=b.auction_id
    where a.listing_id='94000000-0000-4000-8000-000000000004' order by b.daily_rate desc limit 1))$$,
  '55000','Winner selection is not open','Expired auction cannot be resurrected by late owner decision');
select throws_ok($$select public.admin_list_auction_decisions(20,0)$$,
  '42501','Not authorized','Owners cannot access administrator decision list');
select is((public.get_listing_auction('94000000-0000-4000-8000-000000000004')->>'owner_decision_hours')::integer,0,'Owner decision has no grace period');
select ok(not (public.get_listing_auction('94000000-0000-4000-8000-000000000004') ? 'owner_missed_decision_count'),
  'Owners cannot retrieve missed-decision counts');
select ok(not (public.get_listing_auction('94000000-0000-4000-8000-000000000004') ? 'owner_reliability_flag'),
  'Owners cannot retrieve reliability flags');
select is((select missed_decision_count from public.get_owner_rating_stats(array['91000000-0000-4000-8000-000000000001'::uuid])),
  0,'Owner ratings do not reveal private counts');
set local role authenticated;
select is((select count(*)::integer from public.listing_auction_decision_events),0,'Owners cannot read decision audit rows');
reset role;
insert into public.admin_users(user_id,role,permissions)
  values('91000000-0000-4000-8000-000000000006','super_admin','{}');
select pg_temp.date_auction_user(6);
select is((public.admin_search_auction_decisions(null,'91000000-0000-4000-8000-000000000001',100,0)->>'total')::integer,
  2,'Per-user decision history returns the same two known audit records');
select is((public.admin_search_auction_decisions(null,'91000000-0000-4000-8000-000000000002',100,0)->>'total')::integer,
  0,'Per-user history never returns another owner records');
select is((public.admin_search_auction_decisions('DATE-AUCTION-1@EXAMPLE.TEST',null,100,0)->>'total')::integer,
  2,'Decision search matches owner email case-insensitively');
select is((public.admin_search_auction_decisions(
  (select customer_id from public.profiles where id='91000000-0000-4000-8000-000000000001'),null,100,0)->>'total')::integer,
  2,'Decision search matches Customer ID');
select is((public.admin_search_auction_decisions('94000000-0000-4000-8000-000000000004',null,100,0)->>'total')::integer,
  1,'Decision search matches listing ID');
select is((public.admin_search_auction_decisions('unmatched-owner-query',null,100,0)->>'total')::integer,
  0,'Decision search totals use the same filter as rows');
select is((public.admin_list_users('date-auction-1@example.test',20,0)->'rows'->0->>'missed_decision_count')::integer,
  2,'Admin Users search shows the same owner count as decision history');
select ok((public.admin_list_users('date-auction-1@example.test',20,0)->'rows'->0->>'last_missed_decision_at') is not null,
  'Admin Users exposes the latest decision audit time');
select is((public.admin_list_users('date-auction-1@example.test',20,0)->'rows'->0->>'restricted_at'),
  null::text,'Missed decisions do not automatically restrict the account');
select is((public.admin_list_auction_decisions(100,0)->'rows'->0->>'owner_id'),
  '91000000-0000-4000-8000-000000000001','Administrator decision list identifies the owner');
select ok((public.admin_list_auction_decisions(100,0)->'rows'->0) ?& array['listing_title','deadline_at','owner_missed_decision_count'],
  'Administrator list includes listing, close time and missed count');
select is(jsonb_array_length(public.admin_list_auction_decisions(1,0)->'rows'),1,'Administrator list is paginated');
select throws_ok($$select public.admin_list_auction_decisions(101,0)$$,
  '22023','Choose a page size from 1 to 100 and a nonnegative offset','Administrator page size is bounded');
select is((public.get_listing_auction('94000000-0000-4000-8000-000000000004')->>'owner_missed_decision_count')::integer,2,
  'Authorized administrators retain missed-decision counts');
select is((select missed_decision_count from public.get_owner_rating_stats(array['91000000-0000-4000-8000-000000000001'::uuid])),
  2,'Authorized administrators retain private rating statistics');
set local role authenticated;
select is((select count(*)::integer from public.listing_auction_decision_events
  where owner_id='91000000-0000-4000-8000-000000000001'),2,'Authorized administrators retain audit row access');
reset role;
insert into public.admin_users(user_id,role,permissions)
  values('91000000-0000-4000-8000-000000000005','admin',array['users.manage']);
select pg_temp.date_auction_user(5);
select ok(not ((public.admin_list_users('date-auction-1@example.test',20,0)->'rows'->0) ? 'missed_decision_count'),
  'User-management permission alone does not expose private decision counts');
select throws_ok($$select public.admin_search_auction_decisions(null,null,20,0)$$,
  '42501','Not authorized','User-management permission alone cannot access decision history');
select pg_temp.date_auction_user(2);
select throws_ok($$select public.admin_list_auction_decisions(20,0)$$,
  '42501','Not authorized','Renters cannot access administrator decision list');
select ok(not (public.get_listing_auction('94000000-0000-4000-8000-000000000004') ? 'owner_missed_decision_count'),
  'Renters cannot retrieve private decision counts');
select is((select rating_adjustment from public.get_owner_rating_stats(array['91000000-0000-4000-8000-000000000001'::uuid])),
  0::numeric,'Reliability misses never deduct review stars');
select is((select rating from public.get_owner_rating_stats(array['91000000-0000-4000-8000-000000000001'::uuid])),
  coalesce((select round(avg(rating)::numeric,2) from public.reviews where reviewee_id='91000000-0000-4000-8000-000000000001'),0::numeric),
  'Displayed owner stars are actual review average');
reset request.jwt.claims;
update public.listing_auctions set ends_at=clock_timestamp()-interval '1 second'
  where listing_id='94000000-0000-4000-8000-000000000005';
select is(public.get_listing_auction('94000000-0000-4000-8000-000000000005')->>'status','ended',
  'Public retrieval expires a just-closed auction without waiting for cron');
select ok(not (public.get_listing_auction('94000000-0000-4000-8000-000000000005',current_date+9,current_date+11) ? 'owner_missed_decision_count'),
  'Filtered anonymous retrieval does not expose private decision counts');
select is((select missed_decision_count from public.get_owner_rating_stats(array['91000000-0000-4000-8000-000000000001'::uuid])),
  0,'Anonymous ratings do not reveal private counts');
select is((select count(*)::integer from public.bookings where listing_id='94000000-0000-4000-8000-000000000005'),1,
  'Immediate retrieval expiry never creates auction booking');

select * from finish();
rollback;
