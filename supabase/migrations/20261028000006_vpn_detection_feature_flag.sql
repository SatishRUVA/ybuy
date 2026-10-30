insert into public.feature_flags (key, enabled, description) values
  ('vpn_detection', false, 'Checks visitor IPs for VPN use and shows a warning when detected.')
on conflict (key) do nothing;