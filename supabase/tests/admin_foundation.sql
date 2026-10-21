-- Run with `supabase test db` against a disposable local database after applying migrations.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'super@admin.test', '{"full_name":"Super"}'),
  ('a0000000-0000-4000-8000-000000000002', 'mod@admin.test', '{"full_name":"Moderator"}'),
  ('a0000000-0000-4000-8000-000000000003', 'owner@admin.test', '{"full_name":"Owner"}'),
  ('a0000000-0000-4000-8000-000000000004', 'renter@admin.test', '{"full_name":"Renter"}'),
  ('a0000000-0000-4000-8000-000000000005', 'newadmin@admin.test', '{"full_name":"New Admin"}');
insert into auth.sessions (id, user_id) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004');
insert into public.admin_users (user_id, role, permissions) values
  ('a0000000-0000-4000-8000-000000000001', 'super_admin', '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'admin', '{listings.moderate}');
insert into public.categories (id, name) values ('a2000000-0000-4000-8000-000000000001', 'Admin test category');
insert into public.listings (id, owner_id, category_id, title, price_per_day, status,estimated_value,item_condition) values
  ('a3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'Owner item', 10, 'published',200,'good');

select ok(not has_function_privilege('anon', 'public.admin_overview(timestamptz,timestamptz)', 'EXECUTE'), 'Anonymous callers cannot run admin RPCs');
select ok(not has_function_privilege('authenticated', 'public.admin_write_audit(text,text,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'Clients cannot write audit rows directly');
select ok(not has_function_privilege('authenticated', 'public.admin_require(text)', 'EXECUTE'), 'Clients cannot call the internal permission guard');

-- Plain user: no admin access anywhere.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000004","exp":4102444800}';
select is(public.get_my_admin_access(), null, 'A plain user has no admin access');
select throws_ok($$select public.admin_list_users()$$, '42501', 'Not authorized', 'A plain user cannot list users');
select throws_ok($$select public.admin_overview(now() - interval '1 day', now())$$, '42501', 'Not authorized', 'A plain user cannot read the overview');
select throws_ok($$select public.admin_set_feature_flag('bidding', true, 'because')$$, '42501', 'Not authorized', 'A plain user cannot change flags');
select throws_ok($$select public.admin_update_setting('platform_fee_pct', '0.05', 'because')$$, '42501', 'Not authorized', 'A plain user cannot change settings');
select is((select count(*)::int from public.admin_audit_log), 0, 'The audit table is not readable through the Data API');
select is((select count(*)::int from public.admin_users), 0, 'The admin_users table is not readable through the Data API');
select is((select count(*)::int from public.app_settings where key = 'platform_fee_pct'), 1, 'Public settings stay readable');

-- Limited admin: only the permissions granted to them.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000002","exp":4102444800}';
select is((public.get_my_admin_access() ->> 'role'), 'admin', 'Moderator reports the admin role');
select is(jsonb_array_length(public.get_my_admin_access() -> 'permissions'), 1, 'Moderator holds only the granted permission');
select lives_ok($$select public.admin_list_listings()$$, 'Moderator can list listings');
select throws_ok($$select public.admin_list_users()$$, '42501', 'Not authorized', 'Moderator cannot list users without users.manage');
select throws_ok($$select public.admin_list_admins()$$, '42501', 'Not authorized', 'Moderator cannot list administrators');
select throws_ok($$select public.admin_set_listing_suspension('a3000000-0000-4000-8000-000000000001', true, 'x')$$, '22023', 'A reason of 3-500 characters is required', 'A reason is mandatory');
select is((public.admin_set_listing_suspension('a3000000-0000-4000-8000-000000000001', true, 'Prohibited item') ->> 'ok')::boolean, true, 'Moderator can suspend a listing');

-- Owner cannot lift the suspension.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000003","exp":4102444800}';
select throws_ok($$update public.listings set status = 'published' where id = 'a3000000-0000-4000-8000-000000000001'$$,
  '42501', 'Only an administrator can change a suspended listing', 'An owner cannot lift an admin suspension');
select is((select status from public.listings where id = 'a3000000-0000-4000-8000-000000000001'), 'suspended', 'A suspended listing is no longer public');

-- Super admin: settings validation, audit, flags, administrator management.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((public.admin_update_setting('platform_fee_pct', '0.9', 'Too high') ->> 'ok')::boolean, false, 'An out-of-range fee is rejected');
select is((select outcome from public.admin_audit_log where action = 'setting.update' order by created_at desc limit 1), null, 'Audit rows stay hidden from the Data API even for admins');
select is((public.admin_update_setting('platform_fee_pct', '0.05', 'Promo period') ->> 'ok')::boolean, true, 'A valid fee is accepted');
select is((public.admin_set_feature_flag('bidding', true, 'Pilot') ->> 'ok')::boolean, true, 'Super admin can toggle a flag');
select throws_ok($$select public.admin_upsert_admin('super@admin.test', 'admin', '{}', true, 'self edit')$$, '22023', 'You cannot change your own administrator access', 'Self-edits are blocked');
select throws_ok($$select public.admin_upsert_admin('newadmin@admin.test', 'admin', '{config.manage}', true, 'escalation')$$, '22023', 'Unknown permission', 'Super-only permissions are not grantable to admins');
select is((public.admin_upsert_admin('newadmin@admin.test', 'admin', '{audit.view}', true, 'Support hire') ->> 'ok')::boolean, true, 'Super admin can create an administrator');
select is((select count(*)::int from jsonb_array_elements(public.admin_list_audit(null,null,100) -> 'rows') r
  where r->>'actor_id' in ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002')), 5,
  'Audit view returns the fixture actors'' failed and successful operations');
select is((select count(*)::int from jsonb_array_elements(public.admin_list_audit(null, 'setting.update') -> 'rows') r where r ->> 'outcome' = 'failed'), 1, 'The rejected setting change is recorded with outcome failed');

-- New fee applies to new bookings; history keeps its snapshot.
reset role;
update public.listings set status = 'published' where id = 'a3000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000004","exp":4102444800}';
select is((select service_fee_pct from public.create_booking_request('a3000000-0000-4000-8000-000000000001', current_date + 5, current_date + 7)), 0.0500::numeric, 'New bookings snapshot the administrator-managed fee');

-- Restricting a user blocks writes and suspends their listings.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((public.admin_set_user_restriction('a0000000-0000-4000-8000-000000000003', true, 'Policy violation') ->> 'listings_suspended')::int, 1, 'Restriction suspends published listings');
select throws_ok($$select public.admin_set_user_restriction('a0000000-0000-4000-8000-000000000002', true, 'Cannot restrict admins')$$, '22023', 'Deactivate the administrator role before restricting this account', 'Administrators cannot be restricted directly');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000003","exp":4102444800}';
select throws_ok($$insert into public.listings (owner_id, category_id, title, price_per_day) values ('a0000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'New', 5)$$,
  '42501', 'Your account is restricted. Contact YBuy support.', 'A restricted user cannot create listings');
select throws_ok($$insert into public.payouts (booking_id, owner_id, amount)
  select id, 'a0000000-0000-4000-8000-000000000003', 1 from public.bookings
  where owner_id = 'a0000000-0000-4000-8000-000000000003' limit 1$$,
  '42501', 'permission denied for table payouts', 'A restricted owner cannot fabricate a payout');

-- Audit log is append-only even for the table owner.
reset role;
select throws_ok($$update public.admin_audit_log set reason = 'tampered'$$, '42501', 'admin_audit_log is append-only', 'Audit rows cannot be edited');
select throws_ok($$delete from public.admin_audit_log$$, '42501', 'admin_audit_log is append-only', 'Audit rows cannot be deleted');

select * from finish();
rollback;
