begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','owner@settlement.test','{"full_name":"Settlement owner"}'),
 ('81000000-0000-4000-8000-000000000002','renter@settlement.test','{"full_name":"Settlement renter"}'),
 ('81000000-0000-4000-8000-000000000003','other@settlement.test','{"full_name":"Other"}');
insert into auth.sessions(id,user_id) values
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001'),
 ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002'),
 ('82000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003');
insert into public.categories(id,name) values('83000000-0000-4000-8000-000000000001','Settlement test');
insert into public.listings(id,owner_id,category_id,title,price_per_day,status,estimated_value,item_condition) values
 ('84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','Settlement test listing',10,'published',200,'good');
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status) values
 ('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002',current_date+100,current_date+102,10,2,20,.1,2,50,72,'pending_payment');

select ok(not has_function_privilege('authenticated','public.claim_rental_settlement(uuid,text)','EXECUTE'),'Clients cannot claim financial execution');
select ok(not has_function_privilege('authenticated','public.record_rental_settlement(uuid,text,text,text)','EXECUTE'),'Clients cannot fabricate provider receipts');
select ok(not has_table_privilege('authenticated','public.payouts','INSERT'),'Owners cannot fabricate paid-out bookkeeping');
select ok(not has_table_privilege('authenticated','public.owner_connect_accounts','INSERT'),'Clients cannot substitute Connect destinations');
select throws_ok($$select public.confirm_booking_payment('85000000-0000-4000-8000-000000000001','cs_sql','pi_sql',71)$$,
 '23514','Payment details do not match the booking','Underpayment cannot confirm a booking');
select lives_ok($$select public.confirm_booking_payment('85000000-0000-4000-8000-000000000001','cs_sql','pi_sql',72)$$,'Exact webhook payment confirms');
select lives_ok($$select public.confirm_booking_payment('85000000-0000-4000-8000-000000000001','cs_sql','pi_sql',72)$$,'Duplicate webhook is idempotent');
select is((select count(*)::int from public.payments where booking_id='85000000-0000-4000-8000-000000000001'),1,'Only one payment receipt exists');
select throws_ok($$select public.confirm_booking_payment('85000000-0000-4000-8000-000000000001','cs_sql','pi_other',72)$$,
 'P0001','Payment receipt conflicts with existing payment','Conflicting webhook is rejected');
select throws_ok($$select public.claim_rental_settlement('85000000-0000-4000-8000-000000000001','refund')$$,
 'P0001','Owner-confirmed completed return required','Payment alone cannot release deposit');
update public.bookings set status='return_pending' where id='85000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.complete_booking_return('85000000-0000-4000-8000-000000000001')$$,
 '42501','Only the owner can confirm return','Renter cannot self-complete return to release money');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.complete_booking_return('85000000-0000-4000-8000-000000000001')$$,'Owner confirms return');
select lives_ok($$select public.complete_booking_return('85000000-0000-4000-8000-000000000001')$$,'Owner confirmation is retry safe');
select is((select deposit_amount from public.rental_settlements where booking_id='85000000-0000-4000-8000-000000000001'),50::numeric,'Deposit uses frozen booking amount');
select is((select owner_amount from public.rental_settlements where booking_id='85000000-0000-4000-8000-000000000001'),20::numeric,'Owner amount excludes fee and deposit');
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"82000000-0000-4000-8000-000000000003","exp":4102444800}';
select is((select count(*)::int from public.rental_settlements),0,'Other users cannot see private settlement');
reset role;

insert into public.operations_cases(id,kind,booking_id,created_by,participant_id,category,subject) values
 ('86000000-0000-4000-8000-000000000001','dispute','85000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','damaged','Damage must block settlement');
select throws_ok($$select public.claim_rental_settlement('85000000-0000-4000-8000-000000000001','refund')$$,
 'P0001','Settlement blocked by an unresolved dispute','Open claim blocks deposit refund');
