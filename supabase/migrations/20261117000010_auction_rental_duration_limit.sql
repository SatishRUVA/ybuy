begin;

create or replace function public.initialize_auction_bid_dates()
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
  if a.date_flexible and new.end_date-new.start_date>30 then
    raise exception 'Auction rentals cannot exceed 30 days' using errcode='22023';
  end if;
  return new;
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
  return v||jsonb_build_object('top_bids',v_bids,'minimum_next_bid',public.auction_range_minimum_bid(a.id,p_start_date,p_end_date));
end;
$$;
revoke all on function public.get_listing_auction(uuid,date,date) from public;
grant execute on function public.get_listing_auction(uuid,date,date) to anon,authenticated;

commit;
