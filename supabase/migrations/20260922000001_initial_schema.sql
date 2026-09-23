-- YBuy Part 1 core schema (see agent-inst/YBuy-Series-A-Part1-Agent-Instructions.md §6)

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── profiles ────────────────────────────────────────────────────────────────
-- Mirrors auth.users; row is auto-created on first Google sign-in by a trigger (see below).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  avatar_url text,
  phone text,
  location text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_any" on public.profiles
  for select using (true);

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- Auto-create a profile row from Google OAuth metadata on first sign-in.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── categories ──────────────────────────────────────────────────────────────
-- Seeded via supabase/seed.sql; no write API — edited via DB/seed script only.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text,
  active boolean not null default true,
  sort_order int not null default 0
);

alter table public.categories enable row level security;

create policy "categories_select_active" on public.categories
  for select using (active = true);

-- ─── listings ────────────────────────────────────────────────────────────────
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  title text not null,
  description text,
  price_per_day numeric(10,2) not null check (price_per_day > 0),
  price_per_week numeric(10,2) check (price_per_week is null or price_per_week > 0),
  deposit numeric(10,2) not null default 0 check (deposit >= 0),
  location_lat double precision,
  location_lng double precision,
  location_label text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_owner_id_idx on public.listings(owner_id);
create index listings_category_id_idx on public.listings(category_id);
create index listings_location_idx on public.listings(location_lat, location_lng);

create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

alter table public.listings enable row level security;

create policy "listings_select_published_or_own" on public.listings
  for select using (status = 'published' or owner_id = auth.uid());

create policy "listings_insert_own" on public.listings
  for insert with check (owner_id = auth.uid());

create policy "listings_update_own" on public.listings
  for update using (owner_id = auth.uid());

create policy "listings_delete_own" on public.listings
  for delete using (owner_id = auth.uid());

-- ─── listing_images ──────────────────────────────────────────────────────────
create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index listing_images_listing_id_idx on public.listing_images(listing_id);

alter table public.listing_images enable row level security;

create policy "listing_images_select_published_or_own" on public.listing_images
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and (l.status = 'published' or l.owner_id = auth.uid())
    )
  );

create policy "listing_images_write_own" on public.listing_images
  for all using (
    exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid())
  );

-- ─── listing_availability ────────────────────────────────────────────────────
create table public.listing_availability (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  date date not null,
  is_available boolean not null default true,
  unique (listing_id, date)
);

create index listing_availability_listing_id_idx on public.listing_availability(listing_id);
create index listing_availability_date_idx on public.listing_availability(date);

alter table public.listing_availability enable row level security;

create policy "listing_availability_select_published_or_own" on public.listing_availability
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and (l.status = 'published' or l.owner_id = auth.uid())
    )
  );

create policy "listing_availability_write_own" on public.listing_availability
  for all using (
    exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid())
  );

-- ─── favorites ───────────────────────────────────────────────────────────────
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

create index favorites_user_id_idx on public.favorites(user_id);

alter table public.favorites enable row level security;

create policy "favorites_all_own" on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── bookings ────────────────────────────────────────────────────────────────
-- State machine (§3.9): requested -> pending_payment -> confirmed -> active -> return_pending -> completed
-- Terminal branches: cancelled, rejected. Transitions are enforced server-side (Edge Functions), not by
-- a DB check constraint, since the valid next-state set depends on the current state.
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  renter_id uuid not null references public.profiles(id),
  owner_id uuid not null references public.profiles(id),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  quantity int not null default 1 check (quantity > 0),
  status text not null default 'requested' check (
    status in ('requested', 'pending_payment', 'confirmed', 'active', 'return_pending', 'completed', 'cancelled', 'rejected')
  ),
  -- Full pricing breakdown captured at creation time — never recompute historical bookings from current config.
  daily_rate numeric(10,2) not null,
  days int not null check (days > 0),
  subtotal numeric(10,2) not null,
  service_fee_pct numeric(5,4) not null,
  service_fee_amount numeric(10,2) not null,
  deposit numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bookings_listing_id_idx on public.bookings(listing_id);
create index bookings_renter_id_idx on public.bookings(renter_id);
create index bookings_owner_id_idx on public.bookings(owner_id);
create index bookings_dates_idx on public.bookings(start_date, end_date);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

alter table public.bookings enable row level security;

create policy "bookings_select_participant" on public.bookings
  for select using (renter_id = auth.uid() or owner_id = auth.uid());

create policy "bookings_update_participant" on public.bookings
  for update using (renter_id = auth.uid() or owner_id = auth.uid());

-- Booking creation always goes through an Edge Function (service role) so availability + pricing
-- are validated/recomputed server-side inside a transaction — no direct client insert policy.

-- ─── payments ────────────────────────────────────────────────────────────────
-- Written only by the Stripe webhook Edge Function using the service role key. Never from the client.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  amount numeric(10,2) not null,
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_booking_id_idx on public.payments(booking_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;

create policy "payments_select_own" on public.payments
  for select using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id and (b.renter_id = auth.uid() or b.owner_id = auth.uid())
    )
  );

-- ─── payouts ─────────────────────────────────────────────────────────────────
-- Manual-entry for Part 1: an owner is marked "paid out" by hand; recorded here for later automation.
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index payouts_owner_id_idx on public.payouts(owner_id);

alter table public.payouts enable row level security;

create policy "payouts_select_own" on public.payouts
  for select using (owner_id = auth.uid());

-- ─── conversations ───────────────────────────────────────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id),
  booking_id uuid references public.bookings(id),
  participant_one uuid not null references public.profiles(id),
  participant_two uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index conversations_participant_one_idx on public.conversations(participant_one);
create index conversations_participant_two_idx on public.conversations(participant_two);

alter table public.conversations enable row level security;

create policy "conversations_select_participant" on public.conversations
  for select using (participant_one = auth.uid() or participant_two = auth.uid());

create policy "conversations_insert_participant" on public.conversations
  for insert with check (participant_one = auth.uid() or participant_two = auth.uid());

-- ─── messages ────────────────────────────────────────────────────────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_idx on public.messages(conversation_id);

alter table public.messages enable row level security;

create policy "messages_select_participant" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.participant_one = auth.uid() or c.participant_two = auth.uid())
    )
  );

create policy "messages_insert_participant" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.participant_one = auth.uid() or c.participant_two = auth.uid())
    )
  );

-- ─── reviews ─────────────────────────────────────────────────────────────────
-- One review per party per booking, only after the booking is Completed (enforced in insert policy).
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  reviewee_id uuid not null references public.profiles(id),
  rating int not null check (rating between 1 and 5),
  body text,
  created_at timestamptz not null default now(),
  unique (booking_id, reviewer_id)
);

create index reviews_booking_id_idx on public.reviews(booking_id);
create index reviews_reviewee_id_idx on public.reviews(reviewee_id);

alter table public.reviews enable row level security;

create policy "reviews_select_any" on public.reviews
  for select using (true);

create policy "reviews_insert_participant_after_completed" on public.reviews
  for insert with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and b.status = 'completed'
        and (b.renter_id = auth.uid() or b.owner_id = auth.uid())
        and reviewee_id = (case when b.renter_id = auth.uid() then b.owner_id else b.renter_id end)
    )
  );
