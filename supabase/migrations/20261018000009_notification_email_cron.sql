create or replace function public.claim_next_notification_email_jobs(p_limit integer default 10)
returns table (
  job_id uuid, recipient_email text, category text, subject text, body text,
  destination text, attempts integer
)
language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_email_jobs j set status = 'failed',
    last_error = 'Email notifications are disabled by this user.', locked_until = null
    where j.status in ('pending','retrying')
      and not public.notification_preference_enabled(j.user_id,j.category,'email');

  update public.notification_email_jobs j set status = 'failed',
    last_error = 'Email retry limit reached.', locked_until = null
    where j.status in ('pending','retrying','sending') and j.attempts >= 5
      and (j.status <> 'sending' or j.locked_until < now());

  return query
  with candidates as (
    select j.id from public.notification_email_jobs j
    where j.attempts < 5 and j.available_at <= now()
      and (j.status in ('pending','retrying') or (j.status = 'sending' and j.locked_until < now()))
      and public.notification_preference_enabled(j.user_id,j.category,'email')
    order by j.created_at,j.id
    limit least(greatest(coalesce(p_limit,10),1),25)
    for update skip locked
  ), claimed as (
    update public.notification_email_jobs j set status = 'sending',
      attempts = j.attempts + 1, locked_until = now() + interval '2 minutes'
    from candidates c where j.id = c.id
    returning j.id,j.recipient_email,j.category,j.subject,j.body,j.destination,j.attempts
  )
  select claimed.id,claimed.recipient_email,claimed.category,claimed.subject,
    claimed.body,claimed.destination,claimed.attempts
  from claimed;
end;
$$;
revoke all on function public.claim_next_notification_email_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_next_notification_email_jobs(integer) to service_role;
