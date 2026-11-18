create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notification_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notification_worker_secret',
      'Shared secret for the scheduled notification Edge Function'
    );
  end if;
end;
$$;

create or replace function public.process_scheduled_notification_emails()
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'notification_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'notification_worker_secret';
  if v_url is null or v_secret is null then
    raise exception 'Notification scheduler Vault configuration is missing';
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-notification-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.process_scheduled_notification_emails() from public, anon, authenticated;
grant execute on function public.process_scheduled_notification_emails() to service_role;

select cron.schedule(
  'notification-email-delivery',
  '*/5 * * * *',
  'select public.process_scheduled_notification_emails();'
);
