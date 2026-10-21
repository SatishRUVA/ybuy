-- Persistent renter requests and structured, server-authorized negotiations.
-- Accepted offers enter the existing booking/payment lifecycle; this migration
-- never confirms a booking or changes Stripe/webhook financial behavior.

alter table public.listings
  add column if not exists available_quantity integer not null default 1
    check (available_quantity between 1 and 100),
  add column if not exists negotiation_enabled boolean not null default false;

insert into public.app_settings (key, value, value_type, min_value, max_value, description, is_public)
values
  ('item_request_expiration_days', '30', 'integer', 1, 90,
   'Default lifetime in days for new public item requests.', false),
  ('negotiation_expiration_hours', '72', 'integer', 1, 168,
   'Lifetime in hours for each pending marketplace offer or counteroffer.', false),
  ('negotiation_max_rounds', '10', 'integer', 1, 25,
   'Maximum number of counteroffer revisions in a negotiation.', false),
  ('negotiation_max_daily_price', '100000', 'number', 1, 100000,
   'Maximum proposed USD rental price per day for an offer or counteroffer.', false),
  ('item_request_max_daily_budget', '100000', 'number', 1, 100000,
   'Maximum daily budget accepted on a renter item request.', false)
on conflict (key) do nothing;

create table public.item_requests (
  id uuid primary key default gen_random_uuid(),
  renter_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  category_id uuid not null references public.categories(id) on delete restrict,
  title text not null,
  description text not null,
  intended_use text,
  preferred_start_date date not null,
  preferred_end_date date not null,
  location_label text not null,
  max_daily_budget numeric(10,2) check (max_daily_budget is null or max_daily_budget > 0),
  requested_quantity integer not null default 1 check (requested_quantity between 1 and 100),
  specifications text,
  additional_notes text,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  status text not null default 'open' check (
    status in ('open', 'responses_received', 'negotiating', 'matched', 'cancelled', 'expired', 'closed')
  ),
  reference_image_paths text[] not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (renter_id, idempotency_key),
  check (preferred_end_date > preferred_start_date),
  check (char_length(title) between 3 and 120),
  check (char_length(location_label) between 2 and 200),
  check (cardinality(reference_image_paths) <= 4)
);
create index item_requests_renter_created_idx on public.item_requests(renter_id, created_at desc);
create index item_requests_open_discovery_idx on public.item_requests(category_id, preferred_start_date, preferred_end_date)
  where status in ('open', 'responses_received', 'negotiating');
create trigger item_requests_set_updated_at before update on public.item_requests
  for each row execute function public.set_updated_at();
create trigger item_requests_reject_unsafe_text before insert or update on public.item_requests
  for each row execute function public.reject_unsafe_text(
    '1200', 'title', 'description', 'intended_use', 'location_label', 'specifications', 'additional_notes'
  );
alter table public.item_requests enable row level security;
revoke insert, update, delete on public.item_requests from public, anon, authenticated;
grant select on public.item_requests to authenticated;
create policy item_requests_read_owner_or_open on public.item_requests
  for select to authenticated using (
    renter_id = auth.uid()
    or public.has_admin_permission('listings.moderate')
    or (
      visibility = 'public'
      and preferred_end_date > current_date
      and status in ('open', 'responses_received', 'negotiating')
      and expires_at > now()
      and exists (select 1 from public.feature_flags where key = 'item_requests' and enabled)
    )
  );
create policy item_requests_active_session on public.item_requests as restrictive for all to authenticated
  using (public.has_active_session()) with check (public.has_active_session());

