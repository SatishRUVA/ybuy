begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select relrowsecurity from pg_class where oid='public.reward_launch'::regclass),
  'Reward launch metadata has row-level security enabled');
select is((select count(*) from pg_policies where schemaname='public' and tablename='reward_launch'),
  0::bigint,'Reward launch metadata has no client policies');

update public.admin_financial_test_gate set environment='local_test',enabled=true;
update public.app_settings set value='true' where key='signup_reward_enabled';
update public.reward_launch set launched_at=clock_timestamp()-interval '1 minute';

insert into auth.users(id,email,phone,created_at,email_confirmed_at,phone_confirmed_at,raw_user_meta_data) values
 ('a1000000-0000-4000-8000-000000000001','points-owner@example.test','15550001001',clock_timestamp()-interval '1 day',now(),now(),'{"full_name":"Points owner"}'),
 ('a1000000-0000-4000-8000-000000000002','points-renter@example.test','15550001002',clock_timestamp(),null,null,'{"full_name":"Points renter","phone_verified":true}'),
 ('a1000000-0000-4000-8000-000000000003','points-other@example.test','15550001003',clock_timestamp(),now(),null,'{"full_name":"Points other"}');
insert into auth.sessions(id,user_id) values
 ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002'),
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003');
select is((select count(*) from public.reward_transactions where user_id::text like 'a1000000-%'),0::bigint,'Old accounts, metadata and partial verification do not earn points');
update auth.users set email_confirmed_at=now() where id='a1000000-0000-4000-8000-000000000002';
select is((select count(*) from public.reward_transactions where user_id='a1000000-0000-4000-8000-000000000002'),0::bigint,'Email alone does not award points');
update auth.users set phone_confirmed_at=now() where id='a1000000-0000-4000-8000-000000000002';
select is((select reward_balance from public.reward_wallets where user_id='a1000000-0000-4000-8000-000000000002'),500,'Second verification automatically awards 500 points');
update auth.users set phone_confirmed_at=now() where id='a1000000-0000-4000-8000-000000000002';
select is((select count(*) from public.reward_transactions where user_id='a1000000-0000-4000-8000-000000000002'),1::bigint,'Verification retries award once');

update auth.users set phone='15550001009' where id='a1000000-0000-4000-8000-000000000002';
update auth.users set phone='15550001002',phone_confirmed_at=now() where id='a1000000-0000-4000-8000-000000000003';
select is((select reward_balance from public.reward_wallets where user_id='a1000000-0000-4000-8000-000000000003'),0,'Previously rewarded phone cannot earn again after a phone change');
update auth.users set phone='15550001003' where id='a1000000-0000-4000-8000-000000000003';
insert into public.reward_signup_claims(user_id,email_hash,phone_hash) values
 ('a1000000-0000-4000-8000-000000000001',
 encode(sha256(convert_to('points-other@example.test','UTF8')),'hex'),'old-phone-claim');
update auth.users set phone_confirmed_at=now() where id='a1000000-0000-4000-8000-000000000003';
select is((select reward_balance from public.reward_wallets where user_id='a1000000-0000-4000-8000-000000000003'),0,'Previously rewarded email cannot earn under a different phone');

insert into public.categories(id,name) values('a3000000-0000-4000-8000-000000000001','Points fixtures');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,availability_start,availability_end) values
 ('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','Points test camera','A camera for isolated rewards tests.',10,'draft',200,'good',current_date+1,current_date+30);
insert into public.listing_images(listing_id,url,sort_order) values
 ('a4000000-0000-4000-8000-000000000001','https://example.test/points-camera.png',0);
insert into public.listing_photo_reviews(listing_id,photo_url,decision,reason,review_method) values
 ('a4000000-0000-4000-8000-000000000001','https://example.test/points-camera.png','approved','Synthetic fixture','system');
insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,latitude,longitude,time_zone) values
 ('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Private pickup','123 Test Street','Dallas','TX','75201','US',32.8,-96.8,'America/Chicago');
update public.listings set status='published' where id='a4000000-0000-4000-8000-000000000001';
insert into public.bookings(id,listing_id,renter_id,owner_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,total) values
 ('a5000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',current_date+1,current_date+2,10,1,10,0.1,1,11),
 ('a5000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',current_date+3,current_date+4,5,1,5,0.1,0.5,5.5),
 ('a5000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',current_date+5,current_date+6,4.99,1,4.99,0.1,0.50,5.49);
create temporary table points_booking_snapshot as select id,total,subtotal,deposit,tax_amount from public.bookings where id::text like 'a5000000-%';

