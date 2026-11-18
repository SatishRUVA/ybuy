-- Admin / Super Admin foundation: server-side roles, permissions, append-only audit log,
-- DB-backed settings + feature flags, and permission-checked RPCs for every admin read/write.
-- Clients never read or write admin data through table policies: every admin table has RLS enabled
-- and (apart from public settings/flags) zero policies, so the SECURITY DEFINER RPCs below are the
-- only access path and each one checks public.has_admin_permission() first.

-- ─── permission catalog ──────────────────────────────────────────────────────
create or replace function public.admin_grantable_permissions()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'analytics.view', 'users.manage', 'listings.moderate', 'bookings.view', 'payments.view',
    'payouts.view', 'reviews.moderate', 'categories.manage', 'audit.view', 'integrations.view'
  ];
$$;

-- Permissions only a super_admin holds (never grantable to the plain admin role).
create or replace function public.admin_all_permissions()
returns text[] language sql immutable set search_path = '' as $$
  select public.admin_grantable_permissions() || array['config.manage', 'flags.manage', 'admins.manage'];
$$;

-- ─── admin_users ─────────────────────────────────────────────────────────────
create table public.admin_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin')),
  permissions text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_permissions_valid check (
    permissions <@ public.admin_grantable_permissions()
  )
);
create trigger admin_users_set_updated_at
  before update on public.admin_users
  for each row execute function public.set_updated_at();
alter table public.admin_users enable row level security;

-- ─── audit log (append-only) ─────────────────────────────────────────────────
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  outcome text not null check (outcome in ('success', 'failed')),
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_at_idx on public.admin_audit_log(created_at desc);
create index admin_audit_log_entity_idx on public.admin_audit_log(entity_type, entity_id);
alter table public.admin_audit_log enable row level security;

create or replace function public.forbid_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'admin_audit_log is append-only' using errcode = '42501';
end;
$$;
create trigger admin_audit_log_append_only
  before update or delete on public.admin_audit_log
  for each row execute function public.forbid_audit_mutation();

-- ─── user restrictions ───────────────────────────────────────────────────────
create table public.user_restrictions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null,
  restricted_by uuid not null,
  restricted_at timestamptz not null default now()
);
alter table public.user_restrictions enable row level security;

create or replace function public.is_current_user_restricted()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_restrictions where user_id = auth.uid()
  );
$$;
revoke all on function public.is_current_user_restricted() from public, anon;
grant execute on function public.is_current_user_restricted() to authenticated;

create policy payouts_unrestricted_users on public.payouts as restrictive for all to authenticated
  using (not (select public.is_current_user_restricted()))
  with check (not (select public.is_current_user_restricted()));

-- ─── settings + feature flags ────────────────────────────────────────────────
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  value_type text not null check (value_type in ('number', 'integer', 'boolean')),
  min_value numeric,
  max_value numeric,
  description text not null,
  is_public boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy app_settings_select_public on public.app_settings
  for select to anon, authenticated using (is_public);

-- `on conflict do nothing`: a redeploy must never overwrite an administrator-managed value.
insert into public.app_settings (key, value, value_type, min_value, max_value, description, is_public)
values ('platform_fee_pct', '0.10', 'number', 0, 0.30,
        'Platform service fee charged to renters, as a fraction of the rental subtotal. Applies to new bookings only; existing bookings keep their price snapshot.',
        true)
on conflict (key) do nothing;

create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
create policy feature_flags_select on public.feature_flags
  for select to anon, authenticated using (true);

insert into public.feature_flags (key, enabled, description) values
  ('bidding', false, 'Bidding and counteroffers on listings.'),
  ('item_requests', false, 'Renter item requests and owner matching.'),
  ('disputes', false, 'Two-sided disputes and resolution.'),
  ('insurance', false, 'Insurance / protection options at checkout.')
on conflict (key) do nothing;

