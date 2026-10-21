insert into public.feature_flags (key, enabled, description)
values ('mock_bidding', false, 'Enable the mock bidding preview only. No real bids, bookings or payments.')
on conflict (key) do nothing;
