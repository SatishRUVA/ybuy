begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('e1000000-0000-4000-8000-000000000001','same-day-owner@test.invalid'),
 ('e1000000-0000-4000-8000-000000000002','same-day-renter@test.invalid');
insert into auth.sessions(id,user_id) select
 ('e2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,2) n;
insert into public.categories(id,name) values('e3000000-0000-4000-8000-000000000001','Same-day fixture');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,estimated_value,item_condition,available_quantity)
values('e4000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
 'e3000000-0000-4000-8000-000000000001','Same-day fixture item','A same-day calendar fixture.',2,10,'good',2);
insert into public.listing_images(listing_id,url,sort_order)
values('e4000000-0000-4000-8000-000000000001','https://example.test/same-day.jpg',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude,time_zone)
values('e4000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
 'Private fixture','Fixture','TX','75201','US',32.8,-96.8,
 case when extract(hour from current_timestamp at time zone 'UTC')<12 then 'Etc/GMT+12' else 'Etc/GMT-14' end);
create temporary table calendar as select time_zone as zone,
 (current_timestamp at time zone time_zone)::date as today
 from public.listing_pickup_locations where listing_id='e4000000-0000-4000-8000-000000000001';
grant select on calendar to authenticated,anon;
set local timezone='UTC';
select isnt((select today from calendar),current_date,'Fixture location date differs from UTC');
select is(public.listing_local_today('e4000000-0000-4000-8000-000000000001'),
 (select today from calendar),'Authoritative today is the pickup calendar');
select ok(not has_function_privilege('anon','public.listing_local_today(uuid)','execute'),
 'Private listing date helper is not exposed');

set local role authenticated;
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000001","exp":4102444800}';
insert into public.listings(id,owner_id,category_id,title,price_per_day)
values('e4000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001',
 'e3000000-0000-4000-8000-000000000001','Unlocated same-day draft',2);
select lives_ok($$select public.owner_save_listing_flow('e4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='e4000000-0000-4000-8000-000000000002'),
 jsonb_build_object('availability_start',(select today from calendar),'availability_end',(select today+2 from calendar),
 'availability_timezone',(select zone from calendar)))$$,
 'Wizard saves today before pickup location is entered');
select lives_ok($$select public.owner_save_listing_flow('e4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='e4000000-0000-4000-8000-000000000001'),
 jsonb_build_object('availability_start',(select today from calendar),'availability_end',(select today+2 from calendar)),
 null,true)$$,'Create and publish availability starting today at pickup');
select is((select status from public.listings where id='e4000000-0000-4000-8000-000000000001'),
 'published','Eligible same-day listing is published immediately');
select throws_ok($$update public.listings set availability_start=(select today-1 from calendar)
 where id='e4000000-0000-4000-8000-000000000001'$$,
 '23514','Choose dates from today through 180 days from today','Past pickup-local listing dates remain rejected');
select is(public.get_listing_time_zone('e4000000-0000-4000-8000-000000000001'),
 (select zone from calendar),'Public calendar exposes only the timezone, not the address');
select lives_ok($$select public.owner_save_listing_availability('e4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='e4000000-0000-4000-8000-000000000001'),
 (select today from calendar),(select today+2 from calendar),array[]::date[],'UTC')$$,
 'Availability management ignores device timezone once pickup is confirmed');

set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000002","exp":4102444800}';
set local timezone='UTC';
select lives_ok($$select public.create_booking_request('e4000000-0000-4000-8000-000000000001',
 (select today from calendar),(select today+1 from calendar),1,'pickup','')$$,
 'Renter books pickup today and return tomorrow even when UTC date differs');
select is((select start_date from public.bookings where listing_id='e4000000-0000-4000-8000-000000000001'),
 (select today from calendar),'Booking keeps the selected local date');
select is((select status from public.bookings where listing_id='e4000000-0000-4000-8000-000000000001'),
 'requested','Same-day booking does not bypass owner approval');
select is((select days from public.bookings where listing_id='e4000000-0000-4000-8000-000000000001'),
 1,'One-day rental is charged as one day');
select throws_ok($$select public.create_booking_request('e4000000-0000-4000-8000-000000000001',
 (select today-1 from calendar),(select today+1 from calendar),1)$$,
 '23P01','Listing is not available for the requested dates and quantity','Booking cannot start yesterday at pickup');
select throws_ok($$select public.create_booking_request('e4000000-0000-4000-8000-000000000001',
 (select today from calendar),(select today from calendar),1)$$,
 '23P01','Listing is not available for the requested dates and quantity','Pickup and return must remain different dates');
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.respond_to_booking_request(
 (select id from public.bookings where listing_id='e4000000-0000-4000-8000-000000000001'),true)$$,
 'Owner can approve same-day booking across UTC midnight');
select is((select status from public.bookings where listing_id='e4000000-0000-4000-8000-000000000001'),
 'pending_payment','Payment is still required after owner approval');
reset role;
update public.bookings set status='cancelled' where listing_id='e4000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into public.listing_availability(listing_id,date,is_available)
values('e4000000-0000-4000-8000-000000000001',(select today from calendar),false);
set local timezone='UTC';
select ok(public.get_listing_unavailable_dates('e4000000-0000-4000-8000-000000000001')->'blocked'
 @> jsonb_build_array((select today from calendar)),'Default availability lookup includes local today');
select ok(public.get_listing_unavailable_dates_for_quantity('e4000000-0000-4000-8000-000000000001',2)->'blocked'
 @> jsonb_build_array((select today from calendar)),'Quantity availability also includes local today');
reset role;
delete from public.listing_availability where listing_id='e4000000-0000-4000-8000-000000000001';
set local role anon;
select is((select listing_count from public.get_listing_category_counts()
 where category_id='e3000000-0000-4000-8000-000000000001'),1::bigint,
 'Category counts include listings available today at pickup, excluding drafts');
select is((public.search_available_listings(p_start_date=>(select today from calendar),
 p_end_date=>(select today+1 from calendar),p_keyword=>'Same-day fixture item')->>'total')::integer,
 1,'Same-day listing remains discoverable using pickup-local rental dates');
reset role;
select * from finish();
rollback;
