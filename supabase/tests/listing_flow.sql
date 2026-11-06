begin;
set local timezone='America/Chicago';
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('a1000000-0000-4000-8000-000000000001','flow-owner@example.test'),
 ('a1000000-0000-4000-8000-000000000002','flow-renter@example.test'),
 ('a1000000-0000-4000-8000-000000000003','flow-admin@example.test');
insert into auth.sessions(id,user_id) select
 ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.admin_users(user_id,role) values('a1000000-0000-4000-8000-000000000003','super_admin');
insert into public.categories(id,name) values('a3000000-0000-4000-8000-000000000001','Flow fixture');
select is((select suggested_pct from public.category_deposit_rules where category_id='a3000000-0000-4000-8000-000000000001'),0.30::numeric,'New categories retain approved 30 percent deposit default');
select is(public.get_listing_flow_policy()->>'offer_below_pct',null::text,'Offers disabled until approved asymmetric policy exists');
select is(public.get_listing_flow_policy()->>'high_value_threshold','1000','Approved automatic publication limit is 1000 USD inclusive');
select is(public.get_listing_flow_policy()->>'max_estimated_value','5000','Approved maximum replacement value is 5000 USD');
update public.app_settings set value='0' where key='listing_high_value_threshold';
select is(public.get_listing_flow_policy()->>'high_value_threshold',null::text,'Disabling the threshold still fails closed to review');
select ok(not has_function_privilege('anon','public.get_listing_flow_policy()','execute'),'Anonymous policy access denied');
select ok(not has_function_privilege('authenticated','public.owner_save_listing_before_flow(uuid,bigint,jsonb,jsonb)','execute'),'Legacy bypass RPC is private');
select ok(not has_table_privilege('authenticated','public.listing_publication_approvals','INSERT'),'Owners cannot fabricate approvals');
select is(public.get_listing_flow_policy()->>'listing_duration_days','180','New listing windows support the 180-day horizon');

insert into public.listings(id,owner_id,category_id,title,price_per_day,estimated_value,item_condition,brand,model)
values('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
 'a3000000-0000-4000-8000-000000000001','Flow camera',10,200,'good','',''),
 ('a4000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
 'a3000000-0000-4000-8000-000000000001','Other flow camera',10,200,'good','Sony','FX3');
select is((select deposit from public.listings where id='a4000000-0000-4000-8000-000000000001'),60::numeric,'Database computes 30 percent deposit from declared value');
update public.listings set deposit=1 where id='a4000000-0000-4000-8000-000000000001';
select is((select deposit from public.listings where id='a4000000-0000-4000-8000-000000000001'),60::numeric,'Direct writes cannot override computed deposit');
update public.category_deposit_rules set minimum_amount=70,maximum_amount=90 where category_id='a3000000-0000-4000-8000-000000000001';
update public.listings set estimated_value=100 where id='a4000000-0000-4000-8000-000000000001';
select is((select deposit from public.listings where id='a4000000-0000-4000-8000-000000000001'),70::numeric,'Category minimum clamps calculated deposit');
update public.listings set estimated_value=1000 where id='a4000000-0000-4000-8000-000000000001';
select is((select deposit from public.listings where id='a4000000-0000-4000-8000-000000000001'),90::numeric,'Category maximum clamps calculated deposit');
update public.category_deposit_rules set minimum_amount=0,maximum_amount=10000 where category_id='a3000000-0000-4000-8000-000000000001';
update public.listings set estimated_value=200 where id='a4000000-0000-4000-8000-000000000001';
update public.app_settings set value='366'::jsonb where key='listing_duration_days';
alter table public.listings disable trigger b_listing_scheduling_window;
update public.listings set availability_start=current_date,availability_end=current_date+60
  where id='a4000000-0000-4000-8000-000000000002';
alter table public.listings enable trigger b_listing_scheduling_window;
update public.app_settings set value='30'::jsonb where key='listing_duration_days';
select lives_ok($$update public.listings set title='Preserved legacy window' where id='a4000000-0000-4000-8000-000000000002'$$,
 'Unchanged legacy dates survive unrelated listing edits');
