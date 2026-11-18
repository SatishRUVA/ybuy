begin;

alter table public.listing_auction_bids add column deposit_hold_consent_at timestamptz;

create or replace function public.listing_auction_ranked_bids(p_auction_id uuid)
returns table(bid_id uuid,renter_id uuid,daily_rate numeric,bid_count integer,rank bigint)
language sql stable security definer set search_path = '' as $$
  with current_bids as (
    select distinct on (b.renter_id) b.id,b.renter_id,b.daily_rate,b.created_at
    from public.listing_auction_bids b
    join public.listing_auctions a on a.id=b.auction_id
    join public.listings l on l.id=a.listing_id
    where b.auction_id=p_auction_id and not b.passed
      and (l.deposit<=0 or b.deposit_hold_consent_at is not null)
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

alter function public.place_listing_auction_bid(uuid,numeric,uuid) rename to place_listing_auction_bid_before_deposit_consent;
revoke all on function public.place_listing_auction_bid_before_deposit_consent(uuid,numeric,uuid) from public,anon,authenticated;

create function public.place_listing_auction_bid(
  p_listing_id uuid,p_daily_rate numeric,p_idempotency_key uuid,p_deposit_hold_consent boolean
)
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
  if l.deposit>0 and p_deposit_hold_consent is not true then
    raise exception 'Consent to the temporary security-deposit authorization is required to bid' using errcode='42501';
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
  insert into public.listing_auction_bids(auction_id,renter_id,daily_rate,idempotency_key,deposit_hold_consent_at)
    values(a.id,auth.uid(),p_daily_rate,p_idempotency_key,case when l.deposit>0 then clock_timestamp() end);
  if a.ends_at<=clock_timestamp()+interval '2 minutes' and a.ends_at<a.hard_ends_at then
    update public.listing_auctions set ends_at=least(ends_at+interval '2 minutes',hard_ends_at) where id=a.id;
  end if;
  return public.get_listing_auction(l.id);
end;
$$;
revoke all on function public.place_listing_auction_bid(uuid,numeric,uuid,boolean) from public,anon;
grant execute on function public.place_listing_auction_bid(uuid,numeric,uuid,boolean) to authenticated;

create or replace function public.place_listing_auction_bid(p_listing_id uuid,p_daily_rate numeric,p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.place_listing_auction_bid(p_listing_id,p_daily_rate,p_idempotency_key,false)
$$;
revoke all on function public.place_listing_auction_bid(uuid,numeric,uuid) from public,anon;
grant execute on function public.place_listing_auction_bid(uuid,numeric,uuid) to authenticated;

create function public.copy_auction_bid_deposit_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.auction_bid_id is not null then
    select bid.deposit_hold_consent_at into new.deposit_hold_consent_at
      from public.listing_auction_bids bid where bid.id=new.auction_bid_id and bid.renter_id=new.renter_id;
    if new.deposit>0 and new.deposit_hold_consent_at is null then
      raise exception 'Deposit hold consent was not recorded with the winning bid' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.copy_auction_bid_deposit_consent() from public,anon,authenticated;
create trigger zzzzzzzz_bookings_auction_deposit_consent
  before insert on public.bookings for each row execute function public.copy_auction_bid_deposit_consent();

notify pgrst,'reload schema';
commit;
