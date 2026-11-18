begin;

alter table public.listings
  add column auction_enabled boolean not null default false,
  add column auction_start_date date,
  add column auction_end_date date,
  add constraint listing_auction_dates check (
    not auction_enabled or (auction_start_date is not null and auction_end_date > auction_start_date)
  );

create table public.listing_auctions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id),
  start_date date not null,
  end_date date not null check(end_date > start_date),
  opening_daily_rate numeric(10,2) not null check(opening_daily_rate > 0),
  status text not null default 'open' check(status in ('open','owner_selection','awaiting_payment','completed','ended','cancelled')),
  ends_at timestamptz not null default clock_timestamp() + interval '24 hours',
  selection_deadline timestamptz not null default clock_timestamp() + interval '25 hours',
  selected_bid_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create table public.listing_auction_bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.listing_auctions(id),
  renter_id uuid not null references public.profiles(id),
  daily_rate numeric(10,2) not null check(daily_rate > 0),
  idempotency_key uuid not null,
  passed boolean not null default false,
  booking_id uuid unique references public.bookings(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(auction_id,renter_id,idempotency_key)
);
alter table public.listing_auctions add foreign key(selected_bid_id) references public.listing_auction_bids(id);
alter table public.bookings add column auction_bid_id uuid unique references public.listing_auction_bids(id);
create index listing_auction_bid_rank on public.listing_auction_bids(auction_id,daily_rate desc,created_at,id);
alter table public.listing_auctions enable row level security;
alter table public.listing_auction_bids enable row level security;
revoke all on public.listing_auctions,public.listing_auction_bids from anon,authenticated;
grant all on public.listing_auctions,public.listing_auction_bids to service_role;

create function public.auction_has_capacity(p_listing_id uuid,p_start date,p_end date,p_exclude uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.listings l where l.id=p_listing_id and l.status='published'
    and p_start>=l.availability_start and p_end<=l.availability_end
    and not exists(select 1 from public.listing_availability a where a.listing_id=l.id
      and not a.is_available and a.date>=p_start and a.date<p_end)
    and not exists(select 1 from generate_series(p_start::timestamp,(p_end-1)::timestamp,interval '1 day') d
      where (select coalesce(sum(b.quantity),0) from public.bookings b where b.listing_id=l.id
        and b.id is distinct from p_exclude and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and (b.status<>'pending_payment' or b.checkout_expires_at>clock_timestamp())
        and b.start_date<=d::date and b.end_date>d::date)>=l.available_quantity))
$$;
revoke all on function public.auction_has_capacity(uuid,date,date,uuid) from public,anon,authenticated;

create function public.guard_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and exists(select 1 from public.listing_auctions where listing_id=old.id and status in ('open','owner_selection','awaiting_payment'))
    and (to_jsonb(new)-array['revision','updated_at','status'])
      is distinct from (to_jsonb(old)-array['revision','updated_at','status']) then
    raise exception 'Auction listing terms cannot change after bidding starts' using errcode='23514';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.listing_auctions where listing_id=old.id)
    and (new.auction_enabled,new.auction_start_date,new.auction_end_date)
      is distinct from (old.auction_enabled,old.auction_start_date,old.auction_end_date) then
    raise exception 'A completed auction cannot be restarted or reconfigured' using errcode='23514';
  end if;
  if new.auction_enabled and (tg_op='INSERT' or
    (new.auction_enabled,new.auction_start_date,new.auction_end_date)
      is distinct from (old.auction_enabled,old.auction_start_date,old.auction_end_date)) then
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled) then
      raise exception 'Bidding is not enabled' using errcode='55000';
    end if;
    if new.auction_start_date is null or new.auction_end_date is null or new.availability_start is null or new.availability_end is null
      or new.auction_start_date<new.availability_start or new.auction_end_date>new.availability_end
      or new.auction_end_date<=new.auction_start_date
      or new.auction_start_date::timestamp at time zone 'UTC' <= clock_timestamp()+interval '26 hours' then
      raise exception 'Auction dates must fit availability and allow more than 26 hours before pickup' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger c_listing_auction_guard before insert or update on public.listings
  for each row execute function public.guard_listing_auction();