set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((public.get_my_rewards()->>'balance')::integer,500,'Own wallet is available through the session-protected RPC');
select throws_ok($$select public.redeem_test_reward_points('a5000000-0000-4000-8000-000000000003')$$,'22023','Rental subtotal must be at least $5','Fees do not make a sub-$5 rental eligible');
select is(public.redeem_test_reward_points('a5000000-0000-4000-8000-000000000001')->>'discount','5','Redemption caps at $5');
select lives_ok($$select public.redeem_test_reward_points('a5000000-0000-4000-8000-000000000001')$$,'Same booking retry is idempotent even with zero remaining balance');
select is((public.get_my_rewards()->>'balance')::integer,0,'Redemption debits exactly 500 points once');
select throws_ok($$select public.redeem_test_reward_points('a5000000-0000-4000-8000-000000000002')$$,'22023','At least 500 points are required','Another booking cannot reuse spent points');
select throws_ok($$update public.reward_wallets set reward_balance=100000$$,'42501',null,'Clients cannot manipulate balances');
select throws_ok($$insert into public.reward_transactions(user_id,points,kind) values(auth.uid(),500,'signup')$$,'42501',null,'Clients cannot append ledger entries');
select throws_ok($$select public.award_signup_points(auth.uid())$$,'42501',null,'Internal award function is not callable by clients');

set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000003","exp":4102444800}';
select throws_ok($$select public.redeem_test_reward_points('a5000000-0000-4000-8000-000000000002')$$,'42501','Booking not found or not authorized','Another account cannot redeem against a renter booking');
reset role;
select results_eq($$select id,total,subtotal,deposit,tax_amount from public.bookings where id::text like 'a5000000-%' order by id$$,
 $$select * from points_booking_snapshot order by id$$,'Simulation never changes rental, deposit, tax or payable totals');
update public.bookings set status='cancelled' where id='a5000000-0000-4000-8000-000000000001';
update public.bookings set status='cancelled' where id='a5000000-0000-4000-8000-000000000001';
select is((select reward_balance from public.reward_wallets where user_id='a1000000-0000-4000-8000-000000000002'),500,'Cancellation restores points once');
select is((select sum(points)::integer from public.reward_transactions where user_id='a1000000-0000-4000-8000-000000000002'),500,'Ledger reconciles to the wallet');
update public.app_settings set value='false' where key='signup_reward_enabled';
update public.bookings set status='pending_payment' where id='a5000000-0000-4000-8000-000000000002';
update public.bookings set checkout_expires_at=clock_timestamp()-interval '1 minute' where id='a5000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.redeem_test_reward_points('a5000000-0000-4000-8000-000000000002')$$,'22023','Booking is not eligible for simulated points redemption','Expired payment reservations cannot spend points');
reset role;
update public.bookings set checkout_expires_at=clock_timestamp()+interval '10 minutes' where id='a5000000-0000-4000-8000-000000000002';
set local role authenticated;
select lives_ok($$select public.redeem_test_reward_points('a5000000-0000-4000-8000-000000000002')$$,'Exactly $5 rental subtotal is eligible even when signup awards are paused');
select is((public.get_my_rewards()->>'balance')::integer,0,'Pausing signup rewards preserves existing points redemption');
reset role;
update public.admin_financial_test_gate set enabled=false;
set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.redeem_test_reward_points('a5000000-0000-4000-8000-000000000002')$$,'42501','Financial test operations are disabled','Database gate blocks test redemption');
reset role;
update public.app_settings set value='false' where key='signup_reward_enabled';
update public.app_settings set value='1000' where key='signup_reward_points';
insert into auth.users(id,email,phone,created_at,email_confirmed_at,phone_confirmed_at,raw_user_meta_data) values
 ('a1000000-0000-4000-8000-000000000004','points-paused@example.test','15550001004',clock_timestamp(),now(),now(),'{"full_name":"Paused signup"}');
select ok(not exists(select 1 from public.reward_wallets where user_id='a1000000-0000-4000-8000-000000000004'),'Disabled test gate prevents new awards');
update public.admin_financial_test_gate set enabled=true;
update auth.users set phone_confirmed_at=now() where id='a1000000-0000-4000-8000-000000000004';
select ok(not exists(select 1 from public.reward_wallets where user_id='a1000000-0000-4000-8000-000000000004'),'Paused signup setting independently prevents awards');
create temporary table points_launch_snapshot as select launched_at from public.reward_launch;
update public.app_settings set value='true' where key='signup_reward_enabled';
update auth.users set phone_confirmed_at=now() where id='a1000000-0000-4000-8000-000000000004';
select is((select reward_balance from public.reward_wallets where user_id='a1000000-0000-4000-8000-000000000004'),1000,'New awards use the administrator-configured points amount');
select results_eq($$select launched_at from public.reward_launch$$,$$select launched_at from points_launch_snapshot$$,'Re-enabling does not reset launch eligibility');
select ok(not has_function_privilege('anon','public.get_my_rewards()','execute'),'Anonymous wallets are unavailable');
select * from finish();
rollback;
