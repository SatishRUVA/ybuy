begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select enabled from public.sandbox_booking_tax_gate where singleton), false, 'Deprecated sandbox gate remains disabled');
select ok(not has_table_privilege('authenticated', 'public.sandbox_booking_tax_gate', 'UPDATE'), 'Renters cannot enable test tax');
select ok(not has_table_privilege('anon', 'public.sandbox_booking_tax_gate', 'SELECT'), 'Anonymous clients cannot access the gate');
select ok(not has_table_privilege('service_role', 'public.sandbox_booking_tax_gate', 'UPDATE'), 'Service API cannot enable the SQL-only gate');

insert into auth.users(id,email,raw_user_meta_data) values
 ('95000000-0000-4000-8000-000000000001','owner@tax.test','{"full_name":"Tax owner"}'),
 ('95000000-0000-4000-8000-000000000002','renter@tax.test','{"full_name":"Tax renter"}');
insert into auth.sessions(id,user_id) values
 ('95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000001'),
 ('95000000-0000-4000-8000-000000000012','95000000-0000-4000-8000-000000000002');
insert into public.categories(id,name) values ('95000000-0000-4000-8000-000000000021','Tax test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,delivery_available,delivery_fee,availability_start,availability_end,instant_booking,available_quantity) values
 ('95000000-0000-4000-8000-000000000031','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000021','Tax test camera','Camera with a case and charger.',10,'draft',200,'good',true,15,current_date+1,current_date+20,true,2);
insert into public.listing_images(listing_id,url,sort_order) values
 ('95000000-0000-4000-8000-000000000031','https://example.test/tax-camera.png',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude) values
 ('95000000-0000-4000-8000-000000000031','95000000-0000-4000-8000-000000000001','Private pickup','Dallas','TX','75201','US',32.8,-96.8);
update public.listings set status='published' where id='95000000-0000-4000-8000-000000000031';
update public.feature_flags set enabled=true where key in ('insurance','owner_promotions');
update public.app_settings set value='0.1'::jsonb where key='platform_fee_pct';
insert into public.owner_promotions(owner_id,listing_id,code,discount_percent) values
 ('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000031','TAX50',50);

alter table public.bookings disable trigger zzzzz_bookings_apply_sandbox_tax;
alter table public.bookings disable trigger zzzzzz_bookings_deposit_authorization_model;
set local role authenticated;
set local request.jwt.claims='{"sub":"95000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"95000000-0000-4000-8000-000000000012","exp":4102444800}';
select lives_ok($$select public.create_booking_request('95000000-0000-4000-8000-000000000031',current_date+1,current_date+3,1,'delivery',null)$$,'Legacy booking uses the ordinary request RPC');
select is((select tax_amount from public.bookings where listing_id='95000000-0000-4000-8000-000000000031'),0::numeric,'Legacy snapshot has zero tax');
select is((select total - deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031'),41::numeric,'Legacy total includes only existing rental, fees, insurance and delivery');
reset role;
alter table public.bookings enable trigger zzzzz_bookings_apply_sandbox_tax;
alter table public.bookings enable trigger zzzzzz_bookings_deposit_authorization_model;
set local role authenticated;
select lives_ok($$select public.create_booking_request('95000000-0000-4000-8000-000000000031',current_date+4,current_date+6,1,'delivery',null)$$,'Ordinary instant booking charges tax with the sandbox gate disabled');
select lives_ok($$select public.record_deposit_hold_consent(id) from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,
 'Renter records consent for the separate temporary deposit authorization');
reset role;
select lives_ok($$select public.complete_booking_deposit_setup(
 (select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 'seti_deposit_fixture','cs_deposit_setup_fixture','cus_deposit_fixture','pm_deposit_fixture')$$,
 'Verified SetupIntent fixture saves a renter payment method');
set local role authenticated;
select is((select tax_amount from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),1.54::numeric,'Tax is seven percent of rental 20 and service fee 2 only');
select is((select tax_rate from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),0.07::numeric,'Rate is explicitly stored');
select is((select sandbox_tax from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),false,'Normal tax snapshot supports live and test payments');
select is((select total from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),42.54::numeric,'New authorization-model booking total excludes deposit');
select is((select a.snapshot->>'tax_amount' from public.rental_agreements a join public.bookings b on b.id=a.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031' and b.start_date=current_date+4),'1.54','Agreement freezes tax amount');
select is((select (a.snapshot->>'tax_rate')::numeric from public.rental_agreements a join public.bookings b on b.id=a.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031' and b.start_date=current_date+4),0.07::numeric,'Agreement freezes rate');
select is((select (a.snapshot->>'sandbox_tax')::boolean from public.rental_agreements a join public.bookings b on b.id=a.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031' and b.start_date=current_date+4),false,'Agreement freezes normal tax marker');
select is((select (a.snapshot->>'total')::numeric from public.rental_agreements a join public.bookings b on b.id=a.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031' and b.start_date=current_date+4),
 (select total from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),'Agreement total is tax-inclusive');
select lives_ok($$select public.create_booking_request_with_owner_promo('95000000-0000-4000-8000-000000000031',current_date+7,current_date+9,1,'TAX50','delivery',null)$$,'Promo request reaches the same tax trigger');
select is((select tax_amount from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+7),0.77::numeric,'Tax uses discounted rental 10 plus recalculated fee 1, not gross rental');
select is((select total from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+7),30.77::numeric,'Promo, delivery, insurance and tax compose without taxing excluded charges');
reset role;

select throws_ok($$update public.bookings set tax_amount=0 where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,
 '42501','Booking tax snapshot is immutable','Privileged updates cannot erase tax');
select throws_ok($$update public.bookings set tax_rate=0 where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,
 '42501','Booking tax snapshot is immutable','Rate cannot change');
select throws_ok($$update public.bookings set sandbox_tax=true where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,
 '42501','Booking tax snapshot is immutable','Test marker cannot change, even after payment');
update public.sandbox_booking_tax_gate set enabled=false;
update public.bookings set updated_at=now() where listing_id='95000000-0000-4000-8000-000000000031';
select is((select total from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),42.54::numeric,'Insurance update cannot drop tax or reprice bookings');
select is((select sandbox_tax from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+1),false,'Old zero-tax booking is not retroactively taxed');
select is((select total - deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+1),41::numeric,'Old total remains unchanged');

select lives_ok($$select public.bind_checkout_session(id,'cs_tax_test') from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,'Tax-inclusive booking binds its checkout session');
select throws_ok($$select public.confirm_booking_payment(id,'cs_tax_test','pi_tax_test',total-tax_amount) from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,
 '23514','Payment details do not match the booking','Payment without tax is rejected');
select lives_ok($$select public.confirm_booking_payment(id,'cs_tax_test','pi_tax_test',total) from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,'Verified payment must match tax-inclusive snapshot');
select is((select total from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),42.54::numeric,'Payment status update preserves tax-inclusive total');
select is((select status from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),'pending_payment',
 'Rental payment alone cannot confirm an authorization-model booking');
select is((select confirmation_gate from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),'awaiting_authorization',
 'Booking gate waits for a successful deposit hold');
select lives_ok($$select public.confirm_booking_payment(id,'cs_tax_test','pi_tax_test',total) from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,'Duplicate exact receipt is idempotent');
select is((select count(*)::integer from public.payments p join public.bookings b on b.id=p.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031'),1,'Verified receipt is stored once');
select ok(not has_function_privilege('authenticated','public.mark_booking_active(uuid)','EXECUTE'),
 'Legacy pickup activation is unavailable while deposit authorization is missing');
reset role;
update public.app_settings set value='168'::jsonb where key='deposit_authorization_lead_hours';
create temporary table prepared_deposit_authorization as
	select public.prepare_booking_deposit_authorization(id,renter_id) as result
	from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4;
select lives_ok($$select public.record_deposit_authorization_event(
 'evt_depositaction','payment_intent.requires_action',
 ((select result->>'id' from prepared_deposit_authorization)::uuid),
 (select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 'pi_deposit_action','requires_action','pm_deposit_fixture',
 (select deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),0,0,null,'Complete additional card authentication')$$,
 'Additional authentication is recorded without confirming the booking');
select is((select confirmation_gate from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 'authorization_action_required','Booking gate exposes additional authentication');
create temporary table retried_deposit_authorization as
	select public.prepare_booking_deposit_authorization(id,renter_id) as result
	from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4;
select is((select (result->>'attempt')::integer from retried_deposit_authorization),3,'Failed authentication gets a fresh idempotent authorization attempt');
select lives_ok($$select public.record_deposit_authorization_event(
 'evt_depositauthfixture','payment_intent.amount_capturable_updated',
 ((select result->>'id' from retried_deposit_authorization)::uuid),
 (select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 'pi_deposit_fixture','requires_capture','pm_deposit_fixture',
 (select deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),0,
 (select deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 clock_timestamp()+interval '10 days',null)$$,'Stripe capturable event confirms the separate hold');
select is((select status from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),'confirmed',
 'Booking confirms only after rental payment and deposit authorization both succeed');
select is((select confirmation_gate from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),'confirmed',
 'Explicit booking confirmation gate reaches confirmed');
select lives_ok($$select public.record_deposit_authorization_event(
 'evt_depositduplicate','payment_intent.payment_failed',
 ((select result->>'id' from retried_deposit_authorization)::uuid),
 (select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 'pi_deposit_fixture','requires_capture','pm_deposit_fixture',
 (select deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),0,
 (select deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 clock_timestamp()+interval '10 days',null)$$,'A distinct stale event reconciles the current Stripe intent state');
select lives_ok($$select public.record_deposit_authorization_event(
 'evt_depositduplicate','payment_intent.payment_failed',
 ((select result->>'id' from retried_deposit_authorization)::uuid),
 (select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 'pi_deposit_fixture','requires_capture','pm_deposit_fixture',
 (select deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),0,
 (select deposit from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4),
 clock_timestamp()+interval '10 days',null)$$,'Duplicate Stripe event IDs are idempotent');
select is((select status from public.booking_deposit_authorizations where booking_id=(select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4) order by attempt desc limit 1),
 'authorized','Deposit authorization status is reconciled');
select ok((select capture_before>clock_timestamp() from public.booking_deposit_authorizations where booking_id=(select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4) order by attempt desc limit 1),
 'Actual capture_before timestamp is persisted');
update public.booking_deposit_authorizations set capture_before=clock_timestamp()-interval '1 second'
where booking_id=(select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4)
	and status='authorized';
set local role authenticated;
select ok(not has_function_privilege('authenticated','public.mark_booking_active(uuid)','EXECUTE'),
 'Legacy pickup activation remains unavailable after a deposit hold expires');
reset role;
update public.booking_deposit_authorizations set capture_before=clock_timestamp()+interval '10 days'
where booking_id=(select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4)
	and status='authorized';
set local role authenticated;
select ok(not has_function_privilege('authenticated','public.mark_booking_active(uuid)','EXECUTE'),
 'Pickup activation always requires the verified handoff workflow');
reset role;
update public.bookings set status='completed',return_confirmed_at=clock_timestamp()
where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4;
insert into public.rental_settlements(booking_id,payment_id,deposit_amount,owner_amount,refund_status)
select b.id,p.id,b.deposit,b.subtotal+coalesce(b.delivery_fee_amount,0),'not_required'
from public.bookings b join public.payments p on p.booking_id=b.id
where b.listing_id='95000000-0000-4000-8000-000000000031' and b.start_date=current_date+4;
select is((select s.owner_amount from public.rental_settlements s join public.bookings b on b.id=s.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031'),35::numeric,'Owner receives rental plus delivery, never tax, service or insurance');
select lives_ok($$select public.claim_rental_settlement(id,'refund') from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,'Settlement invariant accepts tax-inclusive payment');
select is((select s.deposit_amount from public.rental_settlements s join public.bookings b on b.id=s.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031'),
 0::numeric,'Authorization-model settlement does not refund a captured deposit');
select is((select s.refund_status from public.rental_settlements s join public.bookings b on b.id=s.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031'),
 'not_required','Authorization-model settlement leaves deposit release to its own lifecycle');
insert into public.owner_connect_accounts(owner_id,stripe_account_id) values ('95000000-0000-4000-8000-000000000001','acct_tax_fixture');
select lives_ok($$select public.claim_rental_settlement(id,'transfer') from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,'Tax-inclusive transfer claim succeeds after deposit refund');
select is((select s.owner_amount from public.rental_settlements s join public.bookings b on b.id=s.booking_id where b.listing_id='95000000-0000-4000-8000-000000000031'),35::numeric,'Transfer claim does not include tax');
update public.rental_settlements set owner_amount=owner_amount+1.54 where booking_id=(select id from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4);
select throws_ok($$select public.claim_rental_settlement(id,'refund') from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+4$$,
 'P0001','Payment or settlement amounts do not match the booking','Settlement refuses tax diverted into owner payout');

update public.sandbox_booking_tax_gate set enabled=true;
update public.listings set price_per_day=1.10 where id='95000000-0000-4000-8000-000000000031';
set local role authenticated;
set local request.jwt.claims='{"sub":"95000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"95000000-0000-4000-8000-000000000012","exp":4102444800}';
select lives_ok($$select public.create_booking_request('95000000-0000-4000-8000-000000000031',current_date+10,current_date+11,1,'pickup',null)$$,'Tax threshold booking uses actual server rounding');
select is((select tax_amount from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+10),0.08::numeric,'Rental 1.10 plus fee 0.11 rounds tax down at the threshold');
select is((select sandbox_tax from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+10),false,'Deprecated sandbox gate cannot make new bookings sandbox-only');
reset role;
update public.listings set price_per_day=1.11 where id='95000000-0000-4000-8000-000000000031';
set local role authenticated;
select lives_ok($$select public.create_booking_request('95000000-0000-4000-8000-000000000031',current_date+12,current_date+13,1,'pickup',null)$$,'Next-cent tax threshold booking succeeds');
select is((select tax_amount from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+12),0.09::numeric,'Rental 1.11 plus fee 0.11 crosses the next-cent tax threshold');
reset role;

update public.listings set price_per_day=10,instant_booking=false where id='95000000-0000-4000-8000-000000000031';
set local role authenticated;
select lives_ok($$select public.create_booking_request('95000000-0000-4000-8000-000000000031',current_date+14,current_date+16,2,'delivery',null)$$,'Owner-approval booking with multiple units shares the authoritative tax path');
select is((select status from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+14),'requested','Tax does not bypass owner approval');
select is((select tax_amount from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+14),3.08::numeric,'Multi-unit tax uses discounted rental 40 plus fee 4');
reset role;

alter table public.bookings disable trigger zzzzz_bookings_apply_sandbox_tax;
update public.bookings set sandbox_tax=true
where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+10;
alter table public.bookings enable trigger zzzzz_bookings_apply_sandbox_tax;
update public.bookings set updated_at=now()
where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+10;
select is((select sandbox_tax from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+10),true,'Historical sandbox snapshot stays sandbox-only after updates');
select is((select tax_amount from public.bookings where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+10),0.08::numeric,'Historical sandbox tax is not repriced');
select throws_ok($$update public.bookings set sandbox_tax=false where listing_id='95000000-0000-4000-8000-000000000031' and start_date=current_date+10$$,
 '42501','Booking tax snapshot is immutable','Historical sandbox marker cannot be removed to allow live payment');

select * from finish();
rollback;
