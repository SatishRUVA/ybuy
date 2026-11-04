begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('91000000-0000-4000-8000-000000000001','owner@delivery.test','{"full_name":"Delivery owner"}'),
 ('91000000-0000-4000-8000-000000000002','renter@delivery.test','{"full_name":"Delivery renter"}');
insert into auth.sessions(id,user_id) values
 ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001'),
 ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002');
insert into public.categories(id,name) values ('93000000-0000-4000-8000-000000000001','Delivery test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,delivery_available,delivery_fee,availability_start,availability_end,instant_booking) values
 ('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Delivery test camera','Camera with its case and charger.',10,'draft',200,'good',true,15,current_date+1,current_date+20,true);
insert into public.listing_images(listing_id,url,sort_order) values
 ('94000000-0000-4000-8000-000000000001','https://example.test/delivery-camera.png',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude) values
 ('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Private pickup','Dallas','TX','75201','US',32.8,-96.8);
update public.listings set status='published' where id='94000000-0000-4000-8000-000000000001';
update public.feature_flags set enabled=false where key='insurance';
update public.app_settings set value='0.1'::jsonb where key='platform_fee_pct';

select ok(not has_function_privilege('anon','public.create_booking_request(uuid,date,date,integer,text,text)','EXECUTE'),'Anonymous clients cannot create delivery bookings');
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.create_booking_request('94000000-0000-4000-8000-000000000001',current_date+1,current_date+3,1,'invalid',null)$$,
 '22023','Choose pickup or delivery for handoff','Invalid handoff mode is rejected');
select throws_ok($$select public.create_booking_request('94000000-0000-4000-8000-000000000001',current_date+1,current_date+3,1,'pickup',repeat('x',501))$$,
 '22023','Keep the booking note under 500 characters','Oversized notes are rejected');
select lives_ok($$select public.create_booking_request('94000000-0000-4000-8000-000000000001',current_date+1,current_date+3,1,'delivery','  Please bring the charger.  ')$$,'Delivery booking uses the real availability and pricing path');
select is((select total from public.bookings where listing_id='94000000-0000-4000-8000-000000000001'),42.54::numeric,'Delivery fee, mandatory insurance and tax are included in payable total; deposit is authorized separately');
select is((select delivery_fee_amount from public.bookings where listing_id='94000000-0000-4000-8000-000000000001'),15::numeric,'Delivery fee is frozen from the listing');
select is((select renter_note from public.bookings where listing_id='94000000-0000-4000-8000-000000000001'),'Please bring the charger.','Note is trimmed and persisted');
select is((select (a.snapshot->>'total')::numeric from public.rental_agreements a join public.bookings b on b.id=a.booking_id where b.listing_id='94000000-0000-4000-8000-000000000001'),
 (select total from public.bookings where listing_id='94000000-0000-4000-8000-000000000001'),'Instant-booking agreement captures the delivery-inclusive total before freezing');
select is((select a.snapshot->>'delivery_mode' from public.rental_agreements a join public.bookings b on b.id=a.booking_id where b.listing_id='94000000-0000-4000-8000-000000000001'),'delivery','Agreement freezes the selected handoff mode');
update public.bookings set delivery_fee_amount=0,renter_note='Changed directly' where listing_id='94000000-0000-4000-8000-000000000001';
select is((select delivery_fee_amount from public.bookings where listing_id='94000000-0000-4000-8000-000000000001'),15::numeric,'RLS prevents clients from changing the frozen delivery fee');
select is((select renter_note from public.bookings where listing_id='94000000-0000-4000-8000-000000000001'),'Please bring the charger.','RLS prevents clients from replacing the saved note directly');
select throws_ok($$select public.create_booking_request('94000000-0000-4000-8000-000000000001',current_date+1,current_date+3,1,'delivery',null)$$,
 '23P01','Listing is not available for the requested dates and quantity','Delivery cannot bypass capacity');
select lives_ok($$select public.create_booking_request('94000000-0000-4000-8000-000000000001',current_date+4,current_date+6,1,'pickup',repeat('x',500))$$,'Pickup accepts a 500-character note');
select is((select total from public.bookings where listing_id='94000000-0000-4000-8000-000000000001' and delivery_mode='pickup'),27.54::numeric,'Pickup has no delivery charge and includes mandatory insurance and tax');
reset role;
update public.feature_flags set enabled=true where key='owner_promotions';
insert into public.owner_promotions(owner_id,listing_id,code,discount_percent) values
 ('91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','DELIVERY50',50);
set local role authenticated;
select lives_ok($$select public.create_booking_request_with_owner_promo('94000000-0000-4000-8000-000000000001',current_date+7,current_date+9,1,'DELIVERY50','delivery','Promo handoff')$$,'Promotion and delivery share the real booking path');
select is((select total from public.bookings where listing_id='94000000-0000-4000-8000-000000000001' and owner_promotion_code='DELIVERY50'),30.77::numeric,'Promotion discounts rental and fee, not delivery, mandatory insurance or tax');
reset role;
update public.feature_flags set enabled=true where key='insurance';
set local role authenticated;
select lives_ok($$select public.create_booking_request('94000000-0000-4000-8000-000000000001',current_date+13,current_date+15,1,'delivery',null)$$,'Insurance and delivery are priced in the same insert');
select is((select total from public.bookings where listing_id='94000000-0000-4000-8000-000000000001' and start_date=current_date+13),42.54::numeric,'Insurance, delivery and tax are included without leaking the previous promo');
reset role;
update public.listings set delivery_available=false,delivery_fee=0 where id='94000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_booking_request('94000000-0000-4000-8000-000000000001',current_date+10,current_date+12,1,'delivery',null)$$,
 '23514','Delivery is not available for this listing','Pickup-only listings reject delivery');
reset role;

select lives_ok($$select public.confirm_booking_payment(b.id,'cs_delivery_test','pi_delivery_test',b.total) from public.bookings b where b.listing_id='94000000-0000-4000-8000-000000000001' and b.start_date=current_date+1$$,'Exact delivery-inclusive payment is verified');
select ok(not has_function_privilege('authenticated','public.complete_booking_return(uuid)','EXECUTE'),
 'Return completion is unavailable through the legacy one-tap RPC');
update public.bookings set status='completed',return_confirmed_at=clock_timestamp()
where listing_id='94000000-0000-4000-8000-000000000001' and start_date=current_date+1;
insert into public.rental_settlements(booking_id,payment_id,deposit_amount,owner_amount,refund_status)
select b.id,p.id,b.deposit,b.subtotal+coalesce(b.delivery_fee_amount,0),'pending'
from public.bookings b join public.payments p on p.booking_id=b.id
where b.listing_id='94000000-0000-4000-8000-000000000001' and b.start_date=current_date+1;
select is((select s.owner_amount from public.rental_settlements s join public.bookings b on b.id=s.booking_id where b.listing_id='94000000-0000-4000-8000-000000000001'),35::numeric,'Owner settlement includes frozen delivery, excluding service fee, insurance and deposit');
reset role;

select * from finish();
rollback;
