begin;

do $$
declare
  v_user uuid;
  v_session uuid := gen_random_uuid();
  v_configuration uuid;
  v_data jsonb;
begin
  select user_id into v_user from public.admin_users
  where active and (role = 'super_admin' or 'config.manage' = any(permissions)) limit 1;
  if v_user is null then raise exception 'An active admin fixture is required'; end if;
  select id into v_configuration from public.service_fee_configurations limit 1;
  if v_configuration is null then raise exception 'A fee configuration fixture is required'; end if;

  insert into auth.sessions(id, user_id, created_at, updated_at) values (v_session, v_user, now(), now());
  update public.service_fee_configurations set created_by = v_user, updated_by = v_user where id = v_configuration;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user, 'session_id', v_session, 'exp', extract(epoch from now()) + 3600
  )::text, true);

  v_data := public.admin_list_service_fee_configurations();
  if not exists (
    select 1 from jsonb_array_elements(v_data) row
    join public.profiles profile on profile.id = v_user
    where (row->>'id')::uuid = v_configuration
      and row->>'created_by_name' = nullif(btrim(profile.full_name), '')
      and row->>'updated_by_name' = nullif(btrim(profile.full_name), '')
  ) then raise exception 'Fee configuration actor names do not match the profile'; end if;

  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.admin_list_service_fee_configurations();
    raise exception 'Unauthorized fee configuration access succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
