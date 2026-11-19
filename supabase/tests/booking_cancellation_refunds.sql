-- Rollback-only cancellation and refund lifecycle checks.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir fixtures/published_listing.inc

insert into auth.users(id,email,raw_user_meta_data) values
 ('c0000000-0000-4000-8000-000000000001','cancel-owner@test.invalid','{"full_name":"Cancel owner"}'),
 ('c0000000-0000-4000-8000-000000000002','cancel-renter@test.invalid','{"full_name":"Cancel renter"}'),
 ('c0000000-0000-4000-8000-000000000003','cancel-other@test.invalid','{"full_name":"Other user"}'),
 ('c0000000-0000-4000-8000-000000000004','cancel-admin@test.invalid','{"full_name":"Cancellation admin"}');
insert into auth.sessions(id,user_id) values
 ('c1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001'),
 ('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002'),
 ('c1000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003'),
 ('c1000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000004');
insert into public.admin_users(user_id,role,permissions)
values ('c0000000-0000-4000-8000-000000000004','super_admin','{}');
insert into public.categories(id,name) values('c2000000-0000-4000-8000-000000000001','Cancellation test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
 availability_start,availability_end)
values ('c3000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
 'c2000000-0000-4000-8000-000000000001','Cancellation test item','A synthetic listing for cancellation and refund tests.',
 10,'draft',200,'good',current_date+1,current_date+60);
select pg_temp.publish_listing_fixture('c3000000-0000-4000-8000-000000000001',current_date+1,current_date+60);
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
 availability_start,availability_end)
values ('c3000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003',
 'c2000000-0000-4000-8000-000000000001','Another owner listing','A separate listing used to verify owner authorization.',
 10,'draft',200,'good',current_date+1,current_date+60);
select pg_temp.publish_listing_fixture('c3000000-0000-4000-8000-000000000002',current_date+1,current_date+60);

insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,
 service_fee_pct,service_fee_amount,deposit,total,status,deposit_collection_model,payment_first)
values
 ('c4000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+3,current_date+5,10,2,20,.1,2,50,72,'requested','captured',false),
 ('c4000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',
  current_date+7,current_date+9,10,2,20,.1,2,50,72,'requested','captured',false),
 ('c4000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+11,current_date+13,10,2,20,.1,2,50,72,'pending_payment','captured',false),
 ('c4000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+15,current_date+17,10,2,20,.1,2,50,72,'pending_payment','captured',false),
 ('c4000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+19,current_date+21,10,2,20,.1,2,50,72,'pending_payment','authorization',true),
 ('c4000000-0000-4000-8000-000000000006','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+23,current_date+25,10,2,20,.1,2,50,72,'pending_payment','captured',false),
 ('c4000000-0000-4000-8000-000000000007','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+27,current_date+29,10,2,20,.1,2,50,72,'confirmed','captured',false),
 ('c4000000-0000-4000-8000-000000000008','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+31,current_date+33,10,2,20,.1,2,50,72,'pending_payment','captured',false),
 ('c4000000-0000-4000-8000-000000000009','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+35,current_date+37,10,2,20,.1,2,50,72,'pending_payment','captured',false),
 ('c4000000-0000-4000-8000-000000000010','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+39,current_date+41,10,2,20,.1,2,50,72,'pending_payment','captured',false),
 ('c4000000-0000-4000-8000-000000000011','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+43,current_date+45,10,2,20,.1,2,50,72,'requested','captured',false),
 ('c4000000-0000-4000-8000-000000000012','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+47,current_date+49,10,2,20,.1,2,50,72,'pending_payment','captured',false);

select public.confirm_booking_payment(id,'cs_cancel_policy','pi_cancel_policy',total)
  from public.bookings where id='c4000000-0000-4000-8000-000000000004';
select public.confirm_booking_payment(id,'cs_cancel_auth','pi_cancel_auth',total)
  from public.bookings where id='c4000000-0000-4000-8000-000000000005';
select public.confirm_booking_payment(id,'cs_cancel_full','pi_cancel_full',total)
  from public.bookings where id='c4000000-0000-4000-8000-000000000006';
select public.confirm_booking_payment(id,'cs_cancel_reject','pi_cancel_reject',total)
  from public.bookings where id='c4000000-0000-4000-8000-000000000009';
select public.confirm_booking_payment(id,'cs_cancel_retry','pi_cancel_retry',total)
  from public.bookings where id='c4000000-0000-4000-8000-000000000010';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000003","exp":4102444800}',true);
select throws_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000001','Not my rental')$$,
 '42501','Not a participant in this booking','An owner cannot cancel another owner''s booking');
select throws_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000001','Not my booking')$$,
 '42501','Not a participant in this booking','A renter cannot cancel another renter''s booking');
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select throws_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000001',' ')$$,
 '22023','Enter a cancellation reason between 3 and 500 characters','Cancellation requires a meaningful reason');
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000001','Plans changed')$$,
 'Renter can cancel a requested booking');
select throws_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000001','Another reason')$$,
 '55000','This booking has already been cancelled.','Duplicate cancellation is rejected');
select is((select initiator_role from public.booking_cancellations where booking_id='c4000000-0000-4000-8000-000000000001'),
 'renter','Cancellation records the initiating participant');
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000001'),
 'not_applicable','Unpaid cancellation has no payment refund');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000001","exp":4102444800}',true);
select lives_ok($$select public.respond_to_booking_request('c4000000-0000-4000-8000-000000000002',false)$$,
 'Owner decline remains a separate request decision');
select is((select status from public.bookings where id='c4000000-0000-4000-8000-000000000002'),
 'rejected','Decline does not mark the booking cancelled');
select is((select count(*)::int from public.booking_cancellations where booking_id='c4000000-0000-4000-8000-000000000002'),
 0,'Decline does not create a participant cancellation record');
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000003','Owner cannot proceed')$$,
 'Owner can cancel an awaiting-payment booking');
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000007','Pickup arrangements changed')$$,
 'Owner can cancel a confirmed booking before pickup');
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000011','Request no longer available')$$,
 'Owner can cancel a new rental request');
reset role;
select is((select initiator_role from public.booking_cancellations where booking_id='c4000000-0000-4000-8000-000000000011'),
 'owner','Owner cancellation records the initiating role');

select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000003'),
 'not_applicable','Unpaid owner cancellation has no refund case amount');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000012','Payment no longer needed')$$,
 'Renter can cancel an awaiting-payment booking');
