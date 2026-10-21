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
insert into public.listings(id,owner_id,category_id,title,price_per_day,deposit,status,estimated_value,item_condition,location_lat,location_lng,negotiation_enabled)
values
 ('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Completion camera',10,50,'published',200,'good',0,0,true),
 ('94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Completion far camera',10,50,'published',200,'good',1,0,true);
update public.feature_flags set enabled=true where key in ('bidding','item_requests');

select throws_ok($$insert into public.listings(owner_id,category_id,title,price_per_day,status)
 values('91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Missing value',10,'published')$$,
 '23514','Enter an owner-declared value and item condition before publishing','Publication requires declared value and condition');
select throws_ok($$update public.listings set estimated_value='NaN' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514','Estimated value must be a finite amount','Nonfinite valuation rejected');
select throws_ok($$update public.listings set price_per_day='NaN' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Direct writes cannot introduce nonfinite daily prices');
select throws_ok($$update public.listings set price_per_week='NaN' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Direct writes cannot introduce nonfinite weekly prices');
select throws_ok($$update public.listings set deposit='NaN' where id='94000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Direct writes cannot introduce a nonfinite security deposit');
select throws_ok($$update public.listings set offer_minimum_daily=20,offer_guardrail_pct=.3 where id='94000000-0000-4000-8000-000000000001'$$,
 '23514',null,'Impossible minimum/guardrail combinations rejected');

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$update public.listings set owner_verified=true where id='94000000-0000-4000-8000-000000000001'$$,
 '42501','Owner verification can only be assigned by the trusted verification service','Owners cannot self-verify through direct writes');
select lives_ok($$select public.owner_save_listing('94000000-0000-4000-8000-000000000001',1,'{"price_per_day":12}')$$,'Owner saves against expected revision');
select throws_ok($$select public.owner_save_listing('94000000-0000-4000-8000-000000000001',1,'{"price_per_day":11}')$$,
 '40001','This listing changed in another session. Reload before saving.','Stale editor cannot overwrite a newer save');
select lives_ok($$insert into public.listing_images(listing_id,url,sort_order) values('94000000-0000-4000-8000-000000000001','https://example.test/camera.jpg',0)$$,'Owner photo change succeeds before booking');
select is((select count(*)::integer from public.listing_change_history where listing_id='94000000-0000-4000-8000-000000000001'),2,'Owner can retrieve price and photo history');
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

select ok(public.listing_offer_within_rules('94000000-0000-4000-8000-000000000002',10,current_date+10,current_date+12),'Listing offer accepts allowed price/dates');
update public.listings set offer_minimum_daily=9,offer_guardrail_pct=.3 where id='94000000-0000-4000-8000-000000000002';
select ok(not public.listing_offer_within_rules('94000000-0000-4000-8000-000000000002',8,current_date+10,current_date+12),'Listing minimum is authoritative');
select ok(not public.listing_offer_within_rules('94000000-0000-4000-8000-000000000002',14,current_date+10,current_date+12),'Listing maximum guardrail is authoritative');
select ok(not public.listing_offer_within_rules('94000000-0000-4000-8000-000000000002','NaN',current_date+10,current_date+12),'Nonfinite offers are excluded');

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

insert into public.listings(owner_id,category_id,title,price_per_day,status,estimated_value,item_condition,location_lat,location_lng)
select '91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
 'Completion batch camera '||n,10,'published',200,'good',0,0 from generate_series(1,101) n;
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

update public.listings set negotiation_enabled=true,price_per_day=1000+substring(title from '[0-9]+$')::integer
 where title in (select 'Completion batch camera '||n from generate_series(1,7) n)
 and category_id='93000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select lives_ok(format('select public.create_marketplace_offer(null,%L,current_date+20,current_date+22,%L,null,%L)',
 id,price_per_day,gen_random_uuid()),'Renter creates eligible persisted bid: '||title)
 from public.listings where category_id='93000000-0000-4000-8000-000000000001' and price_per_day>1000;
select is(jsonb_array_length(public.get_top_listing_bids()),5,'Public ticker returns exactly five of seven eligible bids');
select is((public.get_top_listing_bids()->0->>'daily_rate')::numeric,1007::numeric,'Ticker ranks highest persisted price first');
select ok(not exists(select 1 from jsonb_array_elements(public.get_top_listing_bids()) bid
 where bid ?| array['ordering_id','proposed_by','renter_id','owner_id','negotiation_id','proposal_id']),'Public ticker omits participant and private proposal identities');
reset role;
update public.negotiation_proposals set expires_at=now()-interval '1 second' where daily_rate=1007 and negotiation_id in
 (select id from public.marketplace_negotiations where renter_id='91000000-0000-4000-8000-000000000002');
select is((public.get_top_listing_bids()->0->>'daily_rate')::numeric,1006::numeric,'Expired highest bid is excluded immediately');
update public.marketplace_negotiations set status='withdrawn' where id in
 (select negotiation_id from public.negotiation_proposals where daily_rate=1006);
select is((public.get_top_listing_bids()->0->>'daily_rate')::numeric,1005::numeric,'Withdrawn negotiation is excluded');
update public.feature_flags set enabled=false where key='bidding';
select is(jsonb_array_length(public.get_top_listing_bids()),0,'Disabling bidding clears the public feed');

update public.listings set available_quantity=2,negotiation_enabled=true
 where title='Completion batch camera 8' and category_id='93000000-0000-4000-8000-000000000001';
insert into public.bookings(listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
select id,owner_id,'91000000-0000-4000-8000-000000000003',current_date+20,current_date+22,10,2,20,.1,2,0,22,'confirmed'
 from public.listings where title='Completion batch camera 8' and category_id='93000000-0000-4000-8000-000000000001';
update public.feature_flags set enabled=true where key='bidding';
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select lives_ok(format('select public.create_marketplace_offer(null,%L,current_date+20,current_date+22,10,null,%L)',id,gen_random_uuid()),
 'A partially booked two-unit listing still accepts a one-unit offer') from public.listings
 where title='Completion batch camera 8' and category_id='93000000-0000-4000-8000-000000000001';
reset role;
update public.item_requests set visibility='private' where id='96000000-0000-4000-8000-000000000001';
select ok(not has_function_privilege('authenticated','public.claim_notification_email_jobs(uuid,integer)','execute'),'Client cannot claim trusted email work');
select is((select count(*)::integer from public.claim_notification_email_jobs('91000000-0000-4000-8000-000000000002',25) claimed
  join public.notification_email_jobs j on j.id=claimed.job_id
  where j.event_key like 'request-match:96000000-0000-4000-8000-000000000001:%'),0,'Claim step never returns matches for a now-private request');
select is((select count(*)::integer from public.notification_email_jobs
  where event_key like 'request-match:96000000-0000-4000-8000-000000000001:%' and status in ('pending','retrying')),0,
  'Send-time eligibility suppresses queued matching emails even before request closure');
select * from finish();
rollback;
