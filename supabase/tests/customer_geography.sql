begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('a9000000-0000-4000-8000-000000000001','geography-owner@example.test'),
 ('a9000000-0000-4000-8000-000000000002','geography-renter@example.test');
insert into auth.sessions(id,user_id) values
 ('a9100000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001'),
 ('a9100000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000002');
create temp table original_identity as select customer_id from public.profiles where id='a9000000-0000-4000-8000-000000000001';
grant select on original_identity to authenticated;
set local role anon;
select is((select count(*)::integer from public.reference_countries),249,'Reference covers 249 countries and territories');
select ok(exists(select 1 from public.reference_regions where country_code='US' and code='US-TX'),'Country/subdivision validation uses real reference rows');
select throws_ok($$select country_code from public.profiles$$,'42501',null,'Country is not exposed through public profile joins');
select throws_ok($$insert into public.reference_countries values('XX','Invented')$$,'42501',null,'Clients cannot invent allowed countries');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a9100000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$update public.profiles set country_code='US',state_region_code='US-TX' where id=auth.uid()$$,'Customer saves a valid country and subdivision');
select is((select country_code from public.get_my_profile()),'US','Own profile returns private country');
select ok((select location_updated_at is not null from public.get_my_profile()),'Country changes receive a server-generated location timestamp');
select throws_ok($$update public.profiles set location_updated_at='2000-01-01' where id=auth.uid()$$,
 '42501','Location timestamps are assigned by the server','Client cannot forge a location-update timestamp');
select is((select customer_id from public.get_my_profile()),(select customer_id from original_identity),'Country does not change permanent identity');
select throws_ok($$update public.profiles set state_region_code='CA-ON' where id=auth.uid()$$,'23503',null,'A Canadian subdivision cannot be attached to a US profile');
select throws_ok($$update public.profiles set country_code='XX',state_region_code=null where id=auth.uid()$$,'23503',null,'Invented country is rejected server-side');
select throws_ok($$update public.profiles set country_code=null where id=auth.uid()$$,'23514',null,'A region cannot exist without a country');
select lives_ok($$update public.profiles set country_code='IN',state_region_code='IN-DL' where id='a9000000-0000-4000-8000-000000000002'$$,'Cross-account updates do not leak affected data');
reset role;
select is((select country_code from public.profiles where id='a9000000-0000-4000-8000-000000000002'),null,'RLS prevented changing the other profile');
update public.profiles set country_code='IN',state_region_code='IN-DL' where id='a9000000-0000-4000-8000-000000000002';
insert into public.categories(id,name) values('a9200000-0000-4000-8000-000000000001','Geography fixture');
insert into public.listings(id,owner_id,category_id,title,price_per_day,status,estimated_value,item_condition)
values('a9300000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001','a9200000-0000-4000-8000-000000000001','Geography camera',10,'published',200,'good');
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,total,status)
values('a9400000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001',
 'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000002',current_date+200,current_date+202,10,2,20,.1,2,22,'pending_payment');
select is((select owner_country_code from public.bookings where id='a9400000-0000-4000-8000-000000000001'),'US','Transaction snapshots Owner country');
select is((select renter_state_region_code from public.bookings where id='a9400000-0000-4000-8000-000000000001'),'IN-DL','Transaction snapshots Renter subdivision');
select is((select currency from public.bookings where id='a9400000-0000-4000-8000-000000000001'),'USD','Currency is explicit and not inferred from Indian or US account country');
update public.profiles set country_code='CA',state_region_code='CA-ON' where id='a9000000-0000-4000-8000-000000000002';
select is((select renter_country_code from public.bookings where id='a9400000-0000-4000-8000-000000000001'),'IN','A profile move never rewrites transaction geography');
select is((select snapshot->>'renter_country_code' from public.rental_agreements where booking_id='a9400000-0000-4000-8000-000000000001'),'IN','Immutable agreement includes historical transaction country');
select throws_ok($$update public.bookings set renter_country_code='CA' where id='a9400000-0000-4000-8000-000000000001'$$,
 '42501','Transaction geography and currency are immutable','Even trusted edits cannot rewrite transaction geography');
select lives_ok($$update public.profiles set country_code='CA',state_region_code=null where id='a9000000-0000-4000-8000-000000000002'$$,'Subdivision remains optional');
select * from finish();
rollback;
