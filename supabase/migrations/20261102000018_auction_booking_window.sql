begin;

create or replace function public.enforce_booking_listing_window()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('requested','pending_payment','confirmed','active','return_pending')
    and (tg_op='INSERT' or (new.start_date,new.end_date,new.quantity,new.status,new.auction_bid_id)
      is distinct from (old.start_date,old.end_date,old.quantity,old.status,old.auction_bid_id)) then
    perform 1 from public.listings where id=new.listing_id for update;
    if new.auction_bid_id is not null then
      if not coalesce(public.auction_has_capacity(new.listing_id,new.start_date,new.end_date,new.id),false) then
        raise exception 'Auction dates are no longer available' using errcode='23P01';
      end if;
    elsif not coalesce(public.listing_has_capacity(new.listing_id,new.start_date,new.end_date,new.quantity,new.id),false) then
      raise exception 'Listing is not available for the requested dates and quantity' using errcode='23P01';
    end if;
  end if;
  return new;
end;
$$;

commit;