select is((select availability_end-availability_start from public.listings where id='a4000000-0000-4000-8000-000000000002'),60,
 'Existing saved dates are not shortened');
select throws_ok($$update public.listings set availability_end=current_date+61 where id='a4000000-0000-4000-8000-000000000002'$$,
 '23514','Availability exceeds the configured listing duration','Changed windows must obey the 30-day cap');
select throws_ok($$update public.listings set availability_start=current_date+1,availability_end=current_date+32 where id='a4000000-0000-4000-8000-000000000002'$$,
 '23514','Availability exceeds the configured listing duration','A future start cannot exceed 30 days');
select lives_ok($$update public.listings set availability_start=current_date+1,availability_end=current_date+31 where id='a4000000-0000-4000-8000-000000000002'$$,
 'Future-start 30-day window accepted');
select lives_ok($$update public.listings set availability_start=current_date+150,availability_end=current_date+180 where id='a4000000-0000-4000-8000-000000000002'$$,
 'Thirty available days may end at the exclusive 180-day horizon');
select lives_ok($$update public.listings set availability_start=current_date+179,availability_end=current_date+180 where id='a4000000-0000-4000-8000-000000000002'$$,
 'One available day on the last selectable date is valid');
select throws_ok($$update public.listings set availability_start=current_date+180,availability_end=current_date+181 where id='a4000000-0000-4000-8000-000000000002'$$,
 '23514','Choose dates from today through 180 days from today','Direct writes cannot schedule outside the 180-day horizon');
select throws_ok($$update public.listings set availability_start=current_date-1,availability_end=current_date+1 where id='a4000000-0000-4000-8000-000000000002'$$,
 '23514','Choose dates from today through 180 days from today','Changed availability cannot start in the past');
update public.app_settings set value='366'::jsonb where key='listing_duration_days';
select throws_ok($$update public.listings set availability_start=current_date,availability_end=current_date+31 where id='a4000000-0000-4000-8000-000000000002'$$,
 '23514','Choose no more than 30 consecutive available days. Blocked days do not extend this window.','The hard 30-day cap cannot be raised through platform settings');
update public.app_settings set value='30'::jsonb where key='listing_duration_days';

set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.get_listing_flow_policy()$$,'Signed-in owner reads secure policy');
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',1,'{}')$$,
 '40001','This listing changed in another session. Reload before saving.','Stale revision rejected');
select lives_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),
 jsonb_build_object('availability_start',current_date,'availability_end',current_date+30,'available_quantity',2))$$,
 'Owner saves availability and quantity atomically');
select ok(not has_function_privilege('authenticated','public.owner_save_listing_flow_before_item_details(uuid,bigint,jsonb,jsonb,boolean)','execute'),
 'Internal item detail wrapper cannot bypass public validation');
select lives_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),
 '{"item_details":{"brand":"Sony","model":"FX3","included_items":["Battery","Case"],"additional_details":"Keep the lens cap on during transport.","delivery_radius_miles":25}}')$$,
 'Optional item details and radius are saved atomically');
select is((select brand||' '||model from public.listings where id='a4000000-0000-4000-8000-000000000001'),'Sony FX3','Brand and model persist');
select is((select included_items from public.listings where id='a4000000-0000-4000-8000-000000000001'),array['Battery','Case'],'Included items preserve their order');
select is((select delivery_radius_miles from public.listings where id='a4000000-0000-4000-8000-000000000001'),25,'Informational delivery radius persists');
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',0,'{"item_details":{"brand":"Stale"}}')$$,
 '40001','This listing changed in another session. Reload before saving.','Item details honor revision checks');