reset role;
select is((select initiator_role from public.booking_cancellations where booking_id='c4000000-0000-4000-8000-000000000012'),
 'renter','Awaiting-payment cancellation records the renter');
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000012'),
 'not_applicable','Unpaid cancellation initially has no refund');
select lives_ok($$select public.confirm_booking_payment(
 'c4000000-0000-4000-8000-000000000012','cs_cancel_late_participant','pi_cancel_late_participant',72)$$,
 'A payment webhook arriving after participant cancellation is reconciled');
select is((select status from public.bookings where id='c4000000-0000-4000-8000-000000000012'),
 'cancelled','Late participant payment does not reactivate the booking');
select is((select status from public.payments where booking_id='c4000000-0000-4000-8000-000000000012'),
 'succeeded','Late participant payment is preserved');
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000012'),
 'pending_policy_review','Late participant payment receives policy review');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000004','No longer needed')$$,
 'Paid cancellation without policy is recorded');
reset role;
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000004'),
 'pending_policy_review','No policy produces Pending Policy Review, not a promised refund');
select is((select refund_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000004'),
 0::numeric,'No refund amount is invented without policy');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000009','Plans changed')$$,
 'A second paid cancellation can be reviewed independently');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000004","exp":4102444800}',true);
select lives_ok($$select public.admin_decide_cancellation_refund(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000009'),
 'reject',null,'No refund approved',false)$$,
 'Admin can reject a cancellation refund');
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000009'),
 'rejected','Rejected refund remains separate from cancellation');
select is((select provider_refund_id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000009'),
 null::text,'Rejected refund has no provider refund');
select throws_ok($$select public.begin_cancellation_refund_processing(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000009'))$$,
 '55000','Only approved refunds can be processed','Rejected refund cannot enter provider processing');
select lives_ok($$select public.admin_decide_cancellation_refund(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000004'),
 'approve',1.00,'Senior Admin policy exception',true)$$,
 'Senior Admin can approve a documented no-policy override');
select is((public.begin_cancellation_refund_processing(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000004'))->>'attempt')::int,
 1,'Approved refund starts a distinct provider-processing attempt');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$select public.record_cancellation_refund_provider_result(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000004'),
 'reCancelPartial001','succeeded',1.00,'usd','pi_cancel_policy',1,'{"status":"succeeded"}'::jsonb)$$,
 'Provider confirmation records the refund result');
reset role;
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000004'),
 'partially_refunded','A partial provider-confirmed refund remains distinct from booking cancellation');
select is((select status from public.payments where booking_id='c4000000-0000-4000-8000-000000000004'),
 'succeeded','Original payment transaction remains preserved');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000004","exp":4102444800}',true);
select lives_ok($$select public.admin_save_booking_cancellation_policy(
 now()-interval '1 minute',null,0,50,false,false,false,false,true,0,100,true,true,true,true,true,true,
 'Role-based partial and full cancellation rules')$$,'Super Admin schedules an effective-dated role-based policy');
reset role;
select is((select count(*)::int from public.booking_cancellation_policies),1,'Policy versions are persisted');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000005','Rental plans changed')$$,
 'Renter can cancel a paid booking under policy');
reset role;
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000005'),
 'approved','Policy can automatically approve an eligible refund for processing');
