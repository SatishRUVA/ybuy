-- Rollback-only pickup and return handoff checks.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('b0000000-0000-4000-8000-000000000001','handoff-owner@test.invalid','{"full_name":"Handoff owner"}'),
 ('b0000000-0000-4000-8000-000000000002','handoff-renter@test.invalid','{"full_name":"Handoff renter"}'),
 ('b0000000-0000-4000-8000-000000000003','handoff-other@test.invalid','{"full_name":"Other user"}'),
 ('b0000000-0000-4000-8000-000000000004','handoff-support@test.invalid','{"full_name":"Support agent"}');
insert into auth.sessions(id,user_id) values
 ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001'),
 ('b1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002'),
 ('b1000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000003'),
 ('b1000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000004');
insert into public.admin_users(user_id,role,permissions)
values ('b0000000-0000-4000-8000-000000000004','admin','{support.manage}');
insert into public.categories(id,name) values('b2000000-0000-4000-8000-000000000001','Handoff test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
 availability_start,availability_end)
values ('b3000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
 'b2000000-0000-4000-8000-000000000001','Handoff test item','A test item for pickup and return handoff.',10,'draft',200,'good',
 current_date+1,current_date+30);
insert into public.listing_images(listing_id,url,sort_order)
values ('b3000000-0000-4000-8000-000000000001','https://example.test/handoff-item.jpg',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
values ('b3000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
 'Private pickup','Dallas','TX','75201','US',32.8,-96.8);
update public.listings set status='published' where id='b3000000-0000-4000-8000-000000000001';
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,
 service_fee_pct,service_fee_amount,deposit,total,status,payment_first)
values
 ('b4000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',
  current_date+1,current_date+3,10,2,20,.1,2,50,72,'pending_payment',false),
 ('b4000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',
  current_date+10,current_date+12,10,2,20,.1,2,50,72,'pending_payment',false),
 ('b4000000-0000-4000-8000-000000000003','b3000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',
  current_date+20,current_date+22,10,2,20,.1,2,50,72,'pending_payment',false);
select public.confirm_booking_payment(id,'cs_handoff_1','pi_handoff_1',total)
from public.bookings where id='b4000000-0000-4000-8000-000000000001';
select public.confirm_booking_payment(id,'cs_handoff_2','pi_handoff_2',total)
from public.bookings where id='b4000000-0000-4000-8000-000000000002';
select public.confirm_booking_payment(id,'cs_handoff_3','pi_handoff_3',total)
from public.bookings where id='b4000000-0000-4000-8000-000000000003';
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,
 service_fee_pct,service_fee_amount,deposit,total,status,deposit_collection_model,payment_first)
values ('b4000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',
 current_date+23,current_date+25,10,2,20,.1,2,50,23.54,'return_pending','authorization',false);

create temporary table handoff_test_codes(kind text primary key, code text not null, wrong_code text);
grant select,insert,update on handoff_test_codes to authenticated;
create function pg_temp.login(p_user int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','b0000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),
    'role','authenticated',
    'session_id','b1000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),
    'exp',4102444800)::text,true);
end;
$$;

select ok(not has_function_privilege('authenticated','public.mark_booking_active(uuid)','EXECUTE'),
 'Legacy direct rental activation is disabled');
select ok(not has_function_privilege('authenticated','public.complete_booking_return(uuid)','EXECUTE'),
 'Legacy direct return completion is disabled');
set local role authenticated;
select pg_temp.login(3);
select throws_ok($$select public.get_booking_handoff('b4000000-0000-4000-8000-000000000001')$$,
 '42501','Booking not found or not authorized','Unrelated users cannot view a handoff');
select pg_temp.login(1);
select throws_ok($$select public.start_booking_handoff('b4000000-0000-4000-8000-000000000001')$$,
 '55000','The renter must arrive before the owner can start handoff','Owner cannot skip renter arrival');
select pg_temp.login(2);
select lives_ok($$select public.start_booking_pickup('b4000000-0000-4000-8000-000000000001')$$,'Renter can report pickup arrival');
select is((public.get_booking_handoff('b4000000-0000-4000-8000-000000000001')->>'status'),
 'pickup_ready','Arrival creates the pickup-ready state');