select throws_ok(format($sql$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),%L::jsonb)$sql$,jsonb_build_object('item_details',value)::text),
 '22023',null,label)
 from (values
 ('null'::jsonb,'Null details are rejected'),('[]'::jsonb,'Array details are rejected'),
 ('{"owner_id":"fake"}'::jsonb,'Unknown detail keys are rejected'),
 ('{"brand":null}'::jsonb,'Null brand rejected'),('{"model":5}'::jsonb,'Numeric model rejected'),
 ('{"additional_details":true}'::jsonb,'Boolean details rejected'),
 ('{"included_items":null}'::jsonb,'Null included array rejected'),
 ('{"included_items":[null]}'::jsonb,'Null tag rejected'),('{"included_items":[5]}'::jsonb,'Numeric tag rejected'),
 ('{"included_items":[["nested"]]}'::jsonb,'Nested array rejected'),
 ('{"delivery_radius_miles":"5"}'::jsonb,'String radius rejected'),
 ('{"delivery_radius_miles":true}'::jsonb,'Boolean radius rejected')) cases(value,label);
select throws_ok(format($sql$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),%L::jsonb)$sql$,jsonb_build_object('item_details',value)::text),
 '23514',null,label)
 from (values
 (jsonb_build_object('brand',repeat('x',81)),'Brand limit enforced'),
 (jsonb_build_object('model',repeat('x',81)),'Model limit enforced'),
 (jsonb_build_object('brand',repeat('x',81),'additional_details',repeat('x',81)),'Equal strings cannot bypass brand limit'),
 (jsonb_build_object('additional_details',repeat('x',501)),'Additional details limit enforced'),
 ('{"included_items":[" "]}'::jsonb,'Blank tag rejected'),
 ('{"included_items":["Battery"," battery "]}'::jsonb,'Case-insensitive duplicate rejected'),
 (jsonb_build_object('included_items',array[repeat('x',61)]),'Tag length enforced'),
 (jsonb_build_object('included_items',array(select n::text from generate_series(1,13) n)),'Tag count enforced'),
 ('{"brand":"<script>alert(1)</script>"}'::jsonb,'HTML in brand rejected'),
 ('{"additional_details":"javascript:alert(1)"}'::jsonb,'Script text rejected'),
 ('{"delivery_radius_miles":15}'::jsonb,'Unsupported radius rejected')) cases(value,label);
select lives_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),
 '{"item_details":{"delivery_radius_miles":null}}')$$,'Radius may be cleared');
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),
 '{"available_quantity":0,"item_details":{"brand":"Should roll back"}}')$$,
 '23514',null,'Failure saving core terms rolls back optional item fields too');
select is((select brand from public.listings where id='a4000000-0000-4000-8000-000000000001'),'Sony','Failed atomic save preserves original brand');
select is((select status from public.listings where id='a4000000-0000-4000-8000-000000000001'),'draft','Optional details never self-publish a draft');
select ok(not has_function_privilege('authenticated','public.owner_save_listing_flow_before_offers(uuid,bigint,jsonb,jsonb,boolean)','execute'),
 'Wrapped listing save cannot bypass the new offer transaction');
select ok(not has_function_privilege('authenticated','public.owner_save_offer_preferences(uuid,bigint,jsonb)','EXECUTE'),
 'Clients cannot configure private listing prices');
select ok(not has_function_privilege('authenticated','public.listing_offer_within_rules(uuid,numeric,date,date)','EXECUTE'),
 'Listing offer eligibility helper is revoked');
select throws_ok($$select public.owner_save_listing_flow(null,null,
 jsonb_build_object('offer_preferences',jsonb_build_object('negotiation_enabled',true)))$$,
 '55000','Private offers have been removed; publish rentals at their listed price.','Legacy listing payload cannot re-enable private offers');
reset role;
reset role;
set local role authenticated;
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{}',null,true)$$,
 '23514','Add at least one photo and a private pickup location before publishing','Publication requires photo and private pickup');
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{"deposit":1}')$$,
 '22023','Unsupported listing changes','New API does not accept owner-set deposit');
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),
 jsonb_build_object('availability_start',current_date,'availability_end',current_date+31))$$,
 '23514','Availability exceeds the configured listing duration','Global listing duration enforced');
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),
 jsonb_build_object('availability_start',current_date+180,'availability_end',current_date+181))$$,
 '23514','Choose dates from today through 180 days from today','Authenticated owner RPC cannot bypass the scheduling horizon');
