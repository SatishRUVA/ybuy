begin;

alter table public.listing_auctions add column hard_ends_at timestamptz;
update public.listing_auctions set hard_ends_at=ends_at;
alter table public.listing_auctions alter column hard_ends_at set not null,
  add constraint listing_auctions_hard_end check(hard_ends_at>=ends_at);

-- Auction rental dates are a subset of the listing's half-open availability range.
-- Bidding starts at publication/scheduling time and closes one local calendar day
-- before the rental pickup date. The auction then automatically offers checkout
-- to the highest eligible bidder (ties go to the earliest bid).
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
      or new.auction_bidding_ends_at<=new.auction_bidding_starts_at
      or new.auction_bidding_ends_at-interval '10 minutes'<=new.auction_bidding_starts_at
      or new.auction_bidding_ends_at>((new.auction_start_date-1)::timestamp at time zone v_timezone) then
      raise exception 'Choose bidding dates that close at least one day before rental pickup' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.start_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_opens timestamptz; v_closes timestamptz;
begin
  if new.status='published' and new.auction_enabled
    and not exists(select 1 from public.listing_auctions where listing_id=new.id) then
    v_opens:=coalesce(new.auction_bidding_starts_at,clock_timestamp());
    v_closes:=new.auction_bidding_ends_at;
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled)
      or exists(select 1 from public.user_restrictions where user_id=new.owner_id)
      or v_closes is null or v_closes-interval '10 minutes'<=v_opens
      or v_closes>((new.auction_start_date-1)::timestamp at time zone current_setting('TimeZone'))
      or not public.auction_has_capacity(new.id,new.auction_start_date,new.auction_end_date) then
      raise exception 'Auction dates or inventory are no longer available' using errcode='23514';
    end if;
    insert into public.listing_auctions(listing_id,start_date,end_date,opening_daily_rate,starts_at,ends_at,selection_deadline,hard_ends_at)
      values(new.id,new.auction_start_date,new.auction_end_date,new.price_per_day,v_opens,v_closes-interval '10 minutes',v_closes,v_closes);
  end if;
  return new;
end;
$$;