select pg_temp.login(1);
select lives_ok($$select public.start_booking_handoff('b4000000-0000-4000-8000-000000000001')$$,'Owner starts handoff after arrival');
select lives_ok($$select public.save_booking_inspection(
 'b4000000-0000-4000-8000-000000000001','pickup',
 'Good overall condition with no dents.','One small scratch on the side panel.',
 array['charger','carrying case'],'Powered on and tested successfully.','SERIAL-001')$$,
 'Owner records condition, damage, accessories, function and serial');
reset role;
insert into storage.objects(bucket_id,name,owner_id) values
 ('booking-inspection-evidence','b4000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/pickup/pickup-1.jpg','b0000000-0000-4000-8000-000000000001'),
 ('booking-inspection-evidence','b4000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/pickup/pickup-2.jpg','b0000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.login(1);
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='b4000000-0000-4000-8000-000000000001' and kind='pickup'),
 'b4000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/pickup/pickup-1.jpg')$$,
 'Owner attaches first private photo');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='b4000000-0000-4000-8000-000000000001' and kind='pickup'),
 'b4000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/pickup/pickup-2.jpg')$$,
 'Owner attaches second private photo');
select pg_temp.login(2);
select lives_ok($$select public.acknowledge_booking_inspection('b4000000-0000-4000-8000-000000000001','pickup')$$,
 'Renter acknowledges the saved pickup record');
select throws_ok($$select public.get_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','pickup')$$,
 '55000','Both parties must acknowledge the inspection before a code is available','Code is withheld until both acknowledge');
select pg_temp.login(1);
select lives_ok($$select public.acknowledge_booking_inspection('b4000000-0000-4000-8000-000000000001','pickup')$$,
 'Owner acknowledges the same pickup record');
reset role;
select is((select count(*)::int from public.booking_handoff_otp_challenges
 where booking_id='b4000000-0000-4000-8000-000000000001' and kind='pickup'),1,
 'The backend issues one pickup challenge after both acknowledgments');
set local role authenticated;
select pg_temp.login(3);
select throws_ok($$select public.get_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','pickup')$$,
 '42501','Only the renter can view this verification code','Only the renter can retrieve the pickup code');
select pg_temp.login(2);
insert into handoff_test_codes(kind,code,wrong_code)
select 'pickup',x->>'code',case when x->>'code'='000000' then '000001' else '000000' end
from (select public.get_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','pickup') x) s;
select ok((select code ~ '^[0-9]{6}$' from handoff_test_codes where kind='pickup'),'Pickup OTP has exactly six digits');
select pg_temp.login(1);
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','pickup','bad')->>'attempts_remaining'),
 '4','Malformed verification attempts count toward the limit');
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','pickup',
 (select code from handoff_test_codes where kind='pickup'))->>'verified'),'true','Valid pickup code activates rental');
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','pickup',
 (select code from handoff_test_codes where kind='pickup'))->>'idempotent'),'true','Duplicate pickup verification is retry-safe');
reset role;
select is((select status from public.bookings where id='b4000000-0000-4000-8000-000000000001'),
 'active','Booking becomes active only after OTP verification');
select ok((select actual_pickup_at is not null from public.booking_handoffs
 where booking_id='b4000000-0000-4000-8000-000000000001'),'Actual pickup timestamp is recorded');
select ok(not exists(select 1 from public.booking_handoff_events e
 where e.booking_id='b4000000-0000-4000-8000-000000000001'
 and (e.detail ? 'code' or e.detail ? 'otp')),
 'OTP values are not written to handoff audit details');

set local role authenticated;
select pg_temp.login(2);
select lives_ok($$select public.start_booking_return('b4000000-0000-4000-8000-000000000001')$$,
 'Renter can start an early return');
select is((public.get_booking_handoff('b4000000-0000-4000-8000-000000000001')->>'status'),
 'return_initiated','Return start moves into return handoff state');
