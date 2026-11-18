begin;

insert into public.app_settings(key,value,value_type,min_value,max_value,description,is_public)
values (
  'auction_minimum_increment', '1', 'number', 0.01, 1000,
  'Minimum daily-rate increase required for a new competitive bid. Applies to new bids only.',
  false
)
on conflict(key) do nothing;

alter table public.listing_auctions
  add column owner_decision_missed_at timestamptz;

create or replace function public.guard_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_timezone text:=current_setting('TimeZone');
begin
  if tg_op='UPDATE' and exists(select 1 from public.listing_auctions where listing_id=old.id and status in ('open','owner_selection','awaiting_payment'))
    and (to_jsonb(new)-array['revision','updated_at','status']) is distinct from (to_jsonb(old)-array['revision','updated_at','status']) then
    raise exception 'Auction listing terms cannot change after bidding starts' using errcode='23514';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.listing_auctions where listing_id=old.id)
    and (new.auction_enabled,new.auction_start_date,new.auction_end_date,new.auction_bidding_starts_at,new.auction_bidding_ends_at)
      is distinct from (old.auction_enabled,old.auction_start_date,old.auction_end_date,old.auction_bidding_starts_at,old.auction_bidding_ends_at) then
    raise exception 'A completed auction cannot be restarted or reconfigured' using errcode='23514';
  end if;
  if new.auction_enabled and (tg_op='INSERT' or
    (new.auction_enabled,new.auction_start_date,new.auction_end_date,new.auction_bidding_starts_at,new.auction_bidding_ends_at,new.availability_start,new.availability_end)
      is distinct from (old.auction_enabled,old.auction_start_date,old.auction_end_date,old.auction_bidding_starts_at,old.auction_bidding_ends_at,old.availability_start,old.availability_end)) then
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled) then
      raise exception 'Bidding is not enabled' using errcode='55000';
    end if;
    if new.auction_start_date is null or new.auction_end_date is null or new.availability_start is null or new.availability_end is null
      or new.auction_start_date<new.availability_start or new.auction_end_date>new.availability_end
      or new.auction_end_date<=new.auction_start_date then
      raise exception 'Auction rental dates must fit listing availability' using errcode='23514';
    end if;
    if new.auction_bidding_starts_at is null or new.auction_bidding_ends_at is null
      or new.status<>'published' or not isfinite(new.auction_bidding_starts_at) or not isfinite(new.auction_bidding_ends_at)
      or new.auction_bidding_starts_at<clock_timestamp()
      or new.auction_bidding_ends_at-new.auction_bidding_starts_at<interval '10 minutes'
      or new.auction_bidding_ends_at>(new.auction_start_date::timestamp at time zone v_timezone)-interval '2 hours' then
      raise exception 'Choose bidding dates at least 10 minutes apart that close at least 2 hours before rental pickup' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

create function public.listing_auction_ranked_bids(p_auction_id uuid)
returns table(bid_id uuid,renter_id uuid,daily_rate numeric,bid_count integer,rank bigint)
language sql stable security definer set search_path = '' as $$
  with current_bids as (
    select distinct on (b.renter_id) b.id,b.renter_id,b.daily_rate,b.created_at
    from public.listing_auction_bids b
    where b.auction_id=p_auction_id and not b.passed
      and exists(select 1 from public.profiles p where p.id=b.renter_id)
      and not exists(select 1 from public.user_restrictions r where r.user_id=b.renter_id)
    order by b.renter_id,b.daily_rate desc,b.created_at,b.id
  )
  select current_bids.id,current_bids.renter_id,current_bids.daily_rate,
    (select count(*)::integer from public.listing_auction_bids b
      where b.auction_id=p_auction_id and b.renter_id=current_bids.renter_id),
    row_number() over(order by current_bids.daily_rate desc,current_bids.created_at,current_bids.id)
  from current_bids
$$;
revoke all on function public.listing_auction_ranked_bids(uuid) from public,anon,authenticated;

