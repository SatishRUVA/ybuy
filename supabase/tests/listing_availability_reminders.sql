begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
  ('71000000-0000-4000-8000-000000000001','availability-owner@test.example'),
  ('71000000-0000-4000-8000-000000000002','availability-other-owner@test.example');
insert into auth.sessions(id,user_id) values
  ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001'),
  ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002');
insert into public.categories(id,name)
values ('73000000-0000-4000-8000-000000000001','Availability reminder fixture');
insert into public.notification_preferences(user_id,bookings_in_app,bookings_email)
values ('71000000-0000-4000-8000-000000000002',false,false)
on conflict (user_id) do update set bookings_in_app=false,bookings_email=false;

insert into public.listings(
  id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end
) values
  ('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
   '73000000-0000-4000-8000-000000000001','Seven day listing','Reminder fixture.',10,'draft',100,'good',
   0,0,current_date+7,current_date+14),
  ('74000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001',
   '73000000-0000-4000-8000-000000000001','One day listing','Reminder fixture.',10,'draft',100,'good',
   0,0,current_date+1,current_date+8),
  ('74000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001',
   '73000000-0000-4000-8000-000000000001','Two day listing','Reminder fixture.',10,'draft',100,'good',
   0,0,current_date+2,current_date+9),
  ('74000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000001',
   '73000000-0000-4000-8000-000000000001','Draft listing','Reminder fixture.',10,'draft',100,'good',
   0,0,current_date+7,current_date+14),
  ('74000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000002',
   '73000000-0000-4000-8000-000000000001','Other owner listing','Reminder fixture.',10,'draft',100,'good',
   0,0,current_date+7,current_date+14);

insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/availability-reminder.jpg',0
from public.listings where id between
  '74000000-0000-4000-8000-000000000001' and '74000000-0000-4000-8000-000000000005';
insert into public.listing_pickup_locations(
  listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude
)
select id,owner_id,'Private test pickup','Test City','TX','75201','US',location_lat,location_lng
from public.listings where id between
  '74000000-0000-4000-8000-000000000001' and '74000000-0000-4000-8000-000000000005';
update public.listings set status='published'
where id in (
  '74000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000005'
);

select is(public.process_listing_availability_reminders(),3,
  'Only published listings exactly 7 or 1 calendar day away receive reminders');
select is(public.process_listing_availability_reminders(),0,
  'Repeated scheduler runs do not duplicate reminders');
select is((select count(*)::integer from public.notifications
  where event_key like 'listing-availability:%'),3,
  'Reminder events are persisted once for the matching listings');
select is((select count(*)::integer from public.notifications
  where event_key=format('listing-availability:%s:%s:7',
    '74000000-0000-4000-8000-000000000001',current_date+7)),1,
  'The seven-day reminder is keyed to the exact start date');
select is((select count(*)::integer from public.notifications
  where event_key=format('listing-availability:%s:%s:1',
    '74000000-0000-4000-8000-000000000002',current_date+1)),1,
  'The one-day reminder is keyed to the exact start date');
select is((select count(*)::integer from public.notifications
  where event_key like 'listing-availability:74000000-0000-4000-8000-000000000003:%'
    or event_key like 'listing-availability:74000000-0000-4000-8000-000000000004:%'),0,
  'Listings two days away or still in draft receive no reminder');
select is((select count(*)::integer from public.notifications
  where event_key like 'listing-availability:%' and user_id='71000000-0000-4000-8000-000000000001'
    and in_app_enabled),2,
  'The owner receives enabled in-app reminders for their matching listings');
select is((select count(*)::integer from public.notifications
  where event_key like 'listing-availability:%' and user_id='71000000-0000-4000-8000-000000000002'
    and not in_app_enabled),1,
  'Existing in-app preference settings are honored');
select is((select count(*)::integer from public.notification_email_jobs
  where event_key like 'listing-availability:%'),0,
  'Availability reminders do not enqueue email');
select ok(not has_function_privilege('authenticated',
  'public.process_listing_availability_reminders()','EXECUTE'),
  'Authenticated clients cannot invoke the reminder worker');
select ok(has_function_privilege('service_role',
  'public.process_listing_availability_reminders()','EXECUTE'),
  'The trusted scheduler role can invoke the reminder worker');
select is((select schedule from cron.job where jobname='listing-availability-reminders'),
  '*/5 * * * *','The reminder worker is scheduled every five minutes');
select ok((select active from cron.job where jobname='listing-availability-reminders'),
  'The reminder schedule is active');

update public.listings
set availability_start=current_date+1,availability_end=current_date+8
where id='74000000-0000-4000-8000-000000000001';
select is(public.process_listing_availability_reminders(),1,
  'Rescheduling a listing produces a reminder for its new start date');
select is((select count(*)::integer from public.notifications
  where event_key like 'listing-availability:74000000-0000-4000-8000-000000000001:%'),2,
  'A changed start date gets a distinct dedupe key');
select is((select count(*)::integer from public.notifications
  where event_key like 'listing-availability:74000000-0000-4000-8000-000000000001:%'
    and event_key like '%:7'),1,
  'The earlier reminder remains keyed to the original start window');
select is((select count(*)::integer from public.notifications
  where event_key like 'listing-availability:74000000-0000-4000-8000-000000000001:%'
    and event_key like '%:1'),1,
  'The rescheduled reminder is keyed to the new start window');

set local role authenticated;
set local request.jwt.claims='{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select count(*)::integer from public.notifications
  where event_key like 'listing-availability:%'),3,
  'An owner can read only their enabled reminders');
select is((select count(*)::integer from public.notifications
  where user_id='71000000-0000-4000-8000-000000000002'),0,
  'An owner cannot read another owner’s reminders');
reset role;

select * from finish();
rollback;