create table public.marketplace_negotiations (
  id uuid primary key default gen_random_uuid(),
  item_request_id uuid references public.item_requests(id) on delete restrict,
  listing_id uuid references public.listings(id) on delete restrict,
  renter_id uuid not null references public.profiles(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  status text not null default 'pending' check (
    status in ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled')
  ),
  booking_id uuid unique references public.bookings(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (item_request_id is not null or listing_id is not null),
  check (renter_id <> owner_id),
  unique (created_by, idempotency_key)
);
create index marketplace_negotiations_request_idx on public.marketplace_negotiations(item_request_id, created_at desc);
create index marketplace_negotiations_renter_idx on public.marketplace_negotiations(renter_id, created_at desc);
create index marketplace_negotiations_owner_idx on public.marketplace_negotiations(owner_id, created_at desc);
create unique index marketplace_negotiations_active_listing_pair_idx
  on public.marketplace_negotiations(listing_id, renter_id, owner_id)
  where item_request_id is null and status in ('pending', 'countered');
create unique index marketplace_negotiations_active_request_owner_idx
  on public.marketplace_negotiations(item_request_id, owner_id)
  where item_request_id is not null and status in ('pending', 'countered');
create trigger marketplace_negotiations_set_updated_at before update on public.marketplace_negotiations
  for each row execute function public.set_updated_at();
alter table public.marketplace_negotiations enable row level security;
revoke insert, update, delete on public.marketplace_negotiations from public, anon, authenticated;
grant select on public.marketplace_negotiations to authenticated;
create policy marketplace_negotiations_read_participants on public.marketplace_negotiations
  for select to authenticated using (
    renter_id = auth.uid() or owner_id = auth.uid()
    or public.has_admin_permission('listings.moderate')
  );
create policy marketplace_negotiations_active_session on public.marketplace_negotiations
  as restrictive for all to authenticated using (public.has_active_session())
  with check (public.has_active_session());

create table public.negotiation_proposals (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.marketplace_negotiations(id) on delete restrict,
  revision integer not null check (revision >= 1),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  proposed_to uuid not null references public.profiles(id) on delete restrict,
  daily_rate numeric(10,2) not null check (daily_rate > 0),
  start_date date not null,
  end_date date not null,
  message text,
  status text not null default 'pending' check (
    status in ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled')
  ),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (negotiation_id, revision),
  check (end_date > start_date)
);
create index negotiation_proposals_thread_idx on public.negotiation_proposals(negotiation_id, revision);
create trigger negotiation_proposals_reject_unsafe_text before insert or update on public.negotiation_proposals
  for each row execute function public.reject_unsafe_text('1000', 'message');
alter table public.negotiation_proposals enable row level security;
revoke insert, update, delete on public.negotiation_proposals from public, anon, authenticated;
grant select on public.negotiation_proposals to authenticated;
create policy negotiation_proposals_read_participants on public.negotiation_proposals
  for select to authenticated using (
    exists (
      select 1 from public.marketplace_negotiations n
      where n.id = negotiation_id and (n.renter_id = auth.uid() or n.owner_id = auth.uid())
    )
    or public.has_admin_permission('listings.moderate')
  );
create policy negotiation_proposals_active_session on public.negotiation_proposals
  as restrictive for all to authenticated using (public.has_active_session())
  with check (public.has_active_session());

create table public.marketplace_events (
  id uuid primary key default gen_random_uuid(),
  item_request_id uuid references public.item_requests(id) on delete restrict,
  negotiation_id uuid references public.marketplace_negotiations(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (item_request_id is not null or negotiation_id is not null)
);
create index marketplace_events_request_idx on public.marketplace_events(item_request_id, created_at);
create index marketplace_events_negotiation_idx on public.marketplace_events(negotiation_id, created_at);
alter table public.marketplace_events enable row level security;
revoke insert, update, delete on public.marketplace_events from public, anon, authenticated;
grant select on public.marketplace_events to authenticated;
create policy marketplace_events_read_participants on public.marketplace_events
  for select to authenticated using (
    public.has_admin_permission('listings.moderate')
    or (item_request_id is not null and exists (
      select 1 from public.item_requests r
      where r.id = item_request_id and (r.renter_id = auth.uid() or (
        r.visibility = 'public' and r.status in ('open', 'responses_received', 'negotiating') and r.expires_at > now()
      ))
    ))
    or (negotiation_id is not null and exists (
      select 1 from public.marketplace_negotiations n
      where n.id = negotiation_id and (n.renter_id = auth.uid() or n.owner_id = auth.uid())
    ))
  );
create policy marketplace_events_active_session on public.marketplace_events as restrictive for all to authenticated
  using (public.has_active_session()) with check (public.has_active_session());

create function public.forbid_marketplace_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Marketplace event history is append-only' using errcode = '42501';
end;
$$;
revoke all on function public.forbid_marketplace_event_mutation() from public, anon, authenticated;
create trigger marketplace_events_append_only before update or delete on public.marketplace_events
  for each row execute function public.forbid_marketplace_event_mutation();

create table public.marketplace_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_request_id uuid references public.item_requests(id) on delete restrict,
  negotiation_id uuid references public.marketplace_negotiations(id) on delete restrict,
  event_type text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (item_request_id is not null or negotiation_id is not null)
);
create index marketplace_notifications_user_idx on public.marketplace_notifications(user_id, created_at desc);
alter table public.marketplace_notifications enable row level security;
revoke insert, delete, update on public.marketplace_notifications from public, anon, authenticated;
grant select on public.marketplace_notifications to authenticated;
grant update (read_at) on public.marketplace_notifications to authenticated;
create policy marketplace_notifications_read_own on public.marketplace_notifications
  for select to authenticated using (user_id = auth.uid());
create policy marketplace_notifications_mark_read on public.marketplace_notifications
  for update to authenticated using (user_id = auth.uid()) with check (
    user_id = auth.uid() and read_at is not null
  );
create policy marketplace_notifications_active_session on public.marketplace_notifications
  as restrictive for all to authenticated using (public.has_active_session())
  with check (public.has_active_session());

create or replace function public.marketplace_require_user()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_active_session() then
    raise exception 'An active signed-in session is required' using errcode = '42501';
  end if;
  if public.is_current_user_restricted() then
    raise exception 'This account is restricted from marketplace activity' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.marketplace_require_user() from public, anon, authenticated;

create or replace function public.marketplace_setting_int(p_key text, p_default integer)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = p_key), p_default);
$$;
revoke all on function public.marketplace_setting_int(text, integer) from public, anon, authenticated;