create or replace function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_top_bids jsonb;
  v_my_bids jsonb;
  v_owner_bids jsonb;
  v_my_rank bigint;
  v_increment numeric;
  v_minimum_next numeric;
  v_selected_renter uuid;
  v_selected_booking public.bookings;
  v_payment_status text;
  a public.listing_auctions;
  l public.listings;
begin
  v_result:=public.get_listing_auction_before_schedule(p_listing_id);
  if v_result is null then return null;end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  select * into l from public.listings where id=p_listing_id;

  select greatest(0.01,round(coalesce((s.value #>> '{}')::numeric,1),2))
    into v_increment from (select 1) seed
    left join public.app_settings s on s.key='auction_minimum_increment';
  v_minimum_next:=greatest(a.opening_daily_rate,coalesce(
    (select max(daily_rate)+v_increment from public.listing_auction_bids where auction_id=a.id),
    a.opening_daily_rate));

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',ranked.bid_id,'rank',ranked.rank,'daily_rate',ranked.daily_rate,'bid_count',ranked.bid_count
    ) order by ranked.rank),'[]'::jsonb)
    into v_top_bids
    from public.listing_auction_ranked_bids(a.id) ranked
    where ranked.rank<=3;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',bid.id,'daily_rate',bid.daily_rate,'submitted_at',bid.created_at,'bid_count',counts.bid_count,
      'passed',bid.passed,'is_current',ranked.bid_id is not null,'rank',ranked.rank,
      'selected',bid.id=a.selected_bid_id
    ) order by bid.created_at desc,bid.id),'[]'::jsonb)
    into v_my_bids
    from public.listing_auction_bids bid
    cross join lateral (
      select count(*)::integer bid_count from public.listing_auction_bids
      where auction_id=a.id and renter_id=bid.renter_id
    ) counts
    left join public.listing_auction_ranked_bids(a.id) ranked on ranked.bid_id=bid.id
    where bid.auction_id=a.id and bid.renter_id=auth.uid();

  select ranked.rank into v_my_rank
    from public.listing_auction_ranked_bids(a.id) ranked where ranked.renter_id=auth.uid();

  if l.owner_id=auth.uid() then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',bid.id,'daily_rate',bid.daily_rate,'submitted_at',bid.created_at,'bid_count',counts.bid_count,
        'passed',bid.passed,'is_current',ranked.bid_id is not null,'rank',ranked.rank,
        'selected',bid.id=a.selected_bid_id,
        'eligible',ranked.bid_id is not null and a.status in ('open','owner_selection')
          and a.ends_at<=clock_timestamp() and a.selection_deadline>clock_timestamp(),
        'renter',jsonb_build_object(
          'id',profile.id,'full_name',profile.full_name,'avatar_url',profile.avatar_url,
          'rating',reviews.rating,'review_count',reviews.review_count
        )
      ) order by bid.created_at desc,bid.id),'[]'::jsonb)
      into v_owner_bids
      from public.listing_auction_bids bid
      join public.profiles profile on profile.id=bid.renter_id
      cross join lateral (
        select count(*)::integer bid_count from public.listing_auction_bids
        where auction_id=a.id and renter_id=bid.renter_id
      ) counts
      cross join lateral (
        select avg(review.rating)::numeric(3,2) rating,count(*)::integer review_count
        from public.reviews review where review.reviewee_id=profile.id
      ) reviews
      left join public.listing_auction_ranked_bids(a.id) ranked on ranked.bid_id=bid.id
      where bid.auction_id=a.id;
  end if;

  select bid.renter_id into v_selected_renter
    from public.listing_auction_bids bid where bid.id=a.selected_bid_id;
  select booking.* into v_selected_booking
    from public.listing_auction_bids bid
    join public.bookings booking on booking.id=bid.booking_id
    where bid.id=a.selected_bid_id;
  if a.selected_bid_id is not null and (l.owner_id=auth.uid() or v_selected_renter=auth.uid()) then
    v_payment_status:=case
      when exists(select 1 from public.payments payment where payment.booking_id=v_selected_booking.id and payment.status='succeeded')
        or v_selected_booking.status in ('confirmed','active','return_pending','completed') then 'paid'
      when v_selected_booking.status is distinct from 'pending_payment'
        or v_selected_booking.checkout_expires_at<=clock_timestamp() then 'expired'
      else 'pending'
    end;
  end if;

  return v_result || jsonb_build_object(
    'starts_at',a.starts_at,
    'status',case when a.status='open' and a.starts_at>clock_timestamp() then 'scheduled' else a.status end,
    'server_now',clock_timestamp(),
    'minimum_increment',v_increment,
    'minimum_next_bid',v_minimum_next,
    'top_bids',v_top_bids,
    'my_bid_count',(select count(*)::integer from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid()),
    'my_bids',v_my_bids,
    'my_rank',v_my_rank,
    'owner_bids',case when l.owner_id=auth.uid() then v_owner_bids else null end,
    'selected_payment_status',v_payment_status,
    'owner_decision_missed_at',a.owner_decision_missed_at
  );
