begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local timezone='UTC';
create temporary table hour_calendar as
select name as zone,(current_timestamp at time zone name)::date as today,
 extract(hour from current_timestamp at time zone name)::integer as hour
from pg_catalog.pg_timezone_names
where name like 'Etc/%' and extract(hour from current_timestamp at time zone name) between 9 and 15
 and (current_timestamp at time zone name)::date>=current_date
order by name limit 1;
grant select on hour_calendar to authenticated;

insert into auth.users(id,email) values
 ('f1000000-0000-4000-8000-000000000001','hour-owner@test.invalid'),
 ('f1000000-0000-4000-8000-000000000002','hour-renter@test.invalid');
insert into auth.sessions(id,user_id) select
 ('f2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('f1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,2) n;
insert into public.categories(id,name) values('f3000000-0000-4000-8000-000000000001','Hourly fixture');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,estimated_value,item_condition,
 availability_start,availability_end,pickup_windows,return_windows)
values('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
 'f3000000-0000-4000-8000-000000000001','Hourly item','Hourly fixture',2,10,'good',
 current_date,current_date+10,array['morning','afternoon'],array['evening']);
insert into public.listing_images(listing_id,url,sort_order)
values('f4000000-0000-4000-8000-000000000001','https://example.test/hour.jpg',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude,time_zone)
values('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
 'Private fixture','Fixture','TX','75201','US',32.8,-96.8,(select zone from hour_calendar));
update public.listings set status='published' where id='f4000000-0000-4000-8000-000000000001';
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,
 service_fee_pct,service_fee_amount,deposit,total,status,payment_first)
values('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',
 'f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002',
 (select today from hour_calendar),(select today+1 from hour_calendar),2,1,2,.1,.2,0,2.2,'pending_payment',true);

create function pg_temp.hour_login(n int) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
 'sub','f1000000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated',
 'session_id','f2000000-0000-4000-8000-'||lpad(n::text,12,'0'),'exp',4102444800)::text,true);
end;
$$;
create function pg_temp.propose_hour(hour int) returns void language plpgsql as $$
begin
 perform public.propose_booking_handoff_slot_at_hour('f5000000-0000-4000-8000-000000000001',
  'pickup',case when hour<12 then 'morning' when hour<17 then 'afternoon' else 'evening' end,hour,'Include the case.');
end;
$$;
select is((select starts_at from public.handoff_hour_bounds('2027-03-13','morning',7,'America/New_York')),
 '2027-03-13 12:00Z'::timestamptz,'7 am before DST uses location standard time');
select is((select starts_at from public.handoff_hour_bounds('2027-03-14','morning',7,'America/New_York')),
 '2027-03-14 11:00Z'::timestamptz,'7 am after DST uses location daylight time');
select is((select ends_at-starts_at from public.handoff_hour_bounds('2027-03-14','evening',19,'America/New_York')),
 interval '1 hour','Last evening start reserves 7-8 pm, not thirty minutes');
select throws_ok($$select public.handoff_hour_bounds(current_date,'morning',12,'UTC')$$,
 '22023','Choose an available hour in the pickup location timezone','Hour must match its owner group');
select throws_ok($$select public.handoff_hour_bounds(current_date,'evening',20,'UTC')$$,
 '22023','Choose an available hour in the pickup location timezone','8 pm is not an offered start');
set local role authenticated;
select pg_temp.hour_login(2);
select throws_ok($$select pg_temp.propose_hour(16)$$,'55000','Confirm payment before scheduling pickup',
 'Hourly slots still require payment');
reset role;
select public.confirm_booking_payment(id,'cs_hour','pi_hour',total) from public.bookings
where id='f5000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.hour_login(1);
select throws_ok($$select pg_temp.propose_hour(16)$$,'42501','Only the renter can propose a handoff slot',
 'Owner cannot impersonate the renter');
select pg_temp.hour_login(2);
select throws_ok($$select pg_temp.propose_hour(19)$$,'22023','This window is not available for this listing',
 'Owner pickup groups remain authoritative');
select throws_ok($$select pg_temp.propose_hour((select hour from hour_calendar))$$,
 '22023','This handoff time has passed. Choose a future hour, or request a rental extension for a changed return date.',
 'Current hour is rejected even though its one-hour window has not ended');
select lives_ok($$select pg_temp.propose_hour((select hour+1 from hour_calendar))$$,
 'Next future hour is accepted with no extra lead time');
select is((select selected_date from public.booking_pickup_slots where booking_id='f5000000-0000-4000-8000-000000000001'),
 (select today from hour_calendar),'Hourly pickup date remains the booking start date');
select is((select extract(hour from starts_at at time zone time_zone)::integer from public.booking_pickup_slots
 where booking_id='f5000000-0000-4000-8000-000000000001'),(select hour+1 from hour_calendar),
 'Selected hour is persisted in the pickup timezone, not session UTC');
select is((select ends_at-starts_at from public.booking_pickup_slots where booking_id='f5000000-0000-4000-8000-000000000001'),
 interval '1 hour','Persisted access window matches the displayed hourly choice');
select is((select note from public.booking_pickup_slots where booking_id='f5000000-0000-4000-8000-000000000001'),
 'Include the case.','Optional note is preserved with the selected hour');
select pg_temp.hour_login(1);
select ok(exists(select 1 from public.notifications where user_id=auth.uid()
 and title='Review the proposed pickup window' and body like '% at %' and body like '%Include the case.%'),
 'Owner notification contains selected time and note');
select lives_ok($$select public.respond_to_booking_handoff_slot('f5000000-0000-4000-8000-000000000001','pickup',true,
 (select updated_at from public.booking_pickup_slots where booking_id='f5000000-0000-4000-8000-000000000001'))$$,
 'Owner approves the hourly proposal using its version');
select pg_temp.hour_login(2);
select throws_ok($$select pg_temp.propose_hour(16)$$,'55000','The agreed slot is locked; contact support to reschedule',
 'Approved hour cannot be silently changed');
reset role;
select throws_ok($$select public.require_booking_precheckin('f5000000-0000-4000-8000-000000000001',auth.uid(),true)$$,
 '55000','Deposit authorization opens 24 hours before the slot; handoff is available only during the agreed slot',
 'Physical pickup cannot start before the agreed hour');
reset role;
update public.bookings set status='active' where id='f5000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.hour_login(2);
select lives_ok($$select public.propose_booking_handoff_slot_at_hour('f5000000-0000-4000-8000-000000000001',
 'return','evening',19,'Returning all accessories.')$$,'Return uses the same hourly scheduling');
select is((select selected_date from public.booking_pickup_slots where booking_id='f5000000-0000-4000-8000-000000000001' and kind='return'),
 (select today+1 from hour_calendar),'Return date stays fixed to the booking end date');
reset role;
select * from finish();
rollback;