-- ─── authorization helpers ───────────────────────────────────────────────────
create or replace function public.has_admin_permission(p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_active_session() and exists (
    select 1 from public.admin_users a
    where a.user_id = auth.uid()
      and a.active
      and (a.role = 'super_admin' or p_permission = any (a.permissions))
  );
$$;
revoke all on function public.has_admin_permission(text) from public, anon;
grant execute on function public.has_admin_permission(text) to authenticated;

create or replace function public.admin_require(p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_admin_permission(p_permission) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.admin_require(text) from public, anon, authenticated;

create or replace function public.get_my_admin_access()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'role', a.role,
    'permissions', case when a.role = 'super_admin' then to_jsonb(public.admin_all_permissions()) else to_jsonb(a.permissions) end
  )
  from public.admin_users a
  where a.user_id = auth.uid() and a.active and public.has_active_session();
$$;
revoke all on function public.get_my_admin_access() from public, anon;
grant execute on function public.get_my_admin_access() to authenticated;

-- ponytail: permission denials raise (rolling back the transaction) and are not audited;
-- validation failures on settings are audited with outcome 'failed'. Upgrade path: log denials from
-- an Edge Function with the service role if denial forensics become necessary.
create or replace function public.admin_write_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_old jsonb, p_new jsonb, p_reason text, p_outcome text default 'success'
) returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, old_value, new_value, reason, outcome)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), p_action, p_entity_type, p_entity_id, p_old, p_new, p_reason, p_outcome);
$$;
revoke all on function public.admin_write_audit(text, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;

create or replace function public.admin_clean_reason(p_reason text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_reason, ''));
begin
  if length(v) < 3 or length(v) > 500 then
    raise exception 'A reason of 3-500 characters is required' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function public.admin_clean_reason(text) from public, anon, authenticated;

-- ─── restricted-user and listing-suspension enforcement ─────────────────────
create or replace function public.block_restricted_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and exists (select 1 from public.user_restrictions where user_id = auth.uid()) then
    raise exception 'Your account is restricted. Contact YBuy support.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.block_restricted_user() from public, anon, authenticated;

create trigger listings_block_restricted before insert or update on public.listings
  for each row execute function public.block_restricted_user();
create trigger bookings_block_restricted before insert on public.bookings
  for each row execute function public.block_restricted_user();
create trigger messages_block_restricted before insert on public.messages
  for each row execute function public.block_restricted_user();
create trigger reviews_block_restricted before insert on public.reviews
  for each row execute function public.block_restricted_user();
create trigger payouts_block_restricted before insert or update on public.payouts
  for each row execute function public.block_restricted_user();

alter table public.listings drop constraint listings_status_check;
alter table public.listings add constraint listings_status_check
  check (status in ('draft', 'published', 'archived', 'suspended'));

-- Owners can neither suspend their own listing nor lift an admin suspension.
create or replace function public.guard_listing_suspension()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.status = 'suspended') is distinct from (new.status = 'suspended')
     and not public.has_admin_permission('listings.moderate')
     and not (
       new.status = 'suspended'
       and exists (select 1 from public.user_restrictions where user_id = new.owner_id)
       and public.has_admin_permission('users.manage')
     ) then
    raise exception 'Only an administrator can change a suspended listing' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_listing_suspension() from public, anon, authenticated;
create trigger listings_guard_suspension before update of status on public.listings
  for each row execute function public.guard_listing_suspension();