create function public.start_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='published' and new.auction_enabled
    and not exists(select 1 from public.listing_auctions where listing_id=new.id) then
    if not exists(select 1 from public.feature_flags where key='bidding' and enabled)
      or exists(select 1 from public.user_restrictions where user_id=new.owner_id)
      or new.auction_start_date::timestamp at time zone 'UTC' <= clock_timestamp()+interval '26 hours'
      or not public.auction_has_capacity(new.id,new.auction_start_date,new.auction_end_date) then
      raise exception 'Auction dates or inventory are no longer available' using errcode='23514';
    end if;
    insert into public.listing_auctions(listing_id,start_date,end_date,opening_daily_rate)
      values(new.id,new.auction_start_date,new.auction_end_date,new.price_per_day);
  end if;
  return new;
end;
$$;
create trigger listing_auction_start after insert or update on public.listings
  for each row execute function public.start_listing_auction();

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_auctions;
revoke all on function public.owner_save_listing_flow_before_auctions(uuid,bigint,jsonb,jsonb,boolean) from public,anon,authenticated;
create function public.owner_save_listing_flow(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_prefs jsonb; v_enabled boolean; v_start date; v_end date; v_result jsonb;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if not coalesce(p_details ? 'auction_preferences',false) then
    return public.owner_save_listing_flow_before_auctions(p_listing_id,p_revision,p_details,p_pickup,p_publish);
  end if;
  v_prefs:=p_details->'auction_preferences';
  if jsonb_typeof(v_prefs) is distinct from 'object' or jsonb_typeof(v_prefs->'enabled') is distinct from 'boolean'
    or exists(select 1 from jsonb_object_keys(v_prefs) k where k not in ('enabled','start_date','end_date'))
    or exists(select 1 from jsonb_each(v_prefs) e where e.key in ('start_date','end_date') and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'Invalid auction preferences' using errcode='22023';
  end if;
  v_enabled:=(v_prefs->>'enabled')::boolean;
  v_start:=case when v_enabled then (v_prefs->>'start_date')::date end;
  v_end:=case when v_enabled then (v_prefs->>'end_date')::date end;
  -- Save normal terms first so auction dates are validated against the new availability.
  v_result:=public.owner_save_listing_flow_before_auctions(p_listing_id,p_revision,p_details-'auction_preferences',p_pickup,p_publish);
  if (v_enabled,v_start,v_end) is distinct from (v_listing.auction_enabled,v_listing.auction_start_date,v_listing.auction_end_date) then
    update public.listings set auction_enabled=v_enabled,auction_start_date=v_start,auction_end_date=v_end
      where id=p_listing_id;
  end if;
  select jsonb_build_object('revision',revision,'status',status,'deposit',deposit) into v_result
    from public.listings where id=p_listing_id;
  return v_result;
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

create or replace function public.set_checkout_deadline()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status='pending_payment' and (tg_op='INSERT' or old.status<>'pending_payment') then
    new.checkout_expires_at:=clock_timestamp()+case when new.auction_bid_id is not null then interval '1 hour' else interval '15 minutes' end;
    new.checkout_expired_at:=null;
  end if;
  return new;
end;
$$;

create function public.guard_auction_inventory()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_auction public.listing_auctions; v_reserved integer;
begin
  if new.status not in ('requested','pending_payment','confirmed','active','return_pending') then return new;end if;
  perform 1 from public.listings where id=new.listing_id for update;
  select * into v_auction from public.listing_auctions where listing_id=new.listing_id
    and status in ('open','owner_selection','awaiting_payment');
  if new.auction_bid_id is not null then
    if not exists(select 1 from public.listing_auction_bids b join public.listing_auctions a on a.id=b.auction_id
      where b.id=new.auction_bid_id and a.listing_id=new.listing_id and a.selected_bid_id=b.id
        and b.renter_id=new.renter_id and b.daily_rate=new.daily_rate and a.start_date=new.start_date and a.end_date=new.end_date
        and new.quantity=1 and not b.passed) then
      raise exception 'Auction reservation does not match the selected bid' using errcode='23514';
    end if;
  elsif found and new.start_date<v_auction.end_date and new.end_date>v_auction.start_date then
    v_reserved:=case when v_auction.status='awaiting_payment' and exists(
      select 1 from public.listing_auction_bids b join public.bookings bk on bk.id=b.booking_id
      where b.id=v_auction.selected_bid_id and bk.status in ('pending_payment','confirmed','active','return_pending')
        and (bk.status<>'pending_payment' or bk.checkout_expires_at>clock_timestamp())) then 0 else 1 end;
    if exists(select 1 from generate_series(greatest(new.start_date,v_auction.start_date)::timestamp,
      (least(new.end_date,v_auction.end_date)-1)::timestamp,interval '1 day') d
      where (select coalesce(sum(b.quantity),0) from public.bookings b where b.listing_id=new.listing_id and b.id<>new.id
        and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and (b.status<>'pending_payment' or b.checkout_expires_at>clock_timestamp())
        and b.start_date<=d::date and b.end_date>d::date)+new.quantity+v_reserved>
        (select available_quantity from public.listings where id=new.listing_id)) then
      raise exception 'One unit is reserved for competitive bidding on these dates' using errcode='23P01';
    end if;
  end if;
  return new;
end;
$$;
create trigger b_booking_auction_inventory before insert or update on public.bookings
  for each row execute function public.guard_auction_inventory();

create function public.set_auction_booking_totals()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.auction_bid_id is not null then
    new.owner_discount_amount:=0;
    new.owner_discount_source:='none';
    new.owner_promotion_id:=null;
    new.owner_promotion_code:=null;
    new.subtotal:=round(new.daily_rate*new.days*new.quantity,2);
    new.service_fee_amount:=round(new.subtotal*new.service_fee_pct,2);
    new.total:=new.subtotal+new.service_fee_amount+new.deposit;
  end if;
  return new;
end;
$$;
create trigger z_booking_auction_totals before insert on public.bookings
  for each row execute function public.set_auction_booking_totals();

create function public.guard_auction_related_edits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_listing_id uuid; v_old_listing_id uuid;
begin
  v_listing_id:=case when tg_op='DELETE' then old.listing_id else new.listing_id end;
  v_old_listing_id:=case when tg_op in ('UPDATE','DELETE') then old.listing_id end;
  perform 1 from public.listings where id in (v_listing_id,v_old_listing_id) order by id for update;
  if exists(select 1 from public.listing_auctions where listing_id in (v_listing_id,v_old_listing_id) and status in ('open','owner_selection','awaiting_payment')) then
    raise exception 'Photos, pickup and blocked dates cannot change during competitive bidding' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;
create trigger auction_gallery_guard before insert or update or delete on public.listing_images
  for each row execute function public.guard_auction_related_edits();
create trigger auction_pickup_guard before insert or update or delete on public.listing_pickup_locations
  for each row execute function public.guard_auction_related_edits();
create trigger auction_calendar_guard before insert or update or delete on public.listing_availability
  for each row execute function public.guard_auction_related_edits();

create function public.advance_listing_auction(p_listing_id uuid,p_selected_bid uuid default null)
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
    if exists(select 1 from public.payments where booking_id=bk.id and status='succeeded')
      or bk.status in ('confirmed','active','return_pending','completed') then
      update public.listing_auctions set status='completed' where id=a.id; return;
    end if;
    if bk.status='pending_payment' and bk.checkout_expires_at>clock_timestamp() then return;end if;
    perform public.expire_listing_checkouts(p_listing_id);
    select * into bk from public.bookings where id=b.booking_id;
    -- Do not advance while Stripe could still settle the previous winner's session.
    if bk.checkout_session_id is not null and bk.checkout_session_closed_at is null then return;end if;
    update public.listing_auction_bids set passed=true where auction_id=a.id and renter_id=b.renter_id;
    update public.listing_auctions set selected_bid_id=null where id=a.id;
  elsif a.status='open' then
    if a.ends_at>clock_timestamp() then return;end if;
    update public.listing_auctions set status='owner_selection' where id=a.id;
    perform public.create_notification(l.owner_id,'auction-selection:'||a.id,'bookings','Choose your auction winner',
      'Bidding is closed. Select a bidder before the one-hour selection deadline.','/listing/'||l.id);
    a.status:='owner_selection';
  end if;
  if l.status<>'published' or exists(select 1 from public.user_restrictions where user_id=l.owner_id) then
    update public.listing_auctions set status='cancelled' where id=a.id;return;
  end if;
  if a.status='owner_selection' and a.selection_deadline>clock_timestamp() and p_selected_bid is null then return;end if;
  if a.start_date::timestamp at time zone 'UTC'<=clock_timestamp()+interval '1 hour'
    or not public.auction_has_capacity(l.id,a.start_date,a.end_date) then
    update public.listing_auctions set status='ended',selected_bid_id=null where id=a.id;return;
  end if;
  if p_selected_bid is not null and (a.status<>'owner_selection' or a.selection_deadline<=clock_timestamp()) then
    raise exception 'The owner selection deadline has passed' using errcode='55000';
  end if;
  select bid.id into v_bid from public.listing_auction_bids bid
    where bid.auction_id=a.id and not bid.passed
      and (p_selected_bid is null or bid.id=p_selected_bid)
      and not exists(select 1 from public.user_restrictions where user_id=bid.renter_id)
      and exists(select 1 from public.profiles where id=bid.renter_id)
      and not exists(select 1 from public.listing_auction_bids newer where newer.auction_id=a.id
        and newer.renter_id=bid.renter_id and newer.daily_rate>bid.daily_rate)
    order by bid.daily_rate desc,bid.created_at,bid.id limit 1;
  if v_bid is null then
    if p_selected_bid is not null then raise exception 'Select an eligible current bid' using errcode='22023';end if;
    update public.listing_auctions set status='ended',selected_bid_id=null where id=a.id;return;
  end if;
  select * into b from public.listing_auction_bids where id=v_bid;
  update public.listing_auctions set selected_bid_id=b.id,status='awaiting_payment' where id=a.id;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='platform_fee_pct'),0.10) into v_fee;
  v_subtotal:=round(b.daily_rate*(a.end_date-a.start_date),2);
  v_fee_amount:=round(v_subtotal*v_fee,2);
  insert into public.bookings(listing_id,renter_id,owner_id,start_date,end_date,quantity,status,daily_rate,
    days,subtotal,service_fee_pct,service_fee_amount,deposit,total,auction_bid_id)
    values(l.id,b.renter_id,l.owner_id,a.start_date,a.end_date,1,'pending_payment',b.daily_rate,
      a.end_date-a.start_date,v_subtotal,v_fee,v_fee_amount,l.deposit,v_subtotal+v_fee_amount+l.deposit,b.id)
    returning * into bk;
  update public.listing_auction_bids set booking_id=bk.id where id=b.id;
  perform public.create_notification(b.renter_id,'auction-winner:'||b.id,'bookings','Your rental bid was selected',
    'Complete verified payment within one hour to secure the rental.','/confirmation/'||bk.id);
