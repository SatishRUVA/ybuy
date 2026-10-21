-- Exact pickup addresses are owner-private and must not live on public listing rows.
create table public.listing_pickup_locations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  address text not null,
  city text not null,
  state text not null default '',
  postal_code text not null default '',
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listing_pickup_locations_owner_id_idx on public.listing_pickup_locations(owner_id);

alter table public.listing_pickup_locations enable row level security;

create policy "listing_pickup_locations_select_own" on public.listing_pickup_locations
  for select using (owner_id = auth.uid());

create policy "listing_pickup_locations_insert_own" on public.listing_pickup_locations
  for insert with check (owner_id = auth.uid());

create policy "listing_pickup_locations_update_own" on public.listing_pickup_locations
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "listing_pickup_locations_delete_own" on public.listing_pickup_locations
  for delete using (owner_id = auth.uid());

create trigger listing_pickup_locations_set_updated_at
  before update on public.listing_pickup_locations
  for each row execute function public.set_updated_at();
