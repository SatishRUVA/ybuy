begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('d0000000-0000-4000-8000-000000000001','recovery-owner@test.invalid','{"full_name":"Owner"}'),
 ('d0000000-0000-4000-8000-000000000002','recovery-renter@test.invalid','{"full_name":"Renter"}'),
 ('d0000000-0000-4000-8000-000000000003','recovery-other@test.invalid','{"full_name":"Other"}');
insert into auth.sessions(id,user_id) values
 ('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001'),
 ('d1000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002'),
 ('d1000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000003');
insert into public.categories(id,name) values('d2000000-0000-4000-8000-000000000001','Recovery test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,availability_start,availability_end)
values ('d3000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
 'd2000000-0000-4000-8000-000000000001','Recovery item','Synthetic recovery item.',10,'draft',200,'good',current_date,current_date+10);
insert into public.listing_images(listing_id,url,sort_order) values
 ('d3000000-0000-4000-8000-000000000001','https://example.test/recovery.jpg',0);
insert into public.listing_photo_reviews(listing_id,photo_url,decision,reason,review_method)
values ('d3000000-0000-4000-8000-000000000001','https://example.test/recovery.jpg','approved','Synthetic fixture','system');
insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,latitude,longitude,time_zone)
values ('d3000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
 'Private address','123 Test Street','Dallas','TX','75201','US',32.8,-96.8,'UTC');
update public.listings set status='published' where id='d3000000-0000-4000-8000-000000000001';
insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,status)
values ('d4000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
 'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',
 current_date,current_date+1,10,1,10,.1,1,50,61,'pending_payment');
select public.confirm_booking_payment(id,'cs_recovery','pi_recovery',total) from public.bookings where id='d4000000-0000-4000-8000-000000000001';

create function pg_temp.recovery_login(p_user int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','d0000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),
    'role','authenticated','session_id','d1000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),'exp',4102444800)::text,true);
end;
$$;
select throws_ok($$select public.require_booking_precheckin('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',false)$$,
 '55000','Rental payment and an owner-approved slot are required before deposit setup or handoff','A new pickup cannot bypass the slot');
insert into public.booking_handoffs(booking_id,status) values
 ('d4000000-0000-4000-8000-000000000001','pickup_inspection');
select lives_ok($$select public.require_booking_precheckin('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',false)$$,
 'An already-started pickup can recover without a current slot');
select throws_ok($$select public.require_booking_precheckin('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',true)$$,
 '55000','Rental payment and an owner-approved slot are required before deposit setup or handoff','A fresh handoff remains slot gated');
set local role authenticated;
select pg_temp.recovery_login(2);
select is((public.get_booking_precheckin('d4000000-0000-4000-8000-000000000001')->>'can_authorize')::boolean,true,'Renter can renew during started pickup');
select is((public.get_booking_precheckin('d4000000-0000-4000-8000-000000000001')->>'deposit_recovery_required')::boolean,true,'Missing hold requires recovery');
select is(public.get_booking_pickup('d4000000-0000-4000-8000-000000000001')->>'address','Private address','Pickup participant retains address');
select lives_ok($$select public.record_deposit_hold_consent('d4000000-0000-4000-8000-000000000001')$$,'Consent remains available during recovery');
select pg_temp.recovery_login(3);
select throws_ok($$select public.get_booking_pickup('d4000000-0000-4000-8000-000000000001')$$,
 '42501','Booking not found','Outsiders cannot access the address');
reset role;
insert into public.renter_stripe_customers(renter_id,stripe_customer_id,default_payment_method_id,consent_at)
values ('d0000000-0000-4000-8000-000000000002','cus_recovery','pm_recovery',now());
select pg_temp.recovery_login(2);
select is(
 public.prepare_booking_deposit_authorization('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002')->>'id',
 public.prepare_booking_deposit_authorization('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002')->>'id',
 'Retries reuse the reserved provider attempt');
select is((select count(*)::integer from public.booking_deposit_authorizations
 where booking_id='d4000000-0000-4000-8000-000000000001'),2,'Replacement preserves the original attempt without duplicates');
update public.booking_deposit_authorizations set last_attempt_at=clock_timestamp()-interval '21 hours'
 where booking_id='d4000000-0000-4000-8000-000000000001' and last_attempt_at is not null;
select throws_ok($$select public.prepare_booking_deposit_authorization('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002')$$,
 '55000','Authorization outcome is unknown; contact support for reconciliation','Aged unknown provider requests cannot create another hold');
update public.booking_deposit_authorizations set last_attempt_at=clock_timestamp()
 where booking_id='d4000000-0000-4000-8000-000000000001' and last_attempt_at is not null;
update public.booking_deposit_authorizations set status='failed',stripe_payment_intent_id='pi_uncertain'
 where booking_id='d4000000-0000-4000-8000-000000000001' and last_attempt_at is not null;
select throws_ok($$select public.prepare_booking_deposit_authorization('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002')$$,
 '55000','Authorization outcome requires support reconciliation','An early failed webhook cannot create a duplicate unbound attempt');
update public.booking_deposit_authorizations set status='scheduled',stripe_payment_intent_id=null
 where booking_id='d4000000-0000-4000-8000-000000000001' and last_attempt_at is not null;
select lives_ok($$select public.bind_deposit_authorization_checkout_session(
 (select id from public.booking_deposit_authorizations where booking_id='d4000000-0000-4000-8000-000000000001' order by attempt desc limit 1),'cs_recovery_hold')$$,
 'The checkout session binds to the reserved attempt');
select lives_ok($$select public.bind_deposit_authorization_checkout_session(
 (select id from public.booking_deposit_authorizations where booking_id='d4000000-0000-4000-8000-000000000001' order by attempt desc limit 1),'cs_recovery_hold')$$,
 'Repeating a binding is idempotent');
select throws_ok($$select public.bind_deposit_authorization_checkout_session(
 (select id from public.booking_deposit_authorizations where booking_id='d4000000-0000-4000-8000-000000000001' order by attempt desc limit 1),'cs_different_hold')$$,
 '40001','Authorization session binding requires reconciliation','Conflicting checkout bindings fail closed');
select is(public.booking_financial_settlement_eligible('d4000000-0000-4000-8000-000000000001'),false,'Unreturned booking is not settlement eligible');
update public.bookings set status='completed',return_confirmed_at=clock_timestamp()
 where id='d4000000-0000-4000-8000-000000000001';
select is(public.booking_financial_settlement_eligible('d4000000-0000-4000-8000-000000000001'),true,'Verified return without dispute is eligible');
insert into public.operations_cases(id,kind,booking_id,created_by,participant_id,category,subject)
values('d5000000-0000-4000-8000-000000000001','dispute','d4000000-0000-4000-8000-000000000001',
 'd0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','other','Return discrepancy');
select is(public.booking_financial_settlement_eligible('d4000000-0000-4000-8000-000000000001'),false,'Open dispute freezes settlement');
update public.operations_cases set status='closed' where id='d5000000-0000-4000-8000-000000000001';
select is(public.booking_financial_settlement_eligible('d4000000-0000-4000-8000-000000000001'),true,'Closed dispute permits eligibility checks');
select * from finish();
rollback;
