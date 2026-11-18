create extension if not exists supabase_vault with schema vault;

-- Vault is never exposed directly to browser roles, even after MFA.
revoke all on schema vault from public, anon, authenticated;
revoke all on all tables in schema vault from public, anon, authenticated;

create table if not exists public.admin_vault_entries (
  key text primary key check (key in (
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
    'RESEND_WEBHOOK_SECRET', 'OPENROUTER_API_KEY'
  )),
  secret_id uuid not null unique references vault.secrets(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
alter table public.admin_vault_entries enable row level security;
revoke all on public.admin_vault_entries from public, anon, authenticated;

create or replace function public.admin_vault_prepare()
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_active_session() or not exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and active and role = 'super_admin'
  ) then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.admin_vault_prepare() from public, anon;
grant execute on function public.admin_vault_prepare() to authenticated;

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
    or v_verified_at <= now() - interval '5 minutes' then
    raise exception 'Recent authenticator verification required' using errcode = '42501';
  end if;
  return v_verified_at + interval '5 minutes';
end;
$$;
revoke all on function public.admin_require_vault_mfa() from public, anon, authenticated;

create or replace function public.admin_vault_status()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expires timestamptz;
  v_entries jsonb;
begin
  v_expires := public.admin_require_vault_mfa();
  select jsonb_agg(jsonb_build_object(
    'key', keys.key, 'configured', entry.key is not null,
    'version', coalesce(entry.version, 0), 'updated_at', entry.updated_at
  ) order by keys.key) into v_entries
  from unnest(array[
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
    'RESEND_WEBHOOK_SECRET', 'OPENROUTER_API_KEY'
  ]) keys(key)
  left join public.admin_vault_entries entry using (key);
  perform public.admin_write_audit(
    'vault.access', 'vault', 'chest', null, null, 'MFA-verified metadata access'
  );
  return jsonb_build_object('expires_at', v_expires, 'entries', v_entries);
end;
$$;
revoke all on function public.admin_vault_status() from public, anon;
grant execute on function public.admin_vault_status() to authenticated;

create or replace function public.admin_vault_save(
  p_key text, p_secret text, p_expected_version integer, p_reason text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.admin_vault_entries;
  v_id uuid;
  v_version integer;
begin
  perform public.admin_require_vault_mfa();
  if p_key is null or p_key <> all(array[
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
    'RESEND_WEBHOOK_SECRET', 'OPENROUTER_API_KEY'
  ]) then
    raise exception 'Unsupported vault key' using errcode = '22023';
  end if;
  if p_secret is null or length(btrim(p_secret)) < 8 or octet_length(p_secret) > 16384 then
    raise exception 'Secret must contain 8-16384 bytes of non-empty input' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Expected version is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ybuy-vault:' || p_key, 0));
  select * into v_entry from public.admin_vault_entries where key = p_key for update;
  if coalesce(v_entry.version, 0) <> p_expected_version then
    raise exception 'Vault entry changed; reload before replacing it' using errcode = '40001';
  end if;
  v_version := p_expected_version + 1;
  if v_entry.secret_id is null then
    v_id := vault.create_secret(p_secret, 'ybuy_chest_' || p_key, 'Super Admin Vault Chest');
    insert into public.admin_vault_entries(key, secret_id, updated_by)
      values (p_key, v_id, auth.uid());
  else
    perform vault.update_secret(v_entry.secret_id, p_secret);
    update public.admin_vault_entries
      set version = v_version, updated_at = now(), updated_by = auth.uid()
      where key = p_key;
  end if;
  perform public.admin_write_audit(
    case when v_version = 1 then 'vault.create' else 'vault.replace' end,
    'vault_entry', p_key,
    jsonb_build_object('version', p_expected_version),
    jsonb_build_object('version', v_version),
    'Vault Chest secret write; submitted value and caller reason omitted'
  );
  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;
revoke all on function public.admin_vault_save(text,text,integer,text) from public, anon;
grant execute on function public.admin_vault_save(text,text,integer,text) to authenticated;
