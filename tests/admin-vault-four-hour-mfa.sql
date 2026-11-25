do $$
declare
  v_user uuid;
  v_session uuid := gen_random_uuid();
  v_verified_at timestamptz := date_trunc('second', now() - interval '3 hours 59 minutes');
  v_claims jsonb;
begin
  select user_id into v_user from public.admin_users
    where active and role = 'super_admin' limit 1;
  if v_user is null then raise exception 'An active Super Admin fixture is required'; end if;
  insert into auth.sessions(id,user_id,created_at,updated_at) values (v_session,v_user,now(),now());
  insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
    values (gen_random_uuid(),v_user,'totp','verified',now(),now());
  v_claims := jsonb_build_object('sub',v_user,'session_id',v_session,
    'exp',extract(epoch from now())+3600,'aal','aal2',
    'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from v_verified_at))));

  perform set_config('request.jwt.claims',v_claims::text,true);
  if public.admin_require_vault_mfa() is distinct from v_verified_at + interval '4 hours' then
    raise exception 'Vault MFA expiration did not match verification time plus four hours';
  end if;

  perform set_config('request.jwt.claims',jsonb_set(v_claims,'{amr}',jsonb_build_array(
    jsonb_build_object('method','totp','timestamp',extract(epoch from now()-interval '4 hours'))
  ))::text,true);
  begin
    perform public.admin_require_vault_mfa();
    raise exception 'Expired verification was accepted';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',jsonb_set(v_claims,'{aal}','"aal1"')::text,true);
  begin
    perform public.admin_require_vault_mfa();
    raise exception 'Single-factor verification was accepted';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',jsonb_set(v_claims,'{amr}',jsonb_build_array(
    jsonb_build_object('method','totp','timestamp',extract(epoch from now()+interval '1 minute'))
  ))::text,true);
  begin
    perform public.admin_require_vault_mfa();
    raise exception 'Future verification was accepted';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',jsonb_set(v_claims,'{amr}','[]')::text,true);
  begin
    perform public.admin_require_vault_mfa();
    raise exception 'Missing TOTP verification was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