-- ─── booking fee now comes from app_settings (snapshotted per booking, as before) ───
create or replace function public.create_booking_request(
  p_listing_id uuid,
  p_start_date date,
  p_end_date date,
  p_quantity int default 1
) returns public.bookings
language plpgsql
security definer set search_path = public
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
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  if p_quantity < 1 then
    raise exception 'quantity must be at least 1';
  end if;

  if p_end_date <= p_start_date then
    raise exception 'end date must be after start date';
  end if;

  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'platform_fee_pct'), 0.10)
    into v_service_fee_pct;

  -- Row lock serializes concurrent booking attempts against the same listing.
  select * into v_listing from public.listings where id = p_listing_id and status = 'published' for update;
  if not found then
    raise exception 'listing not found or not published';
  end if;

  if v_listing.owner_id = auth.uid() then
    raise exception 'cannot book your own listing';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.listing_id = p_listing_id
      and b.status in ('requested', 'pending_payment', 'confirmed', 'active', 'return_pending')
      and b.start_date < p_end_date
      and b.end_date > p_start_date
  ) then
    raise exception 'listing is not available for the selected dates';
  end if;

  if exists (
    select 1 from public.listing_availability a
    where a.listing_id = p_listing_id
      and a.date >= p_start_date and a.date < p_end_date
      and a.is_available = false
  ) then
    raise exception 'listing is not available for the selected dates';
  end if;

  v_days := p_end_date - p_start_date;
  v_subtotal := v_listing.price_per_day * v_days * p_quantity;
  v_service_fee := round(v_subtotal * v_service_fee_pct, 2);
  v_total := v_subtotal + v_service_fee + v_listing.deposit;

  insert into public.bookings (
    listing_id, renter_id, owner_id, start_date, end_date, quantity,
    status, daily_rate, days, subtotal, service_fee_pct, service_fee_amount, deposit, total
  ) values (
    p_listing_id, auth.uid(), v_listing.owner_id, p_start_date, p_end_date, p_quantity,
    'requested', v_listing.price_per_day, v_days, v_subtotal, v_service_fee_pct, v_service_fee, v_listing.deposit, v_total
  ) returning * into v_booking;

  return v_booking;
end;
$$;
revoke execute on function public.create_booking_request(uuid, date, date, int) from public, anon;
grant execute on function public.create_booking_request(uuid, date, date, int) to authenticated;

-- ─── overview ────────────────────────────────────────────────────────────────
-- Period metrics filter on created_at in [p_from, p_to). Snapshot metrics are as-of-now.
-- GMV = rental subtotal + platform fee on bookings whose payment was verified by the Stripe webhook
-- (confirmed and later states); security deposits are reported separately and never added to GMV.
create or replace function public.admin_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform public.admin_require('analytics.view');
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'users_total', (select count(*) from public.profiles),
    'users_new', (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    'listings_published', (select count(*) from public.listings where status = 'published'),
    'listings_suspended', (select count(*) from public.listings where status = 'suspended'),
    'bookings_by_status', coalesce((
      select jsonb_object_agg(status, n) from (
        select status, count(*) n from public.bookings
        where created_at >= p_from and created_at < p_to group by status) s), '{}'::jsonb),
    'gross_rental', coalesce((select sum(subtotal) from public.bookings
      where status in ('confirmed', 'active', 'return_pending', 'completed') and created_at >= p_from and created_at < p_to), 0),
    'platform_fees', coalesce((select sum(service_fee_amount) from public.bookings
      where status in ('confirmed', 'active', 'return_pending', 'completed') and created_at >= p_from and created_at < p_to), 0),
    'refunds', coalesce((select sum(amount) from public.payments
      where status = 'refunded' and created_at >= p_from and created_at < p_to), 0),
    'deposit_liability', coalesce((select sum(deposit) from public.bookings
      where status in ('confirmed', 'active', 'return_pending')), 0),
    'payables_outstanding', coalesce((select sum(b.subtotal) from public.bookings b
      where b.status = 'completed'
        and not exists (select 1 from public.payouts p where p.booking_id = b.id and p.status = 'paid')), 0),
    'recent_actions', coalesce((
      select jsonb_agg(to_jsonb(a)) from (
        select id, actor_email, action, entity_type, entity_id, outcome, created_at
        from public.admin_audit_log order by created_at desc limit 8) a), '[]'::jsonb)
  ) into v;
  -- Open disputes / tickets / requests / bidding sessions have no tables yet: omitted, not zeroed.
  return v;
end;
$$;
revoke all on function public.admin_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_overview(timestamptz, timestamptz) to authenticated;

-- ─── users ───────────────────────────────────────────────────────────────────
create or replace function public.admin_list_users(p_search text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v jsonb;
begin
  perform public.admin_require('users.manage');
  with base as (
    select p.id, p.full_name, p.email, p.phone, p.created_at,
           r.reason as restricted_reason, r.restricted_at,
           (select count(*) from public.listings l where l.owner_id = p.id) as listing_count,
           (a.user_id is not null and a.active) as is_admin
    from public.profiles p
    left join public.user_restrictions r on r.user_id = p.id
    left join public.admin_users a on a.user_id = p.id
    where p_search is null or p_search = ''
       or strpos(lower(p.full_name), lower(p_search)) > 0 or strpos(lower(p.email), lower(p_search)) > 0
  ), page as (select * from base order by created_at desc limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc) from page), '[]'::jsonb)) into v;
  return v;
