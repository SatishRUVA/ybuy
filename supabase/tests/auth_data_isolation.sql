-- Run with `supabase test db` against a disposable local database after applying migrations.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'alice@isolation.test', '{"full_name":"Alice"}'),
  ('10000000-0000-4000-8000-000000000002', 'bob@isolation.test', '{"full_name":"Bob"}'),
  ('10000000-0000-4000-8000-000000000003', 'owner@isolation.test', '{"full_name":"Owner"}');
insert into auth.sessions (id, user_id) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003');
insert into public.categories (id, name) values
  ('20000000-0000-4000-8000-000000000001', 'Isolation test category');
insert into public.listings (id, owner_id, category_id, title, description, price_per_day, status,
  estimated_value, item_condition, availability_start, availability_end) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'Alice private draft','Alice draft fixture for isolation tests.',10,'draft',200,'good',current_date+10,current_date+40),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
   'Bob private draft','Bob draft fixture for isolation tests.',10,'draft',200,'good',current_date+10,current_date+40),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
   'Public rental','Public fixture for isolation tests.',10,'draft',200,'good',current_date+10,current_date+40);
insert into public.listing_images(listing_id,url,sort_order) values
  ('30000000-0000-4000-8000-000000000003','https://example.test/isolation-rental.png',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude) values
  ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',
   'Private pickup','Dallas','TX','75201','US',32.8,-96.8);
update public.listings set status='published' where id='30000000-0000-4000-8000-000000000003';
insert into public.favorites (user_id, listing_id) values
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003');
insert into public.bookings (
  id, listing_id, renter_id, owner_id, start_date, end_date,
  daily_rate, days, subtotal, service_fee_pct, service_fee_amount, total
) values (
  '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003',
  current_date + 10, current_date + 12, 10, 2, 20, 0.10, 2, 22
);
insert into public.conversations (id, booking_id, participant_one, participant_two) values (
  '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003'
);
insert into public.messages (conversation_id, sender_id, body) values (
  '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Private message'
);
insert into public.payments (booking_id, amount) values ('40000000-0000-4000-8000-000000000001', 22);
insert into public.payouts (booking_id, owner_id, amount) values (
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 20
);

select ok(not has_function_privilege('anon', 'public.cancel_booking(uuid)', 'EXECUTE'), 'Anonymous callers cannot cancel bookings');
select ok(not has_function_privilege('anon', 'public.respond_to_booking_request(uuid,boolean)', 'EXECUTE'), 'Anonymous callers cannot approve bookings');
select ok(not has_function_privilege('anon', 'public.mark_booking_active(uuid)', 'EXECUTE'), 'Anonymous callers cannot start rentals');
select ok(not has_function_privilege('authenticated', 'public.mark_booking_active(uuid)', 'EXECUTE'), 'Authenticated callers cannot bypass pickup verification');
select ok(not has_function_privilege('anon', 'public.start_booking_return(uuid)', 'EXECUTE'), 'Anonymous callers cannot start returns');
select ok(not has_function_privilege('anon', 'public.complete_booking_return(uuid)', 'EXECUTE'), 'Anonymous callers cannot complete rentals');
select ok(not has_function_privilege('authenticated', 'public.complete_booking_return(uuid)', 'EXECUTE'), 'Authenticated callers cannot bypass return verification');
select ok(not has_function_privilege('anon', 'public.create_booking_request(uuid,date,date,integer)', 'EXECUTE'), 'Anonymous callers cannot request bookings');
select ok(not has_function_privilege('anon', 'public.get_my_profile()', 'EXECUTE'), 'Anonymous callers cannot read private profiles');
select ok(not has_function_privilege('authenticated', 'public.confirm_booking_payment(uuid,text,text,numeric)', 'EXECUTE'), 'Clients cannot confirm payments');
select ok(not has_function_privilege('anon', 'public.confirm_booking_payment(uuid,text,text,numeric)', 'EXECUTE'), 'Anonymous callers cannot confirm payments');
select ok(has_function_privilege('service_role', 'public.confirm_booking_payment(uuid,text,text,numeric)', 'EXECUTE'), 'Webhook service role retains payment confirmation');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"60000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select email from public.get_my_profile()), 'alice@isolation.test', 'Alice can read only her private profile');
select is((select count(*)::int from public.favorites), 1, 'Alice sees her explicit favorite');
select is((select count(*)::int from public.bookings), 1, 'Alice sees her renter booking');
select is((select count(*)::int from public.bookings where owner_id = auth.uid()), 0, 'Renting records do not become lending records');
select is((select count(*)::int from public.listings where owner_id = auth.uid()), 1, 'Alice sees her own draft');
select is((select count(*)::int from public.messages), 1, 'A participant can read messages');
select is((select count(*)::int from public.payments), 1, 'A participant can read payment status');
select is((select count(*)::int from public.payouts), 0, 'Renters cannot read owner payouts');
select throws_ok('select email from public.profiles', '42501', null, 'Profile email cannot be enumerated');
select throws_ok('select phone from public.profiles', '42501', null, 'Profile phone cannot be enumerated');
select throws_ok('select location from public.profiles', '42501', null, 'Profile location cannot be enumerated');
select lives_ok(
  'select l.title, p.full_name, p.avatar_url from public.listings l join public.profiles p on p.id = l.owner_id',
  'Public owner display joins remain readable'
);
select throws_ok(
  $$select public.respond_to_booking_request('40000000-0000-4000-8000-000000000001', true)$$,
  '42501', 'Booking not found or not owned', 'Renter cannot approve own booking'
);

