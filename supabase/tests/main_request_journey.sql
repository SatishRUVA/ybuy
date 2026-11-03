begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('f1000000-0000-4000-8000-000000000001','journey-renter@example.test','{"full_name":"Journey renter"}'),
 ('f1000000-0000-4000-8000-000000000002','journey-owner@example.test','{"full_name":"Journey owner"}'),
 ('f1000000-0000-4000-8000-000000000003','journey-outsider@example.test','{"full_name":"Journey outsider"}');
insert into auth.sessions(id,user_id) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001'),
 ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002'),
 ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000003');
insert into public.categories(id,name) values('f3000000-0000-4000-8000-000000000001','Request journey test');
update public.feature_flags set enabled=true where key='item_requests';
insert into public.notification_preferences(user_id) values('f1000000-0000-4000-8000-000000000001') on conflict do nothing;
update public.notification_preferences set requests_in_app=true,requests_email=false
 where user_id='f1000000-0000-4000-8000-000000000001';
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,deposit,available_quantity,
 status,estimated_value,item_condition,availability_start,availability_end) values
 ('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002',
 'f3000000-0000-4000-8000-000000000001','Journey rental','A test rental with two units of inventory.',25,10,2,'draft',200,'good',current_date,current_date+30);
insert into public.listing_images(listing_id,url,sort_order) values
 ('f4000000-0000-4000-8000-000000000001','https://example.test/journey.jpg',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,latitude,longitude,country) values
 ('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002','Private pickup','Dallas','TX','75201',32.78,-96.8,'US');
update public.listings set status='published' where id='f4000000-0000-4000-8000-000000000001';

create function pg_temp.request_payload() returns jsonb language sql as $$
 select jsonb_build_object('p_id','f5000000-0000-4000-8000-000000000001',
 'p_idempotency_key','f6000000-0000-4000-8000-000000000001','p_category_id','f3000000-0000-4000-8000-000000000001',
 'p_title','Need a journey rental','p_description','Two items for a small community event.',
 'p_intended_use','Community event','p_start_date',current_date+10,'p_end_date',current_date+12,
 'p_location_label','Dallas, TX','p_max_daily_budget',30,'p_quantity',2,'p_specifications',null,
 'p_additional_notes',null,'p_visibility','public','p_reference_image_paths','[]'::jsonb,'p_country_code','US');
$$;
grant execute on function pg_temp.request_payload() to authenticated;

set local role authenticated;
set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.create_main_item_request(pg_temp.request_payload()-'p_max_daily_budget',32.78,-96.8,5,false,true)$$,
 '22023','Choose offer and notification preferences, and a daily budget for fixed-budget requests','Fixed daily budget is required');
select is((public.create_main_item_request(pg_temp.request_payload(),32.78,-96.8,5,false,false)).notify_matches_in_app,false,
 'Creation atomically saves disabled in-app notifications');
select ok((select main_site_flow and not open_for_offers and max_daily_budget=30 from public.item_requests where id='f5000000-0000-4000-8000-000000000001'),
 'Main request retains fixed daily budget and flow marker');
select is((public.create_main_item_request(pg_temp.request_payload(),32.78,-96.8,5,false,false)).id,
 'f5000000-0000-4000-8000-000000000001'::uuid,'Creation retry returns the same request');
select throws_ok($$select public.create_main_item_request(pg_temp.request_payload(),32.78,-96.8,5,false,true)$$,
 '22023','Request retry has different preferences','Preference-changing creation retry is rejected');
select is((public.get_main_request_matches('f5000000-0000-4000-8000-000000000001')->>'total')::int,1,
 'Dedicated matching returns a quantity-capable rental');
select is((public.get_nearby_item_requests(32.78,-96.8,5,p_category_id=>'f3000000-0000-4000-8000-000000000001')->>'total')::int,0,
 'Renter cannot discover their own request as owner inventory');

reset role;
insert into public.listing_availability(listing_id,date,is_available) values('f4000000-0000-4000-8000-000000000001',current_date+10,false);
set local role authenticated;
select is((public.get_main_request_matches('f5000000-0000-4000-8000-000000000001')->>'total')::int,0,
 'Unavailable requested dates exclude a rental');
reset role;
delete from public.listing_availability where listing_id='f4000000-0000-4000-8000-000000000001';
update public.listings set available_quantity=1 where id='f4000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.get_main_request_matches('f5000000-0000-4000-8000-000000000001')->>'total')::int,0,
 'Insufficient quantity excludes a rental');
reset role;
update public.listings set available_quantity=2 where id='f4000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000003","exp":4102444800}';
select throws_ok($$select public.get_main_request_matches('f5000000-0000-4000-8000-000000000001')$$,
 '42501','Your request was not found','Other renters cannot read dedicated matches');
select throws_ok($$select public.update_request_match_preference('f5000000-0000-4000-8000-000000000001',true)$$,
 '42501','Your main-site request was not found','Other renters cannot change request preferences');
select throws_ok($$select public.link_main_request_listing('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',true)$$,
 '42501','Choose your own published rental','Other owners cannot link somebody else’s listing');

set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((public.get_nearby_item_requests(32.78,-96.8,5,p_category_id=>'f3000000-0000-4000-8000-000000000001')->>'total')::int,1,
 'Owner nearby filter includes the renter request');
