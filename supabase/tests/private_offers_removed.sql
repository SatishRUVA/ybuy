begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
  ('c1000000-0000-4000-8000-000000000001','offer-removal-renter@example.test');
insert into auth.sessions(id,user_id) values
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001');
insert into public.categories(id,name) values
  ('c3000000-0000-4000-8000-000000000001','Offer removal test');
update public.feature_flags set enabled=true where key='item_requests';

select ok(not exists(select 1 from public.feature_flags where key='private_offers'),
  'Private-offer feature flag is removed');
select ok(not exists(select 1 from public.app_settings where key in (
  'listing_offers_configured','listing_offer_below_pct','listing_offer_above_pct')),
  'Private-offer settings are removed');
select ok(not has_function_privilege('authenticated','public.owner_save_offer_preferences(uuid,bigint,jsonb)','EXECUTE'),
  'Client cannot configure private listing prices');
select ok(not has_function_privilege('authenticated','public.create_marketplace_offer(uuid,uuid,date,date,numeric,text,uuid)','EXECUTE'),
  'Client cannot create private request or listing offers');
select ok(not has_function_privilege('authenticated','public.respond_to_marketplace_offer(uuid,text,numeric,date,date,text)','EXECUTE'),
  'Client cannot accept or counter private offers');
select ok(not has_function_privilege('authenticated','public.link_request_offer_listing(uuid,uuid)','EXECUTE'),
  'Client cannot link private offer records to rentals');
select ok(not has_table_privilege('authenticated','public.marketplace_negotiations','SELECT'),
  'Client cannot read negotiation records');
select ok(not has_table_privilege('authenticated','public.negotiation_proposals','SELECT'),
  'Client cannot read proposal records');

set local role authenticated;
set local request.jwt.claims='{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.create_main_item_request('{}',32.78,-96.8,5,true,true)$$,
  '55000','Private offers have been removed. Choose only your match-notification preference.',
  'Renter cannot opt a request into owner offers');
select lives_ok($$select public.create_main_item_request(
  jsonb_build_object('p_id','c4000000-0000-4000-8000-000000000001',
    'p_idempotency_key','c5000000-0000-4000-8000-000000000001',
    'p_category_id','c3000000-0000-4000-8000-000000000001',
    'p_title','Need a projector','p_description','A projector for a local community event.',
    'p_intended_use',null,'p_start_date',current_date+10,'p_end_date',current_date+12,
    'p_location_label','Dallas, TX','p_max_daily_budget',null,'p_quantity',1,
    'p_specifications',null,'p_additional_notes',null,'p_visibility','public',
    'p_reference_image_paths','[]'::jsonb,'p_country_code','US'),
  32.78,-96.8,5,false,true)$$,'Public item requests still work without private offers or a required daily budget');
select is((select status from public.item_requests where id='c4000000-0000-4000-8000-000000000001'),'open',
  'Request remains available for public listing matches');
select is((select open_for_offers from public.item_requests where id='c4000000-0000-4000-8000-000000000001'),false,
  'New requests are fixed to public listing matches');
select is((select max_daily_budget from public.item_requests where id='c4000000-0000-4000-8000-000000000001'),null::numeric,
  'Request may omit an optional daily budget');
reset role;

select * from finish();
rollback;
