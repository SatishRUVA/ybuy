begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('a9300000-0000-4000-8000-000000000001','package-owner@example.test','{"full_name":"Package owner"}');
insert into auth.sessions(id,user_id) values
 ('a9400000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001');
insert into public.categories(id,name) values
 ('a9500000-0000-4000-8000-000000000001','Package-rate test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,price_per_week,price_per_month,
 weekly_discount_enabled,weekly_discount_percent,monthly_discount_enabled,monthly_discount_percent,
 status,estimated_value,item_condition,availability_start,availability_end)
values('a9600000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001',
 'a9500000-0000-4000-8000-000000000001','Independent package rates','Pricing test listing.',10,50,120,
 true,20,true,30,'draft',200,'good',current_date+1,current_date+30);
insert into public.listing_images(listing_id,url,sort_order) values
 ('a9600000-0000-4000-8000-000000000001','https://example.test/package-rates.png',0);
insert into public.listing_photo_reviews(listing_id,photo_url,decision,reason,review_method) values
 ('a9600000-0000-4000-8000-000000000001','https://example.test/package-rates.png','approved','Fixture photo approved','system');
insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,time_zone,latitude,longitude) values
 ('a9600000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001',
 'Private pickup','100 Main Street','Dallas','TX','75201','US','America/Chicago',32.8,-96.8);
update public.feature_flags set enabled=true where key='duration_discounts';
update public.listings set status='published' where id='a9600000-0000-4000-8000-000000000001';

select is((public.calculate_listing_rental_amount('a9600000-0000-4000-8000-000000000001',7,1)->>'rental_subtotal')::numeric,
 50::numeric,'Dedicated weekly rate replaces the legacy weekly discount');
select is((public.calculate_listing_rental_amount('a9600000-0000-4000-8000-000000000001',10,1)->>'rental_subtotal')::numeric,
 80::numeric,'Extra days use the daily rate after the dedicated weekly package');
select is((public.calculate_listing_rental_amount('a9600000-0000-4000-8000-000000000001',30,1)->>'rental_subtotal')::numeric,
 120::numeric,'Dedicated monthly rate is independent of the daily rate');
select is((public.get_listing_pricing_quotes('a9600000-0000-4000-8000-000000000001',array[7,10,30],1)
  ->'quotes'->1->>'rental_subtotal'),'80.00','Public quote uses the same server-side package engine');
select is((public.get_listing_pricing_quotes('a9600000-0000-4000-8000-000000000001',array[7],1)
  ->'quotes'->0->>'renter_checkout_total'),'58.85','Renter quote separates service fee and tax from owner earnings');

set local role authenticated;
set local request.jwt.claims='{"sub":"a9300000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a9400000-0000-4000-8000-000000000001","exp":4102444800}';
select is((public.get_owner_listing_earnings_quote(
 'a9600000-0000-4000-8000-000000000001',10,50,120,true,20,true,30,10,1)->>'rental_subtotal')::numeric,
 80::numeric,'Owner preview returns authoritative package pricing');
select is((public.get_owner_listing_earnings_quote(
 'a9600000-0000-4000-8000-000000000001',10,50,120,true,20,true,30,10,1)->>'estimated_owner_net')::numeric,
 80::numeric,'Owner preview deducts only the owner fee share');
select throws_ok($$select public.get_owner_listing_earnings_quote(
 'a9600000-0000-4000-8000-000000000001',10,50,120,true,20,true,30,0,1)$$,
 '22023','Choose a rental length from 1 to 366 days and a quantity from 1 to 100',
 'Owner quote rejects invalid rental lengths');
reset role;

update public.listings set price_per_week=null,price_per_month=null
 where id='a9600000-0000-4000-8000-000000000001';
select is((public.calculate_listing_rental_amount('a9600000-0000-4000-8000-000000000001',7,1)->>'rental_subtotal')::numeric,
 56::numeric,'Legacy weekly discount remains the fallback without a dedicated rate');
update public.feature_flags set enabled=false where key='duration_discounts';
select is((public.calculate_listing_rental_amount('a9600000-0000-4000-8000-000000000001',7,1)->>'rental_subtotal')::numeric,
 70::numeric,'Legacy duration discounts remain disabled when the feature flag is off');

select * from finish();
rollback;
