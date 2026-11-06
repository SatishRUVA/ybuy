create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.has_active_session() then
    raise exception 'An active session is required' using errcode = '42501';
  end if;
  update public.notifications set read_at = now()
    where user_id = auth.uid() and in_app_enabled and read_at is null and category <> 'messages';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

drop policy notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications
  for select to authenticated using (
    user_id = auth.uid() and (in_app_enabled or category = 'messages') and public.has_active_session()
  );

drop policy notifications_mark_read_own on public.notifications;
create policy notifications_mark_read_own on public.notifications
  for update to authenticated using (
    user_id = auth.uid() and (in_app_enabled or category = 'messages') and public.has_active_session()
  ) with check (
    user_id = auth.uid() and (in_app_enabled or category = 'messages') and read_at is not null and public.has_active_session()
  );

create index notifications_message_unread_idx on public.notifications(user_id, created_at desc)
  where category = 'messages' and read_at is null;

create or replace function public.mark_persistent_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_active_session() then
    raise exception 'An active session is required' using errcode = '42501';
  end if;
  update public.notifications set read_at = coalesce(read_at,now())
    where id = p_notification_id and user_id = auth.uid()
      and (in_app_enabled or category = 'messages');
  if not found then raise exception 'Notification not found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.mark_persistent_notification_read(uuid) from public, anon;
grant execute on function public.mark_persistent_notification_read(uuid) to authenticated;