end;
$$;

-- Restricting also suspends the user's published listings so they stop receiving bookings.
create or replace function public.admin_set_user_restriction(p_user_id uuid, p_restricted boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_reason text; v_old jsonb; v_suspended int := 0;
begin
  perform public.admin_require('users.manage');
  v_reason := public.admin_clean_reason(p_reason);
  if p_user_id = auth.uid() then raise exception 'You cannot restrict yourself' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.admin_users where user_id = p_user_id and active) then
    raise exception 'Deactivate the administrator role before restricting this account' using errcode = '22023';
  end if;
  select to_jsonb(r) into v_old from public.user_restrictions r where user_id = p_user_id;
  if p_restricted then
    insert into public.user_restrictions (user_id, reason, restricted_by) values (p_user_id, v_reason, auth.uid())
    on conflict (user_id) do update set reason = excluded.reason, restricted_by = excluded.restricted_by, restricted_at = now();
    update public.listings set status = 'suspended' where owner_id = p_user_id and status = 'published';
    get diagnostics v_suspended = row_count;
  else
    delete from public.user_restrictions where user_id = p_user_id;
  end if;
  perform public.admin_write_audit(
    case when p_restricted then 'user.restrict' else 'user.reinstate' end, 'user', p_user_id::text,
    v_old, jsonb_build_object('restricted', p_restricted, 'listings_suspended', v_suspended), v_reason);
  return jsonb_build_object('ok', true, 'listings_suspended', v_suspended);
end;
$$;

-- ─── listings ────────────────────────────────────────────────────────────────
create or replace function public.admin_list_listings(p_search text default null, p_status text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v jsonb;
begin
  perform public.admin_require('listings.moderate');
  with base as (
    select l.id, l.title, l.status, l.price_per_day, l.deposit, l.created_at, l.owner_id,
           o.full_name as owner_name, o.email as owner_email, c.name as category,
           (select count(*) from public.listing_flags f where f.listing_id = l.id and not f.resolved) as open_flags
    from public.listings l
    join public.profiles o on o.id = l.owner_id
    left join public.categories c on c.id = l.category_id
    where (p_status is null or p_status = '' or l.status = p_status)
      and (p_search is null or p_search = '' or strpos(lower(l.title), lower(p_search)) > 0 or strpos(lower(o.email), lower(p_search)) > 0)
  ), page as (select * from base order by created_at desc limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc) from page), '[]'::jsonb)) into v;
  return v;
end;
$$;

-- Reinstating returns the listing to draft so the owner re-publishes deliberately.
create or replace function public.admin_set_listing_suspension(p_listing_id uuid, p_suspend boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_reason text; v_listing public.listings;
begin
  perform public.admin_require('listings.moderate');
  v_reason := public.admin_clean_reason(p_reason);
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found then raise exception 'Listing not found' using errcode = 'P0002'; end if;
  if p_suspend and v_listing.status = 'suspended' then raise exception 'Listing is already suspended' using errcode = '22023'; end if;
  if not p_suspend and v_listing.status <> 'suspended' then raise exception 'Listing is not suspended' using errcode = '22023'; end if;
  update public.listings set status = case when p_suspend then 'suspended' else 'draft' end where id = p_listing_id;
  perform public.admin_write_audit(
    case when p_suspend then 'listing.suspend' else 'listing.reinstate' end, 'listing', p_listing_id::text,
    jsonb_build_object('status', v_listing.status),
    jsonb_build_object('status', case when p_suspend then 'suspended' else 'draft' end), v_reason);
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── bookings / payments / payouts (read-only) ───────────────────────────────
create or replace function public.admin_list_bookings(p_search text default null, p_status text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v jsonb;
begin
  perform public.admin_require('bookings.view');
  with base as (
    select b.id, b.status, b.start_date, b.end_date, b.subtotal, b.service_fee_amount, b.deposit, b.total, b.created_at,
           l.title as listing_title, r.full_name as renter_name, r.email as renter_email,
           o.full_name as owner_name, o.email as owner_email,
           (select p.status from public.payments p where p.booking_id = b.id order by p.created_at desc limit 1) as payment_status
    from public.bookings b
    join public.listings l on l.id = b.listing_id
    join public.profiles r on r.id = b.renter_id
    join public.profiles o on o.id = b.owner_id
    where (p_status is null or p_status = '' or b.status = p_status)
      and (p_search is null or p_search = '' or strpos(lower(l.title), lower(p_search)) > 0
           or strpos(lower(r.email), lower(p_search)) > 0 or strpos(lower(o.email), lower(p_search)) > 0
           or b.id::text = p_search)
  ), page as (select * from base order by created_at desc limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc) from page), '[]'::jsonb)) into v;
  return v;
