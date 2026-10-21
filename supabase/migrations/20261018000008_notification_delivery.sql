create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  bookings_in_app boolean not null default true,
  bookings_email boolean not null default true,
  messages_in_app boolean not null default true,
  messages_email boolean not null default true,
  requests_in_app boolean not null default true,
  requests_email boolean not null default true,
  payments_in_app boolean not null default true,
  payments_email boolean not null default true,
  cases_in_app boolean not null default true,
  cases_email boolean not null default true,
  promotions_in_app boolean not null default false,
  promotions_email boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon;
grant select, insert, update on public.notification_preferences to authenticated;
create policy notification_preferences_read_own on public.notification_preferences
  for select to authenticated using (user_id = auth.uid() and public.has_active_session());
create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid() and public.has_active_session());
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated using (user_id = auth.uid() and public.has_active_session())
  with check (user_id = auth.uid() and public.has_active_session());

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null unique,
  category text not null check (category in ('bookings','messages','requests','payments','cases','promotions')),
  title text not null check (length(title) between 1 and 160),
  body text not null check (length(body) between 1 and 500),
  destination text not null check (destination ~ '^/[A-Za-z0-9/_-]+$' and destination not like '//%'),
  in_app_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_created_idx on public.notifications(user_id, created_at desc, id desc)
  where in_app_enabled;
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc)
  where in_app_enabled and read_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read_own on public.notifications
  for select to authenticated using (
    user_id = auth.uid() and in_app_enabled and public.has_active_session()
  );
create policy notifications_mark_read_own on public.notifications
  for update to authenticated using (
    user_id = auth.uid() and in_app_enabled and public.has_active_session()
  ) with check (
    user_id = auth.uid() and in_app_enabled and read_at is not null and public.has_active_session()
  );

