create or replace function public.admin_require_vault_mfa()
returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  v_verified_at timestamptz;
begin
  perform public.admin_vault_prepare();
  if auth.jwt()->>'aal' is distinct from 'aal2' or not exists (
    select 1 from auth.mfa_factors
    where user_id = auth.uid() and factor_type = 'totp' and status = 'verified'
  ) then
    raise exception 'Recent authenticator verification required' using errcode = '42501';
  end if;
  select max(to_timestamp((entry->>'timestamp')::double precision))
    into v_verified_at
    from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) entry
    where entry->>'method' = 'totp';
  if v_verified_at is null or v_verified_at > now()
    or v_verified_at <= now() - interval '4 hours' then
    raise exception 'Recent authenticator verification required' using errcode = '42501';
  end if;
  return v_verified_at + interval '4 hours';
end;
$$;
