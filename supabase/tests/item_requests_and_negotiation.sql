begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1000000-0000-4000-8000-000000000001', 'renter@marketplace.test', '{"full_name":"Renter"}'),
  ('b1000000-0000-4000-8000-000000000002', 'owner@marketplace.test', '{"full_name":"Owner"}'),
  ('b1000000-0000-4000-8000-000000000003', 'outsider@marketplace.test', '{"full_name":"Outsider"}');
insert into auth.sessions (id, user_id) values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002'),
  ('b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003');
insert into public.categories (id, name) values
  ('b3000000-0000-4000-8000-000000000001', 'Marketplace test category');
insert into public.listings (
  id, owner_id, category_id, title, price_per_day, deposit, available_quantity, negotiation_enabled, status,estimated_value,item_condition
) values (
  'b4000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002',
  'b3000000-0000-4000-8000-000000000001', 'Marketplace test item', 40, 10, 2, true, 'published',200,'good'
);
update public.feature_flags set enabled = false where key in ('item_requests', 'bidding');

set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.create_item_request(
  'b5000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001', 'Need a projector',
  'A projector bright enough for a small community event.', 'Community event',
  current_date + 10, current_date + 12, 'North district', 30, 2, 'HDMI input', null, 'public', '{}'
)$$, '55000', 'Item requests are not currently enabled', 'Feature flags block request creation server-side');

reset role;
update public.feature_flags set enabled = true where key in ('item_requests', 'bidding');
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000001","exp":4102444800}';

select is((public.create_item_request(
  'b5000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001', 'Need a projector',
  'A projector bright enough for a small community event.', 'Community event',
  current_date + 10, current_date + 12, 'North district', 30, 2, 'HDMI input', null, 'public', '{}'
)).status, 'open', 'Renter can create a persistent public item request');
select is((public.create_item_request(
  'b5000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001', 'Changed retry payload',
  'A different retry payload must not create a second request.', 'Community event',
  current_date + 10, current_date + 12, 'North district', 30, 2, null, null, 'public', '{}'
)).id, 'b5000000-0000-4000-8000-000000000001'::uuid, 'Request idempotency returns the original row');
select ok(public.can_access_item_request_image(
  'b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000003/1.jpg', true
), 'Request image upload path matches the client-generated format');
select ok(not public.can_access_item_request_image(
  'b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000003/123e4567-e89b-12d3-a456-426614174000.jpg', true
), 'Request image paths cannot use an unexpected filename');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((select count(*)::int from public.item_requests where id = 'b5000000-0000-4000-8000-000000000001'), 1,
  'Other signed-in users can discover an open public request');
select lives_ok($$select public.create_marketplace_offer(
  'b5000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
  current_date + 10, current_date + 12, 25, 'This listing fits your event.', 'b7000000-0000-4000-8000-000000000001'
)$$, 'Owner can submit a listing-backed offer');
select lives_ok($$select public.create_marketplace_offer(
  'b5000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
  current_date + 10, current_date + 12, 25, 'This listing fits your event.', 'b7000000-0000-4000-8000-000000000001'
)$$, 'Offer creation is idempotent');
select is((select count(*)::int from public.marketplace_negotiations
  where item_request_id = 'b5000000-0000-4000-8000-000000000001'), 1, 'Idempotent retries create one negotiation');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000003","exp":4102444800}';
select is((select count(*)::int from public.marketplace_negotiations), 0, 'Non-participants cannot read negotiations');
select is((select count(*)::int from public.negotiation_proposals), 0, 'Non-participants cannot read proposal history');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select count(*)::int from public.marketplace_notifications where user_id = auth.uid()), 1,
  'The renter receives a persistent offer notification');
select lives_ok($$select public.respond_to_marketplace_offer(
  (select id from public.marketplace_negotiations where item_request_id = 'b5000000-0000-4000-8000-000000000001'),
  'counter', 22, current_date + 10, current_date + 12, 'Could you do $22 per day?'
)$$, 'Renter can send a validated counteroffer');
select is((select count(*)::int from public.marketplace_notifications
  where user_id = 'b1000000-0000-4000-8000-000000000001' and read_at is null), 1,
  'Counteroffer notifications do not duplicate on the renter account');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((select count(*)::int from public.marketplace_notifications
  where user_id = 'b1000000-0000-4000-8000-000000000002' and read_at is null), 1,
  'The owner receives the counteroffer notification');

select is((public.respond_to_marketplace_offer(
  (select id from public.marketplace_negotiations where item_request_id = 'b5000000-0000-4000-8000-000000000001'),
  'accept'
)->'booking'->>'status'), 'pending_payment', 'Accepting an offer enters pending payment, never confirmed');
select is((select quantity from public.bookings where id = (
  select booking_id from public.marketplace_negotiations where item_request_id = 'b5000000-0000-4000-8000-000000000001'
)), 2, 'Accepted booking preserves the requested quantity');
select is((select subtotal from public.bookings where id = (
  select booking_id from public.marketplace_negotiations where item_request_id = 'b5000000-0000-4000-8000-000000000001'
)), 88::numeric, 'Accepted booking price is calculated server-side from the final proposal');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select status from public.item_requests where id = 'b5000000-0000-4000-8000-000000000001'),
  'matched', 'Accepted offer matches the request');

select * from finish();
rollback;
