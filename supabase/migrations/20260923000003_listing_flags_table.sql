-- AI photo-analysis guideline flags (Part 1 convenience-only scope — no publish-blocking yet,
-- no admin review queue exists until Part 2). Rows are written exclusively by the
-- analyze-listing-photo Edge Function using the service role, so RLS intentionally has zero
-- policies here: nothing is exposed to anon/authenticated clients, only visible via the Supabase
-- Studio table editor (which uses the service role) for manual review in the meantime.
create table public.listing_flags (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  reason text not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index listing_flags_listing_id_idx on public.listing_flags(listing_id);

alter table public.listing_flags enable row level security;
