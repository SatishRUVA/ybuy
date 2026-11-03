begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('91000000-0000-4000-8000-000000000001','completion-owner@example.test'),
 ('91000000-0000-4000-8000-000000000002','completion-renter@example.test'),
 ('91000000-0000-4000-8000-000000000003','completion-other@example.test');
insert into auth.sessions(id,user_id) select
 ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.categories(id,name) values('93000000-0000-4000-8000-000000000001','Completion fixture');
update public.app_settings set value='366'::jsonb where key='listing_duration_days';
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,deposit,status,estimated_value,item_condition,location_lat,location_lng,availability_start,availability_end)
values
 ('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Completion camera','A camera used for isolated marketplace completion tests.',10,50,'draft',200,'good',0,0,current_date,current_date+366),
 ('94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Completion far camera','A second camera used for isolated marketplace completion tests.',10,50,'draft',200,'good',1,0,current_date,current_date+366);
insert into public.listing_images(listing_id,url,sort_order) values
 ('94000000-0000-4000-8000-000000000001','https://example.test/completion-camera.jpg',0),
 ('94000000-0000-4000-8000-000000000002','https://example.test/completion-far-camera.jpg',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,latitude,longitude)
select id,owner_id,'Private test pickup','Test City','TX','75201',location_lat,location_lng from public.listings where id in
 ('94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002');
update public.listings set status='published' where id in
 ('94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002');
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001","exp":4102444800}';
reset role;
update public.feature_flags set enabled=true where key in ('bidding','item_requests');

select throws_ok($$insert into public.listings(owner_id,category_id,title,price_per_day,status)
 values('91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Missing value',10,'published')$$,
 '23514','Enter an owner-declared value and item condition before publishing','Publication requires declared value and condition');
