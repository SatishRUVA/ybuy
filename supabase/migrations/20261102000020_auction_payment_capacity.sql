begin;

create or replace function public.confirm_booking_payment_before_auctions(
  p_booking_id uuid,p_checkout_session_id text,p_payment_intent_id text,p_amount numeric
)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_listing public.listings; v_reason text; v_existing public.checkout_payment_exceptions;
begin
  select l.* into v_listing from public.listings l join public.bookings b on b.listing_id=l.id where b.id=p_booking_id for update of l;
  if not found then raise exception 'Booking not found'; end if;
  perform public.expire_listing_checkouts(v_listing.id);
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if p_amount is null or p_amount<>v_booking.total or p_amount<=0
    or coalesce(p_checkout_session_id,'') not like 'cs_%' or coalesce(p_payment_intent_id,'') not like 'pi_%'
    or (v_booking.checkout_session_id is not null and v_booking.checkout_session_id<>p_checkout_session_id) then
    raise exception 'Payment details do not match the booking' using errcode='23514';
  end if;
  select * into v_existing from public.checkout_payment_exceptions where checkout_session_id=p_checkout_session_id;
  if found then
    if v_existing.booking_id<>p_booking_id or v_existing.payment_intent_id<>p_payment_intent_id or v_existing.amount<>p_amount then
      raise exception 'Payment receipt conflicts with recorded exception' using errcode='23514';
    end if;
    return v_booking;
  end if;
  if exists(select 1 from public.payments where stripe_checkout_session_id=p_checkout_session_id) then
    return public.confirm_booking_payment_before_reservations(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount);
  end if;
  if v_booking.status not in ('pending_payment','cancelled') or
    (v_booking.status='cancelled' and v_booking.checkout_expired_at is null) then
    v_reason:='Payment arrived after this booking stopped awaiting payment.';
  elsif v_listing.status<>'published' then
    v_reason:='Payment arrived after the listing became unavailable.';
  elsif v_booking.auction_bid_id is not null then
    if not coalesce(public.auction_has_capacity(v_listing.id,v_booking.start_date,v_booking.end_date,v_booking.id),false) then
      v_reason:='Payment arrived after the reserved inventory was no longer available.';
    end if;
  elsif exists(select 1 from public.listing_availability a where a.listing_id=v_listing.id
    and not a.is_available and a.date>=v_booking.start_date and a.date<v_booking.end_date)
    or exists(select 1 from generate_series(v_booking.start_date::timestamp,(v_booking.end_date-1)::timestamp,interval '1 day') day
      where (select coalesce(sum(b.quantity),0) from public.bookings b where b.listing_id=v_listing.id and b.id<>p_booking_id
        and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and b.start_date<=day::date and b.end_date>day::date)+v_booking.quantity>v_listing.available_quantity) then
    v_reason:='Payment arrived after the reserved inventory was no longer available.';
  end if;
  if v_reason is not null then
    insert into public.checkout_payment_exceptions(booking_id,checkout_session_id,payment_intent_id,amount,reason)
      values(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount,v_reason);
    perform public.create_notification(v_booking.renter_id,'checkout-exception:'||p_checkout_session_id,'payments',
      'Payment requires support review','Your payment was received but could not confirm this booking. Do not pay again; contact support.','/confirmation/'||p_booking_id);
    return v_booking;
  end if;
  if v_booking.status='cancelled' and v_booking.checkout_expired_at is not null then
    if exists(select 1 from public.payments where booking_id=p_booking_id and status='succeeded') then
      raise exception 'Booking already has a successful payment' using errcode='23514';
    end if;
    insert into public.payments(booking_id,stripe_checkout_session_id,stripe_payment_intent_id,amount,status)
      values(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount,'succeeded');
    update public.bookings set status='confirmed' where id=p_booking_id returning * into v_booking;
    return v_booking;
  end if;
  return public.confirm_booking_payment_before_reservations(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount);
end;
$$;

revoke all on function public.confirm_booking_payment_before_auctions(uuid,text,text,numeric) from public,anon,authenticated,service_role;

commit;