begin;

alter table public.listings add column auction_date_flexible boolean not null default false;
alter table public.listing_auctions add column date_flexible boolean not null default false;
alter table public.listing_auction_bids
  add column start_date date,
  add column end_date date,
  add column selected_at timestamptz;
update public.listing_auction_bids b set start_date=a.start_date,end_date=a.end_date
  from public.listing_auctions a where a.id=b.auction_id;
alter table public.listing_auction_bids
  alter column start_date set not null,
  alter column end_date set not null,
  add constraint auction_bid_finite_dates check(isfinite(start_date) and isfinite(end_date) and end_date>start_date),
  add column total_value numeric generated always as (daily_rate*(end_date-start_date)) stored;
create index listing_auction_bid_dates on public.listing_auction_bids(auction_id,start_date,end_date);

create function public.initialize_auction_bid_dates()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.listing_auctions;
begin
  select * into strict a from public.listing_auctions where id=new.auction_id;
  if not a.date_flexible then
    new.start_date:=coalesce(new.start_date,a.start_date);
    new.end_date:=coalesce(new.end_date,a.end_date);
  end if;
  if new.start_date is null or new.end_date is null or not isfinite(new.start_date) or not isfinite(new.end_date)
    or new.start_date<a.start_date or new.end_date>a.end_date or new.end_date<=new.start_date
    or (not a.date_flexible and (new.start_date,new.end_date) is distinct from (a.start_date,a.end_date)) then
    raise exception 'Bid dates must fit the auction rental window' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.initialize_auction_bid_dates() from public,anon,authenticated;
create trigger auction_bid_dates before insert or update of start_date,end_date,auction_id
  on public.listing_auction_bids for each row execute function public.initialize_auction_bid_dates();

create function public.copy_listing_auction_date_mode()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select auction_date_flexible into new.date_flexible from public.listings where id=new.listing_id;
  return new;
end;
$$;
revoke all on function public.copy_listing_auction_date_mode() from public,anon,authenticated;
create trigger auction_date_mode before insert on public.listing_auctions
  for each row execute function public.copy_listing_auction_date_mode();

create function public.guard_auction_date_mode()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.auction_date_flexible is distinct from old.auction_date_flexible
    and exists(select 1 from public.listing_auctions where listing_id=new.id) then
    raise exception 'An auction cannot be restarted or reconfigured' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_auction_date_mode() from public,anon,authenticated;
create trigger a_auction_date_mode_guard before update on public.listings
  for each row execute function public.guard_auction_date_mode();

alter function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb)
  rename to owner_configure_listing_negotiation_before_date_bids;
