begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('b1000000-0000-4000-8000-000000000001','pickup-owner@example.test'),
 ('b1000000-0000-4000-8000-000000000002','pickup-renter@example.test'),
 ('b1000000-0000-4000-8000-000000000003','pickup-other@example.test');
insert into auth.sessions(id,user_id) select
 ('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.categories(id,name) values('b3000000-0000-4000-8000-000000000001','Pickup fixture');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,estimated_value,item_condition)
values('b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
 'b3000000-0000-4000-8000-000000000001','Pickup fixture','A test camera with a carrying case.',10,200,'good');
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,latitude,longitude)
values('b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
 '123 Private Lane, Dallas, TX 75247','Dallas','TX','75247',32.8,-96.9);
insert into public.listing_images(listing_id,url,sort_order)
values('b4000000-0000-4000-8000-000000000001',
 'http://localhost:54321/storage/v1/object/public/listing-images/b4000000-0000-4000-8000-000000000001/photo.png',0);
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.owner_save_listing_flow('b4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='b4000000-0000-4000-8000-000000000001'),
 jsonb_build_object('availability_start',current_date,'availability_end',current_date+30),null,true)$$,
 'Publish fixture through authoritative owner checks');
set local request.jwt.claims='{}';
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
values('b5000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',
 'b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
 current_date+1,current_date+3,10,2,20,.1,2,60,82,'requested');

select ok(not has_function_privilege('anon','public.get_booking_pickup(uuid)','execute'),'Anonymous callers cannot request exact addresses');
set local role authenticated;
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((select count(*)::integer from public.listing_pickup_locations),0,'Renters cannot enumerate private locations directly');
select throws_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,
 '42501','Pickup address is available only to participants of a confirmed booking','Requested booking cannot reveal address');
reset role;
update public.bookings set status='pending_payment' where id='b5000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,
 '42501','Pickup address is available only to participants of a confirmed booking','Owner approval without payment cannot reveal address');
reset role;
select lives_ok($$select public.confirm_booking_payment('b5000000-0000-4000-8000-000000000001','cs_pickup','pi_pickup',82)$$,'Trusted payment confirms booking');
set local role authenticated;
select is(public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')->>'address',
 '123 Private Lane, Dallas, TX 75247','Confirmed renter receives exact address');
select is((select count(*)::integer from public.listing_pickup_locations),0,'Confirmed renter still cannot enumerate location table');
select throws_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000099')$$,
 '42501','Pickup address is available only to participants of a confirmed booking','Unknown booking cannot reveal an address');
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000003","exp":4102444800}';
select throws_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,
 '42501','Pickup address is available only to participants of a confirmed booking','Unrelated user cannot read confirmed booking address');
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000001","exp":4102444800}';
select is(public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')->>'city','Dallas','Confirmed booking owner retains pickup access');
reset role;
update public.bookings set status='active' where id='b5000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,'Active booking permits pickup access');
reset role;
update public.bookings set status='return_pending' where id='b5000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,'Return in progress permits address access');
reset role;
update public.bookings set status='completed' where id='b5000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,
 '42501','Pickup address is available only to participants of a confirmed booking','Completed booking no longer reveals address');
reset role;
update public.bookings set status='cancelled' where id='b5000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,
 '42501','Pickup address is available only to participants of a confirmed booking','Cancelled booking cannot reveal address');
reset role;
update public.bookings set status='rejected' where id='b5000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,
 '42501','Pickup address is available only to participants of a confirmed booking','Rejected booking cannot reveal address');
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000099","exp":4102444800}';
select throws_ok($$select public.get_booking_pickup('b5000000-0000-4000-8000-000000000001')$$,
 '42501','Active session required','Revoked session cannot request private addresses');
reset role;
select * from finish();
rollback;
