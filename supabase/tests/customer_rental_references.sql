begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is(public.format_customer_rental_reference('YB',2026,999999),'YB-26-999999','Six-digit booking references are zero padded');
select is(public.format_customer_rental_reference('YB',2026,1000000),'YB-26-1000000','Long booking sequences are never truncated');
select is(public.format_customer_rental_reference('RA',2026,1000000),'RA-26-1000000','Agreement references preserve the full booking sequence');
select ok(not has_table_privilege('authenticated','public.customer_reference_counters','SELECT'),'Authenticated users cannot inspect reference counters');
select ok(not has_table_privilege('service_role','public.customer_reference_counters','UPDATE'),'Service clients cannot alter reference counters');

insert into auth.users(id,email,raw_user_meta_data) values
 ('96000000-0000-4000-8000-000000000001','owner@references.test','{"full_name":"Reference owner"}'),
 ('96000000-0000-4000-8000-000000000002','renter@references.test','{"full_name":"Reference renter"}'),
 ('96000000-0000-4000-8000-000000000003','outsider@references.test','{"full_name":"Reference outsider"}');
insert into auth.sessions(id,user_id) values
 ('96000000-0000-4000-8000-000000000011','96000000-0000-4000-8000-000000000001'),
 ('96000000-0000-4000-8000-000000000012','96000000-0000-4000-8000-000000000002'),
 ('96000000-0000-4000-8000-000000000013','96000000-0000-4000-8000-000000000003');