select pg_temp.login(1);
select lives_ok($$select public.begin_booking_return_inspection('b4000000-0000-4000-8000-000000000001')$$,
 'Owner starts return inspection');
select lives_ok($$select public.save_booking_inspection(
 'b4000000-0000-4000-8000-000000000001','return',
 'Item is present and in working condition.','A new crack is visible near the lower hinge.',
 array['charger'],'Powers on; hinge is loose.','SERIAL-001')$$,
 'Owner records return condition and completeness');
reset role;
insert into storage.objects(bucket_id,name,owner_id) values
 ('booking-inspection-evidence','b4000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/return/return-1.jpg','b0000000-0000-4000-8000-000000000001'),
 ('booking-inspection-evidence','b4000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/return/return-2.jpg','b0000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.login(1);
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='b4000000-0000-4000-8000-000000000001' and kind='return'),
 'b4000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/return/return-1.jpg')$$,
 'Owner attaches first return photo');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='b4000000-0000-4000-8000-000000000001' and kind='return'),
 'b4000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/return/return-2.jpg')$$,
 'Owner attaches second return photo');
select lives_ok($$select public.acknowledge_booking_inspection('b4000000-0000-4000-8000-000000000001','return')$$,
 'Owner acknowledges return condition');
select pg_temp.login(2);
select lives_ok($$select public.acknowledge_booking_inspection('b4000000-0000-4000-8000-000000000001','return')$$,
 'Renter acknowledges return condition');
insert into handoff_test_codes(kind,code,wrong_code)
select 'return',x->>'code',case when x->>'code'='000000' then '000001' else '000000' end
from (select public.get_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return') x) s;
reset role;
select ok((select code ~ '^[0-9]{6}$' from handoff_test_codes where kind='return'),'Return OTP has exactly six digits');
select is((select count(distinct kind)::int from public.booking_handoff_otp_challenges
 where booking_id='b4000000-0000-4000-8000-000000000001'),2,'Pickup and return use independent challenges');
set local role authenticated;
select pg_temp.login(1);
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return',
 (select wrong_code from handoff_test_codes where kind='return'))->>'attempts_remaining'),
 '4','Incorrect return OTP is rejected and counted');
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return',
 (select wrong_code from handoff_test_codes where kind='return'))->>'attempts_remaining'),'3','Second incorrect return attempt is counted');
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return',
 (select wrong_code from handoff_test_codes where kind='return'))->>'attempts_remaining'),'2','Third incorrect return attempt is counted');
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return',
 (select wrong_code from handoff_test_codes where kind='return'))->>'attempts_remaining'),'1','Fourth incorrect return attempt is counted');
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return',
 (select wrong_code from handoff_test_codes where kind='return'))->>'attempts_remaining'),'0','Fifth incorrect return attempt exhausts the challenge');
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return',
 (select code from handoff_test_codes where kind='return'))->>'attempts_remaining'),'0','Exhausted challenge rejects the correct code');
select pg_temp.login(2);
select throws_ok($$select public.get_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return')$$,
 '55000','The verification code expired or is no longer available','Renter cannot retrieve an exhausted code');
reset role;
update public.booking_handoff_otp_challenges set created_at=clock_timestamp()-interval '31 seconds',
 expires_at=clock_timestamp()-interval '1 second'
where booking_id='b4000000-0000-4000-8000-000000000001' and kind='return' and generation=1;
set local role authenticated;
select pg_temp.login(2);
select lives_ok($$select public.regenerate_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return')$$,
 'Renter can regenerate an expired or exhausted code');
reset role;
select is((select count(*)::int from public.booking_handoff_otp_challenges
 where booking_id='b4000000-0000-4000-8000-000000000001' and kind='return' and invalidated_at is not null),
 1,'Regeneration invalidates the previous return code');
select is((select octet_length(otp_ciphertext)::int from public.booking_handoff_otp_challenges
 where booking_id='b4000000-0000-4000-8000-000000000001' and kind='return' and generation=1),
 0,'Regeneration erases the previous encrypted return code');
insert into public.operations_cases(kind,booking_id,created_by,participant_id,category,subject)
values ('dispute','b4000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',
 'b0000000-0000-4000-8000-000000000001','damaged','Return condition is disputed');
