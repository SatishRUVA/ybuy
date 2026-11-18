begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
  ('12000000-0000-4000-8000-000000000001','identity-owner@example.test','{"full_name":"Identity Owner"}'),
  ('12000000-0000-4000-8000-000000000002','identity-renter@example.test','{"full_name":"Identity Renter"}'),
  ('12000000-0000-4000-8000-000000000003','identity-investigator@example.test','{"full_name":"Identity Investigator"}');
insert into auth.sessions(id,user_id) values
  ('62000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001'),
  ('62000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000003');
create temp table original_identity as select id,customer_id from public.profiles
  where id in ('12000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002');
grant select on original_identity to authenticated;

select ok((select bool_and(customer_id ~ '^YB-[0-9]{10}$') from public.profiles),'All existing and new profiles have formatted IDs');
select is((select count(*) from public.profiles where customer_id is null),0::bigint,'Backfill has no missing IDs');
select is((select count(distinct customer_id) from original_identity),2::bigint,'Separate actors have unique IDs');
select is((select count(*) from original_identity o join public.customer_id_registry r using(customer_id)),2::bigint,'IDs are durably registered');
select ok(not has_sequence_privilege('authenticated','public.customer_id_sequence','USAGE'),'Clients cannot allocate or reset IDs');
select ok(not has_table_privilege('authenticated','public.customer_id_registry','SELECT'),'Registry is private');
select ok(not has_table_privilege('service_role','public.customer_id_registry','DELETE'),'Service API cannot retire issued IDs by deleting registry');
select throws_ok($$update public.customer_id_registry set customer_id='YB-9999999999' where customer_id=(select customer_id from original_identity limit 1)$$,
  '42501','Issued Customer IDs cannot be changed or reused','Issued identifiers are append-only');
select throws_ok($$truncate public.customer_id_registry cascade$$,
  '42501','Issued Customer IDs cannot be changed or reused','Registry cannot be truncated');
select throws_ok($$update public.profiles set customer_id='YB-9999999999' where id='12000000-0000-4000-8000-000000000001'$$,
  '42501','Customer identity is immutable','Profile Customer ID cannot be replaced');

set local role authenticated;
set local request.jwt.claims='{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000001","exp":4102444800}';
select is((select p.customer_id from public.get_my_profile() p),
  (select customer_id from original_identity where id='12000000-0000-4000-8000-000000000001'),'Own profile returns Customer ID');
select throws_ok($$select customer_id from public.profiles$$,'42501','permission denied for table profiles','Public profile joins do not disclose Customer IDs');
select throws_ok($$update public.profiles set customer_id='YB-9999999999' where id=auth.uid()$$,
  '42501','Customer identity is immutable','Ordinary users cannot modify Customer ID');
select lives_ok($$update public.profiles set full_name='New name',phone='5551234567',location='Toronto, CA' where id=auth.uid()$$,
  'Profile edits continue to work');
select is((select p.customer_id from public.get_my_profile() p),
  (select customer_id from original_identity where id='12000000-0000-4000-8000-000000000001'),'Name, phone and location changes preserve Customer ID');
select throws_ok($$select public.admin_list_users('YB-',25,0)$$,'42501','Not authorized','Customer search still requires admin permission');
reset role;

insert into public.admin_users(user_id,role,permissions) values
  ('12000000-0000-4000-8000-000000000003','admin',array['users.manage']);
set local role authenticated;
set local request.jwt.claims='{"sub":"12000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000003","exp":4102444800}';
select is((public.admin_list_users((select lower(customer_id) from original_identity where id='12000000-0000-4000-8000-000000000001'),25,0)->>'total')::int,1,
  'Authorized admin can search a normalized Customer ID');
reset role;

delete from auth.users where id='12000000-0000-4000-8000-000000000002';
select is((select count(*) from public.customer_id_registry where customer_id=(select customer_id from original_identity where id='12000000-0000-4000-8000-000000000002')),1::bigint,
  'Deleting an account retains its issued ID without personal data');
insert into auth.users(id,email,raw_user_meta_data) values
  ('12000000-0000-4000-8000-000000000004','identity-recreated@example.test','{"full_name":"Recreated"}');
select isnt((select customer_id from public.profiles where id='12000000-0000-4000-8000-000000000004'),
  (select customer_id from original_identity where id='12000000-0000-4000-8000-000000000002'),'Deleted ID is not reused');
select * from finish();
rollback;
