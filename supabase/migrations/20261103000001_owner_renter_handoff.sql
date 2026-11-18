begin;

create table public.booking_handoff_policy (
  singleton boolean primary key default true check (singleton),
  otp_ttl_seconds integer not null default 300 check (otp_ttl_seconds between 60 and 900),
  otp_max_attempts integer not null default 5 check (otp_max_attempts between 1 and 10),
  otp_regeneration_cooldown_seconds integer not null default 30 check (otp_regeneration_cooldown_seconds between 10 and 300),
  otp_max_generations integer not null default 5 check (otp_max_generations between 1 and 10),
  otp_generation_window_seconds integer not null default 1800 check (otp_generation_window_seconds between 300 and 86400)
);
insert into public.booking_handoff_policy(singleton) values (true);
alter table public.booking_handoff_policy enable row level security;
revoke all on public.booking_handoff_policy from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'booking_handoff_otp_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'booking_handoff_otp_pepper', 'YBuy booking handoff OTP hashing and encryption key');
  end if;
end;
$$;

create table public.booking_handoffs (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  status text not null check (status in (
    'pickup_ready', 'pickup_checkin_started', 'pickup_inspection', 'pickup_otp_pending',
    'rental_active', 'return_initiated', 'return_inspection', 'return_otp_pending', 'returned', 'cancelled'
  )),
  pickup_arrived_at timestamptz,
  actual_pickup_at timestamptz,
  return_initiated_at timestamptz,
  actual_return_at timestamptz,
  support_exception_pickup_at timestamptz,
  support_exception_return_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create trigger booking_handoffs_updated before update on public.booking_handoffs
  for each row execute function public.set_updated_at();
alter table public.booking_handoffs enable row level security;
revoke all on public.booking_handoffs from public, anon;
grant select on public.booking_handoffs to authenticated;
create policy booking_handoffs_participant_read on public.booking_handoffs
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id = booking_id and auth.uid() in (b.owner_id, b.renter_id)
  ));

create table public.booking_inspections (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  kind text not null check (kind in ('pickup', 'return')),
  appearance_condition text not null check (length(btrim(appearance_condition)) between 10 and 2000),
  existing_damage text not null check (length(btrim(existing_damage)) between 1 and 2000),
  included_accessories text[] not null default '{}',
  functional_condition text not null check (length(btrim(functional_condition)) between 3 and 1000),
  serial_number text not null default '' check (length(serial_number) <= 120),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null default clock_timestamp(),
  owner_acknowledged_at timestamptz,
  renter_acknowledged_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (booking_id, kind),
  check (cardinality(included_accessories) <= 30)
);
create trigger booking_inspections_updated before update on public.booking_inspections
  for each row execute function public.set_updated_at();
alter table public.booking_inspections enable row level security;
revoke all on public.booking_inspections from public, anon;
grant select on public.booking_inspections to authenticated;
create policy booking_inspections_participant_read on public.booking_inspections
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id = booking_id and auth.uid() in (b.owner_id, b.renter_id)
  ));

create table public.booking_inspection_audit (
  id bigint generated always as identity primary key,
  inspection_id uuid not null references public.booking_inspections(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in ('created', 'updated', 'owner_acknowledged', 'renter_acknowledged')),
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index booking_inspection_audit_inspection_idx on public.booking_inspection_audit(inspection_id, created_at);
alter table public.booking_inspection_audit enable row level security;
revoke all on public.booking_inspection_audit from public, anon;
grant select on public.booking_inspection_audit to authenticated;
create policy booking_inspection_audit_participant_read on public.booking_inspection_audit
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.booking_inspections i join public.bookings b on b.id = i.booking_id
    where i.id = inspection_id and auth.uid() in (b.owner_id, b.renter_id)
  ));

create function public.audit_booking_inspection()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_inspection_audit(inspection_id, actor_id, event_type, before_snapshot, after_snapshot)
  values (
    new.id, auth.uid(),
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'UPDATE' then to_jsonb(old) - 'updated_at' end,
    to_jsonb(new) - 'updated_at'
  );
  return new;
end;
$$;
revoke all on function public.audit_booking_inspection() from public, anon, authenticated;
create trigger booking_inspection_audit_record after insert or update on public.booking_inspections
  for each row execute function public.audit_booking_inspection();

create table public.booking_inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.booking_inspections(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  object_path text not null unique,
  created_at timestamptz not null default clock_timestamp()
);
create index booking_inspection_photos_inspection_idx on public.booking_inspection_photos(inspection_id, created_at);
alter table public.booking_inspection_photos enable row level security;
revoke all on public.booking_inspection_photos from public, anon;
grant select on public.booking_inspection_photos to authenticated;
create policy booking_inspection_photos_participant_read on public.booking_inspection_photos
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.booking_inspections i join public.bookings b on b.id = i.booking_id
    where i.id = inspection_id and auth.uid() in (b.owner_id, b.renter_id)
  ));

