begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id,email,raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000001','notification-renter@test.example','{"full_name":"Notification Renter"}'),
  ('11000000-0000-4000-8000-000000000002','notification-owner@test.example','{"full_name":"Notification Owner"}');
insert into auth.sessions (id,user_id) values
  ('61000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002');
insert into public.categories (id,name) values
  ('21000000-0000-4000-8000-000000000001','Notification test category');
insert into public.listings (id,owner_id,category_id,title,price_per_day,status,estimated_value,item_condition) values
  ('31000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002',
   '21000000-0000-4000-8000-000000000001','Notification test rental',20,'published',200,'good');
insert into public.bookings (
  id,listing_id,renter_id,owner_id,start_date,end_date,daily_rate,days,subtotal,
  service_fee_pct,service_fee_amount,total
) values (
  '41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002',
  current_date + 10,current_date + 12,20,2,40,0.10,4,44
);
update public.bookings set status = 'pending_payment'
  where id = '41000000-0000-4000-8000-000000000001';
update public.bookings set status = 'confirmed'
  where id = '41000000-0000-4000-8000-000000000001';
insert into public.payments (booking_id,amount,status)
  values ('41000000-0000-4000-8000-000000000001',44,'succeeded');
insert into public.conversations (id,booking_id,participant_one,participant_two) values (
  '51000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002'
);
update public.notification_preferences set messages_in_app = false
  where user_id = '11000000-0000-4000-8000-000000000002';
insert into public.messages (conversation_id,sender_id,body) values
  ('51000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','First private message'),
  ('51000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Second private message');

select is((select count(*)::int from public.notifications
  where user_id in ('11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002')),7,
  'Booking lifecycle and message events are persisted for their recipients');
select is((select count(*)::int from public.notification_email_jobs
  where user_id in ('11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002')),6,
  'Email jobs are queued and message email is throttled per conversation');
select is((select count(*)::int from public.notification_email_jobs
  where user_id = '11000000-0000-4000-8000-000000000002'
    and category = 'messages' and body = 'You have a new message.'),1,
  'Message email contains no private message content');
select is((select count(*)::int from public.notification_preferences
  where user_id in ('11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002')),2,
  'Notification preferences are created for each profile');
select ok(not (select promotions_email from public.notification_preferences
  where user_id = '11000000-0000-4000-8000-000000000001'),
  'Promotional email is disabled by default');
select ok((select bookings_email from public.notification_preferences
  where user_id = '11000000-0000-4000-8000-000000000001'),
  'Transactional email is enabled by default');
select ok(not has_function_privilege('authenticated',
  'public.claim_notification_email_jobs(uuid,integer)','EXECUTE'),
  'Clients cannot directly claim private email jobs');
select ok(not has_function_privilege('authenticated',
  'public.claim_next_notification_email_jobs(integer)','EXECUTE'),
  'Clients cannot claim the global email queue');
select ok(not has_table_privilege('authenticated',
  'public.notification_email_jobs','SELECT'),
  'Clients cannot read private email jobs');

set local role service_role;
select is((select count(*)::int from public.claim_next_notification_email_jobs(1)),1,
  'Trusted scheduler can claim one eligible job across users');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"61000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((select count(*)::int from public.notifications),4,
  'Owner sees only their booking and message notifications');
select is((select count(*)::int from public.notifications where user_id = '11000000-0000-4000-8000-000000000001'),0,
  'Owner cannot read renter notification history');
select is((select count(*)::int from public.notification_preferences),1,
  'Owner can read only their preferences');
select lives_ok(
  $$select public.mark_persistent_notification_read((select id from public.notifications where user_id = auth.uid() and category <> 'messages' limit 1))$$,
  'Recipient can mark one notification read'
);
select is((select count(*)::int from public.notifications where read_at is not null),1,
  'Read state is persisted for that recipient');
select lives_ok($$select public.mark_all_notifications_read()$$,
  'Mark all read completes without consuming message alerts');
select is((select count(*)::int from public.notifications
  where user_id = auth.uid() and category = 'messages' and read_at is null),2,
  'Muted message alerts remain unread for the Messages inbox');
select lives_ok(
  $$select public.mark_persistent_notification_read((select id from public.notifications where user_id = auth.uid() and category = 'messages' limit 1))$$,
  'Messages can be marked read independently of notification preferences'
);

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"61000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select count(*)::int from public.notifications),3,
  'Renter sees only their booking and payment notifications');
select is((select count(*)::int from public.notifications where user_id = '11000000-0000-4000-8000-000000000002'),0,
  'Renter cannot read owner notification history');

set local role anon;
set local request.jwt.claims = '{}';
select ok(not has_table_privilege('anon','public.notifications','SELECT'),
  'Anonymous users cannot read notification rows');
select ok(not has_function_privilege('anon','public.mark_all_notifications_read()','EXECUTE'),
  'Anonymous users cannot mark notification history read');

reset role;
select ok(not has_function_privilege('authenticated','public.notification_email_details(uuid)','EXECUTE'),
  'Detailed email rendering is service-only');
select ok(not has_function_privilege('anon','public.notification_email_details(uuid)','EXECUTE'),
  'Anonymous callers cannot resolve private email details');
select ok(has_function_privilege('service_role','public.notification_email_details(uuid)','EXECUTE'),
  'Email worker can resolve detailed booking data');
select ok(exists (
  select 1 from jsonb_array_elements(public.notification_email_details((
    select id from public.notification_email_jobs
    where event_key like 'booking:41000000-0000-4000-8000-000000000001:%' limit 1))) detail
  where detail->>'label'='Rental subtotal' and detail->>'value'='USD 40.00'
), 'Email details include authoritative rental subtotal');
select ok(exists (
  select 1 from jsonb_array_elements(public.notification_email_details((
    select id from public.notification_email_jobs
    where event_key like 'booking:41000000-0000-4000-8000-000000000001:%' limit 1))) detail
  where detail->>'label'='Booking reference' and detail->>'value'='41000000-0000-4000-8000-000000000001'
), 'Email details include the booking reference');
select ok(exists (
  select 1 from jsonb_array_elements(public.notification_email_details((
    select id from public.notification_email_jobs
    where event_key like 'payment:%' and user_id='11000000-0000-4000-8000-000000000001' limit 1))) detail
  where detail->>'label'='Checkout total' and detail->>'value'='USD 44.00'
), 'Payment email resolves to the booking and exact total');
insert into auth.users (id,email,raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000003','notification-outsider@test.example','{"full_name":"Outsider"}');
insert into public.notification_email_jobs (event_key,user_id,recipient_email,category,subject,body,destination)
values ('booking:41000000-0000-4000-8000-000000000001:outsider',
  '11000000-0000-4000-8000-000000000003','notification-outsider@test.example','bookings','Test event','Test body','/dashboard');
select is(jsonb_array_length(public.notification_email_details((
  select id from public.notification_email_jobs where event_key='booking:41000000-0000-4000-8000-000000000001:outsider'))),3,
  'Unrelated recipients receive event metadata, never another booking details');
select * from finish();
rollback;
