begin;

create or replace function public.place_listing_auction_bid(p_listing_id uuid,p_daily_rate numeric,p_idempotency_key uuid,
  p_deposit_hold_consent boolean,p_start_date date default null,p_end_date date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  if not a.date_flexible then
    if (p_start_date is not null or p_end_date is not null)
      and (p_start_date,p_end_date) is distinct from (a.start_date,a.end_date) then
      raise exception 'Fixed auctions require the owner rental dates' using errcode='22023';
    end if;
    return public.place_listing_auction_bid_before_date_bids(p_listing_id,p_daily_rate,p_idempotency_key,p_deposit_hold_consent);
  end if;
  if l.deposit>0 and p_deposit_hold_consent is not true then
    raise exception 'Consent to the temporary security-deposit authorization is required to bid' using errcode='42501';
  end if;
  if p_idempotency_key is null or p_daily_rate is null or p_daily_rate::text in ('NaN','Infinity','-Infinity')
    or p_daily_rate<=0 or p_daily_rate>100000 or p_daily_rate<>round(p_daily_rate,2) then
    raise exception 'Enter a finite daily bid with at most two decimal places' using errcode='22023';
  end if;
  if p_start_date is null or p_end_date is null or not isfinite(p_start_date) or not isfinite(p_end_date)
    or p_start_date<a.start_date or p_end_date>a.end_date or p_end_date<=p_start_date then
    raise exception 'Bid dates must fit the auction rental window' using errcode='22023';
  end if;
  select * into b from public.listing_auction_bids
    where auction_id=a.id and renter_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if (b.daily_rate,b.start_date,b.end_date) is distinct from (p_daily_rate,p_start_date,p_end_date) then
      raise exception 'This retry key belongs to a different bid' using errcode='22023';
    end if;
    return public.get_listing_auction(l.id);
  end if;
  if a.status<>'open' or a.starts_at>clock_timestamp() or a.ends_at<=clock_timestamp() then
    raise exception 'Bidding is closed' using errcode='55000';
  end if;
  if (select count(*) from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid()
      and start_date<p_end_date and end_date>p_start_date)>=3 then
    raise exception 'You have used all three bids for these dates' using errcode='23514';
  end if;
  if not public.auction_has_capacity(l.id,p_start_date,p_end_date) then
    raise exception 'Auction dates are no longer available' using errcode='23P01';
  end if;
  v_min:=public.auction_range_minimum_bid(a.id,p_start_date,p_end_date);
  if p_daily_rate<v_min then raise exception 'Bid at least $% per day',v_min using errcode='23514';end if;
  insert into public.listing_auction_bids(auction_id,renter_id,daily_rate,idempotency_key,deposit_hold_consent_at,start_date,end_date)
    values(a.id,auth.uid(),p_daily_rate,p_idempotency_key,case when l.deposit>0 then clock_timestamp() end,p_start_date,p_end_date);
  if a.ends_at<=clock_timestamp()+interval '2 minutes' and a.ends_at<a.hard_ends_at then
    update public.listing_auctions set ends_at=least(ends_at+interval '2 minutes',hard_ends_at) where id=a.id;
  end if;
  return public.get_listing_auction(l.id);
end;
$$;

create or replace function public.get_listing_auction(p_listing_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb; a public.listing_auctions; v_bids jsonb;
begin
  v:=public.get_listing_auction(p_listing_id);
  if v is null then return null;end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  if p_start_date is null or p_end_date is null or not isfinite(p_start_date) or not isfinite(p_end_date)
    or p_start_date<a.start_date or p_end_date>a.end_date or p_end_date<=p_start_date then
    raise exception 'Bid dates must fit the auction rental window' using errcode='22023';
  end if;
  if a.date_flexible and p_end_date-p_start_date>30 then
    raise exception 'Auction rentals cannot exceed 30 days' using errcode='22023';
  end if;
  if not a.date_flexible then return v;end if;
  select coalesce(jsonb_agg(b order by (b->>'rank')::bigint),'[]'::jsonb) into v_bids
    from jsonb_array_elements(v->'top_bids') b
    where (b->>'start_date')::date<p_end_date and (b->>'end_date')::date>p_start_date;
  return v||jsonb_build_object('top_bids',v_bids,
    'minimum_next_bid',public.auction_range_minimum_bid(a.id,p_start_date,p_end_date),
    'my_overlapping_bid_count',(select count(*) from public.listing_auction_bids b
      where b.auction_id=a.id and b.renter_id=auth.uid()
        and b.start_date<p_end_date and b.end_date>p_start_date));
end;
$$;

commit;
