begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
select is((select schedule from cron.job where jobname = 'notification-email-delivery'),
  '*/5 * * * *', 'Notification worker runs every five minutes');
select ok((select active from cron.job where jobname = 'notification-email-delivery'),
  'Notification schedule is active');
select ok(not has_function_privilege('authenticated',
  'public.process_scheduled_notification_emails()', 'EXECUTE'),
  'Clients cannot invoke the scheduled worker');
select ok(exists (select 1 from vault.secrets where name = 'notification_worker_secret'),
  'Worker credential is stored in Vault');
select * from finish();
rollback;