end;
$$;
revoke all on function public.advance_listing_auction(uuid,uuid) from public,anon,authenticated;

create function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.listing_auctions; l public.listings; v_bids jsonb; v_booking uuid;
begin
  select * into l from public.listings where id=p_listing_id;
  if not found or (l.status<>'published' and (l.owner_id is distinct from auth.uid() or not public.has_active_session())) then return null;end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  if not found then return null;end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'rank',rank,'daily_rate',daily_rate,'bid_count',bid_count) order by rank),'[]') into v_bids from (
    select id,daily_rate,row_number() over(order by daily_rate desc,created_at,id) as rank,
      (select count(*) from public.listing_auction_bids cnt where cnt.auction_id=a.id and cnt.renter_id=b.renter_id) as bid_count
    from public.listing_auction_bids b where auction_id=a.id and not passed
      and not exists(select 1 from public.user_restrictions where user_id=b.renter_id)
      and not exists(select 1 from public.listing_auction_bids newer where newer.auction_id=a.id and newer.renter_id=b.renter_id and newer.daily_rate>b.daily_rate)
    order by daily_rate desc,created_at,id limit 3
  ) ranked;
  select booking_id into v_booking from public.listing_auction_bids where id=a.selected_bid_id and renter_id=auth.uid();
  return jsonb_build_object('id',a.id,'listing_id',l.id,'status',a.status,'start_date',a.start_date,'end_date',a.end_date,
    'ends_at',a.ends_at,'selection_deadline',a.selection_deadline,
    'payment_deadline',(select checkout_expires_at from public.bookings where id=(select booking_id from public.listing_auction_bids where id=a.selected_bid_id)),
    'server_now',clock_timestamp(),'minimum_next_bid',greatest(a.opening_daily_rate,
      coalesce((select max(daily_rate)+5 from public.listing_auction_bids where auction_id=a.id),a.opening_daily_rate)),
    'top_bids',v_bids,'my_bid_count',(select count(*) from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid()),
    'my_daily_rate',(select max(daily_rate) from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid()),
    'my_booking_id',v_booking,'selected_bid_id',a.selected_bid_id,'is_owner',coalesce(l.owner_id=auth.uid(),false));
