begin;

alter table public.notification_preferences
  add column listings_in_app boolean not null default true,
  add column listings_email boolean not null default true,
  add column bidding_in_app boolean not null default true,
  add column bidding_email boolean not null default true;

update public.notification_preferences set
  bookings_in_app=true, bookings_email=true, payments_in_app=true,
  payments_email=true, cases_in_app=true, cases_email=true;
alter table public.notification_preferences add constraint mandatory_notification_preferences
  check (bookings_in_app and bookings_email and payments_in_app and payments_email and cases_in_app and cases_email);

alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('bookings','messages','requests','listings','bidding','payments','cases','promotions'));
alter table public.notification_email_jobs drop constraint notification_email_jobs_category_check;
alter table public.notification_email_jobs add constraint notification_email_jobs_category_check
  check (category in ('bookings','messages','requests','listings','bidding','payments','cases','promotions'));

create function public.notification_event_category(p_category text, p_event_key text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_category='bookings' and p_event_key like 'auction-%' then 'bidding'
    when p_category='bookings' and p_event_key like 'listing-availability:%' then 'listings'
    else p_category end;
$$;
create function public.notification_is_mandatory(p_category text, p_event_key text)
returns boolean language sql immutable set search_path = '' as $$
  select p_category in ('bookings','payments','cases')
    or (p_category='bidding' and p_event_key !~ '^(auction-bid|auction-bid-accepted|auction-outbid|auction-extended|auction-closed|auction-not-selected):');
$$;
revoke all on function public.notification_event_category(text,text) from public,anon,authenticated;
revoke all on function public.notification_is_mandatory(text,text) from public,anon,authenticated;

create or replace function public.notification_preference_enabled(p_user_id uuid, p_category text, p_channel text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_channel not in ('in_app','email') then false
    when p_category in ('bookings','payments','cases') then true
    when p_category in ('messages','requests','listings','bidding','promotions') then coalesce(
      (select (to_jsonb(p)->>(p_category||'_'||p_channel))::boolean
        from public.notification_preferences p where user_id=p_user_id),
      p_category<>'promotions')
    else false end;
$$;

create function public.notification_delivery_enabled(p_user_id uuid, p_category text, p_event_key text, p_channel text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.notification_is_mandatory(p_category,p_event_key)
    or public.notification_preference_enabled(p_user_id,p_category,p_channel);
$$;
revoke all on function public.notification_delivery_enabled(uuid,text,text,text) from public,anon,authenticated;

create function public.enforce_notification_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.category:=public.notification_event_category(new.category,new.event_key);
  if tg_table_name='notifications' then
    new.in_app_enabled:=public.notification_delivery_enabled(new.user_id,new.category,new.event_key,'in_app');
  elsif not public.notification_delivery_enabled(new.user_id,new.category,new.event_key,'email') then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_notification_delivery() from public,anon,authenticated;
create trigger notifications_enforce_delivery before insert on public.notifications
  for each row execute function public.enforce_notification_delivery();
create trigger notification_email_jobs_enforce_delivery before insert on public.notification_email_jobs
  for each row execute function public.enforce_notification_delivery();

create or replace function public.create_notification(
  p_user_id uuid, p_event_key text, p_category text, p_title text, p_body text, p_destination text,
  p_throttle_key text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_notification_id uuid;
  v_category text:=public.notification_event_category(p_category,p_event_key);
begin
  if p_user_id is null or p_event_key is null or v_category is null or v_category not in
    ('bookings','messages','requests','listings','bidding','payments','cases','promotions')
    or p_destination is null or p_destination !~ '^/[A-Za-z0-9/_-]+$' or p_destination like '//%'
    or p_title is null or length(p_title) not between 1 and 160
    or p_body is null or length(p_body) not between 1 and 500 then
    raise exception 'Invalid notification data' using errcode = '22023';
  end if;
  select email into v_email from public.profiles where id=p_user_id;
  if not found then return; end if;
  insert into public.notifications(user_id,event_key,category,title,body,destination)
    values(p_user_id,p_event_key,v_category,p_title,p_body,p_destination)
    on conflict(event_key) do nothing returning id into v_notification_id;
  if v_notification_id is null then return; end if;
  if public.notification_delivery_enabled(p_user_id,v_category,p_event_key,'email')
    and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and (v_category<>'messages' or not exists(
      select 1 from public.notification_email_jobs where user_id=p_user_id and category='messages'
        and throttle_key=p_throttle_key and created_at>now()-interval '5 minutes'
    )) then
    insert into public.notification_email_jobs(event_key,user_id,recipient_email,category,subject,body,destination,throttle_key)
      values(p_event_key,p_user_id,v_email,v_category,p_title,p_body,p_destination,p_throttle_key)
      on conflict(event_key) do nothing;
  end if;
end;
$$;

create function public.enforce_marketplace_notification_preference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.notification_preference_enabled(new.user_id,'requests','in_app') then return null; end if;
  return new;
end;
$$;
revoke all on function public.enforce_marketplace_notification_preference() from public,anon,authenticated;
create trigger marketplace_notifications_enforce_preference before insert on public.marketplace_notifications
  for each row execute function public.enforce_marketplace_notification_preference();

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='marketplace_notifications') then
    alter publication supabase_realtime add table public.marketplace_notifications;
  end if;
end;
$$;

-- Reclassify history without hiding optional alerts that have already reached the inbox.
update public.notifications set category=public.notification_event_category(category,event_key)
  where category is distinct from public.notification_event_category(category,event_key);
update public.notification_email_jobs set category=public.notification_event_category(category,event_key)
  where category is distinct from public.notification_event_category(category,event_key);
update public.notifications set in_app_enabled=true
  where not in_app_enabled and public.notification_is_mandatory(category,event_key);

commit;