set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"60000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((select email from public.get_my_profile()), 'bob@isolation.test', 'Bob receives his own profile after account switch');
select is((select count(*)::int from public.favorites), 0, 'New user has no seeded favorites');
select is((select count(*)::int from public.bookings), 0, 'Bob cannot enumerate Alice bookings');
select is((select count(*)::int from public.conversations), 0, 'Bob cannot enumerate private conversations');
select is((select count(*)::int from public.messages), 0, 'Bob cannot enumerate private messages');
select is((select count(*)::int from public.payments), 0, 'Bob cannot enumerate private payments');
select is((select count(*)::int from public.payouts), 0, 'Bob cannot enumerate private payouts');
select is((select count(*)::int from public.listings where id = '30000000-0000-4000-8000-000000000001'), 0, 'Bob cannot read Alice draft by ID');
select is((select count(*)::int from public.listings where owner_id = auth.uid()), 1, 'Bob sees his own draft, not Alice draft');
select throws_ok(
  $$insert into public.favorites(user_id, listing_id) values ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'Cannot add favorites as another user'
);
with deleted as (delete from public.favorites where user_id = '10000000-0000-4000-8000-000000000001' returning id)
select is(count(*)::int, 0, 'Cannot delete another user favorites') from deleted;
with changed as (update public.listings set title = 'Hijacked' where id = '30000000-0000-4000-8000-000000000001' returning id)
select is(count(*)::int, 0, 'Cannot modify another user listing') from changed;
with deleted as (delete from public.listings where id = '30000000-0000-4000-8000-000000000001' returning id)
select is(count(*)::int, 0, 'Cannot delete another user listing') from deleted;
select throws_ok(
  $$insert into public.messages(conversation_id, sender_id, body) values ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Intrusion')$$,
  '42501', null, 'Cannot message a conversation without membership'
);
select throws_ok(
  $$select public.cancel_booking('40000000-0000-4000-8000-000000000001')$$,
  '42501', 'Not a participant in this booking', 'Cannot cancel another user booking by ID'
);
select throws_ok(
  $$select public.confirm_booking_payment('40000000-0000-4000-8000-000000000001','fake','fake',22)$$,
  '42501', null, 'Direct client payment confirmation is denied'
);

set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"60000000-0000-4000-8000-000000000003","exp":4102444800}';
select is((select count(*)::int from public.bookings where owner_id = auth.uid()), 1, 'Owner sees incoming booking');
select lives_ok(
  $$select public.respond_to_booking_request('40000000-0000-4000-8000-000000000001', true)$$,
  'Owner can approve incoming request'
);
select is((select status from public.bookings where id = '40000000-0000-4000-8000-000000000001'), 'pending_payment', 'Approval still requires payment');

set local role anon;
set local request.jwt.claims = '{}';
select is((select count(*)::int from public.bookings), 0, 'Signed-out users see no bookings');
select throws_ok(
  $$select public.cancel_booking('40000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Anonymous RPC execution fails before nullable participant checks'
);
select lives_ok('select id, full_name, avatar_url from public.profiles', 'Public profile display fields remain available');
select throws_ok('select email from public.profiles', '42501', null, 'Anonymous profile contact reads are denied');

reset role;
select * from finish();
rollback;
