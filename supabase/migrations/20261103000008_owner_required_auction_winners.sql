begin;

create or replace function public.record_missed_auction_decision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status in ('open','owner_selection') and new.status='ended'
    and old.ends_at<=clock_timestamp() and new.owner_decision_missed_at is null
    and not exists(select 1 from public.listing_auction_bids b where b.auction_id=new.id
      and (b.selected_at is not null or b.id=old.selected_bid_id)) then
    new.owner_decision_missed_at:=clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function public.advance_listing_auction(p_listing_id uuid,p_selected_bid uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.listing_auctions; l public.listings; b public.listing_auction_bids; bk public.bookings;
  v_owner_hours integer; v_payment_hours integer; v_fee numeric; v_deadline timestamptz;
begin
  select * into l from public.listings where id=p_listing_id for update;
  select * into a from public.listing_auctions where listing_id=p_listing_id for update;
  if not found or a.status in ('completed','ended','cancelled') then return;end if;
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key='auction_owner_decision_hours'),1),
    coalesce((select (value #>> '{}')::integer from public.app_settings where key='auction_winner_payment_hours'),1),
    coalesce((select (value #>> '{}')::numeric from public.app_settings where key='platform_fee_pct'),0.10)
    into v_owner_hours,v_payment_hours,v_fee;
  if l.status<>'published' or exists(select 1 from public.user_restrictions where user_id=l.owner_id) then
    update public.listing_auctions set status='cancelled' where id=a.id;return;
  end if;
  if not a.date_flexible then
    if p_selected_bid is not null then
      if a.status<>'open' or a.starts_at>clock_timestamp() or a.ends_at<=clock_timestamp() then
        raise exception 'Winner selection is not open' using errcode='55000';
      end if;
      perform public.advance_listing_auction_before_date_bids(p_listing_id,p_selected_bid);
      return;
    end if;
    if a.status='open' then
      if a.ends_at>clock_timestamp() then return;end if;
      update public.listing_auctions set status='ended',selected_bid_id=null where id=a.id;
      return;
    end if;
    if a.status='owner_selection' then
      update public.listing_auctions set status='ended',selected_bid_id=null where id=a.id;return;
    end if;
    if a.status='awaiting_payment' then
      select * into b from public.listing_auction_bids where id=a.selected_bid_id;
      select * into bk from public.bookings where id=b.booking_id;
      if exists(select 1 from public.payments where booking_id=bk.id and status='succeeded')
        or bk.status in ('confirmed','active','return_pending','completed') then
        update public.listing_auctions set status='completed' where id=a.id;return;
      end if;
      if bk.status='pending_payment' and bk.checkout_expires_at>clock_timestamp() then return;end if;
      perform public.expire_listing_checkouts(l.id);
      select * into bk from public.bookings where id=b.booking_id;
      if bk.checkout_session_id is not null and bk.checkout_session_closed_at is null then return;end if;
      update public.listing_auction_bids set passed=true where auction_id=a.id and renter_id=b.renter_id;
      update public.listing_auctions set status='ended',selected_bid_id=null where id=a.id;
    end if;
    return;
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
  if p_selected_bid is not null then
    if a.status<>'open' or a.starts_at>clock_timestamp() or a.ends_at<=clock_timestamp() then
      raise exception 'Winner selection is not open' using errcode='55000';
    end if;
    select bid.* into b from public.listing_auction_ranked_bids(a.id) ranked
      join public.listing_auction_bids bid on bid.id=ranked.bid_id
      where bid.id=p_selected_bid and bid.selected_at is null and bid.booking_id is null;
    if not found then raise exception 'Select an eligible current bid' using errcode='22023';end if;
    v_deadline:=least(clock_timestamp()+make_interval(hours=>v_payment_hours),
      (b.start_date::timestamp at time zone current_setting('TimeZone'))-interval '1 hour');
    if v_deadline<=clock_timestamp() or not public.auction_has_capacity(l.id,b.start_date,b.end_date)
      or exists(select 1 from public.listing_auction_bids winner where winner.auction_id=a.id
        and winner.selected_at is not null and not winner.passed
        and winner.start_date<b.end_date and winner.end_date>b.start_date) then
      raise exception 'Bid dates conflict with a winner or unavailable inventory' using errcode='23P01';
    end if;
    update public.listing_auction_bids set selected_at=clock_timestamp() where id=b.id;
    insert into public.bookings(listing_id,renter_id,owner_id,start_date,end_date,quantity,status,daily_rate,
      days,subtotal,service_fee_pct,service_fee_amount,deposit,total,auction_bid_id,checkout_expires_at)
      values(l.id,b.renter_id,l.owner_id,b.start_date,b.end_date,1,'pending_payment',b.daily_rate,
        b.end_date-b.start_date,b.total_value,v_fee,round(b.total_value*v_fee,2),l.deposit,
        b.total_value+round(b.total_value*v_fee,2)+l.deposit,b.id,v_deadline) returning * into bk;
    update public.bookings set checkout_expires_at=v_deadline where id=bk.id;
    update public.listing_auction_bids set booking_id=bk.id where id=b.id;
    perform public.create_notification(b.renter_id,'auction-winner:'||b.id,'bookings','Your rental bid was selected',
      'Complete payment before '||v_deadline::text||' to secure your selected rental dates.','/confirmation/'||bk.id);
  end if;
  if a.status='open' and a.ends_at>clock_timestamp() then return;end if;
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

create or replace function public.notify_missed_auction_decision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.owner_decision_missed_at is null and new.owner_decision_missed_at is not null then
    perform public.create_auction_in_app_notification(
      (select owner_id from public.listings where id=new.listing_id),'auction-decision-missed:'||new.id,
      'Auction decision window missed',
      'No bidder was selected before bidding closed. The auction expired without a winner.','/bidding');
  end if;
  return new;
end;
$$;

create or replace function public.record_auction_decision_rating_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.owner_decision_missed_at is not null or new.owner_decision_missed_at is null then return new;end if;
  insert into public.listing_auction_decision_events(
    listing_auction_id,listing_id,owner_id,deadline_at,detected_at,eligible_bid_count,rating_eligible,exclusion_reason)
    values(new.id,new.listing_id,(select owner_id from public.listings where id=new.listing_id),
      old.ends_at,new.owner_decision_missed_at,
      (select count(*)::integer from public.listing_auction_ranked_bids(new.id)),true,null)
    on conflict(listing_auction_id) do nothing;
  return new;
end;
$$;

create or replace function public.get_owner_rating_stats(p_owner_ids uuid[])
returns table(owner_id uuid,rating numeric,review_count integer,missed_decision_count integer,rating_adjustment numeric)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_owner_ids is null or cardinality(p_owner_ids)=0 or cardinality(p_owner_ids)>100
    or array_position(p_owner_ids,null) is not null then
    raise exception 'Choose between 1 and 100 valid owner ids' using errcode='22023';
  end if;
  return query
    with requested as (select distinct unnest(p_owner_ids) as id),
    reviews as (
      select r.reviewee_id,avg(r.rating)::numeric as average,count(*)::integer as review_count
      from public.reviews r join requested q on q.id=r.reviewee_id group by r.reviewee_id
    ), missed as (
      select e.owner_id,count(*)::integer as missed_count from public.listing_auction_decision_events e
      join requested q on q.id=e.owner_id where e.rating_eligible group by e.owner_id
    )
    select q.id,coalesce(round(r.average,2),0::numeric),coalesce(r.review_count,0),
      coalesce(m.missed_count,0),0::numeric
    from requested q left join reviews r on r.reviewee_id=q.id left join missed m on m.owner_id=q.id;
end;
$$;

create or replace function public.select_listing_auction_winner(p_listing_id uuid,p_bid_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  if exists(select 1 from public.listing_auction_bids b where b.id=p_bid_id and b.auction_id=a.id and not b.passed
    and ((a.date_flexible and b.selected_at is not null) or (not a.date_flexible and b.id=a.selected_bid_id))) then
    return public.get_listing_auction(p_listing_id);
  end if;
  if p_bid_id is null or a.status is distinct from 'open' or a.starts_at>clock_timestamp() or a.ends_at<=clock_timestamp() then
    raise exception 'Winner selection is not open' using errcode='55000';
  end if;
  if not exists(select 1 from public.listing_auction_ranked_bids(a.id) where bid_id=p_bid_id) then
    raise exception 'Select an eligible current bid' using errcode='22023';
  end if;
  perform public.advance_listing_auction(p_listing_id,p_bid_id);
  return public.get_listing_auction(p_listing_id);
end;
$$;

alter function public.get_listing_auction(uuid) rename to get_listing_auction_before_owner_required;
revoke all on function public.get_listing_auction_before_owner_required(uuid) from public,anon,authenticated,service_role;
create function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb; a public.listing_auctions; v_count integer; v_bids jsonb;
begin
  v:=public.get_listing_auction_before_owner_required(p_listing_id);
  if v is null then return null;end if;
  select * into a from public.listing_auctions where listing_id=p_listing_id;
  if a.status in ('open','owner_selection','awaiting_payment') and a.ends_at<=clock_timestamp() then
    perform public.advance_listing_auction(p_listing_id);
    select * into a from public.listing_auctions where listing_id=p_listing_id;
    v:=public.get_listing_auction_before_owner_required(p_listing_id);
  end if;
  v_count:=(v->>'owner_missed_decision_count')::integer;
  if jsonb_typeof(v->'owner_bids')='array' then
    select coalesce(jsonb_agg(b||jsonb_build_object('eligible',
      coalesce((b->>'eligible')::boolean,false) and a.status='open'
      and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp())),'[]'::jsonb)
      into v_bids from jsonb_array_elements(v->'owner_bids') b;
    v:=jsonb_set(v,'{owner_bids}',v_bids);
  end if;
  return v||jsonb_build_object('owner_decision_hours',0,'selection_deadline',a.ends_at,
    'owner_reliability_flag',coalesce(v_count,0)>0);
end;
$$;
revoke all on function public.get_listing_auction(uuid) from public;
grant execute on function public.get_listing_auction(uuid) to anon,authenticated;
alter function public.get_listing_auction(uuid,date,date) volatile;

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
  where a.status in ('open','owner_selection','awaiting_payment') and bk.status='pending_payment'
    and bk.checkout_expires_at>statement_timestamp() and bk.checkout_expires_at<=statement_timestamp()+interval '15 minutes'
    and not exists(select 1 from public.payments where booking_id=bk.id and status='succeeded')
  on conflict(event_key) do nothing;
  get diagnostics v_created=row_count;
  return v_created;
end;
$$;

notify pgrst,'reload schema';
commit;