revoke all on function public.owner_configure_listing_negotiation_before_date_bids(uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated,service_role;
create function public.owner_configure_listing_negotiation(p_listing_id uuid,p_revision bigint,p_offers jsonb,p_auction jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.listings; v_revision bigint:=p_revision; v_mode boolean;
begin
  perform public.operations_require_session();
  select * into l from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or l.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if p_auction ? 'date_flexible' and jsonb_typeof(p_auction->'date_flexible') is distinct from 'boolean' then
    raise exception 'Invalid auction preferences' using errcode='22023';
  end if;
  v_mode:=coalesce((p_auction->>'date_flexible')::boolean,l.auction_date_flexible);
  if v_mode is distinct from l.auction_date_flexible then
    update public.listings set auction_date_flexible=v_mode where id=l.id returning revision into v_revision;
  end if;
  return public.owner_configure_listing_negotiation_before_date_bids(l.id,v_revision,p_offers,p_auction-'date_flexible');
end;
$$;
revoke all on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) to authenticated;

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_date_bids;
revoke all on function public.owner_save_listing_flow_before_date_bids(uuid,bigint,jsonb,jsonb,boolean)
  from public,anon,authenticated,service_role;
create function public.owner_save_listing_flow(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.listings; v_revision bigint:=p_revision; v_mode boolean; v_details jsonb:=p_details;
begin
  if coalesce(p_details->'auction_preferences' ? 'date_flexible',false) then
    perform public.operations_require_session();
    select * into l from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
    if not found then raise exception 'Listing not found or not owned' using errcode='42501';end if;
    if p_revision is null or l.revision<>p_revision then
      raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
    end if;
    if jsonb_typeof(p_details->'auction_preferences'->'date_flexible') is distinct from 'boolean' then
      raise exception 'Invalid auction preferences' using errcode='22023';
    end if;
    v_mode:=(p_details->'auction_preferences'->>'date_flexible')::boolean;
    if v_mode is distinct from l.auction_date_flexible then
      update public.listings set auction_date_flexible=v_mode where id=l.id returning revision into v_revision;
    end if;
    v_details:=jsonb_set(p_details,'{auction_preferences}',(p_details->'auction_preferences')-'date_flexible');
  end if;
  return public.owner_save_listing_flow_before_date_bids(p_listing_id,v_revision,v_details,p_pickup,p_publish);
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

create or replace function public.listing_auction_ranked_bids(p_auction_id uuid)
returns table(bid_id uuid,renter_id uuid,daily_rate numeric,bid_count integer,rank bigint)
language sql stable security definer set search_path='' as $$
  with current_bids as (
    select distinct on (b.renter_id,case when a.date_flexible then b.start_date end,case when a.date_flexible then b.end_date end)
      b.id,b.renter_id,b.daily_rate,b.created_at,
      case when a.date_flexible then b.total_value else b.daily_rate end as value
    from public.listing_auction_bids b join public.listing_auctions a on a.id=b.auction_id
    join public.listings l on l.id=a.listing_id
    where b.auction_id=p_auction_id and not b.passed and (l.deposit<=0 or b.deposit_hold_consent_at is not null)
      and exists(select 1 from public.profiles p where p.id=b.renter_id)
      and not exists(select 1 from public.user_restrictions r where r.user_id=b.renter_id)
    order by b.renter_id,case when a.date_flexible then b.start_date end,case when a.date_flexible then b.end_date end,
      b.daily_rate desc,b.created_at,b.id
  )
  select c.id,c.renter_id,c.daily_rate,
    (select count(*)::integer from public.listing_auction_bids b where b.auction_id=p_auction_id and b.renter_id=c.renter_id),
    row_number() over(order by c.value desc,c.created_at,c.id) from current_bids c
$$;

create function public.auction_range_minimum_bid(p_auction_id uuid,p_start_date date,p_end_date date)
returns numeric language sql stable security definer set search_path='' as $$
  select greatest(a.opening_daily_rate,coalesce(
    ceil((select max(b.total_value) from public.listing_auction_bids b
      where b.auction_id=a.id and not b.passed and b.start_date<p_end_date and b.end_date>p_start_date)
      *100/(p_end_date-p_start_date)+
      greatest(0.01,round(coalesce((select (value #>> '{}')::numeric from public.app_settings
        where key='auction_minimum_increment'),1),2))*100)/100,a.opening_daily_rate))
  from public.listing_auctions a where a.id=p_auction_id and p_end_date>p_start_date
$$;
revoke all on function public.auction_range_minimum_bid(uuid,date,date) from public,anon,authenticated;

alter function public.place_listing_auction_bid(uuid,numeric,uuid,boolean)
  rename to place_listing_auction_bid_before_date_bids;
revoke all on function public.place_listing_auction_bid_before_date_bids(uuid,numeric,uuid,boolean)
  from public,anon,authenticated,service_role;
create function public.place_listing_auction_bid(p_listing_id uuid,p_daily_rate numeric,p_idempotency_key uuid,
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
  if (select count(*) from public.listing_auction_bids where auction_id=a.id and renter_id=auth.uid())>=3 then
    raise exception 'You have used all three bids for this auction' using errcode='23514';
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
revoke all on function public.place_listing_auction_bid(uuid,numeric,uuid,boolean,date,date) from public,anon;
grant execute on function public.place_listing_auction_bid(uuid,numeric,uuid,boolean,date,date) to authenticated;
create or replace function public.place_listing_auction_bid(p_listing_id uuid,p_daily_rate numeric,p_idempotency_key uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.place_listing_auction_bid(p_listing_id,p_daily_rate,p_idempotency_key,false,null,null)
$$;

create or replace function public.guard_auction_inventory()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.listing_auctions; v_reserved integer;
begin
  if new.status not in ('requested','pending_payment','confirmed','active','return_pending') then return new;end if;
  perform 1 from public.listings where id=new.listing_id for update;
  select * into a from public.listing_auctions where listing_id=new.listing_id;
  if new.auction_bid_id is not null then
    if not exists(select 1 from public.listing_auction_bids b where b.id=new.auction_bid_id
      and b.auction_id=a.id and b.renter_id=new.renter_id and b.daily_rate=new.daily_rate and not b.passed
      and b.start_date=new.start_date and b.end_date=new.end_date and new.quantity=1
      and ((a.date_flexible and b.selected_at is not null) or (not a.date_flexible and a.selected_bid_id=b.id))) then
      raise exception 'Auction reservation does not match the selected bid' using errcode='23514';
    end if;
  elsif a.status in ('open','owner_selection','awaiting_payment') and new.start_date<a.end_date and new.end_date>a.start_date then
    v_reserved:=case when not a.date_flexible and a.status='awaiting_payment' and not exists(
      select 1 from public.listing_auction_bids b join public.bookings bk on bk.id=b.booking_id
      where b.id=a.selected_bid_id and bk.status in ('pending_payment','confirmed','active','return_pending')
        and (bk.status<>'pending_payment' or bk.checkout_expires_at>clock_timestamp())) then 1 else 0 end;
    if exists(select 1 from generate_series(greatest(new.start_date,a.start_date)::timestamp,
      (least(new.end_date,a.end_date)-1)::timestamp,interval '1 day') day
      where (select coalesce(sum(bk.quantity),0) from public.bookings bk
        where bk.listing_id=new.listing_id and bk.id<>new.id
          and bk.status in ('requested','pending_payment','confirmed','active','return_pending')
          and (bk.status<>'pending_payment' or bk.checkout_expires_at>clock_timestamp())
          and bk.start_date<=day::date and bk.end_date>day::date)+new.quantity+v_reserved>
        (select available_quantity from public.listings where id=new.listing_id)) then
      raise exception 'This rental period no longer has enough available inventory' using errcode='23P01';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.close_auction_for_confirmed_booking()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.auction_bid_id is not null or new.status not in ('confirmed','active','return_pending','completed') then return new;end if;
  if tg_op='UPDATE' and old.status is not distinct from new.status then return new;end if;
  update public.listing_auctions set status='ended'
    where listing_id=new.listing_id and not date_flexible and status in ('open','owner_selection')
      and start_date<new.end_date and end_date>new.start_date;
  return new;
end;
$$;

alter function public.advance_listing_auction(uuid,uuid) rename to advance_listing_auction_before_date_bids;
revoke all on function public.advance_listing_auction_before_date_bids(uuid,uuid) from public,anon,authenticated,service_role;
create function public.advance_listing_auction(p_listing_id uuid,p_selected_bid uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.listing_auctions; l public.listings; b public.listing_auction_bids; bk public.bookings;
  candidate record; v_owner_hours integer; v_payment_hours integer; v_fee numeric; v_deadline timestamptz;
begin
  select * into l from public.listings where id=p_listing_id for update;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not found then return;end if;
  if not a.date_flexible then perform public.advance_listing_auction_before_date_bids(p_listing_id,p_selected_bid);return;end if;
  if a.status in ('completed','ended','cancelled') then return;end if;
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key='auction_owner_decision_hours'),1),
    coalesce((select (value #>> '{}')::integer from public.app_settings where key='auction_winner_payment_hours'),1),
    coalesce((select (value #>> '{}')::numeric from public.app_settings where key='platform_fee_pct'),0.10)
    into v_owner_hours,v_payment_hours,v_fee;
  if l.status<>'published' or exists(select 1 from public.user_restrictions where user_id=l.owner_id) then
    update public.listing_auctions set status='cancelled' where id=a.id;return;
  end if;
  perform public.expire_listing_checkouts(l.id);
  for b in select bid.* from public.listing_auction_bids bid join public.bookings booking on booking.id=bid.booking_id
    where bid.auction_id=a.id and bid.selected_at is not null and not bid.passed
      and booking.status not in ('confirmed','active','return_pending','completed')
      and not exists(select 1 from public.payments p where p.booking_id=booking.id and p.status='succeeded')
      and (booking.status<>'pending_payment' or booking.checkout_expires_at<=clock_timestamp())
      and (booking.checkout_session_id is null or booking.checkout_session_closed_at is not null) loop
    update public.listing_auction_bids set passed=true where id=b.id;
  end loop;
  if a.status='open' then
    if a.ends_at>clock_timestamp() and p_selected_bid is null then return;end if;
    update public.listing_auctions set status='owner_selection',
      ends_at=case when p_selected_bid is not null then least(ends_at,clock_timestamp()) else ends_at end
      where id=a.id returning * into a;
    update public.listing_auctions set selection_deadline=
      case when p_selected_bid is not null then clock_timestamp() else a.ends_at end+make_interval(hours=>v_owner_hours)
      where id=a.id returning * into a;
    perform public.create_notification(l.owner_id,'auction-selection:'||a.id,'bookings','Choose your auction winners',
      'Select eligible rental dates before the decision deadline.','/bidding');
  end if;
  if p_selected_bid is not null and (a.status<>'owner_selection' or a.selection_deadline<=clock_timestamp()) then
    raise exception 'The owner selection deadline has passed' using errcode='55000';
  end if;
  if a.status='owner_selection' and a.selection_deadline>clock_timestamp() and p_selected_bid is null then return;end if;
  for candidate in select r.bid_id from public.listing_auction_ranked_bids(a.id) r
    join public.listing_auction_bids bid on bid.id=r.bid_id
    where bid.selected_at is null and bid.booking_id is null and (p_selected_bid is null or bid.id=p_selected_bid)
    order by r.rank loop
    select * into b from public.listing_auction_bids where id=candidate.bid_id;
    v_deadline:=least(clock_timestamp()+make_interval(hours=>v_payment_hours),
      (b.start_date::timestamp at time zone current_setting('TimeZone'))-interval '1 hour');
    if v_deadline<=clock_timestamp() or not public.auction_has_capacity(l.id,b.start_date,b.end_date)
      or exists(select 1 from public.listing_auction_bids winner where winner.auction_id=a.id
        and winner.selected_at is not null and not winner.passed
        and winner.start_date<b.end_date and winner.end_date>b.start_date) then
      if p_selected_bid is not null then raise exception 'Bid dates conflict with a winner or unavailable inventory' using errcode='23P01';end if;
      continue;
    end if;
    update public.listing_auction_bids set selected_at=clock_timestamp() where id=b.id;
    insert into public.bookings(listing_id,renter_id,owner_id,start_date,end_date,quantity,status,daily_rate,
      days,subtotal,service_fee_pct,service_fee_amount,deposit,total,auction_bid_id,checkout_expires_at)
      values(l.id,b.renter_id,l.owner_id,b.start_date,b.end_date,1,'pending_payment',b.daily_rate,
        b.end_date-b.start_date,b.total_value,v_fee,round(b.total_value*v_fee,2),l.deposit,
        b.total_value+round(b.total_value*v_fee,2)+l.deposit,b.id,v_deadline) returning * into bk;
    update public.bookings set checkout_expires_at=v_deadline where id=bk.id returning * into bk;
    update public.listing_auction_bids set booking_id=bk.id where id=b.id;
    perform public.create_notification(b.renter_id,'auction-winner:'||b.id,'bookings','Your rental bid was selected',
      'Complete payment before '||v_deadline::text||' to secure your selected rental dates.','/confirmation/'||bk.id);
  end loop;
  if a.status='owner_selection' and a.selection_deadline>clock_timestamp() then return;end if;
  update public.listing_auctions set status=case
    when exists(select 1 from public.listing_auction_bids bid where bid.auction_id=a.id and bid.selected_at is not null
      and not bid.passed and not exists(select 1 from public.payments p where p.booking_id=bid.booking_id and p.status='succeeded'))
      then 'awaiting_payment'
    when exists(select 1 from public.listing_auction_bids bid where bid.auction_id=a.id and bid.selected_at is not null and not bid.passed)
      then 'completed' else 'ended' end
    where id=a.id;
end;
$$;
revoke all on function public.advance_listing_auction(uuid,uuid) from public,anon,authenticated;
grant execute on function public.advance_listing_auction(uuid,uuid) to service_role;

alter function public.select_listing_auction_winner(uuid,uuid) rename to select_listing_auction_winner_before_date_bids;
revoke all on function public.select_listing_auction_winner_before_date_bids(uuid,uuid) from public,anon,authenticated,service_role;
create function public.select_listing_auction_winner(p_listing_id uuid,p_bid_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.listing_auctions;
begin
  perform public.operations_require_session();
  if public.is_current_user_restricted() then raise exception 'This account is restricted' using errcode='42501';end if;
  perform 1 from public.listings where id=p_listing_id and owner_id=auth.uid() and status='published' for update;
  if not found then raise exception 'Only the listing owner can select a winner' using errcode='42501';end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not a.date_flexible then return public.select_listing_auction_winner_before_date_bids(p_listing_id,p_bid_id);end if;
  if not exists(select 1 from public.feature_flags where key='bidding' and enabled) then
    raise exception 'Bidding is not enabled' using errcode='55000';
  end if;
  if exists(select 1 from public.listing_auction_bids where id=p_bid_id and auction_id=a.id and selected_at is not null and not passed) then
    return public.get_listing_auction(p_listing_id);
  end if;
  if p_bid_id is null or not ((a.status='open' and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp())
    or (a.status='owner_selection' and a.selection_deadline>clock_timestamp())) then
    raise exception 'Winner selection is not open' using errcode='55000';
  end if;
  if not exists(select 1 from public.listing_auction_ranked_bids(a.id) r
    join public.listing_auction_bids b on b.id=r.bid_id where r.bid_id=p_bid_id and b.selected_at is null and b.booking_id is null) then
    raise exception 'Select an eligible current bid' using errcode='22023';
  end if;
  perform public.advance_listing_auction(p_listing_id,p_bid_id);
  return public.get_listing_auction(p_listing_id);
end;
$$;
revoke all on function public.select_listing_auction_winner(uuid,uuid) from public,anon;
grant execute on function public.select_listing_auction_winner(uuid,uuid) to authenticated;

create or replace function public.confirm_booking_payment(p_booking_id uuid,p_checkout_session_id text,p_payment_intent_id text,p_amount numeric)
returns public.bookings language plpgsql security definer set search_path='' as $$
declare b public.bookings; v_selected uuid; a public.listing_auctions; v_existing public.checkout_payment_exceptions;
begin
  perform 1 from public.listings where id=(select listing_id from public.bookings where id=p_booking_id) for update;
  select * into b from public.bookings where id=p_booking_id for update;
  if b.auction_bid_id is not null then
    select * into a from public.listing_auctions where listing_id=b.listing_id;
    if a.date_flexible then
      select id into v_selected from public.listing_auction_bids
        where id=b.auction_bid_id and auction_id=a.id and booking_id=b.id and selected_at is not null and not passed;
    else v_selected:=a.selected_bid_id;end if;
    if b.auction_bid_id is distinct from v_selected then
      if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>b.total
        or b.checkout_session_id is distinct from p_checkout_session_id or coalesce(p_payment_intent_id,'') not like 'pi_%' then
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

alter function public.get_listing_auction(uuid) rename to get_listing_auction_before_date_bids;
revoke all on function public.get_listing_auction_before_date_bids(uuid) from public,anon,authenticated,service_role;
create function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb; a public.listing_auctions; v_owner uuid; v_top jsonb; v_my jsonb; v_owner_bids jsonb; v_booking public.bookings;
begin
  v:=public.get_listing_auction_before_date_bids(p_listing_id);
  if v is null then return null;end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  select owner_id into v_owner from public.listings where id=p_listing_id;
  with bids as (
    select b.*,r.rank,r.bid_id is not null as is_current,
      jsonb_build_object('start_date',b.start_date,'end_date',b.end_date,'total_value',b.total_value,
        'selected',case when a.date_flexible then b.selected_at is not null and not b.passed else b.id=a.selected_bid_id end,
        'payment_status',case when bk.id is null then null
          when exists(select 1 from public.payments p where p.booking_id=bk.id and p.status='succeeded') then 'paid'
          when bk.status<>'pending_payment' or bk.checkout_expires_at<=clock_timestamp() or b.passed then 'expired' else 'pending' end,
        'payment_deadline',bk.checkout_expires_at,'booking_id',bk.id) as fields
    from public.listing_auction_bids b
    left join public.listing_auction_ranked_bids(a.id) r on r.bid_id=b.id
    left join public.bookings bk on bk.id=b.booking_id where b.auction_id=a.id
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'rank',b.rank,'daily_rate',b.daily_rate,
      'bid_count',(select count(*) from bids other where other.renter_id=b.renter_id),
      'start_date',b.start_date,'end_date',b.end_date,'total_value',b.total_value,
      'selected',case when a.date_flexible then b.selected_at is not null and not b.passed else b.id=a.selected_bid_id end)
      order by b.rank),'[]'::jsonb) from bids b where b.is_current and (a.date_flexible or b.rank<=3)),
    (select coalesce(jsonb_agg(old||b.fields order by (old->>'submitted_at')::timestamptz desc),'[]'::jsonb)
      from jsonb_array_elements(v->'my_bids') old join bids b on b.id=(old->>'id')::uuid),
    (select coalesce(jsonb_agg(old||b.fields||jsonb_build_object('eligible',case when not a.date_flexible
      then (old->>'eligible')::boolean else
      b.is_current and b.selected_at is null and b.booking_id is null
      and ((a.status='open' and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp())
        or (a.status='owner_selection' and a.selection_deadline>clock_timestamp()))
      and public.auction_has_capacity(p_listing_id,b.start_date,b.end_date)
      and not exists(select 1 from bids winner where winner.selected_at is not null and not winner.passed
        and winner.start_date<b.end_date and winner.end_date>b.start_date) end) order by b.rank nulls last,b.created_at),'[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(v->'owner_bids')='array' then v->'owner_bids' else '[]'::jsonb end) old
        join bids b on b.id=(old->>'id')::uuid)
    into v_top,v_my,v_owner_bids;
  if not a.date_flexible then
    return v||jsonb_build_object('date_flexible',false,'top_bids',v_top,'my_bids',v_my,
      'owner_bids',case when auth.uid()=v_owner then v_owner_bids else null end,
      'participant_count',(select count(distinct renter_id) from public.listing_auction_bids where auction_id=a.id),
      'total_bid_count',(select count(*) from public.listing_auction_bids where auction_id=a.id));
  end if;
  select bk.* into v_booking from public.listing_auction_bids b join public.bookings bk on bk.id=b.booking_id
    where b.auction_id=a.id and b.renter_id=auth.uid() and b.selected_at is not null and not b.passed
    order by (bk.status='pending_payment') desc,b.selected_at desc limit 1;
  return v||jsonb_build_object('date_flexible',true,'minimum_next_bid',a.opening_daily_rate,
    'top_bids',v_top,'my_bids',v_my,'owner_bids',case when auth.uid()=v_owner then v_owner_bids else null end,
    'participant_count',(select count(distinct renter_id) from public.listing_auction_bids where auction_id=a.id),
    'total_bid_count',(select count(*) from public.listing_auction_bids where auction_id=a.id),
    'selected_bid_id',null,'selected_payment_status',null,'payment_deadline',null,
    'my_booking_id',v_booking.id,'my_payment_deadline',v_booking.checkout_expires_at,
    'my_payment_status',case when v_booking.id is null then null
      when exists(select 1 from public.payments p where p.booking_id=v_booking.id and p.status='succeeded') then 'paid'
      when v_booking.status<>'pending_payment' or v_booking.checkout_expires_at<=clock_timestamp() then 'expired' else 'pending' end);
end;
$$;
revoke all on function public.get_listing_auction(uuid) from public;
grant execute on function public.get_listing_auction(uuid) to anon,authenticated;

create function public.get_listing_auction(p_listing_id uuid,p_start_date date,p_end_date date)
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
  if not a.date_flexible then return v;end if;
  select coalesce(jsonb_agg(b order by (b->>'rank')::bigint),'[]'::jsonb) into v_bids
    from jsonb_array_elements(v->'top_bids') b
    where (b->>'start_date')::date<p_end_date and (b->>'end_date')::date>p_start_date;
  return v||jsonb_build_object('top_bids',v_bids,'minimum_next_bid',public.auction_range_minimum_bid(a.id,p_start_date,p_end_date));
end;
$$;
revoke all on function public.get_listing_auction(uuid,date,date) from public;
grant execute on function public.get_listing_auction(uuid,date,date) to anon,authenticated;

create or replace function public.process_auction_payment_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare v_created integer;
begin
  insert into public.notifications(user_id,event_key,category,title,body,destination,in_app_enabled)
  select bk.renter_id,'auction-payment-reminder:'||bk.id,'bookings','Payment reminder',
    left('You have 15 minutes or less to complete payment for "'||l.title||'". Check your booking for the exact deadline.',500),
    '/confirmation/'||bk.id,public.notification_preference_enabled(bk.renter_id,'bookings','in_app')
  from public.listing_auctions a
  join public.listing_auction_bids bid on bid.auction_id=a.id
    and ((a.date_flexible and bid.selected_at is not null and not bid.passed) or (not a.date_flexible and bid.id=a.selected_bid_id))
  join public.bookings bk on bk.id=bid.booking_id join public.listings l on l.id=a.listing_id
  where a.status in ('owner_selection','awaiting_payment') and bk.status='pending_payment'
    and bk.checkout_expires_at>statement_timestamp() and bk.checkout_expires_at<=statement_timestamp()+interval '15 minutes'
    and not exists(select 1 from public.payments where booking_id=bk.id and status='succeeded')
  on conflict(event_key) do nothing;
  get diagnostics v_created=row_count;
  return v_created;
end;
$$;

create or replace function public.notify_listing_auction_status()
returns trigger language plpgsql security definer set search_path='' as $$
declare l public.listings; recipient uuid; winner uuid;
begin
  select * into strict l from public.listings where id=new.listing_id;
  if new.ends_at>old.ends_at and new.status='open' then
    for recipient in select l.owner_id union select renter_id from public.listing_auction_bids where auction_id=new.id loop
      perform public.create_auction_in_app_notification(recipient,
        'auction-extended:'||new.id||':'||new.ends_at::text||':'||recipient,
        'Auction extended','A late bid extended bidding for "'||l.title||'". Check the updated deadline.',
        case when recipient=l.owner_id then '/bidding' else '/bidding/'||l.id end);
    end loop;
  end if;
  if old.status='open' and new.status<>'open' then
    for recipient in select l.owner_id union select renter_id from public.listing_auction_bids where auction_id=new.id loop
      perform public.create_auction_in_app_notification(recipient,'auction-closed:'||new.id||':'||recipient,
        case when new.status='cancelled' then 'Auction cancelled' else 'Auction ended' end,
        'Bidding for "'||l.title||'" has closed. Open Bidding to view the current result.',
        case when recipient=l.owner_id then '/bidding' else '/bidding/'||l.id end);
    end loop;
  end if;
  if new.status in ('completed','ended','cancelled') and new.status is distinct from old.status then
    if new.status='completed' then
      select renter_id into winner from public.listing_auction_bids where id=new.selected_bid_id;
    end if;
    for recipient in select distinct bid.renter_id from public.listing_auction_bids bid
      where bid.auction_id=new.id and bid.renter_id is distinct from winner
        and (not new.date_flexible or not exists(select 1 from public.listing_auction_bids selected
          where selected.auction_id=new.id and selected.renter_id=bid.renter_id and selected.selected_at is not null
            and not selected.passed and exists(select 1 from public.payments p where p.booking_id=selected.booking_id and p.status='succeeded'))) loop
      perform public.create_auction_in_app_notification(recipient,'auction-not-selected:'||new.id||':'||recipient,
        'Not selected',case when new.status='completed' then 'Other renters completed payment for "'||l.title||'".'
          else 'The auction for "'||l.title||'" ended without a completed booking.' end,'/bidding/'||l.id);
    end loop;
  end if;
  return new;
end;
$$;

notify pgrst,'reload schema';
commit;