set local role authenticated;
select pg_temp.login(2);
update handoff_test_codes set code=(public.get_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return')->>'code')
where kind='return';
select pg_temp.login(1);
select is((public.verify_booking_handoff_otp('b4000000-0000-4000-8000-000000000001','return',
 (select code from handoff_test_codes where kind='return'))->>'verified'),'true','New return code verifies');
select is((select status from public.bookings where id='b4000000-0000-4000-8000-000000000001'),
 'completed','Booking becomes completed only after verified return handoff');
select ok((select actual_return_at is not null from public.booking_handoffs
 where booking_id='b4000000-0000-4000-8000-000000000001'),'Actual return timestamp is recorded');
select is((select refund_status from public.rental_settlements where booking_id='b4000000-0000-4000-8000-000000000001'),
 'pending','Return starts settlement without capturing a disputed deposit');
reset role;
select throws_ok($$select public.claim_rental_settlement('b4000000-0000-4000-8000-000000000001','refund')$$,
 'P0001','Settlement blocked by an unresolved dispute','Open dispute blocks automatic deposit settlement');

set local role authenticated;
select pg_temp.login(2);
select lives_ok($$select public.start_booking_pickup('b4000000-0000-4000-8000-000000000002')$$,
 'Renter can report arrival for support exception case');
select lives_ok($$select public.create_case('support','b4000000-0000-4000-8000-000000000002',
 'pickup_return','Owner unavailable','The owner did not arrive for the scheduled handoff.')$$,
 'No-show creates an auditable support case');
select throws_ok($$select public.support_complete_booking_handoff_exception(
 'b4000000-0000-4000-8000-000000000002','pickup','Owner unavailable')$$,
 '42501','Not authorized','Participants cannot approve their own support exception');
select pg_temp.login(4);
select lives_ok($$select public.support_complete_booking_handoff_exception(
 'b4000000-0000-4000-8000-000000000002','pickup','Owner no-show confirmed by support.')$$,
 'Authorized support can record an exception against an open support case');
reset role;
select is((select status from public.bookings where id='b4000000-0000-4000-8000-000000000002'),
 'active','Support exception is the only OTP-free activation path');
select ok((select support_exception_pickup_at is not null from public.booking_handoffs
 where booking_id='b4000000-0000-4000-8000-000000000002'),'Support exception records an auditable timestamp');
set local role authenticated;
select pg_temp.login(2);
select lives_ok($$select public.start_booking_pickup('b4000000-0000-4000-8000-000000000003')$$,
 'Cancellation scenario begins with renter arrival');
select lives_ok($$select public.cancel_booking('b4000000-0000-4000-8000-000000000003')$$,
 'Booking can be cancelled before verified pickup');
select is((public.get_booking_handoff('b4000000-0000-4000-8000-000000000003')->>'status'),
 'cancelled','Pre-pickup cancellation closes its handoff');
select pg_temp.login(3);
select throws_ok($$select public.submit_booking_deposit_claim(
 'b4000000-0000-4000-8000-000000000004','New damage','The item has a new crack.',25)$$,
 '42501','Only the owner can submit a deposit claim during return inspection','Renter cannot submit an owner damage claim');
select pg_temp.login(1);
select throws_ok($$select public.submit_booking_deposit_claim(
 'b4000000-0000-4000-8000-000000000004','New damage','The item has a new crack.',51)$$,
 '22023','Enter a clear damage reason and an amount within the authorized deposit','Damage claim cannot exceed the deposit');
select lives_ok($$select public.submit_booking_deposit_claim(
 'b4000000-0000-4000-8000-000000000004','New damage','A new crack is documented in the return photos.',25)$$,
 'Owner can file a return damage claim with a reason and amount');
reset role;
select is((select requested_amount from public.booking_deposit_claims c
 join public.operations_cases o on o.id=c.case_id
 where o.booking_id='b4000000-0000-4000-8000-000000000004'),25::numeric,
 'The requested damage amount is persisted with the claim');

select * from finish();
rollback;
