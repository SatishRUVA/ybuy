begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('91000000-0000-4000-8000-000000000001','schedule-owner@example.test'),
 ('91000000-0000-4000-8000-000000000002','schedule-renter@example.test');
insert into auth.sessions(id,user_id) values
 ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001'),
 ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002');
insert into public.categories(id,name) values('93000000-0000-4000-8000-000000000001','Schedule fixtures');
update public.feature_flags set enabled=true where key='bidding';
update public.app_settings set value='true'::jsonb where key='listing_offers_configured';
update public.app_settings set value='0.2'::jsonb where key='listing_offer_below_pct';
update public.app_settings set value='0.1'::jsonb where key='listing_offer_above_pct';
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end,brand,model)
select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
 'Schedule camera '||n,'Camera with case.',20,'draft',100,'good',0,0,current_date+3,current_date+14,'Sony','FX3'
from generate_series(1,2) n;
insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/schedule.png',0 from public.listings where category_id='93000000-0000-4000-8000-000000000001';
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
select id,owner_id,'Private pickup','Dallas','TX','75201','US',0,0 from public.listings where category_id='93000000-0000-4000-8000-000000000001';
update public.listings set status='published' where id='94000000-0000-4000-8000-000000000001';

create function pg_temp.configure(p_id uuid default '94000000-0000-4000-8000-000000000001',
 p_opens timestamptz default ((current_date+3)::timestamp at time zone 'UTC'),
 p_closes timestamptz default ((current_date+4)::timestamp at time zone 'UTC')-interval '2 hours')
returns jsonb language sql as $$
 select public.owner_configure_listing_negotiation(p_id,(select revision from public.listings where id=p_id),
 jsonb_build_object('negotiation_enabled',true,'offer_minimum_daily',16,'offer_maximum_daily',22,'offer_target_daily',20,
   'offer_start_date',current_date+3,'offer_end_date',current_date+14,'offer_expiration_hours',24),
 jsonb_build_object('enabled',true,'start_date',current_date+4,'end_date',current_date+7,
   'bidding_starts_at',p_opens,'bidding_ends_at',p_closes))
$$;
select ok(not has_function_privilege('anon','public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb)','EXECUTE'),'Anonymous users cannot change negotiation');
select ok(not has_function_privilege('authenticated','public.get_listing_auction_before_schedule(uuid)','EXECUTE'),'Legacy reader is private');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select pg_temp.configure()$$,'42501','Listing not found or not owned','Other renters cannot configure auctions');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select pg_temp.configure('94000000-0000-4000-8000-000000000002')$$,'23514','Publish your listing before configuring negotiation','Drafts cannot use post-publication settings');
select throws_ok($$select pg_temp.configure(p_opens:=((current_date+2)::timestamp at time zone 'UTC'))$$,
 '23514','Bidding must fit published availability and close at least 2 hours before pickup','Opening before availability is rejected');
select is((select negotiation_enabled from public.listings where id='94000000-0000-4000-8000-000000000001'),false,'Failed scheduling rolls back private offers too');
select throws_ok($$select pg_temp.configure(p_closes:=((current_date+4)::timestamp at time zone 'UTC')-interval '119 minutes')$$,
 '23514','Bidding must fit published availability and close at least 2 hours before pickup','Less than two hours before pickup is rejected');
select throws_ok($$select pg_temp.configure(p_closes:=((current_date+15)::timestamp at time zone 'UTC'))$$,
 '23514','Bidding must fit published availability and close at least 2 hours before pickup','Closing after availability is rejected');
select throws_ok($$select pg_temp.configure(p_opens:=clock_timestamp()-interval '1 minute')$$,
 '23514','Bidding must fit published availability and close at least 2 hours before pickup','Past opening is rejected');
select lives_ok($$select pg_temp.configure()$$,'Owner schedules both negotiation modes after publication');
select ok((select negotiation_enabled and auction_enabled from public.listings where id='94000000-0000-4000-8000-000000000001'),'Both modes persist');
select is(public.get_listing_auction('94000000-0000-4000-8000-000000000001')->>'status','scheduled','Reader distinguishes scheduled bidding');
select is((select selection_deadline-ends_at from public.listing_auctions where listing_id='94000000-0000-4000-8000-000000000001'),interval '1 hour','Selection deadline follows the chosen close');
select is((public.get_listing_auction_feed()->>'total')::integer,0,'Scheduled auctions are absent from live feed');
select throws_ok($$update public.listings set availability_end=current_date+15 where id='94000000-0000-4000-8000-000000000001'$$,
 '23514','Auction listing terms cannot change after bidding starts','Scheduled terms are immutable');
select throws_ok($$select public.owner_configure_listing_negotiation('94000000-0000-4000-8000-000000000001',0,'{}','{"enabled":false}')$$,
 '40001','This listing changed in another session. Reload before saving.','Stale settings cannot overwrite scheduled terms');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,gen_random_uuid())$$,
 '55000','Bidding has not opened yet','Server rejects early bids');
select is((select count(*)::integer from public.listing_auction_bids where auction_id=(select id from public.listing_auctions where listing_id='94000000-0000-4000-8000-000000000001')),0,'Early bid did not enter the ledger');
select throws_ok($$select public.create_booking_request('94000000-0000-4000-8000-000000000001',current_date+4,current_date+7,1)$$,
 '23P01','One unit is reserved for competitive bidding on these dates','Scheduled auction reserves inventory');
update public.listing_auctions set starts_at=clock_timestamp()-interval '1 second' where listing_id='94000000-0000-4000-8000-000000000001';
select is(public.get_listing_auction('94000000-0000-4000-8000-000000000001')->>'status','open','Bidding opens automatically without scheduler lag');
select lives_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',20,gen_random_uuid())$$,'Bids are accepted after opening');
select is((public.get_listing_auction_feed()->>'total')::integer,1,'Opened auction appears in live feed');
select is(jsonb_array_length(public.get_top_listing_bids()),1,'Opened bids appear in ribbon');
select lives_ok($$select public.process_listing_auctions()$$,'Existing worker preserves future deadlines');
update public.listing_auctions set ends_at=clock_timestamp()-interval '1 second',selection_deadline=clock_timestamp()+interval '1 hour'
 where listing_id='94000000-0000-4000-8000-000000000001';
select throws_ok($$select public.place_listing_auction_bid('94000000-0000-4000-8000-000000000001',25,gen_random_uuid())$$,
 '55000','Bidding is closed','Chosen closing deadline is enforced');
select lives_ok($$select public.process_listing_auctions()$$,'Worker moves closed scheduled auction to owner selection');
select is(public.get_listing_auction('94000000-0000-4000-8000-000000000001')->>'status','owner_selection','Owner selection is retained');
select * from finish();
rollback;
