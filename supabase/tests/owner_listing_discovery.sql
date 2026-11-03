begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('96000000-0000-4000-8000-000000000001','owner@discovery.test'),
 ('96000000-0000-4000-8000-000000000002','renter@discovery.test');
insert into auth.sessions(id,user_id) values
 ('96000000-0000-4000-8000-000000000011','96000000-0000-4000-8000-000000000001'),
 ('96000000-0000-4000-8000-000000000012','96000000-0000-4000-8000-000000000002');
insert into public.categories(id,name) values ('96000000-0000-4000-8000-000000000021','Owner discovery fixtures');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
 availability_start,availability_end,brand,model)
select ('96000000-0000-4000-8000-'||lpad((30+n)::text,12,'0'))::uuid,
 '96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000021',
 'Discovery camera '||n,'Camera with a case and charger.',10+n,'draft',100,'good',current_date,current_date+20,'Sony','FX3'
from generate_series(1,5) n;
insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/camera.png',0 from public.listings where category_id='96000000-0000-4000-8000-000000000021';
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
select id,owner_id,'Private pickup','Dallas','TX','75201','US',32.8,-96.8
from public.listings where category_id='96000000-0000-4000-8000-000000000021';
update public.listings set status='published' where category_id='96000000-0000-4000-8000-000000000021';

-- Reproduce inventory published on an earlier day without changing the clock or publication policy.
alter table public.listings disable trigger b_listing_scheduling_window;
update public.listings set availability_start=current_date-10,availability_end=current_date-1
where id='96000000-0000-4000-8000-000000000031';
update public.listings set availability_start=current_date-10,availability_end=current_date
where id='96000000-0000-4000-8000-000000000032';
alter table public.listings enable trigger b_listing_scheduling_window;

select is((public.search_available_listings(p_category_id=>'96000000-0000-4000-8000-000000000021')->>'total')::integer,3,
 'Search excludes expired-yesterday and end-today listings before counting');
select is(jsonb_array_length(public.search_available_listings(p_category_id=>'96000000-0000-4000-8000-000000000021',p_limit=>2)->'rows'),2,
 'Pagination uses active inventory only');
select is((public.search_available_listings(p_category_id=>'96000000-0000-4000-8000-000000000021',p_limit=>2,p_offset=>2)->>'total')::integer,3,
 'Later pages retain the active total');
select is((public.search_available_listings(p_category_id=>'96000000-0000-4000-8000-000000000021')->'rows'->0->>'availability_end')::date,current_date+20,
 'Search includes the actual exclusive availability end');
select throws_ok($$select public.search_available_listings(p_start_date=>current_date-1,p_end_date=>current_date+1)$$,'22023',
 'Choose both dates, starting today or later, with an end after the start and a range of at most 366 days','Past requested rentals are rejected');

set local role authenticated;
set local request.jwt.claims='{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000011","exp":4102444800}';
select is((select count(*)::integer from public.listings where category_id='96000000-0000-4000-8000-000000000021'),5,
 'Owner can still read expired inventory for recovery');
reset role;
reset request.jwt.claims;
update public.feature_flags set enabled=true where key='bidding';
insert into public.listing_auctions(listing_id,start_date,end_date,opening_daily_rate,status,starts_at,ends_at,created_at)
select id,current_date+7,current_date+10,price_per_day,'open',
 case when id='96000000-0000-4000-8000-000000000034' then now()+interval '1 hour' else now()-interval '1 hour' end,
 now()+interval '2 hours',now()
from public.listings where category_id='96000000-0000-4000-8000-000000000021' and id<>'96000000-0000-4000-8000-000000000035';

select is((select count(*)::integer from jsonb_array_elements(public.get_top_listing_bids()) r
 where r->>'listing_id' like '96000000%'),1,'Ribbon includes zero-bid open auctions but excludes scheduled and expired inventory');
select is((select (r->>'daily_rate')::numeric from jsonb_array_elements(public.get_top_listing_bids()) r
 where r->>'listing_id'='96000000-0000-4000-8000-000000000033'),13::numeric,'Zero-bid ribbon uses the auction opening rate');
select is((select count(*)::integer from jsonb_array_elements(public.get_listing_auction_feed()->'items') r
 where r->>'listing_id' like '96000000%'),1,'Public directory uses the same expiry and opening rules');
set local role authenticated;
set local request.jwt.claims='{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000011","exp":4102444800}';
select is((public.get_listing_auction_feed(p_category_id=>'96000000-0000-4000-8000-000000000021')->>'total')::integer,0,
 'Owner directory still excludes own auctions');
select is((select count(*)::integer from jsonb_array_elements(public.get_top_listing_bids()) r
 where r->>'listing_id' like '96000000%'),1,'Owner can see their new auction in the ribbon');
reset role;
select ok(not exists(select 1 from public.feature_flags where key='private_offers'),'Private offers feature flag is removed');
update public.app_settings set value='2000' where key='listing_max_estimated_value';
select is((public.get_listing_flow_policy()->>'max_estimated_value')::numeric,2000::numeric,
 'Replacement maximum comes from the global listing policy');
select throws_ok($$update public.listings set estimated_value=2000.01 where id='96000000-0000-4000-8000-000000000035'$$,
 '23514',null,'Database rejects values above the configured replacement maximum');
select * from finish();
rollback;