end;
$$;

create or replace function public.admin_list_payments(p_status text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v jsonb;
begin
  perform public.admin_require('payments.view');
  with base as (
    select p.id, p.booking_id, p.amount, p.currency, p.status, p.stripe_payment_intent_id, p.created_at,
           r.email as renter_email, l.title as listing_title
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    join public.profiles r on r.id = b.renter_id
    join public.listings l on l.id = b.listing_id
    where p_status is null or p_status = '' or p.status = p_status
  ), page as (select * from base order by created_at desc limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc) from page), '[]'::jsonb)) into v;
  return v;
end;
$$;

create or replace function public.admin_list_payouts(p_status text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v jsonb;
begin
  perform public.admin_require('payouts.view');
  with base as (
    select p.id, p.booking_id, p.amount, p.status, p.paid_at, p.notes, p.created_at,
           o.full_name as owner_name, o.email as owner_email
    from public.payouts p
    join public.profiles o on o.id = p.owner_id
    where p_status is null or p_status = '' or p.status = p_status
  ), page as (select * from base order by created_at desc limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc) from page), '[]'::jsonb)) into v;
  return v;
end;
$$;

-- ─── reviews ─────────────────────────────────────────────────────────────────
create or replace function public.admin_list_reviews(p_search text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v jsonb;
begin
  perform public.admin_require('reviews.moderate');
  with base as (
    select rv.id, rv.rating, rv.body, rv.created_at, rv.booking_id,
           a.full_name as reviewer_name, e.full_name as reviewee_name
    from public.reviews rv
    join public.profiles a on a.id = rv.reviewer_id
    join public.profiles e on e.id = rv.reviewee_id
    where p_search is null or p_search = '' or strpos(lower(coalesce(rv.body, '')), lower(p_search)) > 0
  ), page as (select * from base order by created_at desc limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc) from page), '[]'::jsonb)) into v;
  return v;
end;
$$;

