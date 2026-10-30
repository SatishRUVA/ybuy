-- Fixed category list for YBuy Part 1 (§3.4) — edit here, not in UI components.
-- icon values must match lucide-react export names (PascalCase) used by the UI's icon lookup.
insert into public.categories (name, icon, active, sort_order) values
  ('Tools & Equipment', 'Wrench', true, 1),
  ('Electronics', 'Camera', true, 2),
  ('Outdoor & Camping', 'Tent', true, 3),
  ('Party & Events', 'PartyPopper', true, 4),
  ('Sports & Fitness', 'Dumbbell', true, 5),
  ('Vehicles', 'Car', true, 6),
  ('Home & Garden', 'Home', true, 7),
  ('Other', 'Package', true, 8)
on conflict (name) do update set icon = excluded.icon, active = excluded.active, sort_order = excluded.sort_order;

-- Local-only test defaults. `supabase db reset` applies this seed to the local stack;
-- migrations keep these features disabled in other environments until an admin enables them.
update public.feature_flags set enabled = true, updated_at = now()
where key in ('bidding','item_requests','disputes','duration_discounts','owner_promotions','test_dummy_legal_terms');
