begin;

create function public.process_scheduled_deposit_authorization_reminders()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='notification_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='notification_worker_secret';
  if v_url is null or v_secret is null then raise exception 'Deposit authorization scheduler Vault configuration is missing';end if;
  if v_url not in ('http://kong:8000','http://localhost:54321','https://jzyjmsixfuwzfnntewqn.supabase.co') then
    raise exception 'Only an isolated test backend is permitted for deposit authorization scheduling';
  end if;
  return net.http_post(url:=rtrim(v_url,'/')||'/functions/v1/process-deposit-authorizations',
    headers:=jsonb_build_object('Content-Type','application/json','x-notification-worker-secret',v_secret),
    body:='{}'::jsonb,timeout_milliseconds:=120000);
end;
$$;
revoke all on function public.process_scheduled_deposit_authorization_reminders() from public,anon,authenticated;
grant execute on function public.process_scheduled_deposit_authorization_reminders() to service_role;
select cron.schedule('deposit-authorization-reminders','0 * * * *',
  'select public.process_scheduled_deposit_authorization_reminders();');

commit;
