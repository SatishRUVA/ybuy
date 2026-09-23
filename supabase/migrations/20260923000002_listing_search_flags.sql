-- Add server-filterable listing flags used by search filters.
alter table public.listings
  add column if not exists instant_booking boolean not null default false,
  add column if not exists protection_eligible boolean not null default false,
  add column if not exists delivery_available boolean not null default false,
  add column if not exists owner_verified boolean not null default false;

create index if not exists listings_instant_booking_idx on public.listings(instant_booking);
create index if not exists listings_protection_eligible_idx on public.listings(protection_eligible);
create index if not exists listings_delivery_available_idx on public.listings(delivery_available);
create index if not exists listings_owner_verified_idx on public.listings(owner_verified);

update public.listings
set
  instant_booking = coalesce(instant_booking, false),
  protection_eligible = coalesce(protection_eligible, false),
  delivery_available = coalesce(delivery_available, false),
  owner_verified = coalesce(owner_verified, false);

alter table public.listings
  alter column instant_booking set default false,
  alter column protection_eligible set default false,
  alter column delivery_available set default false,
  alter column owner_verified set default false,
  alter column instant_booking set not null,
  alter column protection_eligible set not null,
  alter column delivery_available set not null,
  alter column owner_verified set not null;