create or replace function public.marketplace_record(
  p_item_request_id uuid, p_negotiation_id uuid, p_event_type text, p_detail jsonb,
  p_notification_title text, p_notification_body text, p_recipient_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_renter uuid;
  v_owner uuid;
  v_recipient uuid;
begin
  insert into public.marketplace_events(item_request_id, negotiation_id, actor_id, event_type, detail)
    values (p_item_request_id, p_negotiation_id, auth.uid(), p_event_type, coalesce(p_detail, '{}'));
  if p_recipient_id is not null then
    insert into public.marketplace_notifications(user_id, item_request_id, negotiation_id, event_type, title, body)
      values (p_recipient_id, p_item_request_id, p_negotiation_id, p_event_type, p_notification_title, p_notification_body);
  elsif p_negotiation_id is not null then
    select renter_id, owner_id into v_renter, v_owner
      from public.marketplace_negotiations where id = p_negotiation_id;
    foreach v_recipient in array array[v_renter, v_owner] loop
      if v_recipient is not null and v_recipient <> auth.uid() then
        insert into public.marketplace_notifications(user_id, item_request_id, negotiation_id, event_type, title, body)
          values (v_recipient, p_item_request_id, p_negotiation_id, p_event_type, p_notification_title, p_notification_body);
      end if;
    end loop;
  elsif p_item_request_id is not null then
    insert into public.marketplace_notifications(user_id, item_request_id, event_type, title, body)
    select distinct recipient, p_item_request_id, p_event_type, p_notification_title, p_notification_body
    from (
      select n.owner_id as recipient from public.marketplace_negotiations n
        where n.item_request_id = p_item_request_id
      union select r.renter_id from public.item_requests r where r.id = p_item_request_id
    ) participants where recipient <> auth.uid();
  end if;
end;
$$;
revoke all on function public.marketplace_record(uuid, uuid, text, jsonb, text, text, uuid) from public, anon, authenticated;

create or replace function public.create_item_request(
  p_id uuid, p_idempotency_key uuid, p_category_id uuid, p_title text, p_description text,
  p_intended_use text, p_start_date date, p_end_date date, p_location_label text,
  p_max_daily_budget numeric, p_quantity integer, p_specifications text,
  p_additional_notes text, p_visibility text, p_reference_image_paths text[]
) returns public.item_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.item_requests;
  v_expiration_days integer;
  v_enabled boolean;
  v_path text;
begin
  perform public.marketplace_require_user();
  select enabled into v_enabled from public.feature_flags where key = 'item_requests';
  if coalesce(v_enabled, false) is not true then raise exception 'Item requests are not currently enabled' using errcode = '55000'; end if;
  if p_id is null or p_idempotency_key is null then raise exception 'Request identifiers are required' using errcode = '22023'; end if;
  if p_start_date < current_date or p_end_date <= p_start_date then raise exception 'Choose a valid future date range' using errcode = '22023'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then raise exception 'Quantity must be between 1 and 100' using errcode = '22023'; end if;
  if p_max_daily_budget is not null and (p_max_daily_budget <= 0 or p_max_daily_budget > coalesce(
    (select (value #>> '{}')::numeric from public.app_settings where key = 'item_request_max_daily_budget'), 100000
  )) then raise exception 'Maximum daily budget is outside the allowed range' using errcode = '22023'; end if;
  if coalesce(p_visibility, 'public') not in ('public', 'private') then raise exception 'Invalid request visibility' using errcode = '22023'; end if;
  if cardinality(coalesce(p_reference_image_paths, '{}')) > 4 then raise exception 'At most four reference images are allowed' using errcode = '22023'; end if;
  foreach v_path in array coalesce(p_reference_image_paths, '{}') loop
    if v_path !~ ('^' || auth.uid()::text || '/' || p_id::text || '/[1-4]\.(jpg|jpeg|png|webp)$')
      or not exists (select 1 from storage.objects where bucket_id = 'item-request-images' and name = v_path) then
      raise exception 'A reference image is invalid or has not finished uploading' using errcode = '22023';
    end if;
  end loop;
  select * into v_request from public.item_requests
    where renter_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then return v_request; end if;
  select coalesce((select active from public.categories where id = p_category_id), false) into v_enabled;
  if not v_enabled then raise exception 'Select an active category' using errcode = '22023'; end if;
  v_expiration_days := public.marketplace_setting_int('item_request_expiration_days', 30);
  insert into public.item_requests(
    id, renter_id, idempotency_key, category_id, title, description, intended_use,
    preferred_start_date, preferred_end_date, location_label, max_daily_budget,
    requested_quantity, specifications, additional_notes, visibility, reference_image_paths, expires_at
  ) values (
    p_id, auth.uid(), p_idempotency_key, p_category_id, p_title, p_description, p_intended_use,
    p_start_date, p_end_date, p_location_label, p_max_daily_budget,
    coalesce(p_quantity, 1), p_specifications, p_additional_notes, coalesce(p_visibility, 'public'),
    coalesce(p_reference_image_paths, '{}'), now() + make_interval(days => v_expiration_days)
  ) returning * into v_request;
  perform public.marketplace_record(v_request.id, null, 'request_created',
    jsonb_build_object('status', v_request.status), 'Item request posted', 'Your request is now visible to eligible owners.');
  return v_request;
end;
$$;

create or replace function public.update_item_request(
  p_request_id uuid, p_title text, p_category_id uuid, p_description text,
  p_intended_use text, p_start_date date, p_end_date date, p_location_label text,
  p_max_daily_budget numeric, p_quantity integer, p_specifications text,
  p_additional_notes text, p_visibility text
) returns public.item_requests
language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests;
begin
  perform public.marketplace_require_user();
  select * into v_request from public.item_requests where id = p_request_id for update;
  if not found or v_request.renter_id <> auth.uid() then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if v_request.status not in ('open', 'responses_received', 'negotiating') or v_request.expires_at <= now() then
    raise exception 'Only an active request can be edited' using errcode = '55000';
  end if;
  if p_start_date < current_date or p_end_date <= p_start_date then raise exception 'Choose a valid future date range' using errcode = '22023'; end if;
  if p_quantity < 1 or p_quantity > 100 then raise exception 'Quantity must be between 1 and 100' using errcode = '22023'; end if;
  if p_max_daily_budget is not null and (p_max_daily_budget <= 0 or p_max_daily_budget > coalesce(
    (select (value #>> '{}')::numeric from public.app_settings where key = 'item_request_max_daily_budget'), 100000
  )) then raise exception 'Maximum daily budget is outside the allowed range' using errcode = '22023'; end if;
  if p_visibility not in ('public', 'private') then raise exception 'Invalid request visibility' using errcode = '22023'; end if;
  if not exists (select 1 from public.categories where id = p_category_id and active) then raise exception 'Select an active category' using errcode = '22023'; end if;
  update public.item_requests set title = p_title, category_id = p_category_id, description = p_description,
    intended_use = p_intended_use, preferred_start_date = p_start_date, preferred_end_date = p_end_date,
    location_label = p_location_label, max_daily_budget = p_max_daily_budget, requested_quantity = p_quantity,
    specifications = p_specifications, additional_notes = p_additional_notes, visibility = p_visibility
    where id = p_request_id returning * into v_request;
  perform public.marketplace_record(v_request.id, null, 'request_updated',
    jsonb_build_object('status', v_request.status), 'Item request updated', 'A request you can view has been updated.');
  return v_request;
end;
$$;

create or replace function public.close_item_request(p_request_id uuid, p_action text)
returns public.item_requests
language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests;
begin
  perform public.marketplace_require_user();
  if p_action not in ('cancel', 'close') then raise exception 'Invalid request action' using errcode = '22023'; end if;
  select * into v_request from public.item_requests where id = p_request_id for update;
  if not found or (v_request.renter_id <> auth.uid() and not public.has_admin_permission('listings.moderate')) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_request.status not in ('open', 'responses_received', 'negotiating') then raise exception 'Request is no longer active' using errcode = '55000'; end if;
  update public.item_requests set status = case when p_action = 'cancel' then 'cancelled' else 'closed' end
    where id = p_request_id returning * into v_request;
  update public.marketplace_negotiations set status = 'cancelled'
    where item_request_id = p_request_id and status in ('pending', 'countered');
  update public.negotiation_proposals set status = 'cancelled'
    where negotiation_id in (select id from public.marketplace_negotiations where item_request_id = p_request_id)
      and status = 'pending';
  perform public.marketplace_record(v_request.id, null, 'request_' || p_action,
    jsonb_build_object('status', v_request.status), 'Item request closed', 'A request you responded to has been closed.');
  return v_request;
end;
$$;

create or replace function public.admin_moderate_item_request(p_request_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests; v_reason text;
begin
  perform public.admin_require('listings.moderate');
  v_reason := public.admin_clean_reason(p_reason);
  select * into v_request from public.item_requests where id = p_request_id for update;
  if not found then raise exception 'Item request not found' using errcode = 'P0002'; end if;
  if v_request.status not in ('open', 'responses_received', 'negotiating') then
    raise exception 'Only an active item request can be moderated' using errcode = '55000';
  end if;
  update public.item_requests set status = 'closed' where id = p_request_id returning * into v_request;
  update public.marketplace_negotiations set status = 'cancelled'
    where item_request_id = p_request_id and status in ('pending', 'countered');
  update public.negotiation_proposals set status = 'cancelled'
    where negotiation_id in (select id from public.marketplace_negotiations where item_request_id = p_request_id)
      and status = 'pending';
  perform public.marketplace_record(p_request_id, null, 'request_moderated',
    jsonb_build_object('status', v_request.status),
    'Item request closed by a moderator', 'A moderator closed this item request.');
  perform public.admin_write_audit('item_request.moderate', 'item_request', p_request_id::text,
    jsonb_build_object('status', 'active'), jsonb_build_object('status', 'closed'), v_reason);
  return jsonb_build_object('ok', true, 'status', v_request.status);
end;
$$;

create or replace function public.create_marketplace_offer(
  p_item_request_id uuid, p_listing_id uuid, p_start_date date, p_end_date date,
  p_daily_rate numeric, p_message text, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.item_requests;
  v_listing public.listings;
  v_negotiation public.marketplace_negotiations;
  v_proposal public.negotiation_proposals;
  v_flag boolean;
  v_max_price numeric;
  v_expiry_hours integer;
  v_is_request boolean := p_item_request_id is not null;
begin
  perform public.marketplace_require_user();
  if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode = '22023'; end if;
  if p_start_date < current_date or p_end_date <= p_start_date then raise exception 'Choose a valid future date range' using errcode = '22023'; end if;
  if p_daily_rate is null or p_daily_rate <= 0 then raise exception 'Offer price must be greater than zero' using errcode = '22023'; end if;
  select coalesce((value #>> '{}')::numeric, 100000) into v_max_price from public.app_settings where key = 'negotiation_max_daily_price';
  if p_daily_rate > coalesce(v_max_price, 100000) then raise exception 'Offer price exceeds the platform limit' using errcode = '22023'; end if;
  if p_message is not null and char_length(p_message) > 1000 then raise exception 'Message is too long' using errcode = '22023'; end if;

  select * into v_negotiation from public.marketplace_negotiations
    where created_by = auth.uid() and idempotency_key = p_idempotency_key;
  if found then
    select * into v_proposal from public.negotiation_proposals
      where negotiation_id = v_negotiation.id order by revision desc limit 1;
    return jsonb_build_object('negotiation', to_jsonb(v_negotiation), 'proposal', to_jsonb(v_proposal));
  end if;

  if v_is_request then
    select * into v_request from public.item_requests where id = p_item_request_id for update;
    if not found or v_request.visibility <> 'public' or v_request.status not in ('open', 'responses_received', 'negotiating')
      or v_request.expires_at <= now() then raise exception 'Request is no longer accepting offers' using errcode = '55000'; end if;
    if v_request.renter_id = auth.uid() then raise exception 'You cannot respond to your own request' using errcode = '42501'; end if;
    select enabled into v_flag from public.feature_flags where key = 'item_requests';
    if coalesce(v_flag, false) is not true then raise exception 'Item requests are not currently enabled' using errcode = '55000'; end if;
    if p_start_date < v_request.preferred_start_date or p_end_date > v_request.preferred_end_date then
      raise exception 'Offer dates must fit within the requested date range' using errcode = '22023';
    end if;
    if v_request.max_daily_budget is not null and p_daily_rate > v_request.max_daily_budget then
      raise exception 'Offer price exceeds the renter budget' using errcode = '22023';
    end if;
    if exists(select 1 from public.marketplace_negotiations where item_request_id = p_item_request_id
      and owner_id = auth.uid() and status in ('pending', 'countered')) then
      raise exception 'You already have an active offer for this request' using errcode = '23505';
    end if;
    if p_listing_id is not null then
      select * into v_listing from public.listings where id = p_listing_id and owner_id = auth.uid()
        and status = 'published' for update;
      if not found or v_listing.category_id <> v_request.category_id then
        raise exception 'Choose your published listing in the requested category' using errcode = '22023';
      end if;
      if v_listing.available_quantity < v_request.requested_quantity then
        raise exception 'Listing quantity cannot fulfill the request' using errcode = '22023';
      end if;
    end if;
    v_negotiation := null;
    insert into public.marketplace_negotiations(item_request_id, listing_id, renter_id, owner_id, created_by, idempotency_key)
      values (p_item_request_id, p_listing_id, v_request.renter_id, auth.uid(), auth.uid(), p_idempotency_key)
      returning * into v_negotiation;
    update public.item_requests set status = case when status = 'open' then 'responses_received' else status end
      where id = p_item_request_id;
  else
    select * into v_listing from public.listings where id = p_listing_id and status = 'published' for update;
    if not found or not v_listing.negotiation_enabled then raise exception 'This listing is not eligible for offers' using errcode = '55000'; end if;
    if v_listing.owner_id = auth.uid() then raise exception 'You cannot negotiate on your own listing' using errcode = '42501'; end if;
    select enabled into v_flag from public.feature_flags where key = 'bidding';
    if coalesce(v_flag, false) is not true then raise exception 'Negotiation is not currently enabled' using errcode = '55000'; end if;
    if exists(select 1 from public.marketplace_negotiations where item_request_id is null and listing_id = p_listing_id
      and renter_id = auth.uid() and owner_id = v_listing.owner_id and status in ('pending', 'countered')) then
      raise exception 'You already have an active offer for this listing' using errcode = '23505';
    end if;
    v_negotiation := null;
    insert into public.marketplace_negotiations(listing_id, renter_id, owner_id, created_by, idempotency_key)
      values (p_listing_id, auth.uid(), v_listing.owner_id, auth.uid(), p_idempotency_key)
      returning * into v_negotiation;
  end if;

  if p_listing_id is not null and exists (
    select 1 from public.bookings b where b.listing_id = p_listing_id
      and b.status in ('requested', 'pending_payment', 'confirmed', 'active', 'return_pending')
      and b.start_date < p_end_date and b.end_date > p_start_date
  ) then raise exception 'Listing is not available for the proposed dates' using errcode = '23P01'; end if;
  if p_listing_id is not null and exists (
    select 1 from public.listing_availability a where a.listing_id = p_listing_id
      and a.date >= p_start_date and a.date < p_end_date and not a.is_available
  ) then raise exception 'Listing is not available for the proposed dates' using errcode = '23P01'; end if;

  v_expiry_hours := public.marketplace_setting_int('negotiation_expiration_hours', 72);
  insert into public.negotiation_proposals(
    negotiation_id, revision, proposed_by, proposed_to, daily_rate, start_date, end_date, message, expires_at
  ) values (
    v_negotiation.id, 1, auth.uid(),
    case when v_is_request then v_negotiation.renter_id else v_negotiation.owner_id end,
    p_daily_rate, p_start_date, p_end_date, p_message, now() + make_interval(hours => v_expiry_hours)
  ) returning * into v_proposal;
  perform public.marketplace_record(p_item_request_id, v_negotiation.id, 'offer_created',
    jsonb_build_object('proposal_id', v_proposal.id, 'daily_rate', v_proposal.daily_rate, 'start_date', v_proposal.start_date, 'end_date', v_proposal.end_date),
    'New rental offer', 'You have received a new rental offer.', v_proposal.proposed_to);
  return jsonb_build_object('negotiation', to_jsonb(v_negotiation), 'proposal', to_jsonb(v_proposal));
end;
$$;

create or replace function public.link_request_offer_listing(p_negotiation_id uuid, p_listing_id uuid)
returns public.marketplace_negotiations
language plpgsql security definer set search_path = '' as $$
declare v_negotiation public.marketplace_negotiations; v_listing public.listings; v_request public.item_requests;
begin
  perform public.marketplace_require_user();
  select * into v_negotiation from public.marketplace_negotiations where id = p_negotiation_id for update;
  if not found or v_negotiation.item_request_id is null or v_negotiation.owner_id <> auth.uid()
    or v_negotiation.status not in ('pending', 'countered') then raise exception 'Offer is not available to link a listing' using errcode = '42501'; end if;
  select * into v_listing from public.listings where id = p_listing_id and owner_id = auth.uid()
    and status = 'published' for update;
  if not found then raise exception 'A published listing you own is required' using errcode = '22023'; end if;
  select * into v_request from public.item_requests where id = v_negotiation.item_request_id;
  if v_listing.category_id <> v_request.category_id then raise exception 'Listing category does not match the request' using errcode = '22023'; end if;
  if v_listing.available_quantity < v_request.requested_quantity then
    raise exception 'Listing quantity cannot fulfill the request' using errcode = '22023';
  end if;
  update public.marketplace_negotiations set listing_id = p_listing_id where id = p_negotiation_id returning * into v_negotiation;
  perform public.marketplace_record(v_negotiation.item_request_id, v_negotiation.id, 'listing_linked',
    jsonb_build_object('listing_id', p_listing_id), 'Offer listing updated', 'The owner linked a published listing to their offer.', v_negotiation.renter_id);
  return v_negotiation;
end;
$$;

create or replace function public.respond_to_marketplace_offer(
  p_negotiation_id uuid, p_action text, p_daily_rate numeric default null,
  p_start_date date default null, p_end_date date default null, p_message text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_negotiation public.marketplace_negotiations;
  v_proposal public.negotiation_proposals;
  v_new_proposal public.negotiation_proposals;
  v_listing public.listings;
  v_request public.item_requests;
  v_booking public.bookings;
  v_actor_other uuid;
  v_round_limit integer;
  v_expiry_hours integer;
  v_fee_pct numeric(5,4);
  v_days integer;
  v_quantity integer := 1;
  v_subtotal numeric(10,2);
  v_fee numeric(10,2);
  v_max_price numeric;
  v_flag boolean;
begin
  perform public.marketplace_require_user();
  if p_action not in ('accept', 'decline', 'counter', 'withdraw') then raise exception 'Invalid offer action' using errcode = '22023'; end if;
  select * into v_negotiation from public.marketplace_negotiations where id = p_negotiation_id for update;
  if not found or (v_negotiation.renter_id <> auth.uid() and v_negotiation.owner_id <> auth.uid()) then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  if v_negotiation.status = 'accepted' and v_negotiation.booking_id is not null and p_action = 'accept' then
    select * into v_booking from public.bookings where id = v_negotiation.booking_id;
    return jsonb_build_object('negotiation', to_jsonb(v_negotiation), 'booking', to_jsonb(v_booking), 'idempotent', true);
  end if;
  if v_negotiation.status not in ('pending', 'countered') then raise exception 'Offer is no longer active' using errcode = '55000'; end if;
  select * into v_proposal from public.negotiation_proposals
    where negotiation_id = p_negotiation_id order by revision desc limit 1 for update;
  if not found or v_proposal.status <> 'pending' then raise exception 'No active proposal is awaiting a response' using errcode = '55000'; end if;
  if v_proposal.expires_at <= now() then
    update public.negotiation_proposals set status = 'expired' where id = v_proposal.id;
    update public.marketplace_negotiations set status = 'expired' where id = p_negotiation_id returning * into v_negotiation;
    perform public.marketplace_record(v_negotiation.item_request_id, v_negotiation.id, 'offer_expired',
      jsonb_build_object('proposal_id', v_proposal.id), 'Rental offer expired', 'An offer in this conversation has expired.');
    return jsonb_build_object('negotiation', to_jsonb(v_negotiation), 'expired', true);
  end if;
  if p_action = 'withdraw' then
    if v_proposal.proposed_by <> auth.uid() then raise exception 'Only the offer author can withdraw it' using errcode = '42501'; end if;
    update public.negotiation_proposals set status = 'withdrawn' where id = v_proposal.id returning * into v_proposal;
    update public.marketplace_negotiations set status = 'withdrawn' where id = p_negotiation_id returning * into v_negotiation;
    perform public.marketplace_record(v_negotiation.item_request_id, v_negotiation.id, 'offer_withdrawn',
      jsonb_build_object('proposal_id', v_proposal.id), 'Rental offer withdrawn', 'An offer you received has been withdrawn.');
    return jsonb_build_object('negotiation', to_jsonb(v_negotiation), 'proposal', to_jsonb(v_proposal));
  end if;
  if v_proposal.proposed_to <> auth.uid() then raise exception 'Only the intended recipient can respond to this offer' using errcode = '42501'; end if;

  if p_action = 'decline' then
    update public.negotiation_proposals set status = 'declined' where id = v_proposal.id returning * into v_proposal;
    update public.marketplace_negotiations set status = 'declined' where id = p_negotiation_id returning * into v_negotiation;
    perform public.marketplace_record(v_negotiation.item_request_id, v_negotiation.id, 'offer_declined',
      jsonb_build_object('proposal_id', v_proposal.id), 'Rental offer declined', 'An offer was declined.');
    return jsonb_build_object('negotiation', to_jsonb(v_negotiation), 'proposal', to_jsonb(v_proposal));
  end if;

  if p_action = 'counter' then
    select enabled into v_flag from public.feature_flags where key = 'bidding';
    if coalesce(v_flag, false) is not true then raise exception 'Counteroffers are not currently enabled' using errcode = '55000'; end if;
    v_round_limit := public.marketplace_setting_int('negotiation_max_rounds', 10);
    if v_proposal.revision > v_round_limit then raise exception 'The maximum number of counteroffer rounds has been reached' using errcode = '55000'; end if;
    if p_daily_rate is null or p_daily_rate <= 0 or p_start_date is null or p_end_date is null
      or p_start_date < current_date or p_end_date <= p_start_date then
      raise exception 'Provide a valid daily price and future date range' using errcode = '22023';
    end if;
    select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'negotiation_max_daily_price'), 100000)
      into v_max_price;
    if p_daily_rate > coalesce(v_max_price, 100000) then raise exception 'Counteroffer price exceeds the platform limit' using errcode = '22023'; end if;
    if p_message is not null and char_length(p_message) > 1000 then raise exception 'Message is too long' using errcode = '22023'; end if;
    if v_negotiation.item_request_id is not null then
      select * into v_request from public.item_requests where id = v_negotiation.item_request_id for update;
      if not found or v_request.status not in ('open', 'responses_received', 'negotiating') or v_request.expires_at <= now() then
        raise exception 'Request is no longer active' using errcode = '55000';
      end if;
      if v_proposal.start_date < v_request.preferred_start_date
        or v_proposal.end_date > v_request.preferred_end_date
        or (v_request.max_daily_budget is not null and v_proposal.daily_rate > v_request.max_daily_budget) then
        raise exception 'Offer no longer fits the request dates and budget' using errcode = '22023';
      end if;
      if p_start_date < v_request.preferred_start_date or p_end_date > v_request.preferred_end_date
        or (v_request.max_daily_budget is not null and p_daily_rate > v_request.max_daily_budget) then
        raise exception 'Counteroffer must fit the request dates and budget' using errcode = '22023';
      end if;
      if auth.uid() = v_negotiation.renter_id and v_request.renter_id <> auth.uid() then
        raise exception 'Only the requesting renter can counter this request offer' using errcode = '42501';
      end if;
      update public.item_requests set status = 'negotiating' where id = v_request.id and status <> 'matched';
    end if;
    if v_negotiation.listing_id is not null then
      select * into v_listing from public.listings where id = v_negotiation.listing_id
        and status = 'published' for update;
      if not found then raise exception 'Linked listing is no longer available' using errcode = '55000'; end if;
      if exists(select 1 from public.bookings b where b.listing_id = v_listing.id
        and b.status in ('requested', 'pending_payment', 'confirmed', 'active', 'return_pending')
        and b.start_date < p_end_date and b.end_date > p_start_date) then
        raise exception 'Listing is not available for the counteroffer dates' using errcode = '23P01';
      end if;
      if exists(select 1 from public.listing_availability a where a.listing_id = v_listing.id
        and a.date >= p_start_date and a.date < p_end_date and not a.is_available) then
        raise exception 'Listing is not available for the counteroffer dates' using errcode = '23P01';
      end if;
    end if;
    update public.negotiation_proposals set status = 'countered' where id = v_proposal.id;
    v_expiry_hours := public.marketplace_setting_int('negotiation_expiration_hours', 72);
    v_actor_other := case when auth.uid() = v_negotiation.renter_id then v_negotiation.owner_id else v_negotiation.renter_id end;
    insert into public.negotiation_proposals(
      negotiation_id, revision, proposed_by, proposed_to, daily_rate, start_date, end_date, message, expires_at
    ) values (
      v_negotiation.id, v_proposal.revision + 1, auth.uid(), v_actor_other, p_daily_rate,
      p_start_date, p_end_date, p_message, now() + make_interval(hours => v_expiry_hours)
    ) returning * into v_new_proposal;
    update public.marketplace_negotiations set status = 'countered' where id = v_negotiation.id returning * into v_negotiation;
    perform public.marketplace_record(v_negotiation.item_request_id, v_negotiation.id, 'offer_countered',
      jsonb_build_object('proposal_id', v_new_proposal.id, 'daily_rate', v_new_proposal.daily_rate,
        'start_date', v_new_proposal.start_date, 'end_date', v_new_proposal.end_date),
      'New counteroffer', 'You have received a counteroffer.', v_actor_other);
    return jsonb_build_object('negotiation', to_jsonb(v_negotiation), 'proposal', to_jsonb(v_new_proposal));
  end if;

  if v_negotiation.item_request_id is not null then
    select * into v_request from public.item_requests where id = v_negotiation.item_request_id for update;
    if not found or v_request.status not in ('open', 'responses_received', 'negotiating') or v_request.expires_at <= now() then
      raise exception 'Request is no longer active' using errcode = '55000';
    end if;
    v_quantity := v_request.requested_quantity;
  end if;
  if v_negotiation.listing_id is null then raise exception 'The owner must link a published listing before acceptance' using errcode = '55000'; end if;
  select * into v_listing from public.listings where id = v_negotiation.listing_id
    and owner_id = v_negotiation.owner_id and status = 'published' for update;
  if not found then raise exception 'Linked listing is no longer available' using errcode = '55000'; end if;
  if v_negotiation.item_request_id is null and not v_listing.negotiation_enabled then
    raise exception 'Listing is no longer eligible for negotiation' using errcode = '55000';
  end if;
  if v_quantity > v_listing.available_quantity then raise exception 'Listing quantity cannot fulfill the request' using errcode = '22023'; end if;
  if v_proposal.start_date < current_date or v_proposal.end_date <= v_proposal.start_date then
    raise exception 'Offer dates are no longer valid' using errcode = '22023';
  end if;
  if exists(
    select 1
    from generate_series(v_proposal.start_date, v_proposal.end_date - 1, interval '1 day') day
    where (select coalesce(sum(b.quantity), 0) from public.bookings b
      where b.listing_id = v_listing.id and b.status in ('requested', 'pending_payment', 'confirmed', 'active', 'return_pending')
        and b.start_date <= day::date and b.end_date > day::date) + v_quantity > v_listing.available_quantity
  ) then
    raise exception 'Listing is no longer available for the offer dates' using errcode = '23P01';
  end if;
  if exists(select 1 from public.listing_availability a where a.listing_id = v_listing.id
    and a.date >= v_proposal.start_date and a.date < v_proposal.end_date and not a.is_available) then
    raise exception 'Listing is no longer available for the offer dates' using errcode = '23P01';
  end if;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'platform_fee_pct'), 0.10)
    into v_fee_pct;
  v_days := v_proposal.end_date - v_proposal.start_date;
  v_subtotal := round(v_proposal.daily_rate * v_days * v_quantity, 2);
  v_fee := round(v_subtotal * v_fee_pct, 2);
  insert into public.bookings(
    listing_id, renter_id, owner_id, start_date, end_date, quantity, status, daily_rate, days,
    subtotal, service_fee_pct, service_fee_amount, deposit, total
  ) values (
    v_listing.id, v_negotiation.renter_id, v_negotiation.owner_id, v_proposal.start_date, v_proposal.end_date,
    v_quantity, 'pending_payment', v_proposal.daily_rate, v_days, v_subtotal, v_fee_pct, v_fee,
    v_listing.deposit, v_subtotal + v_fee + v_listing.deposit
  ) returning * into v_booking;
  update public.negotiation_proposals set status = 'accepted' where id = v_proposal.id;
  update public.marketplace_negotiations set status = 'accepted', booking_id = v_booking.id
    where id = v_negotiation.id returning * into v_negotiation;
  if v_negotiation.item_request_id is not null then
    update public.item_requests set status = 'matched' where id = v_negotiation.item_request_id;
    update public.marketplace_negotiations set status = 'cancelled'
      where item_request_id = v_negotiation.item_request_id and id <> v_negotiation.id and status in ('pending', 'countered');
    update public.negotiation_proposals set status = 'cancelled'
      where negotiation_id in (select id from public.marketplace_negotiations
        where item_request_id = v_negotiation.item_request_id and id <> v_negotiation.id)
        and status = 'pending';
  end if;
  perform public.marketplace_record(v_negotiation.item_request_id, v_negotiation.id, 'offer_accepted',
    jsonb_build_object('proposal_id', v_proposal.id, 'booking_id', v_booking.id, 'status', v_booking.status),
    'Offer accepted', 'Your offer was accepted and a booking is awaiting payment.');
  return jsonb_build_object('negotiation', to_jsonb(v_negotiation), 'booking', to_jsonb(v_booking));
end;
$$;

create or replace function public.expire_marketplace_activity()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; v_row record;
begin
  perform public.marketplace_require_user();
  for v_row in
    select id, renter_id from public.item_requests
      where status in ('open', 'responses_received', 'negotiating')
        and (expires_at <= now() or preferred_end_date <= current_date)
      order by expires_at limit 250 for update skip locked
  loop
    update public.item_requests set status = 'expired' where id = v_row.id;
    update public.marketplace_negotiations set status = 'expired'
      where item_request_id = v_row.id and status in ('pending', 'countered');
    update public.negotiation_proposals set status = 'expired'
      where negotiation_id in (select id from public.marketplace_negotiations where item_request_id = v_row.id)
        and status = 'pending';
    insert into public.marketplace_events(item_request_id, actor_id, event_type, detail)
      values (v_row.id, null, 'request_expired', '{"status":"expired"}');
    insert into public.marketplace_notifications(user_id, item_request_id, event_type, title, body)
      select distinct recipient, v_row.id, 'request_expired', 'Item request expired', 'An item request you participated in has expired.'
      from (
        select v_row.renter_id as recipient
        union select owner_id from public.marketplace_negotiations where item_request_id = v_row.id
      ) participants
      where recipient <> auth.uid();
    v_count := v_count + 1;
  end loop;
  for v_row in
    select p.id, p.negotiation_id, n.renter_id, n.owner_id, n.item_request_id
      from public.negotiation_proposals p join public.marketplace_negotiations n on n.id = p.negotiation_id
      where p.status = 'pending' and p.expires_at <= now() and n.status in ('pending', 'countered')
      order by p.expires_at limit 500 for update of p, n skip locked
  loop
    update public.negotiation_proposals set status = 'expired' where id = v_row.id;
    update public.marketplace_negotiations set status = 'expired' where id = v_row.negotiation_id;
    insert into public.marketplace_events(item_request_id, negotiation_id, actor_id, event_type, detail)
      values (v_row.item_request_id, v_row.negotiation_id, null, 'offer_expired', jsonb_build_object('proposal_id', v_row.id));
    insert into public.marketplace_notifications(user_id, item_request_id, negotiation_id, event_type, title, body)
      select recipient, v_row.item_request_id, v_row.negotiation_id, 'offer_expired', 'Rental offer expired',
        'An offer in this conversation has expired.'
      from unnest(array[v_row.renter_id, v_row.owner_id]) recipient;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('expired', v_count);
end;
$$;

create or replace function public.mark_marketplace_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.marketplace_require_user();
  update public.marketplace_notifications set read_at = coalesce(read_at, now())
    where id = p_notification_id and user_id = auth.uid();
  if not found then raise exception 'Notification not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.get_item_request_response_counts(p_request_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.marketplace_require_user();
  if cardinality(coalesce(p_request_ids, '{}')) > 100 then raise exception 'Too many request ids' using errcode = '22023'; end if;
  select coalesce(jsonb_object_agg(r.id::text, coalesce(c.response_count, 0)), '{}'::jsonb)
    into v_result
    from public.item_requests r
    left join (
      select item_request_id, count(*)::integer as response_count
      from public.marketplace_negotiations
      where item_request_id = any(coalesce(p_request_ids, '{}'))
        and status in ('pending', 'countered', 'accepted')
      group by item_request_id
    ) c on c.item_request_id = r.id
    where r.id = any(coalesce(p_request_ids, '{}'))
      and (r.renter_id = auth.uid() or (r.visibility = 'public'
        and r.status in ('open', 'responses_received', 'negotiating') and r.expires_at > now()));
  return v_result;
end;
$$;

-- The same capacity and row-lock rules apply to fixed-price booking requests.
create or replace function public.create_booking_request(
  p_listing_id uuid, p_start_date date, p_end_date date, p_quantity int default 1
) returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  v_listing public.listings;
  v_days int;
  v_service_fee_pct numeric(5,4);
  v_subtotal numeric(10,2);
  v_service_fee numeric(10,2);
  v_total numeric(10,2);
  v_booking public.bookings;
begin
  if auth.uid() is null or not public.has_active_session() then raise exception 'An active signed-in session is required' using errcode = '42501'; end if;
  if public.is_current_user_restricted() then raise exception 'This account is restricted from booking' using errcode = '42501'; end if;
  if p_quantity < 1 or p_end_date <= p_start_date or p_start_date < current_date then
    raise exception 'Choose a valid future date range and quantity' using errcode = '22023';
  end if;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'platform_fee_pct'), 0.10)
    into v_service_fee_pct;
  select * into v_listing from public.listings where id = p_listing_id and status = 'published' for update;
  if not found then raise exception 'Listing not found or not published'; end if;
  if v_listing.owner_id = auth.uid() then raise exception 'Cannot book your own listing'; end if;
  if p_quantity > v_listing.available_quantity then raise exception 'Requested quantity exceeds listing quantity'; end if;
  if exists (
    select 1
    from generate_series(p_start_date, p_end_date - 1, interval '1 day') day
    where (select coalesce(sum(b.quantity), 0) from public.bookings b
      where b.listing_id = p_listing_id and b.status in ('requested', 'pending_payment', 'confirmed', 'active', 'return_pending')
        and b.start_date <= day::date and b.end_date > day::date) + p_quantity > v_listing.available_quantity
  ) then raise exception 'Listing is not available for the selected dates' using errcode = '23P01'; end if;
  if exists (
    select 1 from public.listing_availability a where a.listing_id = p_listing_id
      and a.date >= p_start_date and a.date < p_end_date and not a.is_available
  ) then raise exception 'Listing is not available for the selected dates' using errcode = '23P01'; end if;
  v_days := p_end_date - p_start_date;
  v_subtotal := v_listing.price_per_day * v_days * p_quantity;
  v_service_fee := round(v_subtotal * v_service_fee_pct, 2);
  v_total := v_subtotal + v_service_fee + v_listing.deposit;
  insert into public.bookings (
    listing_id, renter_id, owner_id, start_date, end_date, quantity, status, daily_rate,
    days, subtotal, service_fee_pct, service_fee_amount, deposit, total
  ) values (
    p_listing_id, auth.uid(), v_listing.owner_id, p_start_date, p_end_date, p_quantity,
    'requested', v_listing.price_per_day, v_days, v_subtotal, v_service_fee_pct, v_service_fee,
    v_listing.deposit, v_total
  ) returning * into v_booking;
  return v_booking;
end;
$$;

revoke execute on function public.create_item_request(uuid, uuid, uuid, text, text, text, date, date, text, numeric, integer, text, text, text, text[]) from public, anon;
revoke execute on function public.update_item_request(uuid, text, uuid, text, text, date, date, text, numeric, integer, text, text, text) from public, anon;
revoke execute on function public.close_item_request(uuid, text) from public, anon;
revoke execute on function public.admin_moderate_item_request(uuid, text) from public, anon;
revoke execute on function public.create_marketplace_offer(uuid, uuid, date, date, numeric, text, uuid) from public, anon;
revoke execute on function public.link_request_offer_listing(uuid, uuid) from public, anon;
revoke execute on function public.respond_to_marketplace_offer(uuid, text, numeric, date, date, text) from public, anon;
revoke execute on function public.expire_marketplace_activity() from public, anon;
revoke execute on function public.mark_marketplace_notification_read(uuid) from public, anon;
revoke execute on function public.get_item_request_response_counts(uuid[]) from public, anon;
revoke execute on function public.create_booking_request(uuid, date, date, integer) from public, anon;
grant execute on function public.create_item_request(uuid, uuid, uuid, text, text, text, date, date, text, numeric, integer, text, text, text, text[]) to authenticated;
grant execute on function public.update_item_request(uuid, text, uuid, text, text, date, date, text, numeric, integer, text, text, text) to authenticated;
grant execute on function public.close_item_request(uuid, text) to authenticated;
grant execute on function public.admin_moderate_item_request(uuid, text) to authenticated;
grant execute on function public.create_marketplace_offer(uuid, uuid, date, date, numeric, text, uuid) to authenticated;
grant execute on function public.link_request_offer_listing(uuid, uuid) to authenticated;
grant execute on function public.respond_to_marketplace_offer(uuid, text, numeric, date, date, text) to authenticated;
grant execute on function public.expire_marketplace_activity() to authenticated;
grant execute on function public.mark_marketplace_notification_read(uuid) to authenticated;
grant execute on function public.get_item_request_response_counts(uuid[]) to authenticated;
grant execute on function public.create_booking_request(uuid, date, date, integer) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('item-request-images', 'item-request-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function public.can_access_item_request_image(p_name text, p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid; v_request_id uuid; v_request public.item_requests;
begin
  if not public.has_active_session()
    or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-4]\.(jpg|jpeg|png|webp)$'
    then return false; end if;
  v_owner := split_part(p_name, '/', 1)::uuid;
  v_request_id := split_part(p_name, '/', 2)::uuid;
  if p_write and v_owner <> auth.uid() then return false; end if;
  select * into v_request from public.item_requests where id = v_request_id;
  if not found then return p_write and v_owner = auth.uid(); end if;
  if p_write then
    return v_request.renter_id = auth.uid() and v_request.status in ('open', 'responses_received', 'negotiating');
  end if;
  return v_request.renter_id = auth.uid()
    or (v_request.visibility = 'public' and v_request.status in ('open', 'responses_received', 'negotiating')
      and v_request.preferred_end_date > current_date and v_request.expires_at > now()
      and exists (select 1 from public.feature_flags where key = 'item_requests' and enabled));
end;
$$;
revoke all on function public.can_access_item_request_image(text, boolean) from public, anon;
grant execute on function public.can_access_item_request_image(text, boolean) to authenticated;
create policy item_request_images_active_session on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'item-request-images' or public.has_active_session())
  with check (bucket_id <> 'item-request-images' or public.has_active_session());
create policy item_request_images_read on storage.objects for select to authenticated
  using (bucket_id = 'item-request-images' and public.can_access_item_request_image(name));
create policy item_request_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-request-images' and public.can_access_item_request_image(name, true));
create policy item_request_images_update on storage.objects for update to authenticated
  using (bucket_id = 'item-request-images' and public.can_access_item_request_image(name, true))
  with check (bucket_id = 'item-request-images' and public.can_access_item_request_image(name, true));
