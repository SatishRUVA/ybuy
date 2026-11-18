begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('a9100000-0000-4000-8000-000000000001','fee-super@example.test','{"full_name":"Fee Super Admin"}'),
 ('a9100000-0000-4000-8000-000000000002','fee-admin@example.test','{"full_name":"Fee Admin"}');
insert into auth.sessions(id,user_id) values
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001'),
 ('a9200000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000002');
insert into public.admin_users(user_id,role) values
 ('a9100000-0000-4000-8000-000000000001','super_admin');
select throws_ok($$insert into public.admin_users(user_id,role,permissions) values
 ('a9100000-0000-4000-8000-000000000002','admin',array['config.manage'])$$,
 '23514','new row for relation "admin_users" violates check constraint "admin_users_permissions_valid"',
 'Admin permission constraint normally forbids granting config.manage to regular admins');
-- Simulate legacy/misconfigured permission data to exercise the RPC guard itself.
-- This transaction rolls back the constraint removal with all fixtures.
alter table public.admin_users drop constraint admin_users_permissions_valid;
insert into public.admin_users(user_id,role,permissions) values
 ('a9100000-0000-4000-8000-000000000002','admin',array['config.manage']);

create temporary table service_fee_test_window as
select clock_timestamp()+interval '1 day' as starts_at,
       clock_timestamp()+interval '2 days' as ends_at;
grant select on service_fee_test_window to authenticated;

select ok(not has_table_privilege('authenticated','public.service_fee_configurations','INSERT'),
 'Clients cannot write fee configurations directly');
set local role authenticated;
set local request.jwt.claims='{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a9200000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.admin_schedule_service_fee_configuration(
  12.5,65,(select starts_at from service_fee_test_window),(select ends_at from service_fee_test_window),
  'Schedule future fee allocation')$$,'Super Admin schedules an effective-dated allocation');
select throws_ok($$select public.admin_schedule_service_fee_configuration(
  11,50,(select starts_at+interval '1 hour' from service_fee_test_window),
  (select ends_at+interval '1 hour' from service_fee_test_window),'Overlapping fee schedule')$$,
 '23P01','The requested service fee period overlaps an existing configuration',
 'Overlapping effective periods are rejected');
select throws_ok($$select public.admin_schedule_service_fee_configuration(
  11,50,clock_timestamp()-interval '1 day',null,'Retroactive fee schedule')$$,
 '22023','Enter a total fee from 0 to 30 percent, an integer renter share from 0 to 100 percent, and a valid non-retroactive effective period',
 'Fee configurations cannot be applied retroactively');
select is((public.get_effective_service_fee_configuration(
  (select starts_at+interval '1 hour' from service_fee_test_window))->>'total_fee_pct')::numeric,
  0.125::numeric,'Scheduled total fee applies only at its effective date');
select is((public.get_effective_service_fee_configuration(
  (select starts_at+interval '1 hour' from service_fee_test_window))->>'renter_service_fee_pct')::numeric,
  0.08125::numeric,'Renter actual rate is derived from the integer allocation');
select is((public.get_effective_service_fee_configuration(
  (select starts_at+interval '1 hour' from service_fee_test_window))->>'owner_service_fee_pct')::numeric,
  0.04375::numeric,'Owner actual rate complements the renter share exactly');
reset role;
select is((select count(*)::integer from public.admin_audit_log
  where actor_id='a9100000-0000-4000-8000-000000000001'
    and action in ('service_fee.close_period','service_fee.schedule','service_fee.continue_period')),
  3,'A scheduled finite period and its continuation are audited');

set local role authenticated;
set local request.jwt.claims='{"sub":"a9100000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a9200000-0000-4000-8000-000000000002","exp":4102444800}';
select ok(public.has_admin_permission('config.manage'),
 'Regular admin has an active session and the configuration permission');
select throws_ok($$select public.admin_schedule_service_fee_configuration(
  10,100,(select ends_at+interval '1 day' from service_fee_test_window),null,'Non-super admin attempt')$$,
 '42501','Only a Super Admin can change service fee configurations',
 'Regular config.manage admin cannot schedule fee configurations');
reset role;
select is((select count(*)::integer from public.admin_audit_log
  where actor_id='a9100000-0000-4000-8000-000000000002'
    and action like 'service_fee.%'),
  0,'Denied configuration writes do not create fee audit events');

update public.admin_users set active=false
 where user_id='a9100000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a9200000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.admin_schedule_service_fee_configuration(
  10,100,(select ends_at+interval '1 day' from service_fee_test_window),null,'Inactive Super Admin attempt')$$,
 '42501','Not authorized','Inactive Super Admin cannot schedule fee configurations');
reset role;
update public.admin_users set active=true
 where user_id='a9100000-0000-4000-8000-000000000001';
delete from auth.sessions where id='a9200000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_schedule_service_fee_configuration(
  10,100,(select ends_at+interval '1 day' from service_fee_test_window),null,'Revoked session attempt')$$,
 '42501','Not authorized','Super Admin with a revoked session cannot schedule fee configurations');
reset role;

select * from finish();
rollback;