create table public.notification_email_jobs (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  category text not null check (category in ('bookings','messages','requests','payments','cases','promotions')),
  subject text not null check (length(subject) between 1 and 160),
  body text not null check (length(body) between 1 and 500),
  destination text not null check (destination ~ '^/[A-Za-z0-9/_-]+$' and destination not like '//%'),
  throttle_key text,
  status text not null default 'pending' check (
    status in ('pending','sending','sent','delivered','retrying','failed','unknown')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  provider_message_id text unique,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz
);
create index notification_email_jobs_queue_idx
  on public.notification_email_jobs(available_at, created_at)
  where status in ('pending','retrying','sending');
create index notification_email_jobs_user_idx
  on public.notification_email_jobs(user_id, created_at desc);
alter table public.notification_email_jobs enable row level security;
revoke all on public.notification_email_jobs from public, anon, authenticated;
grant all on public.notification_email_jobs to service_role;

create table public.notification_email_provider_events (
  event_id text primary key,
  provider_message_id text not null,
  event_type text not null,
  created_at timestamptz not null default now()
);
alter table public.notification_email_provider_events enable row level security;
revoke all on public.notification_email_provider_events from public, anon, authenticated;
grant all on public.notification_email_provider_events to service_role;

create or replace function public.notification_preference_enabled(
  p_user_id uuid, p_category text, p_channel text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_category
    when 'bookings' then coalesce((select case p_channel when 'in_app' then bookings_in_app else bookings_email end
      from public.notification_preferences where user_id = p_user_id), true)
    when 'messages' then coalesce((select case p_channel when 'in_app' then messages_in_app else messages_email end
      from public.notification_preferences where user_id = p_user_id), true)
    when 'requests' then coalesce((select case p_channel when 'in_app' then requests_in_app else requests_email end
      from public.notification_preferences where user_id = p_user_id), true)
    when 'payments' then coalesce((select case p_channel when 'in_app' then payments_in_app else payments_email end
      from public.notification_preferences where user_id = p_user_id), true)
    when 'cases' then coalesce((select case p_channel when 'in_app' then cases_in_app else cases_email end
      from public.notification_preferences where user_id = p_user_id), true)
    when 'promotions' then coalesce((select case p_channel when 'in_app' then promotions_in_app else promotions_email end
      from public.notification_preferences where user_id = p_user_id), false)
    else false
  end;
$$;
revoke all on function public.notification_preference_enabled(uuid,text,text) from public, anon, authenticated;

create or replace function public.create_notification(
  p_user_id uuid, p_event_key text, p_category text, p_title text, p_body text, p_destination text,
  p_throttle_key text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_notification_id uuid;
begin
  if p_user_id is null or p_event_key is null or p_category not in
    ('bookings','messages','requests','payments','cases','promotions')
    or p_destination !~ '^/[A-Za-z0-9/_-]+$' or p_destination like '//%'
    or length(p_title) not between 1 and 160
    or length(p_body) not between 1 and 500 then
    raise exception 'Invalid notification data' using errcode = '22023';
  end if;

  select email into v_email from public.profiles where id = p_user_id;
  if not found then return; end if;

  insert into public.notifications(user_id,event_key,category,title,body,destination,in_app_enabled)
    values (p_user_id,p_event_key,p_category,p_title,p_body,p_destination,
      public.notification_preference_enabled(p_user_id,p_category,'in_app'))
    on conflict (event_key) do nothing
    returning id into v_notification_id;

  if v_notification_id is null then return; end if;
  if public.notification_preference_enabled(p_user_id,p_category,'email')
    and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and (p_category <> 'messages' or not exists (
      select 1 from public.notification_email_jobs
      where user_id = p_user_id and category = 'messages'
        and throttle_key = p_throttle_key and created_at > now() - interval '5 minutes'
    )) then
    insert into public.notification_email_jobs(
      event_key,user_id,recipient_email,category,subject,body,destination,throttle_key
    ) values (
      p_event_key,p_user_id,v_email,p_category,p_title,p_body,p_destination,p_throttle_key
    ) on conflict (event_key) do nothing;
  end if;
end;
$$;
revoke all on function public.create_notification(uuid,text,text,text,text,text,text) from public, anon, authenticated;

create or replace function public.capture_booking_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status text := new.status;
  v_title text;
  v_body text;
  v_recipient uuid;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  if v_status = 'requested' then
    v_title := 'New booking request';
    v_body := 'A renter has requested to book your item.';
    perform public.create_notification(new.owner_id,
      'booking:' || new.id::text || ':requested:' || new.owner_id::text,'bookings',v_title,v_body,'/dashboard');
    return new;
  elsif v_status = 'pending_payment' then
    v_title := 'Complete your booking payment';
    v_body := 'Your booking request was accepted. Complete payment to confirm the rental.';
    perform public.create_notification(new.renter_id,
      'booking:' || new.id::text || ':pending_payment:' || new.renter_id::text,'bookings',v_title,v_body,'/dashboard');
    return new;
  elsif v_status = 'confirmed' then
    v_title := 'Booking confirmed';
    v_body := 'Payment is confirmed and your rental is booked.';
  elsif v_status = 'active' then
    v_title := 'Rental started';
    v_body := 'The rental is now active.';
  elsif v_status = 'return_pending' then
    v_title := 'Return ready for review';
    v_body := 'The rental return is waiting for the next step.';
  elsif v_status = 'completed' then
    v_title := 'Rental completed';
    v_body := 'Your rental is complete. You can leave a review.';
  elsif v_status = 'cancelled' then
    v_title := 'Booking cancelled';
    v_body := 'The booking was cancelled.';
  elsif v_status = 'rejected' then
    v_title := 'Booking declined';
    v_body := 'The booking request was declined.';
  else
    return new;
  end if;

  foreach v_recipient in array array[new.renter_id,new.owner_id] loop
    perform public.create_notification(v_recipient,
      'booking:' || new.id::text || ':' || v_status || ':' || v_recipient::text,
      'bookings',v_title,v_body,'/dashboard');
  end loop;
  return new;
end;
$$;
revoke all on function public.capture_booking_notification() from public, anon, authenticated;
create trigger bookings_capture_notification
  after insert or update of status on public.bookings
  for each row execute function public.capture_booking_notification();

create or replace function public.capture_payment_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  if new.status not in ('succeeded','failed') then return new; end if;
  select * into v_booking from public.bookings where id = new.booking_id;
  if not found then return new; end if;

  perform public.create_notification(v_booking.renter_id,
    'payment:' || new.id::text || ':' || new.status,'payments',
    case when new.status = 'succeeded' then 'Payment confirmed' else 'Payment failed' end,
    case when new.status = 'succeeded'
      then 'Your payment was confirmed and the booking is secured.'
      else 'Your payment could not be completed. Review the booking before trying again.' end,
    '/dashboard');
  return new;
end;
$$;
revoke all on function public.capture_payment_notification() from public, anon, authenticated;
create trigger payments_capture_notification
  after insert or update of status on public.payments
  for each row execute function public.capture_payment_notification();

create or replace function public.capture_message_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
begin
  for v_recipient in
    select participant_one from public.conversations
      where id = new.conversation_id and participant_one <> new.sender_id
    union all
    select participant_two from public.conversations
      where id = new.conversation_id and participant_two <> new.sender_id
  loop
    perform public.create_notification(v_recipient,
      'message:' || new.id::text || ':' || v_recipient::text,'messages',
      'New message','You have a new message.','/messages/' || new.conversation_id::text,
      'conversation:' || new.conversation_id::text);
  end loop;
  return new;
end;
$$;
revoke all on function public.capture_message_notification() from public, anon, authenticated;
create trigger messages_capture_notification after insert on public.messages
  for each row execute function public.capture_message_notification();

create or replace function public.capture_marketplace_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.create_notification(new.user_id,
    'marketplace:' || new.id::text,'requests',left(new.title,160),left(new.body,500),
    case when new.negotiation_id is null then '/requests' else '/bidding' end);
  return new;
end;
$$;
revoke all on function public.capture_marketplace_notification() from public, anon, authenticated;
create trigger marketplace_notifications_capture after insert on public.marketplace_notifications
  for each row execute function public.capture_marketplace_notification();

create or replace function public.capture_case_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_case public.operations_cases;
begin
  select * into v_case from public.operations_cases where id = new.case_id;
  if not found then return new; end if;
  perform public.create_notification(new.user_id,
    'case:' || new.id::text,'cases',
    case when v_case.kind = 'dispute' then 'Dispute case update' else 'Support case update' end,
    'There is an update to your case.',
    case when v_case.kind = 'dispute' then '/claims/' || v_case.id::text
      else '/support/' || v_case.id::text end);
  return new;
end;
$$;
revoke all on function public.capture_case_notification() from public, anon, authenticated;
create trigger operations_notifications_capture after insert on public.operations_notifications
  for each row execute function public.capture_case_notification();

create or replace function public.capture_review_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.create_notification(new.reviewee_id,
    'review:' || new.id::text,'bookings','You received a review',
    'A rental participant left you a review.','/dashboard');
  return new;
end;
$$;
revoke all on function public.capture_review_notification() from public, anon, authenticated;
create trigger reviews_capture_notification after insert on public.reviews
  for each row execute function public.capture_review_notification();

create or replace function public.mark_persistent_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_active_session() then
    raise exception 'An active session is required' using errcode = '42501';
  end if;
  update public.notifications set read_at = coalesce(read_at,now())
    where id = p_notification_id and user_id = auth.uid() and in_app_enabled;
  if not found then raise exception 'Notification not found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.mark_persistent_notification_read(uuid) from public, anon;
grant execute on function public.mark_persistent_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.has_active_session() then
    raise exception 'An active session is required' using errcode = '42501';
  end if;
  update public.notifications set read_at = now()
    where user_id = auth.uid() and in_app_enabled and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

create or replace function public.claim_notification_email_jobs(p_user_id uuid,p_limit integer default 10)
returns table (
  job_id uuid, recipient_email text, category text, subject text, body text,
  destination text, attempts integer
)
language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_email_jobs j set status = 'failed',
    last_error = 'Email notifications are disabled by this user.', locked_until = null
    where j.user_id = p_user_id and j.status in ('pending','retrying')
      and not public.notification_preference_enabled(p_user_id,j.category,'email');

  update public.notification_email_jobs j set status = 'failed',
    last_error = 'Email retry limit reached.', locked_until = null
    where j.user_id = p_user_id and j.status in ('pending','retrying','sending')
      and j.attempts >= 5 and (j.status <> 'sending' or j.locked_until < now());

  return query
  with candidates as (
    select j.id from public.notification_email_jobs j
    where j.user_id = p_user_id and j.attempts < 5 and j.available_at <= now()
      and (j.status in ('pending','retrying') or (j.status = 'sending' and j.locked_until < now()))
      and public.notification_preference_enabled(p_user_id,j.category,'email')
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
revoke all on function public.claim_notification_email_jobs(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_notification_email_jobs(uuid,integer) to service_role;

create or replace function public.finish_notification_email_job(
  p_job_id uuid,p_status text,p_provider_message_id text default null,p_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_email_jobs;
v_provider_event text;
begin
if p_status is null or p_status not in ('sent','retrying','failed','unknown') then
    raise exception 'Invalid notification email status' using errcode = '22023';
  end if;
  select * into v_job from public.notification_email_jobs where id = p_job_id for update;
  if found and v_job.status in ('sent','delivered','failed') then return; end if;
  if not found or v_job.status <> 'sending' then
    raise exception 'Email job is not currently being sent' using errcode = 'P0002';
  end if;
  if p_status = 'sent' and p_provider_message_id is not null then
    select event_type into v_provider_event from public.notification_email_provider_events
      where provider_message_id = p_provider_message_id
      order by created_at desc,event_id desc limit 1;
  end if;
  update public.notification_email_jobs set
    status = case
      when v_provider_event = 'email.delivered' then 'delivered'
      when v_provider_event in ('email.bounced','email.complained','email.failed') then 'failed'
      when p_status = 'retrying' and v_job.attempts >= 5 then 'failed'
      else p_status end,
    provider_message_id = case when p_status = 'sent' then p_provider_message_id else provider_message_id end,
    sent_at = case when p_status = 'sent' then coalesce(sent_at,now()) else sent_at end,
    delivered_at = case when v_provider_event = 'email.delivered' then now() else delivered_at end,
    last_error = case
      when v_provider_event in ('email.bounced','email.complained','email.failed') then 'Resend reported a delivery failure.'
      when p_status = 'sent' then null
      else left(coalesce(p_error,'Delivery failed'),300) end,
    available_at = case when p_status = 'retrying' and v_job.attempts < 5
      then now() + make_interval(secs => least(3600,30 * (2 ^ greatest(v_job.attempts - 1,0))::integer))
      else available_at end,
    locked_until = null
    where id = p_job_id;
end;
$$;
revoke all on function public.finish_notification_email_job(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.finish_notification_email_job(uuid,text,text,text) to service_role;

create or replace function public.record_notification_email_event(
  p_event_id text,p_provider_message_id text,p_event_type text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_row_count integer;
begin
  if p_event_id is null or p_event_id = '' or p_provider_message_id is null
    or p_event_type not in ('email.sent','email.delivered','email.bounced','email.complained','email.failed') then
    raise exception 'Invalid provider event' using errcode = '22023';
  end if;
  insert into public.notification_email_provider_events(event_id,provider_message_id,event_type)
    values(p_event_id,p_provider_message_id,p_event_type)
    on conflict (event_id) do nothing;
  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then return false; end if;
  update public.notification_email_jobs set
    status = case p_event_type
      when 'email.delivered' then 'delivered'
      when 'email.sent' then 'sent'
      else 'failed' end,
    delivered_at = case when p_event_type = 'email.delivered' then now() else delivered_at end,
    last_error = case when p_event_type in ('email.bounced','email.complained','email.failed')
      then 'Resend reported a delivery failure.' else null end,
    locked_until = null
    where provider_message_id = p_provider_message_id;
  return true;
end;
$$;
revoke all on function public.record_notification_email_event(text,text,text) from public, anon, authenticated;
grant execute on function public.record_notification_email_event(text,text,text) to service_role;

insert into public.notification_preferences(user_id)
  select id from public.profiles on conflict (user_id) do nothing;
create or replace function public.create_notification_preferences_for_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_preferences(user_id) values(new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_notification_preferences_for_profile() from public, anon, authenticated;
create trigger profiles_create_notification_preferences after insert on public.profiles
  for each row execute function public.create_notification_preferences_for_profile();

-- Preserve the existing case and marketplace history in the consolidated center without
-- sending retroactive email.
insert into public.notifications(user_id,event_key,category,title,body,destination,read_at)
  select n.user_id,'legacy:marketplace:' || n.id::text,'requests',left(n.title,160),left(n.body,500),
    case when n.negotiation_id is null then '/requests' else '/bidding' end,n.read_at
  from public.marketplace_notifications n
  on conflict (event_key) do nothing;
insert into public.notifications(user_id,event_key,category,title,body,destination,read_at)
  select n.user_id,'legacy:case:' || n.id::text,'cases',
    case when c.kind = 'dispute' then 'Dispute case update' else 'Support case update' end,
    'There is an update to your case.',
    case when c.kind = 'dispute' then '/claims/' || c.id::text else '/support/' || c.id::text end,n.read_at
  from public.operations_notifications n join public.operations_cases c on c.id = n.case_id
  on conflict (event_key) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
