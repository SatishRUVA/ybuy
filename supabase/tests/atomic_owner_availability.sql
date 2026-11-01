begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('a9100000-0000-4000-8000-000000000001','atomic-owner@example.test'),
 ('a9100000-0000-4000-8000-000000000002','atomic-renter@example.test');
insert into auth.sessions(id,user_id) values
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001'),
 ('a9200000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000002');
insert into public.categories(id,name) values('a9300000-0000-4000-8000-000000000001','Atomic availability fixture');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,estimated_value,item_condition,
 availability_start,availability_end,brand,model)
values('a9400000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001',
 'a9300000-0000-4000-8000-000000000001','Atomic camera','A camera with carrying case.',20,100,'good',current_date,current_date+20,'Sony','FX3');
insert into public.listing_availability(listing_id,date,is_available)
values('a9400000-0000-4000-8000-000000000001',current_date+2,false);
select ok(not has_function_privilege('anon','public.owner_save_listing_availability(uuid,bigint,date,date,date[],text)','execute'),'Anonymous callers cannot execute availability updates');

set local role authenticated;
set local request.jwt.claims='{"sub":"a9100000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a9200000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.owner_save_listing_availability('a9400000-0000-4000-8000-000000000001',1,current_date,current_date+10,'{}')$$,
 '42501','Listing not found or not owned','Authenticated renter cannot call owner RPC');
select throws_ok($$insert into public.listing_availability(listing_id,date,is_available) values('a9400000-0000-4000-8000-000000000001',current_date+3,false)$$,
 '42501','new row violates row-level security policy for table "listing_availability"','RLS denies renter direct writes');
set local request.jwt.claims='{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a9200000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.owner_save_listing_availability('a9400000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000001'),current_date,current_date+15,array[current_date+3,current_date+4])$$,
 'Owner atomically saves window and replaces blocked dates');
select is((select availability_end from public.listings where id='a9400000-0000-4000-8000-000000000001'),current_date+15,'Window confirmed');
select is((select array_agg(date order by date) from public.listing_availability where listing_id='a9400000-0000-4000-8000-000000000001' and not is_available),
 array[current_date+3,current_date+4],'Complete blocked-day replacement confirmed');

reset role;
create function public.atomic_availability_test_failure() returns trigger language plpgsql as $$
begin
  if new.date=current_date+6 then raise exception 'Injected second-day failure' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger zz_atomic_availability_test_failure before insert on public.listing_availability
 for each row execute function public.atomic_availability_test_failure();
create temporary table atomic_before as select revision,availability_end from public.listings where id='a9400000-0000-4000-8000-000000000001';
grant select on atomic_before to authenticated;
set local role authenticated;
select throws_ok($$select public.owner_save_listing_availability('a9400000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000001'),current_date,current_date+12,array[current_date+5,current_date+6])$$,
 '23514','Injected second-day failure','Late failure aborts the entire authoritative update');
select is((select revision from public.listings where id='a9400000-0000-4000-8000-000000000001'),(select revision from atomic_before),'Failed replacement rolls back listing revision');
select is((select availability_end from public.listings where id='a9400000-0000-4000-8000-000000000001'),(select availability_end from atomic_before),'Failed replacement rolls back window');
select is((select array_agg(date order by date) from public.listing_availability where listing_id='a9400000-0000-4000-8000-000000000001' and not is_available),
 array[current_date+3,current_date+4],'Failed replacement rolls back prior deletes and first inserted day');
select throws_ok($$select public.owner_save_listing_availability('a9400000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000001'),current_date,current_date+12,array[current_date+12])$$,
 '22023','Choose a valid availability window and unique blocked rental days, keeping at least one day open','Exclusive return date cannot be blocked');
select throws_ok($$select public.owner_save_listing_availability('a9400000-0000-4000-8000-000000000001',0,current_date,current_date+12,'{}')$$,
 '40001','This listing changed in another session. Reload before saving.','Stale revision fails closed');
reset role;
drop trigger zz_atomic_availability_test_failure on public.listing_availability;
insert into public.listing_images(listing_id,url,sort_order)
values('a9400000-0000-4000-8000-000000000001','https://example.test/atomic-camera.png',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,latitude,longitude)
values('a9400000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','123 Main Street','123 Main Street','Dallas','TX','75201','US',32.8,-96.8);
update public.listings set status='published' where id='a9400000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"a9100000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a9200000-0000-4000-8000-000000000002","exp":4102444800}';
select lives_ok($$select public.create_booking_request('a9400000-0000-4000-8000-000000000001',current_date+7,current_date+9,1)$$,'Renter reserves available days through real booking RPC');
set local request.jwt.claims='{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a9200000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.owner_save_listing_availability('a9400000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000001'),current_date,current_date+12,array[current_date+5,current_date+7])$$,
 '23514','Keep reserved rental days inside the availability window and unblocked','Blocking a reserved day rejects the whole update');
select throws_ok($$select public.owner_save_listing_availability('a9400000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000001'),current_date,current_date+8,array[current_date+5])$$,
 '23514','Keep reserved rental days inside the availability window and unblocked','Shrinking the window cannot exclude reserved rental days');
select is((select array_agg(date order by date) from public.listing_availability where listing_id='a9400000-0000-4000-8000-000000000001' and not is_available),
 array[current_date+3,current_date+4],'Booking-guard failures leave all blocked days intact');
set local request.jwt.claims='{}';
select throws_ok($$select public.owner_save_listing_availability('a9400000-0000-4000-8000-000000000001',1,current_date,current_date+12,'{}')$$,
 '42501','Active session required','Revoked or missing sessions fail closed');
reset role;
select * from finish();
rollback;