select is(public.get_listing_flow_policy()->>'max_delivery_fee','99','Approved delivery maximum is 99 USD');
select lives_ok($$update public.listings set delivery_available=true,delivery_fee=1 where id='a4000000-0000-4000-8000-000000000001'$$,'Delivery accepts minimum 1 USD');
select lives_ok($$update public.listings set delivery_fee=25 where id='a4000000-0000-4000-8000-000000000001'$$,'Delivery accepts 25 USD');
select lives_ok($$update public.listings set delivery_fee=99 where id='a4000000-0000-4000-8000-000000000001'$$,'Delivery accepts maximum 99 USD');
select throws_ok($$update public.listings set delivery_fee=0 where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Delivery rejects zero fee when enabled');
select throws_ok($$update public.listings set delivery_fee=0.99 where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Delivery rejects below minimum');
select throws_ok($$update public.listings set delivery_fee=99.01 where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','Quantity or delivery fee exceeds listing policy','Delivery rejects above maximum');
select lives_ok($$update public.listings set delivery_available=false,delivery_fee=0 where id='a4000000-0000-4000-8000-000000000001'$$,'Delivery disabled keeps zero fee');
insert into public.listing_images(listing_id,url,sort_order) values
 ('a4000000-0000-4000-8000-000000000001','https://example.test/one.jpg',0),
 ('a4000000-0000-4000-8000-000000000001','https://example.test/two.jpg',1);
select lives_ok($$select public.owner_reorder_listing_images('a4000000-0000-4000-8000-000000000001',
 array['https://example.test/two.jpg','https://example.test/one.jpg'])$$,'Photo reorder is one owner-authorized transaction');
select is((select sort_order from public.listing_images where listing_id='a4000000-0000-4000-8000-000000000001' and url='https://example.test/two.jpg'),0,'Cover ordering persisted');
select throws_ok($$select public.owner_reorder_listing_images('a4000000-0000-4000-8000-000000000001',
 array['https://example.test/two.jpg','https://example.test/unknown.jpg'])$$,
 '22023','Photo order must include each saved photo exactly once','Partial or forged reorder rejected');
select lives_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{"description":""}',
 '{"formattedAddress":"123 Test Lane","streetAddress":"123 Test Lane","city":"Austin","state":"TX","postalCode":"78701","country":"US","latitude":30.27,"longitude":-97.74,"placeId":"","timeZone":"America/Chicago"}',false)$$,
 'Incomplete description can be saved privately as a draft');
select throws_ok(format(
 $$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),
 jsonb_build_object('description',%L::text),null,true)$$, value),
 '23514','Description must be at least 10 characters.', label)
 from (values (null::text,'Null description cannot be submitted'),
 ('','Empty description cannot be submitted'),
 (E' \t\n ','Whitespace description cannot be submitted'),
 (' 123456789 ','Trimmed description shorter than 10 cannot be submitted')) as cases(value,label);
select is((select status from public.listings where id='a4000000-0000-4000-8000-000000000001'),'draft',
 'Invalid submissions preserve draft status');
select lives_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{"description":"1234567890"}',
 '{"formattedAddress":"123 Test Lane","streetAddress":"123 Test Lane","city":"Austin","state":"TX","postalCode":"78701","country":"US","latitude":30.27,"longitude":-97.74,"placeId":"","timeZone":"America/Chicago"}',true)$$,
 'Owner terms, pickup and publication request commit together');
select is((select status from public.listings where id='a4000000-0000-4000-8000-000000000001'),'pending_approval','Unconfigured threshold never fabricates approval');
select throws_ok($$update public.listings set description='' where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','Description must be at least 10 characters.','Pending listing description cannot be cleared directly');
select is(public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{}',null,true)->>'revision',
 (select revision::text from public.listings where id='a4000000-0000-4000-8000-000000000001'),'Repeated publish request is idempotent');
select is(public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{}',
 '{"formattedAddress":"123 Test Lane","streetAddress":"123 Test Lane","city":"Austin","state":"TX","postalCode":"78701","country":"US","latitude":30.27,"longitude":-97.74,"placeId":"","timeZone":"America/Chicago"}',true)->>'revision',
 (select revision::text from public.listings where id='a4000000-0000-4000-8000-000000000001'),'Repeated publication with identical pickup is also idempotent');
