begin;

insert into auth.users(id,email)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'bidding-deploy-'||n||'@example.test' from generate_series(1,3) n;
insert into auth.sessions(id,user_id)
select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.categories(id,name) values('93000000-0000-4000-8000-000000000001','Bidding deployment fixtures');
update public.feature_flags set enabled=true where key='bidding';
update public.app_settings set value='2.5' where key='auction_minimum_increment';
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end,brand,model)
select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '91000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
  'Bidding deployment camera '||n,'A camera and carrying case.',20,'draft',100,'good',0,0,
  current_date+7,current_date+14,'Sony','FX3' from generate_series(1,2) n;
insert into public.listing_images(listing_id,url,sort_order)
select id,'https://example.test/auction.png',0 from public.listings
where category_id='93000000-0000-4000-8000-000000000001';
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
select id,owner_id,'Private pickup','Dallas','TX','75201','US',0,0 from public.listings
where category_id='93000000-0000-4000-8000-000000000001';

do $$
declare
  v_listing_id constant uuid:='94000000-0000-4000-8000-000000000001';
  result jsonb;
  selected_bid uuid;
begin
  begin
    update public.listings set status='published',auction_enabled=true,
      auction_start_date=current_date+7,auction_end_date=current_date+10,
      auction_bidding_starts_at=clock_timestamp()+interval '5 minutes',
      auction_bidding_ends_at=(current_date+7)::timestamp-interval '1 hour'
    where id=v_listing_id;
    raise exception 'A bidding close less than two hours before pickup was accepted';
  exception when check_violation then
    if sqlerrm not like 'Choose bidding dates%' then raise;end if;
  end;
  update public.listings set status='published',auction_enabled=true,
    auction_start_date=current_date+7,auction_end_date=current_date+10,
    auction_bidding_starts_at=clock_timestamp()+interval '5 minutes',
    auction_bidding_ends_at=(current_date+7)::timestamp-interval '2 hours'
  where category_id='93000000-0000-4000-8000-000000000001';
  if (select count(*) from public.listing_auctions where listing_id in
    (select id from public.listings where category_id='93000000-0000-4000-8000-000000000001'))<>2 then
    raise exception 'The two-hour cutoff was rejected';
  end if;
  update public.listing_auctions set starts_at=clock_timestamp()-interval '1 minute',ends_at=clock_timestamp()+interval '1 hour'
    where listing_id in (select id from public.listings where category_id='93000000-0000-4000-8000-000000000001');
  perform set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","exp":4102444800}',true);
  result:=public.place_listing_auction_bid(v_listing_id,20,gen_random_uuid());
  if (result->>'minimum_next_bid')::numeric<>22.5 or jsonb_array_length(result->'my_bids')<>1
    or (result->>'my_rank')::integer<>1 or result->'owner_bids'<>'null'::jsonb then
    raise exception 'Bid increment, history, rank or owner-only privacy contract failed: %',result;
  end if;
  begin
    perform public.place_listing_auction_bid(v_listing_id,22,gen_random_uuid());
    raise exception 'A bid below the configured increment was accepted';
  exception when check_violation then
    if sqlerrm not like 'Bid at least%' then raise;end if;
  end;
  perform public.place_listing_auction_bid(v_listing_id,22.5,gen_random_uuid());
  perform set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000003","exp":4102444800}',true);
  result:=public.place_listing_auction_bid(v_listing_id,25,gen_random_uuid());
  if jsonb_array_length(result->'my_bids')<>1 or (result->'top_bids')::text like '%renter_id%'
    or result->'owner_bids'<>'null'::jsonb then
    raise exception 'Competing bidder privacy failed';
  end if;
  perform set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001","exp":4102444800}',true);
  result:=public.get_listing_auction(v_listing_id);
  if jsonb_array_length(result->'owner_bids')<>3
    or result->'owner_bids'->0->'renter'->>'id' is null then
    raise exception 'Owner cannot inspect full bid history and profiles';
  end if;
  select id into selected_bid from public.listing_auction_bids where daily_rate=25
    and auction_id=(select id from public.listing_auctions where listing_id=v_listing_id);
  begin
    perform public.select_listing_auction_winner(v_listing_id,selected_bid);
    raise exception 'Owner selection before bidding closed was accepted';
  exception when sqlstate '55000' then null;
  end;
  update public.listing_auctions set ends_at=clock_timestamp()-interval '1 second' where listing_id=v_listing_id;
  perform public.advance_listing_auction(v_listing_id);
  result:=public.get_listing_auction(v_listing_id);
  if result->>'status'<>'owner_selection' then raise exception 'Bidding close skipped the owner decision window';end if;
  if exists(select 1 from public.listing_auctions where listing_id=v_listing_id
    and selection_deadline<>ends_at+interval '1 hour') then
    raise exception 'Owner decision window is not exactly one hour';
  end if;
  result:=public.select_listing_auction_winner(v_listing_id,selected_bid);
  if result->>'status'<>'awaiting_payment' or result->>'selected_payment_status'<>'pending' then
    raise exception 'Selected winner did not receive pending payment checkout';
  end if;
  if not exists(select 1 from public.bookings where auction_bid_id=selected_bid
    and status='pending_payment' and daily_rate=25 and subtotal=75) then
    raise exception 'Winning booking terms or payment reservation failed';
  end if;
  perform set_config('request.jwt.claims','{}',true);
  update public.listing_auctions set ends_at=clock_timestamp()-interval '2 hours'
    where listing_id='94000000-0000-4000-8000-000000000002';
  perform public.advance_listing_auction('94000000-0000-4000-8000-000000000002');
  if not exists(select 1 from public.listing_auctions
    where listing_id='94000000-0000-4000-8000-000000000002' and status='ended' and owner_decision_missed_at is not null) then
    raise exception 'Missed owner decision was not recorded';
  end if;
  if not exists(select 1 from public.notifications where user_id='91000000-0000-4000-8000-000000000001'
    and event_key like 'auction-decision-missed:%') then
    raise exception 'Missed owner decision notification was not created';
  end if;
  if has_function_privilege('authenticated','public.advance_listing_auction_before_completion(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.listing_auction_ranked_bids(uuid)','EXECUTE') then
    raise exception 'Private auction internals are executable by clients';
  end if;
end;
$$;

select 'Bidding cutoff, increments, privacy, history, decision window, checkout and missed-decision checks passed' as result;
rollback;
