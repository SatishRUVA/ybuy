begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('91000000-0000-4000-8000-000000000001','directory-owner@example.test');
insert into public.categories(id,name) values
 ('93000000-0000-4000-8000-000000000001','Directory tools'),
 ('93000000-0000-4000-8000-000000000002','Directory cameras');
update public.feature_flags set enabled=true where key='bidding';
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end,brand,model,auction_enabled,auction_start_date,auction_end_date)
select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '91000000-0000-4000-8000-000000000001',
 case when n=27 then '93000000-0000-4000-8000-000000000002'::uuid else '93000000-0000-4000-8000-000000000001'::uuid end,
 'Directory item '||n,'Rental item with a carrying case.',20,'draft',100,'good',0,0,
 current_date+7,current_date+14,'Fixture brand','Fixture model',true,current_date+7,current_date+10
from generate_series(1,27) n;
insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/directory.png',0 from public.listings where owner_id='91000000-0000-4000-8000-000000000001';
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
select id,owner_id,'Private pickup','Dallas','TX','75201','US',0,0
from public.listings where owner_id='91000000-0000-4000-8000-000000000001';
update public.listings set status='published' where owner_id='91000000-0000-4000-8000-000000000001';

select ok(has_function_privilege('anon','public.get_listing_auction_feed(uuid,integer)','EXECUTE'),'Anonymous visitors can browse auctions');
select ok(not has_table_privilege('anon','public.listing_auction_bids','SELECT'),'Directory does not expose private bid ledger');
select is((public.get_listing_auction_feed()->>'total')::integer,27,'All open auctions are included even without a bid');
select is(jsonb_array_length(public.get_listing_auction_feed()->'items'),24,'Results have a bounded 24-item page');
select is(jsonb_array_length(public.get_listing_auction_feed(null,24)->'items'),3,'Remaining auctions can be paginated');
select is((select count(distinct item->>'listing_id')::integer from (
 select jsonb_array_elements(public.get_listing_auction_feed()->'items') item
 union all select jsonb_array_elements(public.get_listing_auction_feed(null,24)->'items')) pages),27,'Pages cover every listing without duplicates');
select is(jsonb_array_length(public.get_listing_auction_feed()->'categories'),2,'Global category choices are returned');
select is((public.get_listing_auction_feed('93000000-0000-4000-8000-000000000002')->>'total')::integer,1,'Category filters are applied before pagination');
select is((public.get_listing_auction_feed('93000000-0000-4000-8000-000000000002')->'items'->0->>'category_name'),'Directory cameras','Results belong to the requested category');
select is((public.get_listing_auction_feed()->'items'->0->>'daily_rate')::numeric,20::numeric,'Unbid auctions display the asking price');
select is((public.get_listing_auction_feed()->'items'->0->>'has_bids')::boolean,false,'Asking prices are not labeled existing bids');
select ok(not (public.get_listing_auction_feed()->'items'->0 ? 'owner_id')
 and not (public.get_listing_auction_feed()->'items'->0 ? 'renter_id'),'Directory omits private identity');
select throws_ok($$select public.get_listing_auction_feed(null,-1)$$,'22023','Choose a valid auction page','Negative offsets fail explicitly');
select throws_ok($$select public.get_listing_auction_feed(null,null)$$,'22023','Choose a valid auction page','Null offsets fail explicitly');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.get_listing_auction_feed()->>'total')::integer,0,'Explore excludes the current owner before counting');
select is(jsonb_array_length(public.get_listing_auction_feed()->'items'),0,'Own auctions are absent from Explore');
select is(jsonb_array_length(public.get_listing_auction_feed(null,24)->'items'),0,'Pagination never returns own auctions');
select is(jsonb_array_length(public.get_listing_auction_feed()->'categories'),0,'Own auctions do not contribute category counts');
select is((public.get_listing_auction_feed('93000000-0000-4000-8000-000000000002')->>'total')::integer,0,'Category filters exclude own auctions');
select is((select count(*)::integer from public.listings where owner_id=auth.uid() and auction_enabled),27,'Own listings remain available for owner management');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.get_listing_auction_feed()->>'total')::integer,27,'Other renters still see eligible auctions');
reset request.jwt.claims;
select is((public.get_listing_auction_feed()->>'total')::integer,27,'Anonymous visitors still see all eligible auctions');
update public.listing_auctions set ends_at=clock_timestamp()-interval '1 second'
 where listing_id='94000000-0000-4000-8000-000000000027';
select is((public.get_listing_auction_feed()->>'total')::integer,26,'Expired auctions disappear from the feed');
select is((public.get_listing_auction_feed('93000000-0000-4000-8000-000000000002')->>'total')::integer,0,'Expired category can return a genuine empty result');
update public.feature_flags set enabled=false where key='bidding';
select is((public.get_listing_auction_feed()->>'total')::integer,0,'Bidding feature flag gates public results');
select is(jsonb_array_length(public.get_listing_auction_feed()->'categories'),0,'Disabled bidding leaks no category activity');
select * from finish();
rollback;