create table public.booking_handoff_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  kind text not null check (kind in ('pickup', 'return')),
  generation integer not null check (generation > 0),
  otp_hash bytea not null,
  otp_ciphertext bytea not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null check (max_attempts between 1 and 10),
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete restrict,
  invalidated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (booking_id, kind, generation)
);
create index booking_handoff_otp_recent_idx on public.booking_handoff_otp_challenges(booking_id, kind, created_at desc);
alter table public.booking_handoff_otp_challenges enable row level security;
revoke all on public.booking_handoff_otp_challenges from public, anon, authenticated, service_role;

create table public.booking_handoff_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  event_type text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index booking_handoff_events_booking_idx on public.booking_handoff_events(booking_id, created_at, id);
alter table public.booking_handoff_events enable row level security;
revoke all on public.booking_handoff_events from public, anon;
grant select on public.booking_handoff_events to authenticated;
create policy booking_handoff_events_participant_read on public.booking_handoff_events
  for select to authenticated using (public.has_active_session() and exists (
    select 1 from public.bookings b where b.id = booking_id and auth.uid() in (b.owner_id, b.renter_id)
  ));

create function public.can_access_booking_inspection_photo(p_path text, p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_booking_id uuid;
  v_user_id uuid;
  v_kind text;
  v_booking public.bookings;
  v_handoff public.booking_handoffs;
begin
  if not public.has_active_session() or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(pickup|return)/[A-Za-z0-9._-]{1,140}$'
    or split_part(p_path, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or split_part(p_path, '/', 2) <> auth.uid()::text then return false; end if;
  v_booking_id := split_part(p_path, '/', 1)::uuid;
  v_user_id := split_part(p_path, '/', 2)::uuid;
  v_kind := split_part(p_path, '/', 3);
  select * into v_booking from public.bookings where id = v_booking_id;
  select * into v_handoff from public.booking_handoffs where booking_id = v_booking_id;
  if not found or v_user_id not in (v_booking.owner_id, v_booking.renter_id) then return false; end if;
  if p_write then
    return v_user_id = v_booking.owner_id and (
      (v_kind = 'pickup' and v_booking.status = 'confirmed'
        and v_handoff.status in ('pickup_checkin_started', 'pickup_inspection'))
      or (v_kind = 'return' and v_booking.status = 'return_pending'
        and v_handoff.status = 'return_inspection')
    );
  end if;
  return exists (
    select 1 from public.booking_inspection_photos p
    join public.booking_inspections i on i.id = p.inspection_id
    where p.object_path = p_path and i.booking_id = v_booking_id and i.kind = v_kind
  );
end;
$$;
revoke all on function public.can_access_booking_inspection_photo(text, boolean) from public, anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('booking-inspection-evidence', 'booking-inspection-evidence', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy booking_inspection_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'booking-inspection-evidence' and public.can_access_booking_inspection_photo(name));
create policy booking_inspection_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'booking-inspection-evidence' and public.can_access_booking_inspection_photo(name, true));

create function public.record_booking_handoff_event(p_booking_id uuid, p_event text, p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_handoff_events(booking_id, actor_id, event_type, detail)
  values (p_booking_id, auth.uid(), p_event, coalesce(p_detail, '{}'));
end;
$$;
revoke all on function public.record_booking_handoff_event(uuid, text, jsonb) from public, anon, authenticated;

create function public.issue_booking_handoff_otp(p_booking_id uuid, p_kind text)
returns public.booking_handoff_otp_challenges language plpgsql security definer set search_path = '' as $$
declare
  v_policy public.booking_handoff_policy;
  v_previous public.booking_handoff_otp_challenges;
  v_challenge public.booking_handoff_otp_challenges;
  v_pepper text;
  v_random bytea;
  v_value bigint;
  v_code text;
  v_generation integer;
begin
  select * into strict v_policy from public.booking_handoff_policy where singleton;
  select * into v_previous from public.booking_handoff_otp_challenges
    where booking_id = p_booking_id and kind = p_kind order by generation desc limit 1 for update;
  if found then
    if v_previous.invalidated_at is null and v_previous.used_at is null
      and v_previous.expires_at > clock_timestamp() and v_previous.attempts < v_previous.max_attempts then
      raise exception 'A valid code already exists; use it or wait for it to expire' using errcode = '55000';
    end if;
    if v_previous.created_at > clock_timestamp() - make_interval(secs => v_policy.otp_regeneration_cooldown_seconds) then
      raise exception 'Please wait before requesting another verification code' using errcode = '55000';
    end if;
  end if;
  if (select count(*) from public.booking_handoff_otp_challenges
      where booking_id = p_booking_id and kind = p_kind
        and created_at > clock_timestamp() - make_interval(secs => v_policy.otp_generation_window_seconds))
      >= v_policy.otp_max_generations then
    raise exception 'Too many verification codes were requested; contact support' using errcode = '55000';
  end if;
  select decrypted_secret into strict v_pepper from vault.decrypted_secrets where name = 'booking_handoff_otp_pepper';
  loop
    v_random := extensions.gen_random_bytes(4);
    v_value := get_byte(v_random, 0)::bigint * 16777216
      + get_byte(v_random, 1)::bigint * 65536
      + get_byte(v_random, 2)::bigint * 256
      + get_byte(v_random, 3)::bigint;
    exit when v_value < 4294000000;
  end loop;
  v_code := lpad((v_value % 1000000)::text, 6, '0');
  v_generation := coalesce(v_previous.generation, 0) + 1;
  if v_previous.id is not null then
    update public.booking_handoff_otp_challenges set invalidated_at = clock_timestamp(), otp_ciphertext = ''::bytea
      where id = v_previous.id;
  end if;
  insert into public.booking_handoff_otp_challenges(
    booking_id, kind, generation, otp_hash, otp_ciphertext, expires_at, max_attempts
  ) values (
    p_booking_id, p_kind, v_generation,
    extensions.hmac(convert_to(p_booking_id::text || ':' || p_kind || ':' || v_generation::text || ':' || v_code, 'UTF8'),
      convert_to(v_pepper, 'UTF8'), 'sha256'),
    extensions.pgp_sym_encrypt(v_code, v_pepper),
    clock_timestamp() + make_interval(secs => v_policy.otp_ttl_seconds),
    v_policy.otp_max_attempts
  ) returning * into v_challenge;
  return v_challenge;
end;
$$;
revoke all on function public.issue_booking_handoff_otp(uuid, text) from public, anon, authenticated;

create function public.start_booking_pickup(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.renter_id <> auth.uid() then raise exception 'Booking not found or not authorized' using errcode = '42501'; end if;
  if b.status <> 'confirmed' then raise exception 'Booking must be confirmed before pickup check-in' using errcode = '55000'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  if found then
    if h.status <> 'pickup_ready' then raise exception 'Pickup check-in has already moved forward' using errcode = '55000'; end if;
    return to_jsonb(h);
  end if;
  insert into public.booking_handoffs(booking_id, status, pickup_arrived_at)
    values (p_booking_id, 'pickup_ready', clock_timestamp()) returning * into h;
  perform public.record_booking_handoff_event(p_booking_id, 'pickup_arrival_reported');
  perform public.create_notification(b.owner_id, 'pickup-arrived:' || p_booking_id, 'bookings',
    'Your renter has arrived', 'Open the booking to begin the pickup inspection.', '/check-in/' || p_booking_id);
  return to_jsonb(h);
end;
$$;
revoke all on function public.start_booking_pickup(uuid) from public, anon;
grant execute on function public.start_booking_pickup(uuid) to authenticated;

create function public.start_booking_handoff(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.owner_id <> auth.uid() then raise exception 'Booking not found or not authorized' using errcode = '42501'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  if not found or b.status <> 'confirmed' or h.status not in ('pickup_ready', 'pickup_checkin_started') then
    raise exception 'The renter must arrive before the owner can start handoff' using errcode = '55000';
  end if;
  if h.status = 'pickup_ready' then
    update public.booking_handoffs set status = 'pickup_checkin_started' where booking_id = p_booking_id returning * into h;
    perform public.record_booking_handoff_event(p_booking_id, 'pickup_handoff_started');
  end if;
  return to_jsonb(h);
end;
$$;
revoke all on function public.start_booking_handoff(uuid) from public, anon;
grant execute on function public.start_booking_handoff(uuid) to authenticated;

create or replace function public.start_booking_return(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.renter_id <> auth.uid() then raise exception 'Only the renter can start a return' using errcode = '42501'; end if;
  if b.status = 'return_pending' then
    select * into h from public.booking_handoffs where booking_id = p_booking_id;
    if h.status in ('return_initiated', 'return_inspection', 'return_otp_pending') then return b; end if;
  end if;
  if b.status <> 'active' then raise exception 'Booking must be active to start a return' using errcode = '55000'; end if;
  insert into public.booking_handoffs(booking_id, status, return_initiated_at)
    values (p_booking_id, 'return_initiated', clock_timestamp())
  on conflict (booking_id) do update set status = 'return_initiated', return_initiated_at = clock_timestamp()
    where public.booking_handoffs.status = 'rental_active'
  returning * into h;
  if h.booking_id is null then raise exception 'A return handoff is already in progress' using errcode = '55000'; end if;
  update public.bookings set status = 'return_pending' where id = p_booking_id returning * into b;
  perform public.record_booking_handoff_event(p_booking_id, 'return_initiated');
  perform public.create_notification(b.owner_id, 'return-started:' || p_booking_id, 'bookings',
    'Your renter started a return', 'Open the booking to inspect the item and accessories.', '/check-out/' || p_booking_id);
  return b;
end;
$$;
revoke all on function public.start_booking_return(uuid) from public, anon;
grant execute on function public.start_booking_return(uuid) to authenticated;

create function public.begin_booking_return_inspection(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.owner_id <> auth.uid() then raise exception 'Booking not found or not authorized' using errcode = '42501'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  if b.status <> 'return_pending' or h.status not in ('return_initiated', 'return_inspection') then
    raise exception 'The renter must start the return before inspection' using errcode = '55000';
  end if;
  if h.status = 'return_initiated' then
    update public.booking_handoffs set status = 'return_inspection' where booking_id = p_booking_id returning * into h;
    perform public.record_booking_handoff_event(p_booking_id, 'return_inspection_started');
  end if;
  return to_jsonb(h);
end;
$$;
revoke all on function public.begin_booking_return_inspection(uuid) from public, anon;
grant execute on function public.begin_booking_return_inspection(uuid) to authenticated;

create function public.save_booking_inspection(
  p_booking_id uuid, p_kind text, p_appearance_condition text, p_existing_damage text,
  p_included_accessories text[], p_functional_condition text, p_serial_number text default ''
) returns public.booking_inspections language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs; i public.booking_inspections;
  v_appearance text := btrim(coalesce(p_appearance_condition, ''));
  v_damage text := btrim(coalesce(p_existing_damage, ''));
  v_functional text := btrim(coalesce(p_functional_condition, ''));
  v_serial text := btrim(coalesce(p_serial_number, ''));
  v_accessories text[] := coalesce(p_included_accessories, '{}');
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.owner_id <> auth.uid() then raise exception 'Only the owner can document an inspection' using errcode = '42501'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  if (p_kind = 'pickup' and (b.status <> 'confirmed' or h.status not in ('pickup_checkin_started', 'pickup_inspection')))
    or (p_kind = 'return' and (b.status <> 'return_pending' or h.status <> 'return_inspection'))
    or p_kind not in ('pickup', 'return') then
    raise exception 'This inspection is not open for documentation' using errcode = '55000';
  end if;
  if length(v_appearance) not between 10 and 2000 or length(v_damage) not between 1 and 2000
    or length(v_functional) not between 3 and 1000 or length(v_serial) > 120 or cardinality(v_accessories) > 30
    or exists (select 1 from unnest(v_accessories) item where length(btrim(item)) not between 1 and 120) then
    raise exception 'Complete the condition, damage, accessory and functional checklist' using errcode = '22023';
  end if;
  select * into i from public.booking_inspections where booking_id = p_booking_id and kind = p_kind for update;
  if found and (i.owner_acknowledged_at is not null or i.renter_acknowledged_at is not null) then
    raise exception 'An acknowledged inspection can no longer be changed' using errcode = '55000';
  end if;
  if i.id is null then
    insert into public.booking_inspections(
      booking_id, kind, appearance_condition, existing_damage, included_accessories,
      functional_condition, serial_number, submitted_by
    ) values (
      p_booking_id, p_kind, v_appearance, v_damage, v_accessories, v_functional, v_serial, auth.uid()
    ) returning * into i;
  else
    update public.booking_inspections set appearance_condition = v_appearance, existing_damage = v_damage,
      included_accessories = v_accessories, functional_condition = v_functional, serial_number = v_serial,
      submitted_by = auth.uid(), submitted_at = clock_timestamp()
      where id = i.id returning * into i;
  end if;
  if h.status in ('pickup_checkin_started', 'pickup_inspection') then
    update public.booking_handoffs set status = 'pickup_inspection' where booking_id = p_booking_id;
  end if;
  perform public.record_booking_handoff_event(p_booking_id, p_kind || '_inspection_saved', jsonb_build_object('inspection_id', i.id));
  return i;
end;
$$;
revoke all on function public.save_booking_inspection(uuid, text, text, text, text[], text, text) from public, anon;
grant execute on function public.save_booking_inspection(uuid, text, text, text, text[], text, text) to authenticated;

create function public.register_booking_inspection_photo(p_inspection_id uuid, p_object_path text)
returns public.booking_inspection_photos language plpgsql security definer set search_path = '' as $$
declare i public.booking_inspections; b public.bookings; p public.booking_inspection_photos;
begin
  perform public.operations_require_session();
  select * into i from public.booking_inspections where id = p_inspection_id for update;
  if not found then raise exception 'Inspection not found' using errcode = 'P0002'; end if;
  select * into b from public.bookings where id = i.booking_id;
  if b.owner_id <> auth.uid() or split_part(coalesce(p_object_path, ''), '/', 1) <> i.booking_id::text
    or split_part(p_object_path, '/', 2) <> auth.uid()::text or split_part(p_object_path, '/', 3) <> i.kind
    or not public.can_access_booking_inspection_photo(p_object_path, true) then
    raise exception 'Not authorized to attach this inspection photo' using errcode = '42501';
  end if;
  select * into p from public.booking_inspection_photos where object_path = p_object_path;
  if found then return p; end if;
  if (select count(*) from public.booking_inspection_photos where inspection_id = i.id) >= 12 then
    raise exception 'An inspection can have at most 12 photos' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'booking-inspection-evidence' and name = p_object_path) then
    raise exception 'Upload the photo before attaching it to the inspection' using errcode = '22023';
  end if;
  insert into public.booking_inspection_photos(inspection_id, uploaded_by, object_path)
    values (i.id, auth.uid(), p_object_path) returning * into p;
  perform public.record_booking_handoff_event(i.booking_id, i.kind || '_inspection_photo_added', jsonb_build_object('photo_id', p.id));
  return p;
end;
$$;
revoke all on function public.register_booking_inspection_photo(uuid, text) from public, anon;
grant execute on function public.register_booking_inspection_photo(uuid, text) to authenticated;

create function public.acknowledge_booking_inspection(p_booking_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs; i public.booking_inspections; v_code text;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or auth.uid() not in (b.owner_id, b.renter_id) then raise exception 'Booking not found or not authorized' using errcode = '42501'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  select * into i from public.booking_inspections where booking_id = p_booking_id and kind = p_kind for update;
  if not found or p_kind not in ('pickup', 'return')
    or (p_kind = 'pickup' and (b.status <> 'confirmed' or h.status not in ('pickup_inspection', 'pickup_otp_pending')))
    or (p_kind = 'return' and (b.status <> 'return_pending' or h.status not in ('return_inspection', 'return_otp_pending'))) then
    raise exception 'This inspection is not ready for acknowledgment' using errcode = '55000';
  end if;
  if (select count(*) from public.booking_inspection_photos where inspection_id = i.id) < 2 then
    raise exception 'At least two condition photos are required before acknowledgment' using errcode = '22023';
  end if;
  if auth.uid() = b.owner_id then
    update public.booking_inspections set owner_acknowledged_at = coalesce(owner_acknowledged_at, clock_timestamp())
      where id = i.id returning * into i;
    perform public.record_booking_handoff_event(p_booking_id, p_kind || '_inspection_owner_acknowledged',
      jsonb_build_object('inspection_id', i.id));
  else
    update public.booking_inspections set renter_acknowledged_at = coalesce(renter_acknowledged_at, clock_timestamp())
      where id = i.id returning * into i;
    perform public.record_booking_handoff_event(p_booking_id, p_kind || '_inspection_renter_acknowledged',
      jsonb_build_object('inspection_id', i.id));
  end if;
  if i.owner_acknowledged_at is not null and i.renter_acknowledged_at is not null then
    if p_kind = 'pickup' and h.status <> 'pickup_otp_pending' then
      update public.booking_handoffs set status = 'pickup_otp_pending' where booking_id = p_booking_id;
      perform public.issue_booking_handoff_otp(p_booking_id, 'pickup');
      perform public.record_booking_handoff_event(p_booking_id, 'pickup_otp_issued');
    elsif p_kind = 'return' and h.status <> 'return_otp_pending' then
      update public.booking_handoffs set status = 'return_otp_pending' where booking_id = p_booking_id;
      perform public.issue_booking_handoff_otp(p_booking_id, 'return');
      perform public.record_booking_handoff_event(p_booking_id, 'return_otp_issued');
    end if;
  end if;
  return jsonb_build_object('inspection', to_jsonb(i),
    'status', (select status from public.booking_handoffs where booking_id = p_booking_id));
end;
$$;
revoke all on function public.acknowledge_booking_inspection(uuid, text) from public, anon;
grant execute on function public.acknowledge_booking_inspection(uuid, text) to authenticated;

create function public.get_booking_handoff(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id and auth.uid() in (owner_id, renter_id);
  if not found then raise exception 'Booking not found or not authorized' using errcode = '42501'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id;
  return jsonb_build_object(
    'booking_id', p_booking_id, 'booking_status', b.status, 'start_date', b.start_date, 'end_date', b.end_date,
    'is_owner', b.owner_id = auth.uid(),
    'status', h.status,
    'pickup_arrived_at', h.pickup_arrived_at,
    'actual_pickup_at', h.actual_pickup_at,
    'return_initiated_at', h.return_initiated_at,
    'actual_return_at', h.actual_return_at,
    'pickup', (select jsonb_build_object(
      'inspection', to_jsonb(i),
      'photos', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
        from public.booking_inspection_photos p where p.inspection_id = i.id), '[]'::jsonb)
    ) from public.booking_inspections i where i.booking_id = p_booking_id and i.kind = 'pickup'),
    'return', (select jsonb_build_object(
      'inspection', to_jsonb(i),
      'photos', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
        from public.booking_inspection_photos p where p.inspection_id = i.id), '[]'::jsonb)
    ) from public.booking_inspections i where i.booking_id = p_booking_id and i.kind = 'return'),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id)
      from public.booking_handoff_events e where e.booking_id = p_booking_id), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind,
      'category', c.category, 'subject', c.subject, 'status', c.status, 'created_at', c.created_at)
      order by c.created_at desc) from public.operations_cases c where c.booking_id = p_booking_id
      and auth.uid() in (c.participant_id, b.owner_id, b.renter_id)), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_booking_handoff(uuid) from public, anon;
