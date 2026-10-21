begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-000000000001', 'vault-super@example.test'),
  ('d1000000-0000-4000-8000-000000000002', 'vault-admin@example.test'),
  ('d1000000-0000-4000-8000-000000000003', 'vault-user@example.test');
insert into auth.sessions (id, user_id) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002'),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003');
insert into public.admin_users (user_id, role, permissions) values
  ('d1000000-0000-4000-8000-000000000001', 'super_admin', '{}'),
  ('d1000000-0000-4000-8000-000000000002', 'admin', '{integrations.view}');
insert into auth.mfa_factors (id, user_id, factor_type, status, secret, created_at, updated_at) values
  ('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'totp', 'verified', 'test-factor-only', now(), now());

create function pg_temp.vault_claims(p_user integer default 1, p_aal text default 'aal2', p_age integer default 0, p_method text default 'totp')
returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', 'd1000000-0000-4000-8000-' || lpad(p_user::text, 12, '0'),
    'session_id', 'd2000000-0000-4000-8000-' || lpad(p_user::text, 12, '0'),
    'role', 'authenticated', 'exp', 4102444800, 'aal', p_aal,
    'amr', jsonb_build_array(jsonb_build_object('method', p_method, 'timestamp', extract(epoch from now()) - p_age))
  )::text, true)::void;
$$;

select ok(not has_function_privilege('anon', 'public.admin_vault_status()', 'execute'), 'Anonymous metadata access denied');
select ok(not has_function_privilege('anon', 'public.admin_vault_prepare()', 'execute'), 'Anonymous readiness check denied');
select ok(not has_function_privilege('anon', 'public.admin_vault_save(text,text,integer,text)', 'execute'), 'Anonymous secret writes denied');
select ok(not has_function_privilege('authenticated', 'public.admin_require_vault_mfa()', 'execute'), 'Internal guard is not directly callable');
select ok(not has_schema_privilege('authenticated', 'vault', 'usage'), 'Authenticated clients cannot use raw Vault schema');
select ok(not has_schema_privilege('anon', 'vault', 'usage'), 'Anonymous clients cannot use raw Vault schema');
select ok(not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select'), 'Decrypted secrets are inaccessible');
select ok((select relrowsecurity from pg_class where oid = 'public.admin_vault_entries'::regclass), 'Metadata table has RLS enabled');

set local role authenticated;
select pg_temp.vault_claims(3);
select throws_ok($$select public.admin_vault_prepare()$$, '42501', 'Super Admin access required', 'Ordinary user cannot prepare vault enrollment');
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Super Admin access required', 'Ordinary user denied');
select pg_temp.vault_claims(2);
select throws_ok($$select public.admin_vault_save('RESEND_API_KEY','fake-secret-one',0,'local fixture')$$, '42501', 'Super Admin access required', 'Admin cannot write even with asserted MFA');
select pg_temp.vault_claims(1, 'aal1');
select lives_ok($$select public.admin_vault_prepare()$$, 'Super Admin can check deployment readiness before enrollment');
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Recent authenticator verification required', 'Super Admin without MFA denied');
select pg_temp.vault_claims(1, 'aal2', 301);
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Recent authenticator verification required', 'Stale MFA denied');
select pg_temp.vault_claims(1, 'aal2', 300);
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Recent authenticator verification required', 'Five-minute boundary denied');
select pg_temp.vault_claims(1, 'aal2', -60);
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Recent authenticator verification required', 'Future MFA timestamp denied');
select pg_temp.vault_claims(1, 'aal2', 0, 'oauth');
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Recent authenticator verification required', 'OAuth alone is not a TOTP step-up');
select pg_temp.vault_claims();
select is(jsonb_array_length(public.admin_vault_status()->'entries'), 5, 'Recent MFA can read the five allowlisted slots');
select throws_ok($$select * from public.admin_vault_entries$$, '42501', 'permission denied for table admin_vault_entries', 'Even a Super Admin cannot directly query metadata');
select throws_ok($$select public.admin_vault_save('SUPABASE_SERVICE_ROLE_KEY','fake-secret-one',0,'local fixture')$$, '22023', 'Unsupported vault key', 'Bootstrap secret excluded');
select throws_ok($$select public.admin_vault_save('VITE_SECRET','fake-secret-one',0,'local fixture')$$, '22023', 'Unsupported vault key', 'Client secret names excluded');
select throws_ok($$select public.admin_vault_save('RESEND_API_KEY','short',0,'local fixture')$$, '22023', 'Secret must contain 8-16384 bytes of non-empty input', 'Short values rejected');
select is((public.admin_vault_save('RESEND_API_KEY','fake-secret-one',0,'local fixture')->>'version')::integer, 1, 'First write creates version one');
select throws_ok($$select public.admin_vault_save('RESEND_API_KEY','fake-secret-two',0,'local fixture')$$, '40001', 'Vault entry changed; reload before replacing it', 'Stale version prevents concurrent overwrite');
select is((public.admin_vault_save('RESEND_API_KEY','fake-secret-two',1,'local replacement')->>'version')::integer, 2, 'Replacement increments version');
select ok(public.admin_vault_status()::text not like '%fake-secret%', 'Status never returns secret values');
select ok(public.admin_vault_status()::text not like '%secret_id%', 'Status does not return raw Vault identifiers');

reset role;
select is((select decrypted_secret from vault.decrypted_secrets where name = 'ybuy_chest_RESEND_API_KEY'), 'fake-secret-two', 'Vault decrypts the latest fixture value for trusted database code');
select ok((select secret <> 'fake-secret-two' from vault.secrets where name = 'ybuy_chest_RESEND_API_KEY'), 'Value is encrypted at rest');
select is((select count(*)::integer from vault.secrets where name = 'ybuy_chest_RESEND_API_KEY'), 1, 'Replacement does not create duplicate secrets');
select is((select count(*)::integer from public.admin_audit_log where actor_id = 'd1000000-0000-4000-8000-000000000001' and action in ('vault.create','vault.replace')), 2, 'Creation and replacement audited');
select is((select reason from public.admin_audit_log where actor_id = 'd1000000-0000-4000-8000-000000000001' and action = 'vault.create'), 'Vault Chest secret write; submitted value and caller reason omitted', 'Audit reason is server-defined and cannot capture submitted input');
select ok(not exists(select 1 from public.admin_audit_log where actor_id = 'd1000000-0000-4000-8000-000000000001' and row_to_json(admin_audit_log)::text like '%fake-secret%'), 'Audit history contains no submitted values');

update public.admin_users set active = false where user_id = 'd1000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Super Admin access required', 'Revocation takes effect despite existing MFA token');
reset role;
update public.admin_users set active = true where user_id = 'd1000000-0000-4000-8000-000000000001';
update auth.mfa_factors set status = 'unverified' where id = 'd3000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Recent authenticator verification required', 'Removing verified factor blocks stale MFA token');
reset role;
update auth.mfa_factors set status = 'verified' where id = 'd3000000-0000-4000-8000-000000000001';
delete from auth.sessions where id = 'd2000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_vault_status()$$, '42501', 'Super Admin access required', 'Deleted session denied');

select * from finish();
rollback;
