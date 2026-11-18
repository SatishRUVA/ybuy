alter table public.listing_pickup_locations
  add column street_address text not null default '',
  add column country text not null default '',
  add column place_id text;
