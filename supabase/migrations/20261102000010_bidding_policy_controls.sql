begin;

insert into public.app_settings(key,value,value_type,min_value,max_value,description,is_public) values
  ('auction_owner_decision_hours','1','integer',1,24,'Hours an owner has to select an eligible bidder after bidding closes.',false),
  ('auction_winner_payment_hours','1','integer',1,72,'Hours a selected renter has to complete auction payment.',false),
  ('auction_max_opening_daily_rate','100000','number',0.01,100000,'Maximum owner-set auction starting bid per day.',false)
on conflict(key) do nothing;

alter table public.listings add column auction_opening_daily_rate numeric(10,2)
  check(auction_opening_daily_rate between 0.01 and 100000);

alter function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb)
  rename to owner_configure_listing_negotiation_before_policy_controls;
revoke all on function public.owner_configure_listing_negotiation_before_policy_controls(uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated;

create function public.owner_configure_listing_negotiation(
  p_listing_id uuid,p_revision bigint,p_offers jsonb,p_auction jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_listing public.listings;
  v_revision bigint;
  v_opening numeric;
  v_maximum numeric;
  v_auction jsonb:=p_auction;
  v_result jsonb;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings
    where id=p_listing_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if v_listing.status<>'published' then
    raise exception 'Publish your listing before configuring negotiation' using errcode='23514';
  end if;
  if jsonb_typeof(p_auction) is distinct from 'object'
    or (p_auction ? 'opening_daily_rate' and jsonb_typeof(p_auction->'opening_daily_rate') not in ('number','null')) then
    raise exception 'Invalid auction preferences' using errcode='22023';
  end if;
  select coalesce((value #>> '{}')::numeric,100000) into v_maximum
    from public.app_settings where key='auction_max_opening_daily_rate';
  v_opening:=case when p_auction->>'enabled'='true'
    then coalesce((p_auction->>'opening_daily_rate')::numeric,v_listing.auction_opening_daily_rate,v_listing.price_per_day)
    else null end;
  if v_opening is not null and (v_opening<=0 or v_opening>coalesce(v_maximum,100000)) then
    raise exception 'Starting bid must be within the configured auction price limit' using errcode='22023';
  end if;
  v_auction:=p_auction-'opening_daily_rate';
  v_revision:=p_revision;
  if v_opening is distinct from v_listing.auction_opening_daily_rate then
    update public.listings set auction_opening_daily_rate=v_opening where id=p_listing_id returning revision into v_revision;
  end if;
  v_result:=public.owner_configure_listing_negotiation_before_policy_controls(p_listing_id,v_revision,p_offers,v_auction);
  return (select jsonb_build_object('revision',revision,'status',status,'deposit',deposit) from public.listings where id=p_listing_id);
end;
$$;
revoke all on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) to authenticated;

create or replace function public.start_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_opens timestamptz;
  v_closes timestamptz;
  v_hard_end timestamptz;
  v_pickup_cutoff timestamptz;
  v_timezone text:=current_setting('TimeZone');
  v_immediate boolean:=coalesce(current_setting('ybuy.auction_start_immediately',true),'false')='true';
begin
  if new.status='published' and new.auction_enabled
    and not exists(select 1 from public.listing_auctions where listing_id=new.id) then
    v_opens:=case when v_immediate then clock_timestamp()-interval '1 second' else new.auction_bidding_starts_at end;
    v_closes:=new.auction_bidding_ends_at;
    v_pickup_cutoff:=(new.auction_start_date::timestamp at time zone v_timezone)-interval '2 hours';
    v_hard_end:=least(v_closes+interval '10 minutes',v_pickup_cutoff);
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled)
      or exists(select 1 from public.user_restrictions where user_id=new.owner_id)
      or v_opens is null or v_closes is null or (v_opens<clock_timestamp() and not v_immediate)
      or v_closes-v_opens<interval '10 minutes' or v_closes>v_pickup_cutoff
      or not public.auction_has_capacity(new.id,new.auction_start_date,new.auction_end_date) then
      raise exception 'Auction dates or inventory are no longer available' using errcode='23514';
    end if;
    insert into public.listing_auctions(
      listing_id,start_date,end_date,opening_daily_rate,starts_at,ends_at,selection_deadline,hard_ends_at
    ) values(
      new.id,new.auction_start_date,new.auction_end_date,
      coalesce(new.auction_opening_daily_rate,new.price_per_day),v_opens,v_closes,v_closes+interval '1 hour',v_hard_end
    );
  end if;
  return new;
end;
$$;

alter function public.advance_listing_auction(uuid,uuid) rename to advance_listing_auction_before_policy_controls;
revoke all on function public.advance_listing_auction_before_policy_controls(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.advance_listing_auction(p_listing_id uuid,p_selected_bid uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.listing_auctions;
  v_owner_hours integer;
  v_payment_hours integer;
  v_previous_bid uuid;
  v_booking_id uuid;
  v_deadline timestamptz;
begin
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key='auction_owner_decision_hours'),1),
         coalesce((select (value #>> '{}')::integer from public.app_settings where key='auction_winner_payment_hours'),1)
    into v_owner_hours,v_payment_hours;
  perform 1 from public.listings where id=p_listing_id for update;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not found or a.status in ('completed','ended','cancelled') then return;end if;
  v_previous_bid:=a.selected_bid_id;
  if a.status='open' then
    if p_selected_bid is null and a.ends_at>clock_timestamp() then return;end if;
    if p_selected_bid is null then
      update public.listing_auctions set status='owner_selection'
        where id=a.id returning * into a;
      update public.listing_auctions set selection_deadline=ends_at+make_interval(hours=>v_owner_hours)
        where id=a.id returning * into a;
      perform public.create_notification((select owner_id from public.listings where id=p_listing_id),
        'auction-selection:'||a.id,'bookings','Choose your auction winner',
        'Bidding is closed. Select a bidder before your decision deadline.','/bidding');
    else
      update public.listing_auctions set status='owner_selection'
        where id=a.id returning * into a;
      update public.listing_auctions set selection_deadline=clock_timestamp()+make_interval(hours=>v_owner_hours)
        where id=a.id returning * into a;
    end if;
  end if;
  if a.status='owner_selection' and a.selection_deadline>clock_timestamp() and p_selected_bid is null then return;end if;
  if p_selected_bid is not null and (a.status<>'owner_selection' or a.selection_deadline<=clock_timestamp()) then
    raise exception 'The owner selection deadline has passed' using errcode='55000';
  end if;
  perform public.advance_listing_auction_before_policy_controls(p_listing_id,p_selected_bid);
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  if a.status='awaiting_payment' and a.selected_bid_id is distinct from v_previous_bid then
    select booking_id into v_booking_id from public.listing_auction_bids where id=a.selected_bid_id;
    select checkout_expires_at into v_deadline from public.bookings where id=v_booking_id;
    update public.bookings set checkout_expires_at=clock_timestamp()+make_interval(hours=>v_payment_hours)
      where id=v_booking_id and status='pending_payment';
    update public.notifications set body='Complete verified payment by '||to_char(clock_timestamp()+make_interval(hours=>v_payment_hours),'Mon DD, HH12:MI AM TZ')||' to secure the rental.'
      where event_key='auction-winner:'||a.selected_bid_id;
  end if;
end;
$$;
revoke all on function public.advance_listing_auction(uuid,uuid) from public,anon,authenticated;
grant execute on function public.advance_listing_auction(uuid,uuid) to service_role;

create or replace function public.select_listing_auction_winner(p_listing_id uuid,p_bid_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.listing_auctions;
begin
  perform public.operations_require_session();
  if public.is_current_user_restricted() then raise exception 'This account is restricted' using errcode='42501';end if;
  perform 1 from public.listings where id=p_listing_id and owner_id=auth.uid() and status='published' for update;
  if not found then raise exception 'Only the listing owner can select a winner' using errcode='42501';end if;
  if not exists(select 1 from public.feature_flags where key='bidding' and enabled) then
    raise exception 'Bidding is not enabled' using errcode='55000';
  end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not found or p_bid_id is null
    or not ((a.status='open' and a.ends_at>clock_timestamp())
      or (a.status='owner_selection' and a.selection_deadline>clock_timestamp())) then
    raise exception 'Winner selection is not open' using errcode='55000';
  end if;
  if not exists(select 1 from public.listing_auction_ranked_bids(a.id) where bid_id=p_bid_id) then
    raise exception 'Select an eligible current bid' using errcode='22023';
  end if;
  perform public.advance_listing_auction(p_listing_id,p_bid_id);
  return public.get_listing_auction(p_listing_id);
end;
$$;
revoke all on function public.select_listing_auction_winner(uuid,uuid) from public,anon;
grant execute on function public.select_listing_auction_winner(uuid,uuid) to authenticated;

alter function public.get_listing_auction(uuid) rename to get_listing_auction_before_policy_controls;
revoke all on function public.get_listing_auction_before_policy_controls(uuid) from public,anon,authenticated;
create function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_bids jsonb;
  a public.listing_auctions;
  v_owner uuid;
  v_owner_hours integer;
  v_payment_hours integer;
  v_missed integer;
  v_can_select boolean;
begin
  v_result:=public.get_listing_auction_before_policy_controls(p_listing_id);
  if v_result is null then return null;end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  select owner_id into v_owner from public.listings where id=p_listing_id;
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key='auction_owner_decision_hours'),1),
         coalesce((select (value #>> '{}')::integer from public.app_settings where key='auction_winner_payment_hours'),1)
    into v_owner_hours,v_payment_hours;
  select count(*)::integer into v_missed from public.listing_auctions missed
    join public.listings listing on listing.id=missed.listing_id
    where listing.owner_id=v_owner and missed.owner_decision_missed_at is not null;
  v_can_select:=(a.status='open' and a.ends_at>clock_timestamp())
    or (a.status='owner_selection' and a.selection_deadline>clock_timestamp());
  if auth.uid()=v_owner and jsonb_typeof(v_result->'owner_bids')='array' then
    select coalesce(jsonb_agg(bid||jsonb_build_object(
      'eligible',coalesce((bid->>'is_current')::boolean,false) and v_can_select
    ) order by (bid->>'submitted_at')::timestamptz,bid->>'id'),'[]'::jsonb)
      into v_bids from jsonb_array_elements(v_result->'owner_bids') bid;
    v_result:=jsonb_set(v_result,'{owner_bids}',v_bids,true);
  end if;
  return v_result||jsonb_build_object('owner_missed_decision_count',v_missed,
    'owner_decision_hours',v_owner_hours,'winner_payment_hours',v_payment_hours);
end;
$$;
revoke all on function public.get_listing_auction(uuid) from public;
grant execute on function public.get_listing_auction(uuid) to anon,authenticated;

notify pgrst,'reload schema';
commit;
