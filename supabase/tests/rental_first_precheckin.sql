-- Synthetic records and provider receipts are rolled back; no provider API is called.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('c0000000-0000-4000-8000-000000000001','slot-owner@test.invalid','{"full_name":"Slot owner"}'),
 ('c0000000-0000-4000-8000-000000000002','slot-renter@test.invalid','{"full_name":"Slot renter"}'),
 ('c0000000-0000-4000-8000-000000000003','slot-other@test.invalid','{"full_name":"Other user"}');
insert into auth.sessions(id,user_id) values
 ('c1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001'),
 ('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002'),
 ('c1000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003');
insert into public.categories(id,name) values('c2000000-0000-4000-8000-000000000001','Slot test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
 availability_start,availability_end)
values ('c3000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
 'c2000000-0000-4000-8000-000000000001','Slot test item','Synthetic rental-first pre-check-in item.',10,'draft',200,'good',
 current_date,current_date+10);
insert into public.listing_images(listing_id,url,sort_order)
values ('c3000000-0000-4000-8000-000000000001','https://example.test/slot-item.jpg',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude,time_zone)
values ('c3000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
 'Private pickup','Dallas','TX','75201','US',32.8,-96.8,'UTC');
update public.listings set status='published' where id='c3000000-0000-4000-8000-000000000001';
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,
 service_fee_pct,service_fee_amount,deposit,total,status)
values
 ('c4000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',
 'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
 current_date+3,current_date+4,10,1,10,.1,1,50,61,'pending_payment'),
 ('c4000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001',
 'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
 (statement_timestamp()+interval '10 minutes')::date,(statement_timestamp()+interval '10 minutes')::date+1,
 10,1,10,.1,1,50,61,'pending_payment');

create function pg_temp.slot_login(p_user int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','c0000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),'role','authenticated',
    'session_id','c1000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),'exp',4102444800)::text,true);
end;
$$;
select is((select total from public.bookings where id='c4000000-0000-4000-8000-000000000001'),13.77::numeric,
 'Rental total includes tax but never the deposit');
select is((select deposit_collection_model from public.bookings where id='c4000000-0000-4000-8000-000000000001'),
 'authorization','New bookings always use a separate authorization');
select is((select confirmation_gate from public.bookings where id='c4000000-0000-4000-8000-000000000001'),
 'awaiting_payment','Initial confirmation waits for rental payment only');
select throws_ok($$update public.bookings set payment_first=false where id='c4000000-0000-4000-8000-000000000001'$$,
 '42501','Booking payment sequence is immutable','The payment sequence cannot be changed to bypass pre-check-in');
select ok(not has_table_privilege('authenticated','public.booking_pickup_slots','INSERT'),
 'Participants cannot insert an approved slot directly');
select ok(not has_function_privilege('authenticated','public.start_booking_pickup_before_precheckin(uuid)','EXECUTE'),
 'Participants cannot bypass the gated pickup RPC');
set local role authenticated;
select pg_temp.slot_login(2);
select throws_ok($$select public.propose_booking_pickup_slot('c4000000-0000-4000-8000-000000000001',current_date+3+time '12:00','UTC')$$,
 '55000','Confirm payment before scheduling pickup','Unpaid bookings cannot schedule');
reset role;
select public.confirm_booking_payment(id,'cs_slot_1','pi_slot_1',total) from public.bookings where id='c4000000-0000-4000-8000-000000000001';
select public.confirm_booking_payment(id,'cs_slot_2','pi_slot_2',total) from public.bookings where id='c4000000-0000-4000-8000-000000000002';
select is((select status from public.bookings where id='c4000000-0000-4000-8000-000000000001'),
 'confirmed','Verified rental payment confirms without a deposit hold');
set local role authenticated;
select pg_temp.slot_login(3);
select throws_ok($$select public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')$$,
 '42501','Booking not found','Unrelated accounts cannot read pre-check-in');
select pg_temp.slot_login(2);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->>'can_authorize')::boolean,false,
 'Missing slots do not unlock authorization');
select is(public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->'slot','null'::jsonb,
 'A missing slot is JSON null rather than an object with null fields');
select throws_ok($$select public.get_booking_pickup('c4000000-0000-4000-8000-000000000001')$$,
 '55000','Complete check-in before accessing the private handoff address','Address stays private until check-in is complete');
select lives_ok($$select public.propose_booking_pickup_slot('c4000000-0000-4000-8000-000000000001',current_date+3+time '12:00','UTC')$$,
 'Renter proposes a slot after paying');
select throws_ok($$select public.respond_to_booking_pickup_slot('c4000000-0000-4000-8000-000000000001',current_date+3+time '12:00',true)$$,
 '42501','Only the owner can approve the handoff slot','Renter cannot approve own slot');
select pg_temp.slot_login(1);
select throws_ok($$select public.respond_to_booking_pickup_slot('c4000000-0000-4000-8000-000000000001',current_date+3+time '13:00',true)$$,
 '55000','This slot changed or is no longer available. Refresh check-in.','Owner cannot approve a stale proposal');
