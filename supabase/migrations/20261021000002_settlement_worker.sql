alter table public.rental_settlements add column last_error text;
alter table public.rental_settlements add column last_attempt_at timestamptz;

do $$
begin
  if not exists(select 1 from vault.secrets where name='settlement_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
      'settlement_worker_secret','Isolated test rental settlement worker');
  end if;
end;
$$;

-- Scheduling is opt-in; migration alone does not activate provider operations.
create function public.process_scheduled_rental_settlements()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='settlement_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='settlement_worker_secret';
  if v_url is null or v_secret is null then raise exception 'Settlement scheduler configuration is missing'; end if;
  if v_url not in ('http://kong:8000','https://jzyjmsixfuwzfnntewqn.supabase.co') then
    raise exception 'Only the isolated test backend is permitted for settlement scheduling';
  end if;
  return net.http_post(url:=v_url||'/functions/v1/settle-rental',
    headers:=jsonb_build_object('Content-Type','application/json','x-settlement-worker-secret',v_secret),
    body:='{"action":"process_queue"}'::jsonb,timeout_milliseconds:=120000);
end;
$$;
revoke all on function public.process_scheduled_rental_settlements() from public,anon,authenticated;
grant execute on function public.process_scheduled_rental_settlements() to service_role;
