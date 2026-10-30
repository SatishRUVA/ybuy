begin;

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
    -- Keep inventory reserved until the previous Stripe session is known closed.
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
      and (p_selected_bid is null or bid.id=p_selected_bid)
      and not exists(select 1 from public.user_restrictions where user_id=bid.renter_id)
      and exists(select 1 from public.profiles where id=bid.renter_id)
      and not exists(select 1 from public.listing_auction_bids newer where newer.auction_id=a.id and newer.renter_id=bid.renter_id and newer.daily_rate>bid.daily_rate)
    order by bid.daily_rate desc,bid.created_at,bid.id limit 1;
  if v_bid is null then
    if p_selected_bid is not null then raise exception 'Select an eligible current bid' using errcode='22023';end if;
    update public.listing_auctions set status='ended',selected_bid_id=null where id=a.id;return;
  end if;
  select * into b from public.listing_auction_bids where id=v_bid;
  update public.listing_auctions set selected_bid_id=b.id,status='awaiting_payment' where id=a.id;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='platform_fee_pct'),0.10) into v_fee;
  v_subtotal:=round(b.daily_rate*(a.end_date-a.start_date),2); v_fee_amount:=round(v_subtotal*v_fee,2);
  insert into public.bookings(listing_id,renter_id,owner_id,start_date,end_date,quantity,status,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total,auction_bid_id)
    values(l.id,b.renter_id,l.owner_id,a.start_date,a.end_date,1,'pending_payment',b.daily_rate,a.end_date-a.start_date,v_subtotal,v_fee,v_fee_amount,l.deposit,v_subtotal+v_fee_amount+l.deposit,b.id)
    returning * into bk;
  update public.listing_auction_bids set booking_id=bk.id where id=b.id;
  perform public.create_notification(b.renter_id,'auction-winner:'||b.id,'bookings','Your rental bid was selected','Complete payment within one hour to secure the rental.','/confirmation/'||bk.id);
end;
$$;

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
  if not found or a.status not in ('open','owner_selection') or a.starts_at>clock_timestamp() or p_bid_id is null then
    raise exception 'Winner selection is not open' using errcode='55000';
  end if;
  if not exists(select 1 from jsonb_array_elements(public.get_listing_auction(p_listing_id)->'top_bids') bid
    where bid->>'id'=p_bid_id::text) then
    raise exception 'Select an eligible current top bid' using errcode='22023';
  end if;
  perform public.advance_listing_auction(p_listing_id,p_bid_id);
  return public.get_listing_auction(p_listing_id);
end;
$$;

revoke all on function public.advance_listing_auction(uuid,uuid) from public,anon,authenticated;
revoke all on function public.select_listing_auction_winner(uuid,uuid) from public,anon;
grant execute on function public.select_listing_auction_winner(uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