end;
$$;
revoke all on function public.get_listing_auction(uuid) from public;
grant execute on function public.get_listing_auction(uuid) to anon,authenticated;

create function public.place_listing_auction_bid(p_listing_id uuid,p_daily_rate numeric,p_idempotency_key uuid)
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
  if a.status<>'open' or a.ends_at<=clock_timestamp() then raise exception 'Bidding is closed' using errcode='55000';end if;
  if (select count(*) from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid())>=3 then
    raise exception 'You have used all three bids for this auction' using errcode='23514';
  end if;
  v_min:=greatest(a.opening_daily_rate,coalesce((select max(daily_rate)+5 from public.listing_auction_bids where auction_id=a.id),a.opening_daily_rate));
  if p_daily_rate<v_min then raise exception 'Bid at least $% per day',v_min using errcode='23514';end if;
  insert into public.listing_auction_bids(auction_id,renter_id,daily_rate,idempotency_key) values(a.id,auth.uid(),p_daily_rate,p_idempotency_key);
  return public.get_listing_auction(l.id);
end;
$$;
revoke all on function public.place_listing_auction_bid(uuid,numeric,uuid) from public,anon;
grant execute on function public.place_listing_auction_bid(uuid,numeric,uuid) to authenticated;

create function public.select_listing_auction_winner(p_listing_id uuid,p_bid_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.listing_auctions;
begin
  perform public.operations_require_session();
  if public.is_current_user_restricted() then raise exception 'This account is restricted' using errcode='42501';end if;
  perform 1 from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Only the listing owner can select a winner' using errcode='42501';end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not found or a.ends_at>clock_timestamp() or a.selection_deadline<=clock_timestamp()
    or a.status not in ('open','owner_selection') or p_bid_id is null then
    raise exception 'Winner selection is not open' using errcode='55000';
  end if;
  perform public.advance_listing_auction(p_listing_id,p_bid_id);
  return public.get_listing_auction(p_listing_id);
end;
$$;
revoke all on function public.select_listing_auction_winner(uuid,uuid) from public,anon;
grant execute on function public.select_listing_auction_winner(uuid,uuid) to authenticated;

create function public.process_listing_auctions()
returns integer language plpgsql security definer set search_path = '' as $$
declare l record; v_count integer:=0;
begin
  for l in select listings.id from public.listings join public.listing_auctions a on a.listing_id=listings.id
    where a.status in ('open','owner_selection','awaiting_payment') order by listings.id
    limit 100 for update of listings skip locked loop
    perform public.advance_listing_auction(l.id);v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.process_listing_auctions() from public,anon,authenticated;
grant execute on function public.process_listing_auctions() to service_role;
select cron.schedule('competitive-listing-auctions','* * * * *',$$select public.process_listing_auctions();$$);

alter function public.confirm_booking_payment(uuid,text,text,numeric) rename to confirm_booking_payment_before_auctions;
revoke all on function public.confirm_booking_payment_before_auctions(uuid,text,text,numeric) from public,anon,authenticated,service_role;
create function public.confirm_booking_payment(p_booking_id uuid,p_checkout_session_id text,p_payment_intent_id text,p_amount numeric)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_selected uuid; v_existing public.checkout_payment_exceptions;
begin
  perform 1 from public.listings where id=(select listing_id from public.bookings where id=p_booking_id) for update;
  select * into b from public.bookings where id=p_booking_id for update;
  if b.auction_bid_id is not null then
    select a.selected_bid_id into v_selected from public.listing_auctions a where listing_id=b.listing_id;
    if b.auction_bid_id is distinct from v_selected then
      if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>b.total
        or b.checkout_session_id is distinct from p_checkout_session_id
        or coalesce(p_payment_intent_id,'') not like 'pi_%' then
        raise exception 'Payment details do not match the booking' using errcode='23514';
      end if;
      select * into v_existing from public.checkout_payment_exceptions where checkout_session_id=p_checkout_session_id;
      if found then
        if v_existing.booking_id<>b.id or v_existing.payment_intent_id<>p_payment_intent_id or v_existing.amount<>p_amount then
          raise exception 'Payment receipt conflicts with recorded exception' using errcode='23514';
        end if;
        return b;
      end if;
      insert into public.checkout_payment_exceptions(booking_id,checkout_session_id,payment_intent_id,amount,reason)
        values(b.id,p_checkout_session_id,p_payment_intent_id,p_amount,'Auction payment arrived after this bidder was passed. Support review required.');
      perform public.create_notification(b.renter_id,'checkout-exception:'||p_checkout_session_id,'payments',
        'Payment requires support review','Do not pay again. Contact support to resolve this late auction payment.','/confirmation/'||b.id);
      return b;
    end if;
  end if;
  return public.confirm_booking_payment_before_auctions(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount);
end;
$$;
revoke all on function public.confirm_booking_payment(uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.confirm_booking_payment(uuid,text,text,numeric) to service_role;

revoke all on function public.guard_listing_auction(),public.start_listing_auction(),public.guard_auction_inventory(),
  public.guard_auction_related_edits(),public.set_auction_booking_totals() from public,anon,authenticated;

-- Only competitive bids are public; private rental proposals never enter this feed.
create or replace function public.get_top_listing_bids()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.daily_rate desc),'[]') from (
    select l.id as listing_id,l.title,max(b.daily_rate) as daily_rate,a.start_date,a.end_date,a.ends_at as expires_at,
      (select url from public.listing_images where listing_id=l.id order by sort_order limit 1) as image_url
    from public.listing_auctions a join public.listings l on l.id=a.listing_id
      join public.listing_auction_bids b on b.auction_id=a.id
    where l.status='published' and a.status='open' and a.ends_at>clock_timestamp()
      and not exists(select 1 from public.user_restrictions where user_id in (b.renter_id,l.owner_id))
      and exists(select 1 from public.feature_flags where key='bidding' and enabled)
    group by l.id,a.id order by max(b.daily_rate) desc,l.id limit 5
  ) t
$$;
notify pgrst,'reload schema';
commit;
