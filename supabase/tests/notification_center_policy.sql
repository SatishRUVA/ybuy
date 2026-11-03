begin;
do $$
declare
  v_user uuid;
  v_event text;
  v_category text;
  v_enabled boolean;
begin
  select id into strict v_user from public.profiles
    where email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' order by created_at limit 1;
  insert into public.notification_preferences(user_id) values(v_user) on conflict(user_id) do nothing;
  update public.notification_preferences set
    bidding_in_app=false,bidding_email=false,listings_in_app=false,listings_email=false,
    requests_in_app=false,requests_email=false,messages_in_app=false,messages_email=false,
    promotions_in_app=false,promotions_email=false where user_id=v_user;
  begin
    update public.notification_preferences set bookings_in_app=false where user_id=v_user;
    raise exception 'Mandatory in-app preference was allowed to turn off';
  exception when check_violation then null;
  end;
  begin
    update public.notification_preferences set payments_email=false where user_id=v_user;
    raise exception 'Mandatory email preference was allowed to turn off';
  exception when check_violation then null;
  end;
  for v_event,v_category,v_enabled in select * from (values
    ('auction-bid:notification-policy-test','bidding',false),
    ('auction-bid-accepted:notification-policy-test','bidding',false),
    ('auction-outbid:notification-policy-test','bidding',false),
    ('auction-extended:notification-policy-test','bidding',false),
    ('auction-closed:notification-policy-test','bidding',false),
    ('auction-not-selected:notification-policy-test','bidding',false),
    ('auction-winner:notification-policy-test','bidding',true),
    ('auction-selection:notification-policy-test','bidding',true),
    ('auction-payment-reminder:notification-policy-test','bidding',true),
    ('listing-availability:notification-policy-test','listings',false),
    ('booking:notification-policy-test','bookings',true)
  ) events loop
    perform public.create_notification(v_user,v_event,'bookings','Policy test','Rollback-only test.','/dashboard');
    if not exists(select 1 from public.notifications where event_key=v_event and category=v_category and in_app_enabled=v_enabled) then
      raise exception 'Wrong category or in-app policy for %',v_event;
    end if;
    if exists(select 1 from public.notification_email_jobs where event_key=v_event) is distinct from v_enabled then
      raise exception 'Wrong email policy for %',v_event;
    end if;
  end loop;
  insert into public.notifications(user_id,event_key,category,title,body,destination,in_app_enabled)
    values(v_user,'auction-payment-reminder:direct-policy-test','bookings','Policy test','Rollback-only test.','/dashboard',false);
  if not exists(select 1 from public.notifications where event_key='auction-payment-reminder:direct-policy-test' and in_app_enabled and category='bidding') then
    raise exception 'Direct inserts can bypass mandatory policy';
  end if;
  insert into public.notification_email_jobs(user_id,event_key,recipient_email,category,subject,body,destination)
    values(v_user,'auction-bid:direct-policy-test','test@example.invalid','bookings','Policy test','Rollback-only test.','/dashboard');
  if exists(select 1 from public.notification_email_jobs where event_key='auction-bid:direct-policy-test') then
    raise exception 'Direct email insert bypassed optional mute';
  end if;
  if not public.notification_preference_enabled(v_user,'cases','in_app') then
    raise exception 'Safety and support must stay enabled';
  end if;
end;
$$;
rollback;
