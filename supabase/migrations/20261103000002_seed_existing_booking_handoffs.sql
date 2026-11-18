begin;

with seeded as (
  insert into public.booking_handoffs(booking_id, status)
  select id, case status
    when 'active' then 'rental_active'
    else 'return_initiated'
  end
  from public.bookings
  where status in ('active', 'return_pending')
  on conflict (booking_id) do nothing
  returning booking_id, status
)
insert into public.booking_handoff_events(booking_id, event_type, detail)
select booking_id, 'legacy_handoff_initialized',
  jsonb_build_object(
    'handoff_status', status,
    'pickup_timestamp_unavailable', true,
    'pickup_inspection_unavailable', true
  )
from seeded;

commit;
