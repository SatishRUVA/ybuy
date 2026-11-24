do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  owner_session_id uuid := gen_random_uuid();
  listing_id uuid;
  auction_id uuid;
  fixed_listing_id uuid;
  fixed_auction_id uuid;
  category_id uuid;
  start_day date := current_date + 10;
  quote jsonb;
  retry_key uuid := gen_random_uuid();
begin
 begin
  insert into auth.users(id, email) values
    (owner_id, owner_id::text || '@example.test'),
    (renter_id, renter_id::text || '@example.test');
  insert into auth.sessions(id, user_id) values (session_id, renter_id), (owner_session_id, owner_id);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', owner_id, 'role', 'authenticated', 'session_id', owner_session_id,
    'exp', extract(epoch from now() + interval '1 hour')
  )::text, true);

  select id into category_id from public.categories limit 1;
  insert into public.listings(owner_id, category_id, title, description, price_per_day, estimated_value, item_condition,
    availability_start, availability_end, auction_date_flexible)
    values(owner_id, category_id, 'Overlap limit test', 'Overlap limit test fixture', 10, 100, 'good', start_day, start_day + 30, true)
    returning id into listing_id;
  insert into public.listing_images(listing_id, url) values (listing_id, 'test.jpg');
  insert into public.listing_pickup_locations(listing_id, owner_id, address, street_address, city, state, postal_code, country, time_zone, latitude, longitude)
    values(listing_id, owner_id, '123 Test St', '123 Test St', 'Test', 'CA', '90001', 'US', 'America/Los_Angeles', 0, 0);
  update public.listings set status = 'published' where id = listing_id;
  insert into public.listing_auctions(listing_id, start_date, end_date, opening_daily_rate, starts_at, ends_at, hard_ends_at)
    values(listing_id, start_day, start_day + 30, 10, now() - interval '1 hour',
      now() + interval '1 hour', now() + interval '2 hours')
    returning id into auction_id;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', renter_id, 'role', 'authenticated', 'session_id', session_id,
    'exp', extract(epoch from now() + interval '1 hour')
  )::text, true);

  insert into public.listing_auction_bids(auction_id, renter_id, daily_rate, idempotency_key, start_date, end_date)
    values
      (auction_id, renter_id, 10, gen_random_uuid(), start_day, start_day + 2),
      (auction_id, renter_id, 11, gen_random_uuid(), start_day, start_day + 2),
      (auction_id, renter_id, 12, gen_random_uuid(), start_day, start_day + 2);

  quote := public.get_listing_auction(listing_id, start_day, start_day + 2);
  if (quote->>'my_overlapping_bid_count')::integer is distinct from 3 then
    raise exception 'Quote must report three overlapping bids';
  end if;
  quote := public.get_listing_auction(listing_id, start_day + 2, start_day + 4);
  if (quote->>'my_overlapping_bid_count')::integer is distinct from 0 then
    raise exception 'Adjacent dates must not overlap';
  end if;
  begin
    perform public.place_listing_auction_bid(listing_id, 30, gen_random_uuid(), true, start_day + 1, start_day + 3);
    raise exception 'A fourth partially overlapping bid was accepted';
  exception when check_violation then
    if sqlerrm not like '%three bids%' then raise; end if;
  end;
  perform public.place_listing_auction_bid(listing_id, 20, retry_key, true, start_day + 2, start_day + 4);
  perform public.place_listing_auction_bid(listing_id, 20, retry_key, true, start_day + 2, start_day + 4);
  quote := public.get_listing_auction(listing_id, start_day, start_day + 4);
  if (quote->>'my_overlapping_bid_count')::integer is distinct from 4
    or (quote->>'my_bid_count')::integer is distinct from 4
    or jsonb_array_length(quote->'my_bids') <> 4 then
    raise exception 'Spanning dates and renter history must include all four bids';
  end if;
  begin
    perform public.place_listing_auction_bid(listing_id, 100, gen_random_uuid(), true, start_day, start_day + 4);
    raise exception 'A bid spanning several periods was accepted';
  exception when check_violation then
    if sqlerrm not like '%three bids%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', owner_id, 'role', 'authenticated', 'session_id', owner_session_id,
    'exp', extract(epoch from now() + interval '1 hour')
  )::text, true);
  quote := public.get_listing_auction(listing_id);
  if jsonb_array_length(quote->'owner_bids') <> 4 then
    raise exception 'Owner history must include all four bids';
  end if;
  insert into public.listings(owner_id, category_id, title, description, price_per_day, estimated_value, item_condition,
    availability_start, availability_end, auction_date_flexible)
    values(owner_id, category_id, 'Fixed limit test', 'Fixed limit test fixture', 10, 100, 'good', start_day, start_day + 30, false)
    returning id into fixed_listing_id;
  insert into public.listing_images(listing_id, url) values (fixed_listing_id, 'test.jpg');
  insert into public.listing_pickup_locations(listing_id, owner_id, address, street_address, city, state, postal_code, country, time_zone, latitude, longitude)
    values(fixed_listing_id, owner_id, '123 Test St', '123 Test St', 'Test', 'CA', '90001', 'US', 'America/Los_Angeles', 0, 0);
  update public.listings set status = 'published' where id = fixed_listing_id;
  insert into public.listing_auctions(listing_id, start_date, end_date, opening_daily_rate, starts_at, ends_at, hard_ends_at)
    values(fixed_listing_id, start_day, start_day + 2, 10, now() - interval '1 hour',
      now() + interval '1 hour', now() + interval '2 hours')
    returning id into fixed_auction_id;
  update public.listing_auctions set date_flexible = false where id = fixed_auction_id;
  insert into public.listing_auction_bids(auction_id, renter_id, daily_rate, idempotency_key)
    values (fixed_auction_id, renter_id, 10, gen_random_uuid()),
      (fixed_auction_id, renter_id, 11, gen_random_uuid()),
      (fixed_auction_id, renter_id, 12, gen_random_uuid());
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', renter_id, 'role', 'authenticated', 'session_id', session_id,
    'exp', extract(epoch from now() + interval '1 hour')
  )::text, true);
  begin
    perform public.place_listing_auction_bid(fixed_listing_id, 30, gen_random_uuid(), true, start_day, start_day + 2);
    raise exception 'A fourth fixed-date bid was accepted';
  exception when check_violation then
    if sqlerrm not like '%three bids%' then raise; end if;
  end;
  raise exception 'rollback test fixtures' using errcode = 'PZ002';
 exception when sqlstate 'PZ002' then
   null;
 end;
end;
$$;