select lives_ok($$select public.respond_to_booking_pickup_slot('c4000000-0000-4000-8000-000000000001',current_date+3+time '12:00',true)$$,
 'Owner approves the proposed slot');
select pg_temp.slot_login(2);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->>'can_authorize')::boolean,false,
 'Deposit remains unavailable more than 24 hours before slot');
select throws_ok($$select public.record_deposit_hold_consent('c4000000-0000-4000-8000-000000000001')$$,
 '55000','Deposit authorization opens 24 hours before the slot; handoff is available only during the agreed slot',
 'Server rejects early deposit consent');
select throws_ok($$select public.start_booking_pickup('c4000000-0000-4000-8000-000000000001')$$,
 '55000','Deposit authorization opens 24 hours before the slot; handoff is available only during the agreed slot',
 'Server rejects early pickup');
reset role;
insert into public.booking_pickup_slots(booking_id,kind,selected_date,slot_window,starts_at,ends_at,time_zone,status,proposed_by)
values('c4000000-0000-4000-8000-000000000002','pickup',(clock_timestamp()+interval '10 minutes')::date,
 'afternoon',statement_timestamp()+interval '10 minutes',statement_timestamp()+interval '40 minutes','UTC','proposed',
 'c0000000-0000-4000-8000-000000000002');
select is((select ends_at-starts_at from public.booking_pickup_slots
 where booking_id='c4000000-0000-4000-8000-000000000002'),interval '30 minutes',
 'Historical exact slots keep their shorter bounds');
set local role authenticated;
select pg_temp.slot_login(1);
select public.respond_to_booking_pickup_slot('c4000000-0000-4000-8000-000000000002',
 (select starts_at from public.booking_pickup_slots where booking_id='c4000000-0000-4000-8000-000000000002'),true);
select pg_temp.slot_login(2);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->>'can_authorize')::boolean,true,
 'Deposit opens within 24 hours of approved slot');
select lives_ok($$select public.record_deposit_hold_consent('c4000000-0000-4000-8000-000000000002')$$,
 'Separate hold consent is available within the window');
reset role;
update public.booking_pickup_slots set starts_at=statement_timestamp()+interval '24 hours 1 minute',
 ends_at=statement_timestamp()+interval '24 hours 31 minutes' where booking_id='c4000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.slot_login(2);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->>'can_authorize')::boolean,false,
 'Authorization is closed just outside the 24-hour threshold');
reset role;
update public.booking_pickup_slots set starts_at=statement_timestamp()+interval '23 hours 59 minutes',
 ends_at=statement_timestamp()+interval '24 hours 29 minutes' where booking_id='c4000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.slot_login(2);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->>'can_authorize')::boolean,true,
 'Authorization opens just inside the 24-hour threshold');
reset role;
update public.booking_pickup_slots set starts_at=statement_timestamp()-interval '1 minute',
 ends_at=statement_timestamp()+interval '29 minutes' where booking_id='c4000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.slot_login(2);
select throws_ok($$select public.start_booking_pickup('c4000000-0000-4000-8000-000000000002')$$,
 '55000','Authorize the separate security hold before pickup or delivery','Rental payment alone cannot start pickup');
reset role;
update public.booking_deposit_authorizations set status='authorized',capture_before=clock_timestamp()-interval '1 minute'
 where booking_id='c4000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.slot_login(2);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->>'handoff_ready')::boolean,false,
 'Expired holds cannot unlock physical handoff');
reset role;
update public.booking_deposit_authorizations set status='authorized',capture_before=clock_timestamp()+interval '2 hours'
 where booking_id='c4000000-0000-4000-8000-000000000002';
update public.booking_pickup_slots set starts_at=statement_timestamp()+interval '10 minutes',
 ends_at=statement_timestamp()+interval '40 minutes' where booking_id='c4000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.slot_login(2);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->>'handoff_ready')::boolean,false,
 'A valid hold does not unlock arrival before the agreed slot');
select lives_ok($$select public.get_booking_pickup('c4000000-0000-4000-8000-000000000002')$$,
 'A valid hold unlocks the address before the slot so the renter can plan travel');
reset role;
update public.booking_pickup_slots set starts_at=statement_timestamp()-interval '1 minute',
 ends_at=statement_timestamp()+interval '29 minutes' where booking_id='c4000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.slot_login(2);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->>'handoff_ready')::boolean,true,
 'Live hold and approved current slot unlock handoff');
select lives_ok($$select public.start_booking_pickup('c4000000-0000-4000-8000-000000000002')$$,
 'Renter can arrive only after all pre-check-in gates pass');
select lives_ok($$select public.get_booking_pickup('c4000000-0000-4000-8000-000000000002')$$,
 'Private address opens only after deposit and slot gates pass');
reset role;
select * from finish();
rollback;
