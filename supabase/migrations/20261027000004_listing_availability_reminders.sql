begin;

create index listings_availability_reminders_idx
  on public.listings (availability_start)
  where status = 'published' and availability_start is not null;

create function public.process_listing_availability_reminders()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_created integer;
begin
  -- Write only to the in-app inbox; create_notification also queues email.
  insert into public.notifications (
    user_id, event_key, category, title, body, destination, in_app_enabled
  )
  select
    l.owner_id,
    'listing-availability:' || l.id::text || ':' || l.availability_start::text || ':' || reminder.days_before::text,
    'bookings',
    reminder.title,
    left('Your listing "' || l.title || '" will become available on ' || l.availability_start::text || '.', 500),
    '/dashboard',
    public.notification_preference_enabled(l.owner_id, 'bookings', 'in_app')
  from public.listings l
  cross join (values
    (7, 'Your listing starts in 7 days'),
    (1, 'Your listing starts tomorrow')
  ) as reminder(days_before, title)
  where l.status = 'published'
    and l.availability_start = current_date + reminder.days_before
  on conflict (event_key) do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;
revoke all on function public.process_listing_availability_reminders() from public, anon, authenticated;
grant execute on function public.process_listing_availability_reminders() to service_role;

select cron.schedule(
  'listing-availability-reminders',
  '*/5 * * * *',
  'select public.process_listing_availability_reminders();'
);

commit;