select is((select refund_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000005'),
 (select round(subtotal*0.5,2) from public.bookings where id='c4000000-0000-4000-8000-000000000005'),
 'Renter refund follows the configured partial percentage');
select is((select eligible_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000005'),
 (select round(subtotal*0.5,2) from public.bookings where id='c4000000-0000-4000-8000-000000000005'),
 'Authorization-only security deposit is not included in the cancellation refund');
select is((select count(*)::int from public.rental_settlements where booking_id='c4000000-0000-4000-8000-000000000005'),
 0,'Cancellation does not trigger normal-return deposit settlement');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select is((public.begin_cancellation_refund_processing(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000005'))->>'attempt')::int,
 1,'Automatically approved refund can be safely claimed by the participant');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$select public.record_cancellation_refund_provider_result(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000005'),
 'reCancelPartial002','succeeded',
 (select refund_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000005'),
 'usd','pi_cancel_auth',1,'{"status":"succeeded"}'::jsonb)$$,
 'Provider confirms the policy-driven partial refund');
reset role;
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000005'),
 'partially_refunded','Provider confirmation changes only the independent refund status');
select is((select status from public.bookings where id='c4000000-0000-4000-8000-000000000005'),
 'cancelled','Refund completion does not change the cancelled booking state');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000001","exp":4102444800}',true);
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000006','Owner cancelled confirmed rental')$$,
 'Owner can cancel a confirmed, paid booking before pickup');
reset role;
select is((select eligible_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000006'),
 (select amount from public.payments where booking_id='c4000000-0000-4000-8000-000000000006' and status='succeeded'),
 'Owner policy can include all captured payment components, including a captured deposit');
select is((select eligible_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000006'),
 (select original_payment_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000006'),
 'Configured policy supports a full refund');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000001","exp":4102444800}',true);
select is((public.begin_cancellation_refund_processing(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000006'))->>'attempt')::int,
 1,'Full refund enters provider processing');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$select public.record_cancellation_refund_provider_result(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000006'),
 'reCancelFull001','succeeded',
 (select refund_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000006'),
 'usd','pi_cancel_full',1,'{"status":"succeeded"}'::jsonb)$$,
 'Provider confirms a full cancellation refund');
reset role;
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000006'),
 'refunded','Full provider-confirmed refund is marked refunded');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select lives_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000010','Rental plans changed')$$,
 'Automatic policy creates a retryable cancellation refund');
select is((public.begin_cancellation_refund_processing(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'))->>'attempt')::int,
 1,'First refund provider attempt is recorded');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$select public.record_cancellation_refund_provider_error(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 1,'card_declined','{"code":"card_declined","message":"Provider declined the refund"}'::jsonb)$$,
 'Definitive provider rejection is persisted as a failed refund');
reset role;
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'failed','Provider rejection transitions the case to failed');
select is((select provider_response->>'code' from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'card_declined','Provider failure details remain auditable');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000004","exp":4102444800}',true);
select lives_ok($$select public.admin_decide_cancellation_refund(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'approve',(select eligible_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'Retry after provider rejection',false)$$,
 'Admin can safely authorize a failed refund retry');
select is((public.begin_cancellation_refund_processing(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'))->>'attempt')::int,
 2,'Retry uses a new idempotent provider attempt');
select is((public.begin_cancellation_refund_processing(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'))->>'attempt')::int,
 2,'Duplicate processing claims reuse the active idempotency attempt');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$select public.record_cancellation_refund_provider_result(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'reCancelRetry002','failed',
 (select refund_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'usd','pi_cancel_retry',2,'{"status":"failed"}'::jsonb)$$,
 'A provider-confirmed failed refund is recorded');
select lives_ok($$select public.record_cancellation_refund_provider_result(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'reCancelRetry002','failed',
 (select refund_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'usd','pi_cancel_retry',2,'{"status":"failed"}'::jsonb)$$,
 'Duplicate failed-refund webhook receipt is idempotent');
reset role;
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'failed','Provider-confirmed failure remains retryable');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000004","exp":4102444800}',true);
select lives_ok($$select public.admin_decide_cancellation_refund(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'approve',(select eligible_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'Retry after confirmed provider failure',false)$$,
 'Admin can authorize a retry after provider-confirmed failure');
select is((public.begin_cancellation_refund_processing(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'))->>'attempt')::int,
 3,'A provider-confirmed failure uses a new idempotent attempt');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$select public.record_cancellation_refund_provider_result(
 (select id from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'reCancelRetry001','succeeded',
 (select refund_amount from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000010'),
 'usd','pi_cancel_retry',3,'{"status":"succeeded"}'::jsonb)$$,
 'Retry records the provider-confirmed refund');
reset role;

insert into public.booking_handoffs(booking_id,status,actual_pickup_at)
values('c4000000-0000-4000-8000-000000000007','rental_active',clock_timestamp());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select throws_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000007','After pickup')$$,
 '55000','A booking cannot be cancelled after pickup.','Recorded pickup is a server-side hard cancellation cutoff');
reset role;
update public.bookings set status='completed' where id='c4000000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c1000000-0000-4000-8000-000000000002","exp":4102444800}',true);
select throws_ok($$select public.cancel_booking('c4000000-0000-4000-8000-000000000007','Completed rental')$$,
 '55000','Completed bookings cannot be cancelled.','Completed booking cannot be cancelled');
reset role;

select ok((select checkout_expires_at<=created_at+interval '15 minutes'
  and checkout_expires_at>created_at+interval '14 minutes' from public.bookings
  where id='c4000000-0000-4000-8000-000000000008'),
 'Unpaid checkout reservation initially expires within 15 minutes');
update public.bookings set checkout_expires_at=created_at+interval '1 hour'
where id='c4000000-0000-4000-8000-000000000008';
select ok((select checkout_expires_at<=created_at+interval '15 minutes' from public.bookings
  where id='c4000000-0000-4000-8000-000000000008'),
 'A checkout deadline cannot be extended beyond 15 minutes');
update public.bookings set checkout_expires_at=clock_timestamp()-interval '16 minutes'
where id='c4000000-0000-4000-8000-000000000008';
select is(public.expire_listing_checkouts('c3000000-0000-4000-8000-000000000001'),1,
 'Expired unpaid checkout is cancelled by the existing reservation expiry path');
select is((select cancellation_type from public.booking_cancellations where booking_id='c4000000-0000-4000-8000-000000000008'),
 'checkout_expired','Checkout expiration remains distinguishable from participant cancellation');
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000008'),
 'not_applicable','Expired unpaid checkout does not create a payment refund');
select lives_ok($$select public.confirm_booking_payment(
 'c4000000-0000-4000-8000-000000000008','cs_cancel_late','pi_cancel_late',72)$$,
 'A late successful payment is recorded against the cancelled booking');
select is((select status from public.bookings where id='c4000000-0000-4000-8000-000000000008'),
 'cancelled','A late payment does not reactivate an expired booking');
select is((select status from public.payments where booking_id='c4000000-0000-4000-8000-000000000008'),
 'succeeded','Original late payment transaction is preserved');
select is((select status from public.cancellation_refund_cases where booking_id='c4000000-0000-4000-8000-000000000008'),
 'pending_review','Late payment is routed to a refund review case');
select ok(exists(select 1 from public.booking_cancellation_events
  where booking_id='c4000000-0000-4000-8000-000000000008'
    and event_type='late_payment_reconciled'
    and details->>'payment_id'=(select id::text from public.payments
      where booking_id='c4000000-0000-4000-8000-000000000008')),
 'Late payment reference is included in immutable audit history');

select ok(not has_function_privilege('authenticated','public.cancel_booking(uuid)','EXECUTE'),
 'The legacy cancellation RPC without a reason is disabled');
select ok(not has_function_privilege('authenticated','public.record_cancellation_refund_provider_result(uuid,text,text,numeric,text,text,integer,jsonb)','EXECUTE'),
 'Clients cannot fabricate payment-provider refund receipts');
select ok(not has_function_privilege('authenticated','public.record_cancellation_refund_provider_error(uuid,integer,text,jsonb)','EXECUTE'),
 'Clients cannot fabricate payment-provider failure receipts');
select ok(exists(select 1 from public.booking_cancellation_events where event_type='booking_cancelled'),
 'Cancellation reason and state transition are auditable');
select ok(not exists(select 1 from public.rental_settlements where booking_id in (
 'c4000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000004',
 'c4000000-0000-4000-8000-000000000005','c4000000-0000-4000-8000-000000000006')),
 'Cancellation never invokes the normal-return security-deposit refund workflow');

select * from finish();
rollback;