select ok((public.get_nearby_item_requests(32.78,-96.8,5,p_category_id=>'f3000000-0000-4000-8000-000000000001')->'rows'->0->>'distance_miles')::numeric<0.05,
 'Nearby results report actual geographic distance');
select is((public.get_nearby_item_requests(40.7,-74.0,5,p_category_id=>'f3000000-0000-4000-8000-000000000001')->>'total')::int,0,
 'Out-of-radius requests are excluded');
select throws_ok($$select public.get_nearby_item_requests('NaN'::float8,-96.8,5)$$,
 '22023','Invalid nearby request filters','Non-finite geographic input is rejected');
select is((public.link_main_request_listing('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',true)->>'in_app_notified')::boolean,false,
 'Notify action respects disabled request preference');

reset role;
select ok(not exists(select 1 from public.notifications where user_id='f1000000-0000-4000-8000-000000000001'
 and event_key like 'request-match:f5000000-0000-4000-8000-000000000001:%' and in_app_enabled),'Request-level mute suppresses match alerts');
set local role authenticated;
set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.update_request_match_preference('f5000000-0000-4000-8000-000000000001',true)$$,'Renter can enable future in-app alerts');
reset role;
update public.notification_preferences set requests_in_app=false where user_id='f1000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((public.link_main_request_listing('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',true)->>'in_app_notified')::boolean,false,
 'Request preference cannot override account category mute');
reset role;
update public.notification_preferences set requests_in_app=true where user_id='f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.link_main_request_listing('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',false)->>'in_app_notified')::boolean,false,
 'Skip links inventory without requesting a new notification');
select is((public.link_main_request_listing('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',true)->>'in_app_notified')::boolean,true,
 'Opted-in renter receives a confirmed in-app notification');
reset role;
select is((select destination from public.notifications where event_key='request-match:f5000000-0000-4000-8000-000000000001:listing:f4000000-0000-4000-8000-000000000001'),
 '/requests/f5000000-0000-4000-8000-000000000001/matches','Main notification destination opens dedicated matches');
select is((select count(*)::int from public.item_request_listing_matches where request_id='f5000000-0000-4000-8000-000000000001'),1,'Link retries do not duplicate inventory associations');
select is((select count(*)::int from public.notifications where event_key='request-match:f5000000-0000-4000-8000-000000000001:listing:f4000000-0000-4000-8000-000000000001'),1,
 'Notification retries deduplicate against automatic matcher events');
update public.item_requests set notify_matches_in_app=false where id='f5000000-0000-4000-8000-000000000001';
delete from public.notifications where event_key='request-match:f5000000-0000-4000-8000-000000000001:listing:f4000000-0000-4000-8000-000000000001';
select lives_ok($$select public.create_notification('f1000000-0000-4000-8000-000000000001',
 'request-match:f5000000-0000-4000-8000-000000000001:listing:f4000000-0000-4000-8000-000000000001',
 'requests','Automatic match','Rollback-only alert.','/listing/f4000000-0000-4000-8000-000000000001')$$,
 'Automatic matcher can create preference-controlled history');
select ok(not (select in_app_enabled from public.notifications where event_key='request-match:f5000000-0000-4000-8000-000000000001:listing:f4000000-0000-4000-8000-000000000001'),
 'Automatic match trigger enforces per-request mute');
update public.item_requests set notify_matches_in_app=true where id='f5000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.link_main_request_listing('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',true)->>'in_app_notified')::boolean,false,
 'Previously suppressed deduplicated alert is not reported as delivered');
set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000001","exp":4102444800}';
select ok(not (public.create_located_item_request(pg_temp.request_payload()||jsonb_build_object(
 'p_id','f5000000-0000-4000-8000-000000000002','p_idempotency_key','f6000000-0000-4000-8000-000000000002',
 'p_title','Legacy request','p_max_daily_budget',null),32.78,-96.8,5)).main_site_flow,
 'Legacy and redesign creation retains its original flow');
reset role;
select lives_ok($$select public.create_notification('f1000000-0000-4000-8000-000000000001',
 'request-match:f5000000-0000-4000-8000-000000000002:listing:f4000000-0000-4000-8000-000000000001',
 'requests','Legacy match','Rollback-only alert.','/listing/f4000000-0000-4000-8000-000000000001')$$,
 'Legacy automatic notification remains available');
select is((select destination from public.notifications where event_key='request-match:f5000000-0000-4000-8000-000000000002:listing:f4000000-0000-4000-8000-000000000001'),
 '/listing/f4000000-0000-4000-8000-000000000001','Main-only routing does not change legacy notification destinations');
select lives_ok($$select public.create_notification('f1000000-0000-4000-8000-000000000001',
 'booking:main-request-journey-policy','bookings','Required update','Rollback-only alert.','/dashboard')$$,
 'Required booking alerts remain available');
select ok((select in_app_enabled from public.notifications where event_key='booking:main-request-journey-policy'),
 'Per-request preference cannot mute mandatory booking alerts');
set local role authenticated;
set local request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","exp":4102444800}';
select throws_ok($$select public.get_nearby_item_requests()$$,'42501','An active signed-in session is required',
 'Nearby RPC rejects a token without an active session');
reset role;
select * from finish();
rollback;