select throws_ok($$select public.admin_approve_listing_publication('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'Owner cannot approve')$$,
 '42501','Not authorized','Owner cannot self-approve publication');
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',1,'{}')$$,
 '42501','Listing not found or not owned','Cross-account save denied');
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',1,'{"item_details":{"brand":"Other owner"}}')$$,
 '42501','Listing not found or not owned','Cross-account item detail save denied');
select throws_ok($$select public.owner_reorder_listing_images('a4000000-0000-4000-8000-000000000001',array[]::text[])$$,
 '42501','Listing not found or not owned','Cross-account photo reorder denied');
select is((select count(*)::integer from public.listing_pickup_locations),0,'Private pickup remains owner-only');
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000003","exp":4102444800}';
select is(public.admin_get_listing_publication_review('a4000000-0000-4000-8000-000000000001')->>'estimated_value','200.00','Admin reviews exact saved declared value');
select throws_ok($$select public.admin_approve_listing_publication('a4000000-0000-4000-8000-000000000001',1,'Reviewed safely')$$,
 '40001','Listing changed. Reload before reviewing.','Stale admin approval rejected');
select is(public.admin_approve_listing_publication('a4000000-0000-4000-8000-000000000001',
 (public.admin_get_listing_publication_review('a4000000-0000-4000-8000-000000000001')->>'revision')::bigint,'Reviewed saved listing')->>'status',
 'published','Explicit authorized review publishes current revision');
reset role;
select throws_ok($$update public.listings set description='short' where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','Description must be at least 10 characters.','Privileged writes cannot shorten published listing description');
select is((select count(*)::integer from public.admin_audit_log where action='listing.publication_approved'
 and entity_id='a4000000-0000-4000-8000-000000000001'),1,'Approval is audited');
select ok(not exists(select 1 from public.app_settings where key in ('listing_offers_configured','listing_offer_below_pct','listing_offer_above_pct')),
 'Private-offer pricing settings are removed');
select ok(not has_function_privilege('authenticated','public.owner_save_offer_preferences(uuid,bigint,jsonb)','EXECUTE'),
 'Clients cannot configure private listing prices');
select ok(not has_function_privilege('authenticated','public.listing_offer_within_rules(uuid,numeric,date,date)','EXECUTE'),
 'Listing offer eligibility helper is not client-accessible');
select ok(not public.listing_has_capacity('a4000000-0000-4000-8000-000000000001',current_date+29,current_date+31),'Capacity rejects date range beyond listing end');
select ok(public.listing_has_capacity('a4000000-0000-4000-8000-000000000001',current_date+29,current_date+30,2),'End-exclusive boundary and remaining quantity allowed');

set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.create_booking_request('a4000000-0000-4000-8000-000000000001',current_date+29,current_date+31,1)$$,
 '23P01','Listing is not available for the requested dates and quantity','Booking RPC enforces availability range');
select lives_ok($$select public.create_booking_request('a4000000-0000-4000-8000-000000000001',current_date+3,current_date+5,2)$$,
 'Booking RPC reserves requested units within window');
select is((select booking_mode from public.bookings where listing_id='a4000000-0000-4000-8000-000000000001'),
 'owner_approval','Approval listings retain the owner approval mode');
reset role;
update public.app_settings set value='1000' where key='listing_high_value_threshold';
set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{"instant_booking":true}')$$,
 'Owner enables instant booking on an eligible listing');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((public.create_booking_request('a4000000-0000-4000-8000-000000000001',current_date+8,current_date+10,1)).status,
 'pending_payment','Instant listing bypasses owner approval and goes straight to payment');
select is((select booking_mode from public.bookings where listing_id='a4000000-0000-4000-8000-000000000001'
 and start_date=current_date+8),'instant','Instant mode is snapshotted on the booking');