grant execute on function public.get_booking_handoff(uuid) to authenticated;

create function public.get_booking_handoff_otp(p_booking_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs; c public.booking_handoff_otp_challenges; v_pepper text;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id;
  if not found or b.renter_id <> auth.uid() or p_kind not in ('pickup', 'return') then
    raise exception 'Only the renter can view this verification code' using errcode = '42501';
  end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id;
  if (p_kind = 'pickup' and h.status <> 'pickup_otp_pending')
    or (p_kind = 'return' and h.status <> 'return_otp_pending') then
    raise exception 'Both parties must acknowledge the inspection before a code is available' using errcode = '55000';
  end if;
  select * into c from public.booking_handoff_otp_challenges
    where booking_id = p_booking_id and kind = p_kind order by generation desc limit 1;
  if not found or c.invalidated_at is not null or c.used_at is not null
    or c.attempts >= c.max_attempts or c.expires_at <= clock_timestamp() then
    raise exception 'The verification code expired or is no longer available' using errcode = '55000';
  end if;
  select decrypted_secret into strict v_pepper from vault.decrypted_secrets where name = 'booking_handoff_otp_pepper';
  return jsonb_build_object('code', extensions.pgp_sym_decrypt(c.otp_ciphertext, v_pepper),
    'expires_at', c.expires_at, 'generation', c.generation);
end;
$$;
revoke all on function public.get_booking_handoff_otp(uuid, text) from public, anon;
grant execute on function public.get_booking_handoff_otp(uuid, text) to authenticated;

create function public.regenerate_booking_handoff_otp(p_booking_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs; c public.booking_handoff_otp_challenges;
  v_pepper text; v_code text;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.renter_id <> auth.uid() or p_kind not in ('pickup', 'return') then
    raise exception 'Only the renter can request another verification code' using errcode = '42501';
  end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  if (p_kind = 'pickup' and h.status <> 'pickup_otp_pending')
    or (p_kind = 'return' and h.status <> 'return_otp_pending') then
    raise exception 'Both parties must acknowledge the inspection before a code is available' using errcode = '55000';
  end if;
  select * into c from public.booking_handoff_otp_challenges
    where booking_id = p_booking_id and kind = p_kind order by generation desc limit 1 for update;
  if not found or (c.expires_at > clock_timestamp() and c.attempts < c.max_attempts and c.used_at is null) then
    raise exception 'A verification code is still active' using errcode = '55000';
  end if;
  c := public.issue_booking_handoff_otp(p_booking_id, p_kind);
  select decrypted_secret into strict v_pepper from vault.decrypted_secrets where name = 'booking_handoff_otp_pepper';
  v_code := extensions.pgp_sym_decrypt(c.otp_ciphertext, v_pepper);
  perform public.record_booking_handoff_event(p_booking_id, p_kind || '_otp_regenerated',
    jsonb_build_object('generation', c.generation));
  return jsonb_build_object('code', v_code, 'expires_at', c.expires_at, 'generation', c.generation);
end;
$$;
revoke all on function public.regenerate_booking_handoff_otp(uuid, text) from public, anon;
grant execute on function public.regenerate_booking_handoff_otp(uuid, text) to authenticated;

create function public.verify_booking_handoff_otp(p_booking_id uuid, p_kind text, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  h public.booking_handoffs;
  i public.booking_inspections;
  c public.booking_handoff_otp_challenges;
  v_pepper text;
  v_hash bytea;
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_error text;
  v_payment public.payments;
begin
  perform public.operations_require_session();
  if p_kind not in ('pickup', 'return') then
    return jsonb_build_object('verified', false, 'error', 'Choose a valid handoff type.');
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.owner_id <> auth.uid() then raise exception 'Only the booking owner can verify a code' using errcode = '42501'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  select * into c from public.booking_handoff_otp_challenges
    where booking_id = p_booking_id and kind = p_kind order by generation desc limit 1 for update;
  if not found or c.invalidated_at is not null then
    return jsonb_build_object('verified', false, 'error', 'Request a new verification code.');
  end if;
  select decrypted_secret into strict v_pepper from vault.decrypted_secrets where name = 'booking_handoff_otp_pepper';
  v_hash := extensions.hmac(convert_to(p_booking_id::text || ':' || p_kind || ':' || c.generation::text || ':' || coalesce(p_code, ''), 'UTF8'),
    convert_to(v_pepper, 'UTF8'), 'sha256');
  if c.used_at is not null then
    return jsonb_build_object('verified', c.used_by = auth.uid() and c.otp_hash = v_hash,
      'status', b.status, 'idempotent', true);
  end if;
  if (p_kind = 'pickup' and (b.status <> 'confirmed' or h.status <> 'pickup_otp_pending'))
    or (p_kind = 'return' and (b.status <> 'return_pending' or h.status <> 'return_otp_pending')) then
    raise exception 'This handoff is not waiting for verification' using errcode = '55000';
  end if;
  select * into i from public.booking_inspections where booking_id = p_booking_id and kind = p_kind;
  if not found or i.owner_acknowledged_at is null or i.renter_acknowledged_at is null
    or (select count(*) from public.booking_inspection_photos where inspection_id = i.id) < 2 then
    raise exception 'Both parties must acknowledge a complete inspection before verification' using errcode = '55000';
  end if;
  if c.expires_at <= v_now or c.attempts >= c.max_attempts then
    return jsonb_build_object('verified', false, 'error', 'This code expired or has too many incorrect attempts.',
      'attempts_remaining', 0);
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' or c.otp_hash <> v_hash then
    update public.booking_handoff_otp_challenges set attempts = attempts + 1 where id = c.id returning * into c;
    v_error := case when p_code is null or p_code !~ '^[0-9]{6}$'
      then 'Enter the six-digit code.' else 'That code is not correct.' end;
    perform public.record_booking_handoff_event(p_booking_id, p_kind || '_otp_failed',
      jsonb_build_object('attempts', c.attempts, 'attempts_remaining', greatest(c.max_attempts - c.attempts, 0)));
    return jsonb_build_object('verified', false, 'error', v_error,
      'attempts_remaining', greatest(c.max_attempts - c.attempts, 0));
  end if;
  if p_kind = 'pickup' then
    if b.confirmation_gate <> 'confirmed' then raise exception 'Booking confirmation is no longer valid' using errcode = '55000'; end if;
    if b.deposit_collection_model = 'authorization' and b.deposit > 0 and not exists (
      select 1 from public.booking_deposit_authorizations a
      where a.booking_id = b.id and not a.is_claim_authorization and a.status = 'authorized'
        and a.authorized_amount >= b.deposit and a.capture_before > v_now
    ) then raise exception 'The security deposit authorization expired; complete deposit setup before pickup' using errcode = '55000'; end if;
    update public.bookings set status = 'active' where id = p_booking_id returning * into b;
    update public.booking_handoffs set status = 'rental_active', actual_pickup_at = v_now where booking_id = p_booking_id;
    v_status := 'active';
    perform public.record_booking_handoff_event(p_booking_id, 'pickup_verified',
      jsonb_build_object('inspection_id', i.id, 'verified_at', v_now));
    perform public.create_notification(b.renter_id, 'pickup-verified-renter:' || p_booking_id, 'bookings',
      'Pickup confirmed', 'Your rental is active. Return is due ' || b.end_date::text || '.', '/check-in/' || p_booking_id);
    perform public.create_notification(b.owner_id, 'pickup-verified-owner:' || p_booking_id, 'bookings',
      'Rental is active', 'Pickup was verified. The item is due back ' || b.end_date::text || '.', '/check-in/' || p_booking_id);
  else
    select * into v_payment from public.payments where booking_id = p_booking_id and status = 'succeeded';
    if not found or v_payment.amount <> b.total or v_payment.currency <> 'usd'
      or v_payment.stripe_payment_intent_id is null
      or (select count(*) from public.payments where booking_id = p_booking_id and status = 'succeeded') <> 1 then
      raise exception 'A single verified full payment is required before return settlement' using errcode = '23514';
    end if;
    update public.bookings set status = 'completed', return_confirmed_at = v_now where id = p_booking_id returning * into b;
    insert into public.rental_settlements(booking_id, payment_id, deposit_amount, owner_amount, refund_status)
      values (p_booking_id, v_payment.id, b.deposit, b.subtotal + coalesce(b.delivery_fee_amount, 0),
        case when b.deposit_collection_model = 'authorization' or b.deposit = 0 then 'not_required' else 'pending' end)
      on conflict (booking_id) do nothing;
    update public.booking_handoffs set status = 'returned', actual_return_at = v_now where booking_id = p_booking_id;
    v_status := 'completed';
    perform public.record_booking_handoff_event(p_booking_id, 'return_verified',
      jsonb_build_object('inspection_id', i.id, 'verified_at', v_now));
    perform public.create_notification(b.renter_id, 'return-verified-renter:' || p_booking_id, 'bookings',
      'Return confirmed', 'Your return inspection is complete. Deposit settlement status is available in your booking.', '/check-out/' || p_booking_id);
    perform public.create_notification(b.owner_id, 'return-verified-owner:' || p_booking_id, 'bookings',
      'Return confirmed', 'The item return was verified. Settlement is ready for processing.', '/check-out/' || p_booking_id);
  end if;
  update public.booking_handoff_otp_challenges set used_at = v_now, used_by = auth.uid(), otp_ciphertext = ''::bytea
    where id = c.id;
  return jsonb_build_object('verified', true, 'status', v_status, 'verified_at', v_now);
end;
$$;
revoke all on function public.verify_booking_handoff_otp(uuid, text, text) from public, anon;
grant execute on function public.verify_booking_handoff_otp(uuid, text, text) to authenticated;

create function public.support_complete_booking_handoff_exception(p_booking_id uuid, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs; v_now timestamptz := clock_timestamp();
begin
  perform public.operations_require_session();
  perform public.admin_require('support.manage');
  if p_kind not in ('pickup', 'return') or length(btrim(coalesce(p_reason, ''))) not between 10 and 1000 then
    raise exception 'A handoff type and support exception reason are required' using errcode = '22023';
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  if p_kind = 'pickup' and (b.status <> 'confirmed' or h.status not in (
    'pickup_ready', 'pickup_checkin_started', 'pickup_inspection', 'pickup_otp_pending')) then
    raise exception 'Pickup is not eligible for a support exception' using errcode = '55000';
  elsif p_kind = 'return' and (b.status <> 'return_pending' or h.status not in ('return_initiated', 'return_inspection', 'return_otp_pending')) then
    raise exception 'Return is not eligible for a support exception' using errcode = '55000';
  end if;
  if not exists(select 1 from public.operations_cases c where c.booking_id = p_booking_id
      and c.kind = 'support' and c.status not in ('resolved', 'closed')) then
    raise exception 'An open support case is required before an exception can be approved' using errcode = '55000';
  end if;
  if p_kind = 'pickup' then
    if b.confirmation_gate <> 'confirmed' then raise exception 'Booking confirmation is required' using errcode = '55000'; end if;
    update public.bookings set status = 'active' where id = p_booking_id returning * into b;
    update public.booking_handoffs set status = 'rental_active', actual_pickup_at = v_now,
      support_exception_pickup_at = v_now where booking_id = p_booking_id;
  else
    update public.bookings set status = 'completed', return_confirmed_at = v_now where id = p_booking_id returning * into b;
    update public.booking_handoffs set status = 'returned', actual_return_at = v_now,
      support_exception_return_at = v_now where booking_id = p_booking_id;
    insert into public.rental_settlements(booking_id, payment_id, deposit_amount, owner_amount, refund_status)
      select p_booking_id, p.id, b.deposit, b.subtotal + coalesce(b.delivery_fee_amount, 0),
        case when b.deposit_collection_model = 'authorization' or b.deposit = 0 then 'not_required' else 'pending' end
      from public.payments p where p.booking_id = p_booking_id and p.status = 'succeeded'
        and p.amount = b.total and p.currency = 'usd' and p.stripe_payment_intent_id is not null
        and (select count(*) from public.payments where booking_id = p_booking_id and status = 'succeeded') = 1
      on conflict (booking_id) do nothing;
    if not found then raise exception 'A verified full payment is required before return settlement' using errcode = '23514'; end if;
  end if;
  update public.booking_handoff_otp_challenges set invalidated_at = v_now, otp_ciphertext = ''::bytea
    where booking_id = p_booking_id and kind = p_kind and used_at is null;
  perform public.record_booking_handoff_event(p_booking_id, p_kind || '_support_exception',
    jsonb_build_object('approved_by', auth.uid(), 'reason', btrim(p_reason), 'occurred_at', v_now));
  perform public.create_notification(b.renter_id, 'handoff-exception-renter:' || p_kind || ':' || p_booking_id, 'bookings',
    'Handoff completed with support', 'YBuy Support recorded an authorized handoff exception. See the booking history for details.', '/check-in/' || p_booking_id);
  perform public.create_notification(b.owner_id, 'handoff-exception-owner:' || p_kind || ':' || p_booking_id, 'bookings',
    'Handoff completed with support', 'YBuy Support recorded an authorized handoff exception. See the booking history for details.', '/check-in/' || p_booking_id);
  return jsonb_build_object('status', (select status from public.booking_handoffs where booking_id = p_booking_id),
    'occurred_at', v_now, 'support_exception', true);
end;
$$;
revoke all on function public.support_complete_booking_handoff_exception(uuid, text, text) from public, anon;
grant execute on function public.support_complete_booking_handoff_exception(uuid, text, text) to authenticated;

create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare b public.bookings; h public.booking_handoffs;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if b.renter_id <> auth.uid() and b.owner_id <> auth.uid() then raise exception 'Not a participant in this booking' using errcode = '42501'; end if;
  if b.status not in ('requested', 'pending_payment', 'confirmed') then raise exception 'Booking can no longer be cancelled' using errcode = '55000'; end if;
  select * into h from public.booking_handoffs where booking_id = p_booking_id for update;
  if h.actual_pickup_at is not null then raise exception 'A picked-up rental cannot be cancelled' using errcode = '55000'; end if;
  if h.booking_id is not null then
    update public.booking_handoffs set status = 'cancelled' where booking_id = p_booking_id;
    update public.booking_handoff_otp_challenges set invalidated_at = clock_timestamp(), otp_ciphertext = ''::bytea
      where booking_id = p_booking_id and used_at is null;
    perform public.record_booking_handoff_event(p_booking_id, 'booking_cancelled_before_pickup');
  end if;
  update public.bookings set status = 'cancelled' where id = p_booking_id returning * into b;
  return b;
end;
$$;
revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;

revoke all on function public.mark_booking_active(uuid) from public, anon, authenticated;
revoke all on function public.complete_booking_return(uuid) from public, anon, authenticated;

create or replace function public.submit_booking_deposit_claim(
  p_booking_id uuid, p_subject text, p_description text, p_requested_amount numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_case jsonb;
  v_case_id uuid;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id = p_booking_id and owner_id = auth.uid() for update;
  if not found or b.deposit_collection_model <> 'authorization' or b.deposit <= 0
    or b.status not in ('return_pending', 'completed') then
    raise exception 'Only the owner can submit a deposit claim during return inspection' using errcode = '42501';
  end if;
  if p_subject is null or length(btrim(p_subject)) not between 3 and 160
    or p_description is null or length(btrim(p_description)) not between 10 and 2000
    or p_requested_amount is null or p_requested_amount <= 0 or p_requested_amount > b.deposit
    or p_requested_amount <> round(p_requested_amount, 2) then
    raise exception 'Enter a clear damage reason and an amount within the authorized deposit' using errcode = '22023';
  end if;
  v_case := public.operations_create_case('dispute', b.id, auth.uid(), 'damaged',
    btrim(p_subject), btrim(p_description), null);
  v_case_id := (v_case->>'id')::uuid;
  update public.booking_deposit_claims set requested_amount = p_requested_amount where case_id = v_case_id;
  return v_case;
end;
$$;
revoke all on function public.submit_booking_deposit_claim(uuid, text, text, numeric) from public, anon;
grant execute on function public.submit_booking_deposit_claim(uuid, text, text, numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
