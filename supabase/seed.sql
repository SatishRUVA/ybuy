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
