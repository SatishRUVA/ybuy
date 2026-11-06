begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('d0000000-0000-4000-8000-000000000001','window-owner@test.invalid'),
 ('d0000000-0000-4000-8000-000000000002','window-renter@test.invalid'),
 ('d0000000-0000-4000-8000-000000000003','window-other@test.invalid');
insert into auth.sessions(id,user_id) select
 ('d1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('d0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.categories(id,name) values('d2000000-0000-4000-8000-000000000001','Window fixture');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
 availability_start,availability_end,pickup_windows,return_windows,return_rules,return_note)
values('d3000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
 'd2000000-0000-4000-8000-000000000001','Window item','Window fixture',2,'draft',10,'good',
 current_date,current_date+10,array['morning','afternoon'],array['evening'],array['Return all accessories'],'Repack the charger.');
insert into public.listing_images(listing_id,url,sort_order)
 values('d3000000-0000-4000-8000-000000000001','https://example.test/window.jpg',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude,time_zone)
values('d3000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
 'Private fixture','New York','NY','10001','US',40.75,-73.99,null);
update public.listings set status='published' where id='d3000000-0000-4000-8000-000000000001';
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,
 service_fee_pct,service_fee_amount,deposit,total,status)
values('d4000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
 'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',
 current_date+3,current_date+4,2,1,2,.1,.2,0,2.2,'pending_payment');

create function pg_temp.window_login(n int) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
 'sub','d0000000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated',
 'session_id','d1000000-0000-4000-8000-'||lpad(n::text,12,'0'),'exp',4102444800)::text,true);
end;
$$;
create function pg_temp.respond_window(approve boolean) returns void language plpgsql as $$
begin
 perform public.respond_to_booking_handoff_slot('d4000000-0000-4000-8000-000000000001',
  'pickup',approve,(select updated_at from public.booking_pickup_slots
  where booking_id='d4000000-0000-4000-8000-000000000001' and kind='pickup'));
end;
$$;

set local role authenticated;
select pg_temp.window_login(1);
select throws_ok($$select public.owner_save_listing_flow('d3000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='d3000000-0000-4000-8000-000000000001'),
 '{}',null,true)$$,
 '55000','Confirm the pickup location to determine its timezone before publishing',
 'A retained pickup location needs a timezone before publication');
select lives_ok($$update public.listing_pickup_locations set time_zone='America/New_York'
 where listing_id='d3000000-0000-4000-8000-000000000001'$$,
 'Timezone metadata can be filled without moving a reserved pickup address');
reset role;

select is((select starts_at from public.handoff_slot_bounds('2027-03-13','morning','America/New_York')),
 '2027-03-13 14:00Z'::timestamptz,'Morning before DST uses the location standard offset');
select is((select starts_at from public.handoff_slot_bounds('2027-03-14','morning','America/New_York')),
 '2027-03-14 13:00Z'::timestamptz,'Morning after DST uses the location daylight offset');
select is((select ends_at-starts_at from public.handoff_slot_bounds('2027-03-14','morning','America/New_York')),
 interval '3 hours','Morning is three hours, not thirty minutes');
select is((select ends_at-starts_at from public.handoff_slot_bounds('2027-03-14','afternoon','America/New_York')),
 interval '5 hours','Afternoon is five hours');
select is((select ends_at-starts_at from public.handoff_slot_bounds('2027-03-14','evening','America/New_York')),
 interval '4 hours','Evening is four hours');
set local timezone='Pacific/Honolulu';
select is((select starts_at from public.handoff_slot_bounds('2027-03-14','morning','America/New_York')),
 '2027-03-14 13:00Z'::timestamptz,'Database session timezone does not change window boundaries');
reset timezone;
select throws_ok($$select public.handoff_slot_bounds(current_date,'morning',null)$$,
 '22023','Choose a valid booking date, handoff window and pickup timezone','No silent timezone fallback');
select throws_ok($$update public.listings set pickup_windows=array['morning',null]
 where id='d3000000-0000-4000-8000-000000000001'$$,
 '23514','Choose at least one pickup and return handoff window','Null availability entries are rejected');
select throws_ok($$update public.listings set return_windows=array['evening','evening']
 where id='d3000000-0000-4000-8000-000000000001'$$,
 '23514','Choose at least one pickup and return handoff window','Duplicate availability entries are rejected');
set local role authenticated;
select pg_temp.window_login(2);
select throws_ok($$select public.propose_booking_handoff_slot('d4000000-0000-4000-8000-000000000001','pickup','morning','')$$,
 '55000','Confirm payment before scheduling pickup','Unpaid bookings cannot propose windows');
reset role;
select public.confirm_booking_payment(id,'cs_window','pi_window',total) from public.bookings
 where id='d4000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.window_login(3);
select throws_ok($$select public.propose_booking_handoff_slot('d4000000-0000-4000-8000-000000000001','pickup','morning','')$$,
 '42501','Only the renter can propose a handoff slot','Unrelated users cannot propose');
select pg_temp.window_login(2);
select throws_ok($$select public.propose_booking_handoff_slot('d4000000-0000-4000-8000-000000000001','pickup','evening','')$$,
 '22023','This window is not available for this listing','Owner availability is enforced');