select is((select count(*)::int from public.notifications where user_id='a1000000-0000-4000-8000-000000000002'
 and event_key like 'booking:%:pending_payment:%'),1,'Renter receives payment-needed notice for instant booking');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select count(*)::int from public.notifications where user_id='a1000000-0000-4000-8000-000000000001'
 and event_key like 'booking:%:instant:%'),1,'Owner receives an instant booking notification');
reset role;
select ok(not public.listing_has_capacity('a4000000-0000-4000-8000-000000000001',current_date+3,current_date+4),'Requested quantities count toward capacity');
select throws_ok($$update public.listings set availability_end=current_date+4 where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','Availability must contain existing reserved and rented dates','Owners cannot exclude already reserved dates');
select throws_ok($$update public.listings set available_quantity=1 where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','Quantity cannot be less than existing reserved and rented units','Owners cannot undercut reserved quantity');
select throws_ok($$update public.listings set brand='Changed rental item' where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','Item and handoff detail changes require existing approved rentals to finish','Item changes cannot alter an approved rental');
select throws_ok($$update public.listings set delivery_radius_miles=5 where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','Item and handoff detail changes require existing approved rentals to finish','Delivery area cannot change underneath an approved rental');
update public.app_settings set value='1000' where key='listing_high_value_threshold';
update public.listings set price_per_day=11 where id='a4000000-0000-4000-8000-000000000001';
select ok((select bool_and(daily_rate=10) from public.bookings where listing_id='a4000000-0000-4000-8000-000000000001'),'Existing rentals keep snapshotted daily price');

set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{"price_per_day":10.5}')$$,
 'Asking price can change without private offer settings');
select throws_ok($$delete from public.listing_pickup_locations where listing_id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','Archive the listing before removing its last photo or pickup location','Published listing retains private pickup');
reset role;
insert into public.listing_flags(listing_id,reason,confidence,type)
 values('a4000000-0000-4000-8000-000000000001','Advisory image quality','high','other_guideline');
insert into public.listing_flags(listing_id,reason,confidence,type)
 values('a4000000-0000-4000-8000-000000000001','Prohibited item identified','high','prohibited_item');
update public.listings set status='draft' where id='a4000000-0000-4000-8000-000000000001';
select throws_ok($$update public.listings set status='published' where id='a4000000-0000-4000-8000-000000000001'$$,
 '23514','This listing requires moderation review before publication','High-confidence prohibited flag blocks publication');
update public.listing_flags set resolved=true where listing_id='a4000000-0000-4000-8000-000000000001' and type='prohibited_item';
select lives_ok($$update public.listings set status='published' where id='a4000000-0000-4000-8000-000000000001'$$,
 'Resolved prohibited flag and advisory flag permit publication');
update public.app_settings set value='2' where key='listing_max_photos';
select throws_ok($$insert into public.listing_images(listing_id,url,sort_order)
 values('a4000000-0000-4000-8000-000000000001','https://example.test/three.jpg',2)$$,
 '23514','Listing photo limit reached','Configured photo ceiling is enforced server-side');
select ok((public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000001',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'{}',null,true)->>'revision')::bigint=
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000001'),'Repeated successful publish has no revision side effects');

insert into public.listing_images(listing_id,url,sort_order)
 values('a4000000-0000-4000-8000-000000000002','https://example.test/value-bands.jpg',0);
alter table public.listings disable trigger b_listing_scheduling_window;
update public.listings set availability_start=current_date-1,availability_end=current_date+29
 where id='a4000000-0000-4000-8000-000000000002';
alter table public.listings enable trigger b_listing_scheduling_window;
set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),'{"estimated_value":0,"description":"Camera with a carrying case."}',
 '{"formattedAddress":"123 Test Lane","streetAddress":"123 Test Lane","city":"Austin","state":"TX","postalCode":"78701","country":"US","latitude":30.27,"longitude":-97.74,"placeId":"","timeZone":"America/Chicago"}',true)$$,
 '23514','Choose dates from today through 180 days from today','Stale draft cannot publish until availability is corrected');
select lives_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),
 jsonb_build_object('availability_start',current_date,'availability_end',current_date+1))$$,
 'Owner can correct a stale draft to a one-day rental window');
