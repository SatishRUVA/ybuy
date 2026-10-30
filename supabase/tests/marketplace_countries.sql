begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select value from public.app_settings where key='marketplace_country_codes'),'["US"]'::jsonb,'United States is the initial enabled country');
select ok(public.marketplace_country_allowed('US'),'United States code is enabled');
select ok(public.marketplace_country_allowed('United States'),'Country names match the reference');
select ok(not public.marketplace_country_allowed('CA'),'Canada is disabled initially');
select ok(not public.marketplace_country_allowed(''),'Unknown country is denied');
select ok(not has_function_privilege('authenticated',
  'public.create_item_request(uuid,uuid,uuid,text,text,text,date,date,text,numeric,integer,text,text,text,text[])','execute'),
  'Unlocated request creation cannot bypass country policy');
select ok(not has_function_privilege('authenticated',
  'public.create_located_item_request_before_country_policy(jsonb,double precision,double precision,integer)','execute'),
  'Legacy located request bypass is private');

insert into auth.users(id,email) values
 ('c1000000-0000-4000-8000-000000000001','country-admin@example.test'),
 ('c1000000-0000-4000-8000-000000000002','country-user@example.test');
insert into auth.sessions(id,user_id) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001'),
 ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002');
insert into public.admin_users(user_id,role) values('c1000000-0000-4000-8000-000000000001','super_admin');

set local role authenticated;
set local request.jwt.claims='{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000002","exp":4102444800}';
update public.app_settings set value='["CA"]' where key='marketplace_country_codes';
select is((select value from public.app_settings where key='marketplace_country_codes'),'["US"]'::jsonb,
 'RLS prevents users changing countries directly');
select throws_ok($$select public.admin_update_setting('marketplace_country_codes','["US","CA"]','Enable Canada')$$,
 '42501',null,'Ordinary users cannot add countries');
select throws_ok($$select public.create_located_item_request('{"p_country_code":"CA"}',43.65,-79.38,5)$$,
 '22023','Choose a request location in an enabled marketplace country','Disallowed request country rejected before creation');
select throws_ok($$select public.create_located_item_request('{}',32.8,-96.8,5)$$,
 '22023','Choose a request location in an enabled marketplace country','Missing request country rejected');

set local request.jwt.claims='{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000001","exp":4102444800}';
select is(public.admin_update_setting('marketplace_country_codes','[]','Invalid empty list')->>'ok','false','At least one country required');
select is(public.admin_update_setting('marketplace_country_codes','["ZZ"]','Invalid country')->>'ok','false','Unknown ISO code denied');
select is(public.admin_update_setting('marketplace_country_codes','["US","US"]','Duplicate countries')->>'ok','false','Duplicate codes denied');
select is(public.admin_update_setting('marketplace_country_codes','["us"]','Lowercase country')->>'ok','false','Noncanonical country code denied');
select is(public.admin_update_setting('marketplace_country_codes','true','Invalid country type')->>'ok','false','Wrong JSON type denied');
select is(public.admin_update_setting('marketplace_country_codes','["US","CA"]','Enable Canada')->>'ok','true','Authorized administrator can add Canada');
reset role;
select ok(public.marketplace_country_allowed('Canada'),'Added country is enabled');
select is((select count(*)::integer from public.admin_audit_log where action='setting.update'
  and entity_id='marketplace_country_codes' and outcome='success'),1,'Country addition is audited');

insert into public.categories(id,name) values('c3000000-0000-4000-8000-000000000001','Country fixture');
insert into public.listings(id,owner_id,category_id,title,price_per_day)
values('c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002',
 'c3000000-0000-4000-8000-000000000001','Country camera',10);
set local role authenticated;
set local request.jwt.claims='{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$insert into public.listing_pickup_locations(listing_id,owner_id,address,city,latitude,longitude,country)
 values('c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002',
 'Example address','London',51.5,-0.1,'GB')$$,
 '22023','Choose a pickup address in an enabled marketplace country','Direct pickup writes cannot use disabled countries');
select lives_ok($$insert into public.listing_pickup_locations(listing_id,owner_id,address,city,latitude,longitude,country)
 values('c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002',
 'Example address','Toronto',43.65,-79.38,'CA')$$,'Pickup accepts an admin-enabled country');
reset role;
update public.app_settings set value='["US"]' where key='marketplace_country_codes';
set local role authenticated;
select lives_ok($$update public.listing_pickup_locations set place_id='retained-place'
 where listing_id='c4000000-0000-4000-8000-000000000001'$$,'Historical addresses are preserved after disabling a country');
select throws_ok($$update public.listing_pickup_locations set address='Changed address'
 where listing_id='c4000000-0000-4000-8000-000000000001'$$,
 '22023','Choose a pickup address in an enabled marketplace country','Changed addresses must obey current policy');

reset role;
update public.feature_flags set enabled=true where key='item_requests';
set local role authenticated;
select lives_ok($$select public.create_located_item_request(
 jsonb_build_object('p_id','c5000000-0000-4000-8000-000000000001',
 'p_idempotency_key','c6000000-0000-4000-8000-000000000001',
 'p_category_id','c3000000-0000-4000-8000-000000000001',
 'p_title','Country request camera','p_description','A camera for a weekend event',
 'p_intended_use',null,'p_start_date',current_date+2,'p_end_date',current_date+4,
 'p_location_label','Dallas, Texas','p_max_daily_budget',20,'p_quantity',1,
 'p_specifications',null,'p_additional_notes',null,'p_visibility','public',
 'p_reference_image_paths','[]'::jsonb,'p_country_code','US'),32.8,-96.8,5)$$,
 'Allowed country request creation retains the original request validations');
select is((select location_country_code from public.item_requests where id='c5000000-0000-4000-8000-000000000001'),
 'US','Request country is stored authoritatively');
reset role;
select * from finish();
rollback;
