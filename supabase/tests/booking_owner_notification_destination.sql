begin;

select no_plan();

insert into auth.users(id,email) values
  ('a6000000-0000-4000-8000-000000000001','owner@example.test'),
  ('a6000000-0000-4000-8000-000000000002','renter@example.test');

create temporary table booking_notification_fixture(
  id uuid primary key,
  status text not null,
  renter_id uuid not null,
  owner_id uuid not null,
  booking_mode text not null
) on commit drop;

create trigger booking_notification_fixture_status
after update of status on booking_notification_fixture
for each row execute function public.capture_booking_notification();

insert into booking_notification_fixture values (
  'a6000000-0000-4000-8000-000000000003',
  'pending_payment',
  'a6000000-0000-4000-8000-000000000002',
  'a6000000-0000-4000-8000-000000000001',
  'auction'
);

update booking_notification_fixture
set status='confirmed'
where id='a6000000-0000-4000-8000-000000000003';

select is((select destination from public.notifications
  where event_key='booking:a6000000-0000-4000-8000-000000000003:confirmed:a6000000-0000-4000-8000-000000000001'),
  '/check-in/a6000000-0000-4000-8000-000000000003',
  'Owner confirmation opens the booking handoff');

select is((select destination from public.notifications
  where event_key='booking:a6000000-0000-4000-8000-000000000003:confirmed:a6000000-0000-4000-8000-000000000002'),
  '/dashboard',
  'Renter confirmation keeps the dashboard destination');

select is((select count(*)::integer from public.notifications
  where event_key like 'booking:a6000000-0000-4000-8000-000000000003:confirmed:%'),
  2,
  'Confirmation creates one notification per booking participant');

select * from finish();
rollback;