-- Use a $1/day minimum increase and expose the same minimum in auction reads.
create or replace function public.place_listing_auction_bid(p_listing_id uuid,p_daily_rate numeric,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.listing_auctions; l public.listings; b public.listing_auction_bids; v_min numeric;
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
  select * into b from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if b.daily_rate<>p_daily_rate then raise exception 'This retry key belongs to a different bid' using errcode='22023';end if;
    return public.get_listing_auction(l.id);
  end if;
  if a.status<>'open' or a.starts_at>clock_timestamp() or a.ends_at<=clock_timestamp() then raise exception 'Bidding is closed' using errcode='55000';end if;
  if (select count(*) from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid())>=3 then
    raise exception 'You have used all three bids for this auction' using errcode='23514';
  end if;
  v_min:=greatest(a.opening_daily_rate,coalesce((select max(daily_rate)+1 from public.listing_auction_bids where auction_id=a.id),a.opening_daily_rate));
  if p_daily_rate<v_min then raise exception 'Bid at least $% per day',v_min using errcode='23514';end if;
  insert into public.listing_auction_bids(auction_id,renter_id,daily_rate,idempotency_key) values(a.id,auth.uid(),p_daily_rate,p_idempotency_key);
  if a.ends_at<=clock_timestamp()+interval '2 minutes' and a.ends_at<a.hard_ends_at then
    update public.listing_auctions set ends_at=least(ends_at+interval '2 minutes',hard_ends_at)
      where id=a.id returning * into a;
  end if;
  return public.get_listing_auction(l.id);
end;
$$;

create or replace function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; a public.listing_auctions;
begin
  v_result:=public.get_listing_auction_before_schedule(p_listing_id);
  if v_result is null then return null;end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  return v_result || jsonb_build_object('starts_at',a.starts_at,
    'status',case when a.status='open' and a.starts_at>clock_timestamp() then 'scheduled' else a.status end,
    'minimum_next_bid',greatest(a.opening_daily_rate,coalesce((select max(daily_rate)+1 from public.listing_auction_bids where auction_id=a.id),a.opening_daily_rate)));
end;
$$;

-- Owner approval occurs when enabling the auction. Owners can select any
-- eligible current top bid while bidding is open, which closes bidding and
-- starts the one-hour payment window. If no manual selection happens before
-- closing, the scheduler selects the highest eligible bid automatically.
create or replace function public.advance_listing_auction(p_listing_id uuid,p_selected_bid uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.listing_auctions; l public.listings; b public.listing_auction_bids; bk public.bookings;
  v_fee numeric; v_subtotal numeric; v_fee_amount numeric; v_bid uuid;
begin
  select * into l from public.listings where id=p_listing_id for update;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not found or a.status in ('completed','ended','cancelled') then return;end if;
  if a.status='awaiting_payment' then
    select * into b from public.listing_auction_bids where id=a.selected_bid_id;
    select * into bk from public.bookings where id=b.booking_id;
    if exists(select 1 from public.payments where booking_id=bk.id and status='succeeded') or bk.status in ('confirmed','active','return_pending','completed') then
      update public.listing_auctions set status='completed' where id=a.id; return;
    end if;
    if bk.status='pending_payment' and bk.checkout_expires_at>clock_timestamp() then return;end if;
    perform public.expire_listing_checkouts(p_listing_id);
    select * into bk from public.bookings where id=b.booking_id;
    if bk.checkout_session_id is not null and bk.checkout_session_closed_at is null then return;end if;
    update public.listing_auction_bids set passed=true where auction_id=a.id and renter_id=b.renter_id;
    update public.listing_auctions set selected_bid_id=null where id=a.id;
  elsif a.status='open' then
    if a.ends_at>clock_timestamp() and p_selected_bid is null then return;end if;
  end if;
  if l.status<>'published' or exists(select 1 from public.user_restrictions where user_id=l.owner_id) then
    update public.listing_auctions set status='cancelled' where id=a.id;return;
  end if;
  if not public.auction_has_capacity(l.id,a.start_date,a.end_date) then
    update public.listing_auctions set status='ended',selected_bid_id=null where id=a.id;return;
  end if;
  select bid.id into v_bid from public.listing_auction_bids bid
    where bid.auction_id=a.id and not bid.passed
      and not exists(select 1 from public.user_restrictions where user_id=bid.renter_id)
      and exists(select 1 from public.profiles where id=bid.renter_id)
      and not exists(select 1 from public.listing_auction_bids newer where newer.auction_id=a.id and newer.renter_id=bid.renter_id and newer.daily_rate>bid.daily_rate)
    order by bid.daily_rate desc,bid.created_at,bid.id limit 1;
  if v_bid is null then update public.listing_auctions set status='ended',selected_bid_id=null where id=a.id;return;end if;
  select * into b from public.listing_auction_bids where id=v_bid;
  update public.listing_auctions set selected_bid_id=b.id,status='awaiting_payment' where id=a.id;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='platform_fee_pct'),0.10) into v_fee;
  v_subtotal:=round(b.daily_rate*(a.end_date-a.start_date),2); v_fee_amount:=round(v_subtotal*v_fee,2);
  insert into public.bookings(listing_id,renter_id,owner_id,start_date,end_date,quantity,status,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,auction_bid_id)
    values(l.id,b.renter_id,l.owner_id,a.start_date,a.end_date,1,'pending_payment',b.daily_rate,a.end_date-a.start_date,v_subtotal,v_fee,v_fee_amount,l.deposit,v_subtotal+v_fee_amount+l.deposit,b.id)
    returning * into bk;
  update public.listing_auction_bids set booking_id=bk.id where id=b.id;
  perform public.create_notification(b.renter_id,'auction-winner:'||b.id,'bookings','You have the winning bid','Complete payment within one hour to secure the rental.','/confirmation/'||bk.id);
end;
$$;

-- Owners can select any eligible current top bid while bidding is open.
create or replace function public.select_listing_auction_winner(p_listing_id uuid,p_bid_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auction public.listing_auctions;
begin
  perform public.operations_require_session();
  perform 1 from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Only the listing owner can advance this auction' using errcode='42501';end if;
  select * into v_auction from public.listing_auctions where listing_id=p_listing_id for update;
  if not found or v_auction.status not in ('open','owner_selection') or p_bid_id is null then
    raise exception 'Winner selection is not open' using errcode='55000';
  end if;
  perform public.advance_listing_auction(p_listing_id,p_bid_id);
  return public.get_listing_auction(p_listing_id);
end;
$$;

notify pgrst,'reload schema';
commit;
