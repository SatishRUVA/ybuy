begin;
create function public.suppress_inactive_request_match_emails()
returns void language sql security definer set search_path = '' as $$
  update public.notification_email_jobs j set status='failed',
    last_error='The matched item request is no longer public and active.',locked_until=null
  from public.item_requests r
  where j.event_key like 'request-match:'||r.id::text||':%'
    and (j.status in ('pending','retrying') or (j.status='sending' and j.locked_until<now()))
    and (r.status not in ('open','responses_received','negotiating') or r.visibility<>'public'
      or r.expires_at<=now() or r.preferred_start_date<current_date);
$$;
alter function public.claim_notification_email_jobs(uuid,integer) rename to claim_notification_email_jobs_before_matching;
alter function public.claim_next_notification_email_jobs(integer) rename to claim_next_notification_email_jobs_before_matching;
revoke all on function public.claim_notification_email_jobs_before_matching(uuid,integer),
  public.claim_next_notification_email_jobs_before_matching(integer),public.suppress_inactive_request_match_emails()
  from public,anon,authenticated,service_role;
create function public.claim_notification_email_jobs(p_user_id uuid,p_limit integer default 10)
returns table(job_id uuid,recipient_email text,category text,subject text,body text,destination text,attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.suppress_inactive_request_match_emails();
  return query select * from public.claim_notification_email_jobs_before_matching(p_user_id,p_limit);
end;
$$;
create function public.claim_next_notification_email_jobs(p_limit integer default 10)
returns table(job_id uuid,recipient_email text,category text,subject text,body text,destination text,attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.suppress_inactive_request_match_emails();
  return query select * from public.claim_next_notification_email_jobs_before_matching(p_limit);
end;
$$;
revoke all on function public.claim_notification_email_jobs(uuid,integer),public.claim_next_notification_email_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_email_jobs(uuid,integer),public.claim_next_notification_email_jobs(integer) to service_role;
commit;
