begin;
set local timezone='America/Chicago';
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('a9100000-0000-4000-8000-000000000001','pickup-publication@example.test');
insert into auth.sessions(id,user_id) values
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001');
insert into public.categories(id,name) values
 ('a9300000-0000-4000-8000-000000000001','Pickup publication fixture');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,estimated_value,item_condition,
 availability_start,availability_end)
select ('a9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'a9100000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001',
 'Cordless drill','A cordless drill with two batteries.',10,200,'good',current_date,current_date+7
from generate_series(1,3) n;
insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/pickup-'||id||'.png',0 from public.listings
where id in ('a9400000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000002',
 'a9400000-0000-4000-8000-000000000003');
insert into public.listing_photo_reviews(listing_id,photo_url,decision,reason,review_method)
select listing_id,url,'approved','Approved fixture photo.','ai' from public.listing_images
where listing_id in ('a9400000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000002',
 'a9400000-0000-4000-8000-000000000003');

set local role authenticated;
set local request.jwt.claims='{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a9200000-0000-4000-8000-000000000001","exp":4102444800}';

select lives_ok($$select public.owner_save_listing_flow('a9400000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000001'),'{}',
 '{"formattedAddress":"123 Test Lane","streetAddress":"123 Test Lane","city":"Austin","state":"TX","postalCode":"78701","country":"US","latitude":null,"longitude":null,"placeId":"","timeZone":"America/Chicago"}',true)$$,
 'A first-time manual address and publication save atomically');
select is((select time_zone from public.listing_pickup_locations where listing_id='a9400000-0000-4000-8000-000000000001'),
 'America/Chicago','Manual pickup time zone is persisted before publication');
select ok((select status in ('published','pending_approval') from public.listings where id='a9400000-0000-4000-8000-000000000001'),
 'Manual address publication is confirmed by the server');

select lives_ok($$select public.owner_save_listing_flow('a9400000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000002'),'{}',
 '{"formattedAddress":"456 Test Lane","streetAddress":"456 Test Lane","city":"Austin","state":"TX","postalCode":"78701","country":"US","latitude":30.27,"longitude":-97.74,"placeId":"fixture-place","timeZone":"America/Chicago"}',true)$$,
 'A first-time geocoded address and publication save atomically');
select is((select time_zone from public.listing_pickup_locations where listing_id='a9400000-0000-4000-8000-000000000002'),
 'America/Chicago','Geocoded pickup time zone is persisted before publication');
select lives_ok($$select public.owner_save_listing_flow('a9400000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000002'),'{}',
 '{"formattedAddress":"456 Test Lane","streetAddress":"456 Test Lane","city":"Austin","state":"TX","postalCode":"78701","country":"US","latitude":30.28,"longitude":-97.75,"placeId":"fixture-place-updated","timeZone":"America/Chicago"}',false)$$,
 'Updating coordinates and their time zone remains atomic');

select throws_ok($$select public.owner_save_listing_flow('a9400000-0000-4000-8000-000000000003',
 (select revision from public.listings where id='a9400000-0000-4000-8000-000000000003'),'{}',
 '{"formattedAddress":"789 Test Lane","streetAddress":"789 Test Lane","city":"Austin","state":"TX","postalCode":"","country":"US","latitude":null,"longitude":null,"placeId":"","timeZone":"America/Chicago"}',true)$$,
 '23514',null,'Incomplete manual addresses remain blocked');
select is((select status from public.listings where id='a9400000-0000-4000-8000-000000000003'),
 'draft','Failed publication preserves draft status');
select is((select count(*)::integer from public.listing_pickup_locations where listing_id='a9400000-0000-4000-8000-000000000003'),
 0,'Failed publication rolls back the pickup address');

select * from finish();
rollback;