select is(public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),'{"estimated_value":0,"description":"Camera with a carrying case."}',
 '{"formattedAddress":"123 Test Lane","streetAddress":"123 Test Lane","city":"Austin","state":"TX","postalCode":"78701","country":"US","latitude":30.27,"longitude":-97.74,"placeId":"","timeZone":"America/Chicago"}',true)->>'status',
 'published','Explicit zero value publishes without value approval');
select is(public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),'{"estimated_value":999.99}',null,true)->>'status',
 'published','Value below 1000 publishes');
select is(public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),'{"estimated_value":1000}',null,true)->>'status',
 'published','Exactly 1000 publishes without value approval');
select is(public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),'{"estimated_value":1000.01}',null,true)->>'status',
 'pending_approval','1000.01 requires admin approval and is not live');
select is(public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),'{"estimated_value":5000}',null,true)->>'status',
 'pending_approval','Exactly 5000 remains pending until admin approval');
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000003","exp":4102444800}';
select is(public.admin_approve_listing_publication('a4000000-0000-4000-8000-000000000002',
 (public.admin_get_listing_publication_review('a4000000-0000-4000-8000-000000000002')->>'revision')::bigint,'Reviewed 5000 USD listing')->>'status',
 'published','Admin can approve the current 5000 USD listing before it goes live');
reset role;
update public.listings set model='Reviewed model changed' where id='a4000000-0000-4000-8000-000000000002';
select is((select status from public.listings where id='a4000000-0000-4000-8000-000000000002'),'pending_approval',
 'New item details invalidate a high-value listing approval');
select throws_ok($$update public.listings set estimated_value=5000.01 where id='a4000000-0000-4000-8000-000000000002'$$,
 '23514',null,'Privileged writes cannot bypass maximum value on an approved listing');
set local role authenticated;
set local request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),'{"estimated_value":5000.01}',null,true)$$,
 '23514',null,'5000.01 cannot be saved or published through the API');
select throws_ok($$insert into public.listings(owner_id,category_id,title,price_per_day,estimated_value)
 values('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','Blocked value',10,5001)$$,
 '23514',null,'Direct draft insertion cannot bypass maximum value');
select throws_ok($$update public.listings set estimated_value=-1 where id='a4000000-0000-4000-8000-000000000002'$$,
 '23514',null,'Negative value is rejected by the database');
reset role;
update public.listings set status='pending_approval' where id='a4000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(public.owner_save_listing_flow('a4000000-0000-4000-8000-000000000002',
 (select revision from public.listings where id='a4000000-0000-4000-8000-000000000002'),'{"estimated_value":1000}',null,true)->>'status',
 'published','Owner can explicitly republish an old pending listing once within automatic band');
select is((select deposit from public.listings where id='a4000000-0000-4000-8000-000000000002'),300::numeric,
 'Value-based publication preserves the configured deposit calculation');
reset role;
update public.app_settings set value='500' where key='listing_high_value_threshold';
update public.listings set estimated_value=501 where id='a4000000-0000-4000-8000-000000000002';
select is((select status from public.listings where id='a4000000-0000-4000-8000-000000000002'),'pending_approval',
 'Super Admin threshold changes are enforced dynamically');
update public.app_settings set value='2000' where key='listing_max_estimated_value';
select throws_ok($$update public.listings set estimated_value=2000.01 where id='a4000000-0000-4000-8000-000000000002'$$,
 '23514',null,'Super Admin maximum changes are enforced dynamically');

update public.app_settings set value='1024' where key='listing_max_photo_bytes';
select is((select file_size_limit from storage.buckets where id='listing-images'),1024::bigint,'Global byte setting updates actual storage bucket limit');
delete from public.app_settings where key='listing_max_quantity';
select throws_ok($$select public.get_listing_flow_policy()$$,'55000','Listing policy is unavailable. Contact support.','Missing policy fails closed instead of silently defaulting');
select * from finish();
rollback;