update public.operations_cases set status='decided' where id='86000000-0000-4000-8000-000000000001';
select throws_ok($$select public.claim_rental_settlement('85000000-0000-4000-8000-000000000001','refund')$$,
 'P0001','Settlement blocked by an unresolved dispute','Decided but not closed claim still requires reconciliation');
update public.operations_cases set status='closed' where id='86000000-0000-4000-8000-000000000001';
select lives_ok($$select public.claim_rental_settlement('85000000-0000-4000-8000-000000000001','refund')$$,'Closed claim permits refund');
select throws_ok($$select public.claim_rental_settlement('85000000-0000-4000-8000-000000000001','transfer')$$,
 'P0001','Deposit refund must succeed before owner transfer','Pending refund blocks transfer');
select lives_ok($$select public.record_rental_settlement('85000000-0000-4000-8000-000000000001','refund','re_sql','succeeded')$$,'Trusted receipt records deposit refund');
select lives_ok($$select public.record_rental_settlement('85000000-0000-4000-8000-000000000001','refund','re_sql','succeeded')$$,'Duplicate refund receipt is idempotent');
select throws_ok($$select public.record_rental_settlement('85000000-0000-4000-8000-000000000001','refund','re_other','succeeded')$$,
 'P0001','Conflicting settlement receipt','Different refund ID cannot overwrite receipt');
select is((select count(*)::int from public.notifications where event_key='deposit:85000000-0000-4000-8000-000000000001:succeeded'),1,'Refund notification is deduplicated');
select is((select count(*)::int from public.notification_email_jobs where event_key='deposit:85000000-0000-4000-8000-000000000001:succeeded'),1,'Refund email is queued once, not reported delivered');
select throws_ok($$select public.claim_rental_settlement('85000000-0000-4000-8000-000000000001','transfer')$$,
 'P0001','Owner must complete Stripe Connect setup','Missing Connect account blocks transfer');
insert into public.owner_connect_accounts(owner_id,stripe_account_id) values('81000000-0000-4000-8000-000000000001','acct_sql');
select lives_ok($$select public.claim_rental_settlement('85000000-0000-4000-8000-000000000001','transfer')$$,'Bound account permits transfer claim');
select is((select destination_account from public.rental_settlements where booking_id='85000000-0000-4000-8000-000000000001'),'acct_sql','Transfer destination is frozen');
update public.rental_settlements set transfer_started_at=now()-interval '21 hours' where booking_id='85000000-0000-4000-8000-000000000001';
select throws_ok($$select public.claim_rental_settlement('85000000-0000-4000-8000-000000000001','transfer')$$,
 'P0001','Unknown transfer outcome requires manual reconciliation','Aged unknown outcome cannot duplicate money movement');
update public.rental_settlements set transfer_started_at=now() where booking_id='85000000-0000-4000-8000-000000000001';
select lives_ok($$select public.record_rental_settlement('85000000-0000-4000-8000-000000000001','transfer','tr_sql','succeeded')$$,'Trusted transfer receipt records success');
select lives_ok($$select public.record_rental_settlement('85000000-0000-4000-8000-000000000001','transfer','tr_sql','succeeded')$$,'Transfer receipt retry is idempotent');
select is((select count(*)::int from public.notifications where event_key='transfer:85000000-0000-4000-8000-000000000001:succeeded'),1,'Transfer notification is deduplicated');
select lives_ok($$select public.record_rental_settlement('85000000-0000-4000-8000-000000000001','transfer','tr_sql','reversed')$$,'Reversed transfer is recorded');
select throws_ok($$select public.record_rental_settlement('85000000-0000-4000-8000-000000000001','transfer','tr_sql','succeeded')$$,
 'P0001','Conflicting settlement receipt','Old receipt cannot undo reversal');
select is((select status from public.payments where booking_id='85000000-0000-4000-8000-000000000001'),'succeeded','Partial deposit refund does not mark whole payment refunded');
select * from finish();
rollback;