end;
$$;
revoke all on function public.get_listing_auction(uuid) from public;
grant execute on function public.get_listing_auction(uuid) to anon,authenticated;

create or replace function public.place_listing_auction_bid(p_listing_id uuid,p_daily_rate numeric,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.listing_auctions;
  l public.listings;
  b public.listing_auction_bids;
  v_increment numeric;
  v_min numeric;
begin
  perform public.operations_require_session();
  if public.is_current_user_restricted() then raise exception 'This account is restricted from bidding' using errcode='42501';end if;
  select * into l from public.listings where id=p_listing_id for update;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not found or l.status<>'published' or l.owner_id=auth.uid()
    or exists(select 1 from public.user_restrictions where user_id=l.owner_id)
    or not exists(select 1 from public.feature_flags where key='bidding' and enabled) then
    raise exception 'Bidding is unavailable for this listing or account' using errcode='42501';
  end if;
  if p_idempotency_key is null or p_daily_rate is null or p_daily_rate::text in ('NaN','Infinity','-Infinity')
    or p_daily_rate<=0 or p_daily_rate>100000 or p_daily_rate<>round(p_daily_rate,2) then
    raise exception 'Enter a finite daily bid with at most two decimal places' using errcode='22023';
  end if;
  select * into b from public.listing_auction_bids
    where auction_id=a.id and renter_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if b.daily_rate<>p_daily_rate then raise exception 'This retry key belongs to a different bid' using errcode='22023';end if;
    return public.get_listing_auction(l.id);
  end if;
  if a.status<>'open' or a.starts_at>clock_timestamp() or a.ends_at<=clock_timestamp() then
    raise exception 'Bidding is closed' using errcode='55000';
  end if;
  if (select count(*) from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid())>=3 then
    raise exception 'You have used all three bids for this auction' using errcode='23514';
  end if;
  select greatest(0.01,round(coalesce((s.value #>> '{}')::numeric,1),2))
    into v_increment from (select 1) seed
    left join public.app_settings s on s.key='auction_minimum_increment';
  v_min:=greatest(a.opening_daily_rate,coalesce(
    (select max(daily_rate)+v_increment from public.listing_auction_bids where auction_id=a.id),
    a.opening_daily_rate));
  if p_daily_rate<v_min then raise exception 'Bid at least $% per day',v_min using errcode='23514';end if;
  insert into public.listing_auction_bids(auction_id,renter_id,daily_rate,idempotency_key)
    values(a.id,auth.uid(),p_daily_rate,p_idempotency_key);
  if a.ends_at<=clock_timestamp()+interval '2 minutes' and a.ends_at<a.hard_ends_at then
    update public.listing_auctions
      set ends_at=least(ends_at+interval '2 minutes',hard_ends_at)
      where id=a.id;
  end if;
  return public.get_listing_auction(l.id);
end;
$$;
revoke all on function public.place_listing_auction_bid(uuid,numeric,uuid) from public,anon;
grant execute on function public.place_listing_auction_bid(uuid,numeric,uuid) to authenticated;

alter function public.advance_listing_auction(uuid,uuid) rename to advance_listing_auction_before_completion;
revoke all on function public.advance_listing_auction_before_completion(uuid,uuid) from public,anon,authenticated,service_role;

create function public.advance_listing_auction(p_listing_id uuid,p_selected_bid uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.listing_auctions;
begin
  perform 1 from public.listings where id=p_listing_id for update;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not found then return;end if;
  if a.status='open' then
    if a.ends_at>clock_timestamp() then return;end if;
    update public.listing_auctions set status='owner_selection',selection_deadline=ends_at+interval '1 hour'
      where id=a.id returning * into a;
  end if;
  if a.status='owner_selection' and a.selection_deadline>clock_timestamp() and p_selected_bid is null then return;end if;
  perform public.advance_listing_auction_before_completion(p_listing_id,p_selected_bid);
end;
$$;
revoke all on function public.advance_listing_auction(uuid,uuid) from public,anon,authenticated;

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
  if not found or a.status not in ('open','owner_selection') or a.ends_at>clock_timestamp()
    or a.ends_at+interval '1 hour'<=clock_timestamp() or p_bid_id is null then
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

create or replace function public.auction_has_capacity(p_listing_id uuid,p_start date,p_end date,p_exclude uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.listings l where l.id=p_listing_id and l.status='published'
    and p_start>=l.availability_start and p_end<=l.availability_end
    and not exists(select 1 from public.listing_availability availability where availability.listing_id=l.id
      and not availability.is_available and availability.date>=p_start and availability.date<p_end)
    and not exists(select 1 from generate_series(p_start::timestamp,(p_end-1)::timestamp,interval '1 day') day
      where (select coalesce(sum(b.quantity),0) from public.bookings b where b.listing_id=l.id
        and b.id is distinct from p_exclude and b.status in ('pending_payment','confirmed','active','return_pending')
        and (b.status<>'pending_payment' or b.checkout_expires_at>clock_timestamp())
        and b.start_date<=day::date and b.end_date>day::date)>=l.available_quantity))
$$;
revoke all on function public.auction_has_capacity(uuid,date,date,uuid) from public,anon,authenticated;

create or replace function public.guard_auction_inventory()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_auction public.listing_auctions;
  v_reserved integer;
begin
  if new.status not in ('requested','pending_payment','confirmed','active','return_pending') then return new;end if;
  perform 1 from public.listings where id=new.listing_id for update;
  select * into v_auction from public.listing_auctions where listing_id=new.listing_id
    and status in ('open','owner_selection','awaiting_payment');
  if new.auction_bid_id is not null then
    if not exists(select 1 from public.listing_auction_bids bid
      join public.listing_auctions auction on auction.id=bid.auction_id
      where bid.id=new.auction_bid_id and auction.listing_id=new.listing_id
        and auction.selected_bid_id=bid.id and bid.renter_id=new.renter_id and bid.daily_rate=new.daily_rate
        and auction.start_date=new.start_date and auction.end_date=new.end_date and new.quantity=1 and not bid.passed) then
      raise exception 'Auction reservation does not match the selected bid' using errcode='23514';
    end if;
  elsif found and new.start_date<v_auction.end_date and new.end_date>v_auction.start_date then
    v_reserved:=case when v_auction.status='awaiting_payment' and not exists(
      select 1 from public.listing_auction_bids bid join public.bookings booking on booking.id=bid.booking_id
      where bid.id=v_auction.selected_bid_id
        and booking.status in ('pending_payment','confirmed','active','return_pending')
        and (booking.status<>'pending_payment' or booking.checkout_expires_at>clock_timestamp())
    ) then 1 else 0 end;
    if exists(select 1 from generate_series(greatest(new.start_date,v_auction.start_date)::timestamp,
      (least(new.end_date,v_auction.end_date)-1)::timestamp,interval '1 day') day
      where (select coalesce(sum(booking.quantity),0) from public.bookings booking
        where booking.listing_id=new.listing_id and booking.id<>new.id
          and booking.status in ('requested','pending_payment','confirmed','active','return_pending')
          and (booking.status<>'pending_payment' or booking.checkout_expires_at>clock_timestamp())
          and booking.start_date<=day::date and booking.end_date>day::date)+new.quantity+v_reserved>
        (select available_quantity from public.listings where id=new.listing_id)) then
      raise exception 'This rental period no longer has enough available inventory' using errcode='23P01';
    end if;
  end if;
  return new;
end;
$$;

create function public.close_auction_for_confirmed_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.auction_bid_id is not null or new.status not in ('confirmed','active','return_pending','completed') then return new;end if;
  if tg_op='UPDATE' then
    if old.status is not distinct from new.status then return new;end if;
  end if;
  update public.listing_auctions set status='ended'
    where listing_id=new.listing_id and status in ('open','owner_selection')
      and start_date<new.end_date and end_date>new.start_date;
  return new;
end;
$$;
revoke all on function public.close_auction_for_confirmed_booking() from public,anon,authenticated;
create trigger close_auction_for_confirmed_booking
  after insert or update of status on public.bookings
  for each row execute function public.close_auction_for_confirmed_booking();

create function public.record_missed_auction_decision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status='open' and new.status='owner_selection' then
    new.selection_deadline:=old.ends_at+interval '1 hour';
  elsif old.status='owner_selection' and new.status<>old.status
    and old.selection_deadline<=clock_timestamp() and new.owner_decision_missed_at is null then
    new.owner_decision_missed_at:=clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.record_missed_auction_decision() from public,anon,authenticated;
create trigger record_missed_auction_decision
  before update on public.listing_auctions
  for each row execute function public.record_missed_auction_decision();

create function public.notify_missed_auction_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l public.listings;
begin
  if old.owner_decision_missed_at is null and new.owner_decision_missed_at is not null then
    select * into strict l from public.listings where id=new.listing_id;
    perform public.create_auction_in_app_notification(l.owner_id,'auction-decision-missed:'||new.id,
      'Auction decision window missed',
    'The one-hour decision window passed. The auction advanced automatically if an eligible bid remained.',
      '/bidding');
  end if;
  return new;
end;
$$;
revoke all on function public.notify_missed_auction_decision() from public,anon,authenticated;
create trigger notify_missed_auction_decision
  after update on public.listing_auctions
  for each row execute function public.notify_missed_auction_decision();

create or replace function public.start_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_opens timestamptz;
  v_closes timestamptz;
  v_hard_end timestamptz;
  v_pickup_cutoff timestamptz;
  v_timezone text:=current_setting('TimeZone');
begin
  if new.status='published' and new.auction_enabled
    and not exists(select 1 from public.listing_auctions where listing_id=new.id) then
    v_opens:=new.auction_bidding_starts_at;
    v_closes:=new.auction_bidding_ends_at;
    v_pickup_cutoff:=(new.auction_start_date::timestamp at time zone v_timezone)-interval '2 hours';
    v_hard_end:=least(v_closes+interval '10 minutes',v_pickup_cutoff);
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled)
      or exists(select 1 from public.user_restrictions where user_id=new.owner_id)
      or v_opens is null or v_closes is null or v_opens<clock_timestamp()
      or v_closes-v_opens<interval '10 minutes' or v_closes>v_pickup_cutoff
      or not public.auction_has_capacity(new.id,new.auction_start_date,new.auction_end_date) then
      raise exception 'Auction dates or inventory are no longer available' using errcode='23514';
    end if;
    insert into public.listing_auctions(
      listing_id,start_date,end_date,opening_daily_rate,starts_at,ends_at,selection_deadline,hard_ends_at
    ) values(
      new.id,new.auction_start_date,new.auction_end_date,new.price_per_day,
      v_opens,v_closes,v_closes+interval '1 hour',v_hard_end
    );
  end if;
  return new;
end;
$$;

notify pgrst,'reload schema';
commit;