select throws_ok($$update public.listings set estimated_value='NaN' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514','Estimated replacement value must be between $0 and $5000. Items above this limit cannot be listed.','Nonfinite valuation rejected');
select throws_ok($$update public.listings set price_per_day='NaN' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Direct writes cannot introduce nonfinite daily prices');
select throws_ok($$update public.listings set price_per_week='NaN' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Direct writes cannot introduce nonfinite weekly prices');
select throws_ok($$update public.listings set deposit='NaN' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Direct writes cannot introduce a nonfinite security deposit');

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$update public.listings set owner_verified=true where id='94000000-0000-4000-8000-000000000001'$$,
 '42501','Owner verification can only be assigned by the trusted verification service','Owners cannot self-verify through direct writes');
select lives_ok(format('select public.owner_save_listing(%L,(select revision from public.listings where id=%L),%L)',
 '94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','{"price_per_day":12}'),'Owner saves against expected revision');
select throws_ok($$select public.owner_save_listing('94000000-0000-4000-8000-000000000001',1,'{"price_per_day":11}')$$,
 '40001','This listing changed in another session. Reload before saving.','Stale editor cannot overwrite a newer save');
select lives_ok($$insert into public.listing_images(listing_id,url,sort_order) values('94000000-0000-4000-8000-000000000001','https://example.test/camera.jpg',0)$$,'Owner photo change succeeds before booking');
select is((select count(*)::integer from public.listing_change_history where listing_id='94000000-0000-4000-8000-000000000001'),5,'Owner can retrieve setup, price and photo history');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000003","exp":4102444800}';
select is((select count(*)::integer from public.listing_change_history),0,'Other users cannot read listing edit history');
select throws_ok($$select public.owner_save_listing('94000000-0000-4000-8000-000000000001',3,'{"price_per_day":1}')$$,
 '42501','Listing not found or not owned','Cross-account listing save denied');
reset role;

insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
values('95000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',
 '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
 current_date+100,current_date+102,12,2,24,.1,2.4,50,76.4,'pending_payment');
select ok((select checkout_expires_at between clock_timestamp()+interval '14 minutes 55 seconds' and clock_timestamp()+interval '15 minutes'
 from public.bookings where id='95000000-0000-4000-8000-000000000001'),'Checkout deadline starts at server approval time and lasts fifteen minutes');
select is((select count(*)::integer from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000001'),1,'Approved booking creates one persisted agreement');
select is((select snapshot->>'legal_status' from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000001'),'approval_pending','Absent approved terms are not represented as a legal contract');
select throws_ok($$update public.listings set title='Swapped camera' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514','Item, location and quantity changes require existing approved rentals to finish. Future pricing may still be updated.','Approved rental prevents material item substitution');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$delete from public.listing_images where listing_id='94000000-0000-4000-8000-000000000001'$$,
 '23514','Photos and pickup details cannot change while an approved rental is outstanding','Approved rental protects its photos');
select lives_ok($$update public.listings set price_per_day=15 where id='94000000-0000-4000-8000-000000000001'$$,'Future price can change without modifying existing terms');
select is((select (snapshot->>'daily_rate')::numeric from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000001'),12::numeric,'Agreement preserves original booked daily rate');
select throws_ok($$update public.rental_agreements set snapshot='{}' where booking_id='95000000-0000-4000-8000-000000000001'$$,
 '42501','Rental documents and acceptances are immutable','Even privileged updates cannot rewrite agreement');
select ok(not has_function_privilege('authenticated','public.capture_rental_agreement(uuid)','execute'),'Clients cannot fabricate agreements');
select ok(not has_function_privilege('authenticated','public.bind_checkout_session(uuid,text)','execute'),'Clients cannot bind arbitrary payment sessions');

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select is(public.get_rental_agreement('95000000-0000-4000-8000-000000000001')->'snapshot'->>'legal_status','approval_pending','Renter retrieves persisted snapshot');
select throws_ok($$select public.accept_rental_agreement((select id from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000001'),1)$$,
 '55000','Legal policy approval is required before agreement acceptance','Acceptance blocked until an approved template was captured');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000003","exp":4102444800}';
select throws_ok($$select public.get_rental_agreement('95000000-0000-4000-8000-000000000001')$$,'42501','Booking not found','Unrelated account cannot retrieve agreement');
select is((select count(*)::integer from public.rental_agreements),0,'Agreement RLS excludes unrelated users');
select throws_ok($$select public.get_checkout_reservation('95000000-0000-4000-8000-000000000001')$$,'42501','Booking not found','Reservation timing is participant-only');
reset role;
select lives_ok($$select public.bind_checkout_session('95000000-0000-4000-8000-000000000001','cs_completion')$$,'Trusted provider binds session to reservation');
select lives_ok($$select public.bind_checkout_session('95000000-0000-4000-8000-000000000001','cs_completion')$$,'Binding retries reuse the same session');
select throws_ok($$select public.bind_checkout_session('95000000-0000-4000-8000-000000000001','cs_different')$$,'23514','Conflicting checkout session','Different session cannot replace binding');
update public.bookings set checkout_expires_at=now()-interval '1 second' where id='95000000-0000-4000-8000-000000000001';
select ok(public.listing_has_capacity('94000000-0000-4000-8000-000000000001',current_date+100,current_date+102),'Expired hold no longer consumes capacity before cron runs');
select is(public.expire_listing_checkouts('94000000-0000-4000-8000-000000000001'),1,'Expiration cancels overdue checkout');
select is(public.expire_listing_checkouts('94000000-0000-4000-8000-000000000001'),0,'Expiration is idempotent');
select lives_ok($$select public.confirm_booking_payment('95000000-0000-4000-8000-000000000001','cs_completion','pi_completion',76.4)$$,'Verified delayed payment reclaims still-free inventory');
select is((select status from public.bookings where id='95000000-0000-4000-8000-000000000001'),'confirmed','Late payment only confirms after capacity revalidation');
select lives_ok($$select public.confirm_booking_payment('95000000-0000-4000-8000-000000000001','cs_completion','pi_completion',76.4)$$,'Delayed webhook retry is idempotent');
select is((select count(*)::integer from public.payments where booking_id='95000000-0000-4000-8000-000000000001'),1,'Retry does not duplicate payment');

select ok(not has_function_privilege('authenticated','public.listing_offer_within_rules(uuid,numeric,date,date)','EXECUTE'),
 'Listing offer eligibility helper is revoked');

create temp table located_payload as select jsonb_build_object(
 'p_id','96000000-0000-4000-8000-000000000001','p_idempotency_key','97000000-0000-4000-8000-000000000001',
 'p_category_id','93000000-0000-4000-8000-000000000001','p_title','Need completion camera','p_description','Camera needed for isolated matching validation.',
 'p_intended_use',null,'p_start_date',current_date+10,'p_end_date',current_date+12,
 'p_location_label','Zero coordinate test area','p_max_daily_budget',20,'p_quantity',1,
 'p_specifications',null,'p_additional_notes',null,'p_visibility','public','p_reference_image_paths','[]'::jsonb) payload;
grant select on located_payload to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select lives_ok($$select public.create_located_item_request((select payload from located_payload),0,0,5)$$,'Located request accepts zero coordinates and five-mile radius');
select lives_ok($$select public.create_located_item_request((select payload from located_payload),0,0,5)$$,'Identical request retry is idempotent');
select throws_ok($$select public.create_located_item_request((select payload||'{"p_title":"Different request"}' from located_payload),0,0,5)$$,
 '22023','Request retry has different details or location settings','Idempotency key cannot be reused for changed details');
select throws_ok($$select public.create_located_item_request((select payload from located_payload),null,0,5)$$,
 '22023','Choose a valid city or postal code and search radius','Missing coordinate is not a geographic match');
select throws_ok($$select public.update_item_request('96000000-0000-4000-8000-000000000001','Need completion camera',
 '93000000-0000-4000-8000-000000000001','Camera needed for isolated matching validation.',null,
 current_date+10,current_date+12,'Changed unverified area',20,1,null,null,'public')$$,
 '22023','Cancel this request and create a new one to change its verified area','Verified request area cannot become stale after a label edit');
select is(jsonb_array_length(public.get_request_listing_matches(array['96000000-0000-4000-8000-000000000001'::uuid])->'96000000-0000-4000-8000-000000000001'),1,'Only nearby eligible listing is returned, not far inventory');
reset role;
select is(public.process_item_request_matches(),1,'Matcher persists a genuine nearby match');
select is(public.process_item_request_matches(),0,'Repeated matcher run creates no duplicate matches');
select is((select count(*)::integer from public.notifications where event_key like 'request-match:96000000-0000-4000-8000-000000000001:%'),2,'One Owner and one Renter notification created');
select lives_ok($$insert into public.listing_availability(listing_id,date,is_available) values('94000000-0000-4000-8000-000000000002',current_date+10,true)$$,'Availability changes requeue matching');
select ok(exists(select 1 from public.item_request_match_queue where request_id='96000000-0000-4000-8000-000000000001'),'Inventory release enqueues matching');
update public.item_requests set status='cancelled' where id='96000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.item_request_match_queue where request_id='96000000-0000-4000-8000-000000000001'),0,'Request closure removes queued matching');
select is((select count(*)::integer from public.notification_email_jobs where event_key like 'request-match:96000000-0000-4000-8000-000000000001:%' and status in ('pending','retrying')),0,'Closure stops pending match emails');

insert into public.listings(owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,location_lat,location_lng,availability_start,availability_end)
select '91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
 'Completion batch camera '||n,'A published test fixture for marketplace matching and bidding.',10,'draft',200,'good',0,0,current_date,current_date+366
from generate_series(1,101) n;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001","exp":4102444800}';
insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/'||id||'.jpg',0 from public.listings where title like 'Completion batch camera %';
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,latitude,longitude)
select id,owner_id,'Private test pickup','Test City','TX','75201',location_lat,location_lng
from public.listings where title like 'Completion batch camera %';
update public.listings set status='published' where title like 'Completion batch camera %';
update public.item_requests set status='open' where id='96000000-0000-4000-8000-000000000001';
select is(public.process_item_request_matches(),100,'Matcher processes a bounded first page of 100 additional listings');
select ok(exists(select 1 from public.item_request_match_queue where request_id='96000000-0000-4000-8000-000000000001'),'More than 100 matches remain durably queued');
select is(public.process_item_request_matches(),1,'Next run processes the remaining match rather than silently dropping it');
select is((select count(*)::integer from public.item_request_listing_matches where request_id='96000000-0000-4000-8000-000000000001'),102,'All eligible listings are persisted across batches');

insert into public.rental_agreement_templates(version,terms,approved_by,approval_reference)
values(1000000,'TEST FIXTURE ONLY - NOT APPROVED FOR ANY REAL RENTAL.','91000000-0000-4000-8000-000000000001','Rollback-only fixture');
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
values('95000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000002',
 '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',current_date+110,current_date+112,10,2,20,.1,2,50,72,'pending_payment');
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select lives_ok($$select public.accept_rental_agreement((select id from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000002'),1)$$,'Participant accepts a snapshot with a test-only approved-template fixture');
select lives_ok($$select public.accept_rental_agreement((select id from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000002'),1)$$,'Agreement acceptance retry is idempotent');
select is((select count(*)::integer from public.rental_agreement_acceptances),1,'One acceptance receipt persists');
select throws_ok($$select public.accept_rental_agreement((select id from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000002'),2)$$,'40001','Agreement version mismatch','Stale agreement version cannot be accepted');
reset role;
update public.bookings set checkout_expires_at=now()-interval '1 second' where id='95000000-0000-4000-8000-000000000002';
select public.expire_listing_checkouts('94000000-0000-4000-8000-000000000002');
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
values('95000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000002',
 '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',current_date+110,current_date+112,10,2,20,.1,2,50,72,'confirmed');
select lives_ok($$select public.confirm_booking_payment('95000000-0000-4000-8000-000000000002','cs_conflict','pi_conflict',72)$$,'Verified late conflicting payment is durably recorded for review');
select is((select status from public.bookings where id='95000000-0000-4000-8000-000000000002'),'cancelled','Late payment never displaces another rental');
select is((select count(*)::integer from public.checkout_payment_exceptions where booking_id='95000000-0000-4000-8000-000000000002'),1,'Financial exception is persisted');
select lives_ok($$select public.confirm_booking_payment('95000000-0000-4000-8000-000000000002','cs_conflict','pi_conflict',72)$$,'Repeated conflicting payment does not duplicate reconciliation');

select ok(not has_function_privilege('authenticated','public.create_marketplace_offer(uuid,uuid,date,date,numeric,text,uuid)','EXECUTE'),
 'Clients cannot create private request or listing offers');
select ok(not has_function_privilege('authenticated','public.respond_to_marketplace_offer(uuid,text,numeric,date,date,text)','EXECUTE'),
 'Clients cannot accept or counter private offers');
select is(jsonb_array_length(public.get_top_listing_bids()),0,'Private offers cannot enter the public bidding ticker');
update public.feature_flags set enabled=false where key='bidding';
select is(jsonb_array_length(public.get_top_listing_bids()),0,'Disabling bidding clears the public feed');

update public.item_requests set visibility='private' where id='96000000-0000-4000-8000-000000000001';
select ok(not has_function_privilege('authenticated','public.claim_notification_email_jobs(uuid,integer)','execute'),'Client cannot claim trusted email work');
select is((select count(*)::integer from public.claim_notification_email_jobs('91000000-0000-4000-8000-000000000002',25) claimed
  join public.notification_email_jobs j on j.id=claimed.job_id
  where j.event_key like 'request-match:96000000-0000-4000-8000-000000000001:%'),0,'Claim step never returns matches for a now-private request');
select is((select count(*)::integer from public.notification_email_jobs
  where event_key like 'request-match:96000000-0000-4000-8000-000000000001:%' and status in ('pending','retrying')),0,
  'Send-time eligibility suppresses queued matching emails even before request closure');

-- Owner-funded discounts: a promo replaces (never stacks with) a duration discount.
update public.feature_flags set enabled=true where key in ('duration_discounts','owner_promotions');
update public.listings set price_per_day=12 where id='94000000-0000-4000-8000-000000000001';
update public.listings set duration_discount_min_days=3,duration_discount_percent=10
 where id='94000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.owner_save_promotion('94000000-0000-4000-8000-000000000001','CAMERA20',20,true)$$,
 'Owner configures a single listing promotion');
select is((public.owner_quote_promotion('94000000-0000-4000-8000-000000000001','camera20',3,1)->>'discount_amount')::numeric,7.2::numeric,
 'Promotion quote returns the owner-funded discount');
reset role;
select set_config('ybuy.owner_promotion_code','CAMERA20',true);
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
values('95000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000001',
 '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
 current_date+140,current_date+143,12,3,36,.1,3.6,50,89.6,'pending_payment');
select is((select owner_discount_amount from public.bookings where id='95000000-0000-4000-8000-000000000004'),7.2::numeric,
 'Promotion overrides the eligible long-rental discount');
select is((select owner_discount_source from public.bookings where id='95000000-0000-4000-8000-000000000004'),'promotion',
 'Booking records which owner-funded discount was used');
select is((select subtotal from public.bookings where id='95000000-0000-4000-8000-000000000004'),28.8::numeric,
 'Promotion reduces rental subtotal before service fee');
select is((select total from public.bookings where id='95000000-0000-4000-8000-000000000004'),81.68::numeric,
 'Promotion-adjusted amount includes fee and deposit');
select set_config('ybuy.owner_promotion_code','',true);
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
values('95000000-0000-4000-8000-000000000005','94000000-0000-4000-8000-000000000001',
 '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
 current_date+150,current_date+153,12,3,36,.1,3.6,50,89.6,'requested');
select is((select owner_discount_amount from public.bookings where id='95000000-0000-4000-8000-000000000005'),3.6::numeric,
 'Eligible long rental receives the configured duration discount');
select is((select owner_discount_source from public.bookings where id='95000000-0000-4000-8000-000000000005'),'duration',
 'Booking records duration as the discount source when no promo is used');

-- Dummy terms require an explicit test flag and are visibly marked in immutable snapshots.
insert into public.admin_users(user_id,role)
values('91000000-0000-4000-8000-000000000003','super_admin');
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000003","iss":"https://xwmnfnhnnxxaarbfkqrp.supabase.co/auth/v1","exp":4102444800}';
select throws_ok($$select public.admin_publish_test_dummy_terms('testing')$$,'55000','Test dummy terms are disabled',
 'Dummy rental terms cannot be published until the test-only flag is explicitly enabled');
reset role;
update public.feature_flags set enabled=true where key='test_dummy_legal_terms';
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000003","iss":"https://xwmnfnhnnxxaarbfkqrp.supabase.co/auth/v1","exp":4102444800}';
select throws_ok($$select public.admin_publish_test_dummy_terms('testing')$$,'55000',
 'Test-only terms may only be published in the local or approved test project',
 'Fictional legal text cannot be published from a production Supabase project');
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000003","iss":"http://localhost:54321/auth/v1","exp":4102444800}';
select lives_ok($$select public.admin_publish_test_dummy_terms('isolated end-to-end verification')$$,
 'Authorized test admin can publish explicitly labeled sample terms');
reset role;
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
values('95000000-0000-4000-8000-000000000006','94000000-0000-4000-8000-000000000001',
 '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
 current_date+160,current_date+162,12,2,24,.1,2.4,50,76.4,'pending_payment');
select is((select snapshot->>'legal_status' from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000006'),
 'test_dummy','Agreement snapshot identifies test-only terms without representing them as approved legal text');
select ok((select (snapshot->>'test_only_dummy_terms')::boolean from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000006'),
 'Agreement snapshot explicitly marks fictional terms as test-only');
select is((select snapshot->>'promo_code' from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000004'),
 'CAMERA20','Immutable agreement preserves the promotion code captured at booking time');
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select lives_ok($$select public.accept_rental_agreement((select id from public.rental_agreements where booking_id='95000000-0000-4000-8000-000000000006'),1)$$,
 'Test renter can accept clearly marked dummy terms for the isolated test flow');
reset role;

select * from finish();
rollback;



