-- Test data only. Run against ybuy-e2e-test, never the default linked project:
-- pnpm exec supabase db query --linked --project-ref jzyjmsixfuwzfnntewqn --file supabase\seeds\hosted-test-requests.sql
-- Stable IDs make reruns insert-only: existing requests and responses are never reset.
begin;

do $$
declare
  sample record;
  renter uuid;
  category uuid;
  request_id uuid;
begin
  if not exists (select 1 from public.feature_flags where key = 'item_requests' and enabled) then
    raise exception 'Item requests must already be enabled on the test project';
  end if;
  for sample in
    select * from (values
      (1, 1, 'Tools & Equipment', 'Cordless drill for furniture assembly',
       'Looking for a cordless drill, charged battery and basic drill bits for assembling shelves.',
       'Irving, TX', 32.9247, -96.9598, 20, 1, 7, 9),
      (2, 2, 'Electronics', 'Projector for a family movie night',
       'Need a projector with HDMI input and a power cable for an indoor family movie night.',
       'Las Colinas, TX', 32.8890, -96.9430, 45, 1, 8, 10),
      (3, 3, 'Outdoor & Camping', 'Four-person tent for a weekend camping trip',
       'Seeking a clean four-person tent with rain fly, stakes and a carry bag for a weekend trip.',
       'Irving, TX', 32.9247, -96.9598, 35, 1, 10, 13),
      (4, 4, 'Party & Events', 'Folding tables for a backyard birthday',
       'Need two folding tables for food and gifts at a small backyard birthday. Pickup preferred.',
       'Coppell, TX', 32.9546, -97.0150, 30, 2, 12, 14),
      (5, 5, 'Sports & Fitness', 'Bicycle for a weekend trail ride',
       'Looking for an adult medium-frame bicycle and helmet for paved trails. No off-road riding.',
       'Dallas, TX', 32.7767, -96.7970, 40, 1, 14, 16),
      (6, 1, 'Vehicles', 'Utility trailer for moving boxes',
       'Need a small utility trailer for boxed household items. Please specify hitch requirements.',
       'Irving, TX', 32.8140, -96.9490, 65, 1, 16, 18),
      (7, 2, 'Home & Garden', 'Pressure washer for a patio cleanup',
       'Seeking an electric pressure washer with hose and patio nozzle for a small concrete patio.',
       'Carrollton, TX', 32.9756, -96.8897, 45, 1, 18, 20),
      (8, 3, 'Other', 'Acoustic guitar for beginner practice',
       'Looking for a full-size acoustic guitar with a case for a few days of beginner practice.',
       'Irving, TX', 32.9247, -96.9598, 25, 1, 20, 24)
    ) as samples(number, renter_number, category_name, title, description, location, lat, lng, budget, quantity, start_offset, end_offset)
  loop
    select p.id into strict renter
    from public.profiles p join auth.users u on u.id = p.id
    where p.email = 'renter' || sample.renter_number || '@example.test'
      and u.email = p.email
      and u.raw_app_meta_data ->> 'local_test_fixture' = 'ybuy-local-lifecycle-v1'
      and not exists (select 1 from public.admin_users a where a.user_id = p.id);
    select id into strict category from public.categories where name = sample.category_name;
    request_id := ('b1170000-0000-4000-8000-' || lpad(sample.number::text, 12, '0'))::uuid;
    if exists (select 1 from public.item_requests where id = request_id and
      (renter_id <> renter or additional_notes is distinct from 'ybuy-hosted-request-samples-v1')) then
      raise exception 'Sample request ID collision: %', request_id;
    end if;
    insert into public.item_requests (
      id, renter_id, idempotency_key, category_id, title, description,
      preferred_start_date, preferred_end_date, location_label, location_lat, location_lng,
      location_country_code, radius_miles, max_daily_budget, requested_quantity,
      additional_notes, visibility, status, expires_at
    ) values (
      request_id, renter, request_id, category, '[Sample] ' || sample.title,
      'Sample request for testing only. ' || sample.description,
      current_date + sample.start_offset, current_date + sample.end_offset,
      sample.location, sample.lat, sample.lng, 'US', 25, sample.budget, sample.quantity,
      'ybuy-hosted-request-samples-v1', 'public', 'open', now() + interval '30 days'
    ) on conflict (id) do nothing;
  end loop;
  if (select count(*) from public.item_requests where additional_notes = 'ybuy-hosted-request-samples-v1') <> 8 then
    raise exception 'Expected exactly eight sample requests';
  end if;
end;
$$;

commit;

select title, status, location_label, preferred_start_date, preferred_end_date, max_daily_budget
from public.item_requests where additional_notes = 'ybuy-hosted-request-samples-v1'
order by id;