select lives_ok($$select public.propose_booking_handoff_slot('d4000000-0000-4000-8000-000000000001','pickup','morning','Please include the case.')$$,
 'Renter proposes a full morning with a note');
select is((public.get_booking_precheckin('d4000000-0000-4000-8000-000000000001')->>'time_zone'),
 'America/New_York','UI receives location timezone before selecting a window');
select is((select selected_date from public.booking_pickup_slots where booking_id='d4000000-0000-4000-8000-000000000001'),
 current_date+3,'Pickup uses the booking date without another date input');
select throws_ok($$select pg_temp.respond_window(true)$$,
 '42501','Only the owner can approve the handoff slot','Renter cannot approve their proposal');
reset role;
create temporary table first_proposal as select updated_at from public.booking_pickup_slots
 where booking_id='d4000000-0000-4000-8000-000000000001';
grant select on first_proposal to authenticated;
set local role authenticated;
select pg_temp.window_login(2);
select public.propose_booking_handoff_slot('d4000000-0000-4000-8000-000000000001','pickup','morning','Please include the charger too.');
select pg_temp.window_login(1);
select throws_ok($$select public.respond_to_booking_handoff_slot('d4000000-0000-4000-8000-000000000001',
 'pickup',true,(select updated_at from first_proposal))$$,
 '55000','This slot changed or is no longer available. Refresh check-in.','A changed note invalidates stale owner approval');
select lives_ok($$select pg_temp.respond_window(false)$$,'Owner can decline');
select pg_temp.window_login(2);
select public.propose_booking_handoff_slot('d4000000-0000-4000-8000-000000000001','pickup','afternoon','Please include the charger too.');
select pg_temp.window_login(1);
select lives_ok($$select pg_temp.respond_window(true)$$,'Owner approves the replacement proposal');
select pg_temp.window_login(2);
select is((public.get_booking_precheckin('d4000000-0000-4000-8000-000000000001')->>'handoff_ready')::boolean,false,
 'Approval does not bypass the agreed handoff time');
reset role;
select is((select count(*) from public.notifications where user_id='d0000000-0000-4000-8000-000000000001'
 and event_key like 'pickup-slot-proposed:d4000000-0000-4000-8000-000000000001:%'),3::bigint,
 'Each distinct reproposal notifies the owner, even for the same window');
update public.bookings set status='active' where id='d4000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.window_login(2);
select lives_ok($$select public.propose_booking_handoff_slot('d4000000-0000-4000-8000-000000000001','return','evening','Everything repacked.')$$,
 'Renter proposes return with the same window-plus-note flow');
select is((select selected_date from public.booking_pickup_slots where booking_id='d4000000-0000-4000-8000-000000000001' and kind='return'),
 current_date+4,'Return is fixed to the booked end date');
select pg_temp.window_login(1);
select lives_ok($$select public.respond_to_booking_handoff_slot('d4000000-0000-4000-8000-000000000001','return',true,
 (select updated_at from public.booking_pickup_slots where booking_id='d4000000-0000-4000-8000-000000000001' and kind='return'))$$,
 'Owner approves return separately from pickup');
select pg_temp.window_login(2);
select throws_ok($$select public.start_booking_return('d4000000-0000-4000-8000-000000000001')$$,
 '55000','Get owner approval for the return window before starting return','New rentals cannot return outside the approved window');
reset role;
select throws_ok($$update public.bookings set return_scheduling_required=false where id='d4000000-0000-4000-8000-000000000001'$$,
 '42501','Booking return scheduling policy is immutable','Return scheduling cannot be bypassed by changing the policy');
update public.booking_pickup_slots set starts_at=clock_timestamp()+interval '1 hour',ends_at=clock_timestamp()+interval '6 hours'
 where booking_id='d4000000-0000-4000-8000-000000000001' and kind='return';
select is(public.process_handoff_window_reminders(),2,'Both participants receive the upcoming return reminder');
select is(public.process_handoff_window_reminders(),0,'Reminder retries do not duplicate notifications');
set local role authenticated;
select pg_temp.window_login(2);
select is(public.get_booking_precheckin('d4000000-0000-4000-8000-000000000001')->'return_rules',
 '["Return all accessories"]'::jsonb,'Owner return rules reach check-out');
reset role;
update public.booking_pickup_slots set starts_at=clock_timestamp()-interval '1 hour',
 ends_at=clock_timestamp()+interval '1 hour',
 selected_date=(clock_timestamp() at time zone 'America/New_York')::date
 where booking_id='d4000000-0000-4000-8000-000000000001' and kind='return';
alter table public.bookings disable trigger user;
update public.bookings set start_date=(clock_timestamp() at time zone 'America/New_York')::date-1,
 end_date=(clock_timestamp() at time zone 'America/New_York')::date
 where id='d4000000-0000-4000-8000-000000000001';
alter table public.bookings enable trigger user;
alter table public.listings disable trigger user;
update public.listings set availability_start=(clock_timestamp() at time zone 'America/New_York')::date-1
 where id='d3000000-0000-4000-8000-000000000001';
alter table public.listings enable trigger user;
set local role authenticated;
select pg_temp.window_login(2);
select lives_ok($$select public.start_booking_return('d4000000-0000-4000-8000-000000000001')$$,
 'An approved current return window unlocks return');
reset role;
select * from finish();
rollback;