insert into public.categories(id,name) values ('96000000-0000-4000-8000-000000000021','Reference test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,delivery_available,delivery_fee,availability_start,availability_end,instant_booking,available_quantity) values
 ('96000000-0000-4000-8000-000000000031','96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000021','Reference test camera','Camera with a case and charger.',10,'draft',200,'good',true,15,current_date+1,current_date+20,true,2);
insert into public.listing_images(listing_id,url,sort_order) values
 ('96000000-0000-4000-8000-000000000031','https://example.test/reference-camera.png',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude) values
 ('96000000-0000-4000-8000-000000000031','96000000-0000-4000-8000-000000000001','Private pickup','Dallas','TX','75201','US',32.8,-96.8);
update public.listings set status='published' where id='96000000-0000-4000-8000-000000000031';

set local role authenticated;
set local request.jwt.claims='{"sub":"96000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000012","exp":4102444800}';
select lives_ok($$select public.create_booking_request('96000000-0000-4000-8000-000000000031',current_date+1,current_date+3,1,'pickup',null)$$,'First booking receives a server-generated customer reference');
select lives_ok($$select public.create_booking_request('96000000-0000-4000-8000-000000000031',current_date+4,current_date+6,1,'pickup',null)$$,'Second booking receives a distinct customer reference');
select throws_ok($$insert into public.bookings
  select (jsonb_populate_record(null::public.bookings,to_jsonb(b)||jsonb_build_object(
    'id','96000000-0000-4000-8000-000000000042','booking_reference','YB-99-999999',
    'status','cancelled','start_date',current_date+10,'end_date',current_date+12
  ))).* from public.bookings b
  where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1$$,
  '42501',null,'Authenticated clients cannot bypass the booking RPC with a chosen reference');
select throws_ok($$insert into public.rental_agreements(agreement_reference,snapshot) values('RA-99-999999','{}')$$,
  '42501',null,'Authenticated clients cannot insert an agreement with a chosen reference');

select ok((select booking_reference ~ '^YB-[0-9]{2}-[0-9]{6,}$'
  from public.bookings where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+1),
  'Booking reference uses the customer format');
select ok((select substring(booking_reference from 4 for 2)=to_char(created_at at time zone 'UTC','YY')
  from public.bookings where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+1),
  'Booking reference year is based on the creation timestamp in UTC');
select isnt(
  (select booking_reference from public.bookings where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+1),
  (select booking_reference from public.bookings where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+4),
  'Booking references are unique');
select is(
  (select substring(booking_reference from 4) from public.bookings where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+1),
  (select substring(agreement_reference from 4) from public.rental_agreements a join public.bookings b on b.id=a.booking_id
    where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1),
  'Rental agreement sequence matches its booking sequence');
select is(
  (select a.snapshot->>'booking_reference' from public.rental_agreements a join public.bookings b on b.id=a.booking_id
    where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1),
  (select booking_reference from public.bookings where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+1),
  'Immutable agreement snapshot includes the customer booking reference');
select is(
  (select a.snapshot->>'agreement_reference' from public.rental_agreements a join public.bookings b on b.id=a.booking_id
    where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1),
  (select a.agreement_reference from public.rental_agreements a join public.bookings b on b.id=a.booking_id
    where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1),
  'Agreement snapshot and public agreement reference agree');
select is(
  (select (public.get_rental_agreement(b.id)->>'agreement_reference') from public.bookings b
    where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1),
  (select a.agreement_reference from public.rental_agreements a join public.bookings b on b.id=a.booking_id
    where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1),
  'Authorized agreement RPC includes its customer reference');
select is(
  (select a.version from public.rental_agreements a join public.bookings b on b.id=a.booking_id
    where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1),
  1,
  'Reference migration preserves agreement version 1');
reset role;

insert into public.bookings
select (jsonb_populate_record(null::public.bookings,to_jsonb(b)||jsonb_build_object(
  'id','96000000-0000-4000-8000-000000000041',
  'booking_reference','YB-99-999999',
  'status','cancelled',
  'start_date',current_date+7,'end_date',current_date+9
))).*
from public.bookings b
where b.listing_id='96000000-0000-4000-8000-000000000031' and b.start_date=current_date+1;
select isnt((select booking_reference from public.bookings where id='96000000-0000-4000-8000-000000000041'),
  'YB-99-999999','Direct inserts cannot choose their own booking reference');
select ok((select booking_reference ~ ('^YB-'||to_char(created_at at time zone 'UTC','YY')||'-[0-9]{6,}$')
  from public.bookings where id='96000000-0000-4000-8000-000000000041'),
  'Direct inserts still receive the authoritative UTC booking reference');
insert into public.rental_agreements(booking_id,owner_id,renter_id,agreement_reference,snapshot)
values('96000000-0000-4000-8000-000000000041','96000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000002','RA-99-999999',
  '{"booking_reference":"YB-99-999999","agreement_reference":"RA-99-999999"}');
select is((select agreement_reference from public.rental_agreements where booking_id='96000000-0000-4000-8000-000000000041'),
  (select 'RA-'||substring(booking_reference from 4) from public.bookings where id='96000000-0000-4000-8000-000000000041'),
  'Direct agreement inserts cannot choose a different sequence');
select is((select snapshot->>'booking_reference' from public.rental_agreements where booking_id='96000000-0000-4000-8000-000000000041'),
  (select booking_reference from public.bookings where id='96000000-0000-4000-8000-000000000041'),
  'Direct agreement inserts cannot spoof the snapshot booking reference');
select is((select snapshot->>'agreement_reference' from public.rental_agreements where booking_id='96000000-0000-4000-8000-000000000041'),
  (select agreement_reference from public.rental_agreements where booking_id='96000000-0000-4000-8000-000000000041'),
  'Direct agreement inserts cannot spoof the snapshot agreement reference');

select throws_ok($$update public.bookings set booking_reference='YB-26-999999' where id=(
  select id from public.bookings where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+1
)$$,'42501','Booking reference is immutable','Booking references cannot be changed');
select throws_ok($$update public.rental_agreements set snapshot='{}' where booking_id=(
  select id from public.bookings where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+1
)$$,'42501','Rental documents and acceptances are immutable','Agreement snapshots remain immutable');

set local role authenticated;
set local request.jwt.claims='{"sub":"96000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"96000000-0000-4000-8000-000000000013","exp":4102444800}';
select is((select count(*)::integer from public.bookings where listing_id='96000000-0000-4000-8000-000000000031'),0,'Booking row-level security still hides references from nonparticipants');
select throws_ok($$select public.get_rental_agreement((select id from public.bookings
  where listing_id='96000000-0000-4000-8000-000000000031' and start_date=current_date+1))$$,
  '42501','Booking not found','Agreement reference RPC remains participant-only');
reset role;

select * from finish();
rollback;
