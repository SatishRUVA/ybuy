begin;

-- Treat the listing's final availability date as a selectable local calendar day.
-- The following local midnight is the exclusive end boundary for bidding.
create or replace function public.guard_listing_auction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_timezone text:=current_setting('TimeZone');
begin
  if tg_op='UPDATE' and exists(select 1 from public.listing_auctions where listing_id=old.id and status in ('open','owner_selection','awaiting_payment'))
    and (to_jsonb(new)-array['revision','updated_at','status'])
      is distinct from (to_jsonb(old)-array['revision','updated_at','status']) then
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
    if new.auction_bidding_starts_at is not null then
      if new.status<>'published' or not isfinite(new.auction_bidding_starts_at) or not isfinite(new.auction_bidding_ends_at)
        or new.auction_bidding_starts_at<clock_timestamp()
        or new.auction_bidding_starts_at<(new.availability_start::timestamp at time zone v_timezone)
        or new.auction_bidding_ends_at>=((new.availability_end+1)::timestamp at time zone v_timezone)
        or new.auction_bidding_ends_at<=new.auction_bidding_starts_at
        or new.auction_bidding_ends_at+interval '2 hours'>(new.auction_start_date::timestamp at time zone v_timezone) then
        raise exception 'Bidding must fit published availability and close at least 2 hours before pickup' using errcode='23514';
      end if;
    elsif new.auction_start_date::timestamp at time zone v_timezone <= clock_timestamp()+interval '26 hours' then
      raise exception 'Auction dates must fit availability and allow more than 26 hours before pickup' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

commit;
