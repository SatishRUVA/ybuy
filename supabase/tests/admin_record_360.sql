begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, email, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-000000000001', 'booking-view@test.invalid', '{"full_name":"Booking Viewer"}'),
  ('e1000000-0000-4000-8000-000000000002', 'customer-view@test.invalid', '{"full_name":"Customer Viewer"}'),
  ('e1000000-0000-4000-8000-000000000003', 'record-owner@test.invalid', '{"full_name":"Record Owner"}'),
  ('e1000000-0000-4000-8000-000000000004', 'record-renter@test.invalid', '{"full_name":"Record Renter"}'),
  ('e1000000-0000-4000-8000-000000000005', 'ordinary@test.invalid', '{"full_name":"Ordinary User"}');
insert into auth.sessions(id, user_id) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002'),
  ('e2000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000005');
insert into public.admin_users(user_id, role, permissions) values
  ('e1000000-0000-4000-8000-000000000001', 'admin', '{bookings.view}'),
  ('e1000000-0000-4000-8000-000000000002', 'admin', '{bookings.view,users.manage,payments.view}');
insert into public.categories(id, name) values ('e3000000-0000-4000-8000-000000000001', 'Record 360');
insert into public.listings(id, owner_id, category_id, title, price_per_day, status, estimated_value, item_condition)
values ('e4000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003',
  'e3000000-0000-4000-8000-000000000001', '360 test listing', 20, 'draft', 200, 'good');
insert into public.bookings(id, listing_id, renter_id, owner_id, start_date, end_date, quantity, status,
  daily_rate, days, subtotal, service_fee_pct, service_fee_amount, deposit, total)
values ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000003',
  current_date, current_date + 2, 1, 'confirmed', 20, 2, 40, 0.1, 4, 25, 69);
insert into public.payments(id, booking_id, amount, currency, status)
values ('e6000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 69, 'usd', 'succeeded');

select ok(not has_function_privilege('anon', 'public.admin_get_booking_360(uuid,integer,integer)', 'EXECUTE'),
  'Anonymous callers cannot access Booking 360');
select ok(not has_function_privilege('anon', 'public.admin_get_customer_360(uuid,integer,integer)', 'EXECUTE'),
  'Anonymous callers cannot access Customer 360');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000005","exp":4102444800}';
select throws_ok($$select public.admin_get_booking_360('e5000000-0000-4000-8000-000000000001')$$,
  '42501', 'Not authorized', 'Booking 360 requires bookings.view');
select throws_ok($$select public.admin_get_customer_360('e1000000-0000-4000-8000-000000000004')$$,
  '42501', 'Not authorized', 'Customer 360 requires users.manage');

set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((public.admin_get_booking_360('e5000000-0000-4000-8000-000000000001')->'booking'->>'status'),
  'confirmed', 'Booking viewer can read the authorized booking summary');
select is(public.admin_get_booking_360('e5000000-0000-4000-8000-000000000001')->'payments',
  'null'::jsonb, 'Payment details are omitted without payments.view');
select is(public.admin_get_booking_360('e5000000-0000-4000-8000-000000000001')->'settlement',
  'null'::jsonb, 'Settlement details are omitted without payouts.view');
select is(public.admin_get_booking_360('e5000000-0000-4000-8000-000000000001')->'cases',
  'null'::jsonb, 'Case details are omitted without case permissions');
select throws_ok($$select public.admin_get_customer_360('e1000000-0000-4000-8000-000000000004')$$,
  '42501', 'Not authorized', 'Booking permission does not grant access to Customer 360');

set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((public.admin_get_booking_360('e5000000-0000-4000-8000-000000000001')->'payments'->>'total')::int,
  1, 'Payment viewer can read linked payment records');
select is((public.admin_get_customer_360('e1000000-0000-4000-8000-000000000004')->'customer'->>'full_name'),
  'Record Renter', 'Customer 360 returns the selected customer');
select is((public.admin_get_customer_360('e1000000-0000-4000-8000-000000000004')->'bookings'->>'total')::int,
  1, 'Customer 360 returns linked bookings only with bookings.view');

select * from finish();
rollback;