-- The full row is preserved in the audit log before deletion.
create or replace function public.admin_remove_review(p_review_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_reason text; v_old jsonb;
begin
  perform public.admin_require('reviews.moderate');
  v_reason := public.admin_clean_reason(p_reason);
  select to_jsonb(r) into v_old from public.reviews r where id = p_review_id;
  if v_old is null then raise exception 'Review not found' using errcode = 'P0002'; end if;
  delete from public.reviews where id = p_review_id;
  perform public.admin_write_audit('review.remove', 'review', p_review_id::text, v_old, null, v_reason);
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── categories ──────────────────────────────────────────────────────────────
create or replace function public.admin_list_categories()
returns setof public.categories
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.admin_require('categories.manage');
  return query select * from public.categories order by sort_order, name;
end;
$$;

create or replace function public.admin_upsert_category(p_id uuid, p_name text, p_icon text, p_active boolean, p_sort_order int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_reason text; v_name text := btrim(coalesce(p_name, '')); v_old jsonb; v_row public.categories;
begin
  perform public.admin_require('categories.manage');
  v_reason := public.admin_clean_reason(p_reason);
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'Category name must be 2-60 characters' using errcode = '22023'; end if;
  if p_icon is not null and length(p_icon) > 40 then raise exception 'Icon name is too long' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.categories (name, icon, active, sort_order)
    values (v_name, nullif(btrim(p_icon), ''), coalesce(p_active, true), coalesce(p_sort_order, 0)) returning * into v_row;
  else
    select to_jsonb(c) into v_old from public.categories c where id = p_id;
    if v_old is null then raise exception 'Category not found' using errcode = 'P0002'; end if;
    update public.categories set name = v_name, icon = nullif(btrim(p_icon), ''), active = coalesce(p_active, active),
      sort_order = coalesce(p_sort_order, sort_order) where id = p_id returning * into v_row;
  end if;
  perform public.admin_write_audit(case when p_id is null then 'category.create' else 'category.update' end,
    'category', v_row.id::text, v_old, to_jsonb(v_row), v_reason);
  return jsonb_build_object('ok', true, 'id', v_row.id);
exception when unique_violation then
  raise exception 'A category with that name already exists' using errcode = '23505';
end;
$$;

-- ─── settings (super admin) ──────────────────────────────────────────────────
create or replace function public.admin_list_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.admin_require('config.manage');
  return coalesce((select jsonb_agg(to_jsonb(s) - 'updated_by' order by s.key) from public.app_settings s), '[]'::jsonb);
end;
$$;

-- Validation failures are audited (outcome 'failed') and returned, not raised, so the record persists.
create or replace function public.admin_update_setting(p_key text, p_value jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_reason text; v_s public.app_settings; v_error text; v_num numeric;
begin
  perform public.admin_require('config.manage');
  v_reason := public.admin_clean_reason(p_reason);
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    v_error := 'Value cannot be null';
  end if;
  select * into v_s from public.app_settings where key = p_key for update;
  if not found then raise exception 'Unknown setting' using errcode = 'P0002'; end if;

  if v_error is not null then
    null;
  elsif v_s.value_type = 'boolean' then
    if jsonb_typeof(p_value) <> 'boolean' then v_error := 'Value must be true or false'; end if;
  elsif jsonb_typeof(p_value) <> 'number' then
    v_error := 'Value must be a number';
  else
    v_num := (p_value #>> '{}')::numeric;
    if v_s.value_type = 'integer' and v_num <> trunc(v_num) then v_error := 'Value must be a whole number';
    elsif v_s.min_value is not null and v_num < v_s.min_value then v_error := format('Value must be at least %s', v_s.min_value);
    elsif v_s.max_value is not null and v_num > v_s.max_value then v_error := format('Value must be at most %s', v_s.max_value);
    end if;
  end if;

  if v_error is not null then
    perform public.admin_write_audit('setting.update', 'setting', p_key,
      jsonb_build_object('value', v_s.value), jsonb_build_object('value', p_value, 'error', v_error), v_reason, 'failed');
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  update public.app_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  perform public.admin_write_audit('setting.update', 'setting', p_key,
    jsonb_build_object('value', v_s.value), jsonb_build_object('value', p_value), v_reason);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_set_feature_flag(p_key text, p_enabled boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_reason text; v_old boolean;
begin
  perform public.admin_require('flags.manage');
  v_reason := public.admin_clean_reason(p_reason);
  if p_enabled is null then raise exception 'enabled is required' using errcode = '22023'; end if;
  select enabled into v_old from public.feature_flags where key = p_key for update;
  if not found then raise exception 'Unknown feature flag' using errcode = 'P0002'; end if;
  update public.feature_flags set enabled = p_enabled, updated_by = auth.uid(), updated_at = now() where key = p_key;
  perform public.admin_write_audit('flag.update', 'feature_flag', p_key,
    jsonb_build_object('enabled', v_old), jsonb_build_object('enabled', p_enabled), v_reason);
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── admin users (super admin) ───────────────────────────────────────────────
create or replace function public.admin_list_admins()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.admin_require('admins.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'full_name', p.full_name, 'email', p.email,
      'role', a.role, 'permissions', a.permissions, 'active', a.active, 'created_at', a.created_at) order by a.created_at)
    from public.admin_users a join public.profiles p on p.id = a.user_id), '[]'::jsonb);
end;
$$;

-- The target must already have signed in with Google (a profile exists). Self-edits are blocked and
-- the last active super_admin can never be demoted or deactivated.
create or replace function public.admin_upsert_admin(p_email text, p_role text, p_permissions text[], p_active boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_reason text; v_target uuid; v_old jsonb; v_perms text[] := coalesce(p_permissions, '{}');
begin
  perform public.admin_require('admins.manage');
  v_reason := public.admin_clean_reason(p_reason);
  if p_role is null or p_role not in ('super_admin', 'admin') then raise exception 'Invalid role' using errcode = '22023'; end if;
  if not (v_perms <@ public.admin_grantable_permissions()) then raise exception 'Unknown permission' using errcode = '22023'; end if;
  select id into v_target from public.profiles where lower(email) = lower(btrim(coalesce(p_email, '')));
  if v_target is null then raise exception 'No user with that email has signed in yet' using errcode = 'P0002'; end if;
  if v_target = auth.uid() then raise exception 'You cannot change your own administrator access' using errcode = '22023'; end if;
  if exists (select 1 from public.user_restrictions where user_id = v_target) then
    raise exception 'Reinstate this restricted user before granting administrator access' using errcode = '22023';
  end if;

  select to_jsonb(a) into v_old from public.admin_users a where user_id = v_target for update;
  if v_old is not null and (v_old ->> 'role') = 'super_admin' and (v_old ->> 'active')::boolean
     and (p_role <> 'super_admin' or not coalesce(p_active, true))
     and (select count(*) from public.admin_users where role = 'super_admin' and active) <= 1 then
    raise exception 'At least one active super admin is required' using errcode = '22023';
  end if;

  insert into public.admin_users (user_id, role, permissions, active, created_by)
  values (v_target, p_role, case when p_role = 'super_admin' then '{}' else v_perms end, coalesce(p_active, true), auth.uid())
  on conflict (user_id) do update set role = excluded.role, permissions = excluded.permissions, active = excluded.active;

  perform public.admin_write_audit('admin.upsert', 'admin_user', v_target::text, v_old,
    jsonb_build_object('role', p_role, 'permissions', case when p_role = 'super_admin' then '{}' else v_perms end,
                       'active', coalesce(p_active, true)), v_reason);
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── audit viewer ────────────────────────────────────────────────────────────
create or replace function public.admin_list_audit(p_entity_type text default null, p_action text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v jsonb;
begin
  perform public.admin_require('audit.view');
  with base as (
    select * from public.admin_audit_log
    where (p_entity_type is null or p_entity_type = '' or entity_type = p_entity_type)
      and (p_action is null or p_action = '' or action = p_action)
  ), page as (select * from base order by created_at desc limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc) from page), '[]'::jsonb)) into v;
  return v;
end;
$$;

-- ─── grants: RPCs callable by signed-in users only; each enforces its own permission ───
do $$
declare f text;
begin
  foreach f in array array[
    'admin_list_users(text,int,int)', 'admin_set_user_restriction(uuid,boolean,text)',
    'admin_list_listings(text,text,int,int)', 'admin_set_listing_suspension(uuid,boolean,text)',
    'admin_list_bookings(text,text,int,int)', 'admin_list_payments(text,int,int)', 'admin_list_payouts(text,int,int)',
    'admin_list_reviews(text,int,int)', 'admin_remove_review(uuid,text)',
    'admin_list_categories()', 'admin_upsert_category(uuid,text,text,boolean,int,text)',
    'admin_list_settings()', 'admin_update_setting(text,jsonb,text)', 'admin_set_feature_flag(text,boolean,text)',
    'admin_list_admins()', 'admin_upsert_admin(text,text,text[],boolean,text)',
    'admin_list_audit(text,text,int,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ─── restrictive session policy for the new tables (defence in depth; no permissive policies) ───
do $$
declare t text;
begin
  foreach t in array array['admin_users', 'admin_audit_log', 'user_restrictions'] loop
    execute format(
      'create policy active_session_required on public.%I as restrictive for all to authenticated
       using ((select public.has_active_session())) with check ((select public.has_active_session()))', t);
  end loop;
end;
$$;
