begin;

alter table public.listings alter column auction_date_flexible set default true;
alter table public.listing_auctions alter column date_flexible set default true;

-- Preserve selected rentals and historical auctions; existing bids retain their full-window dates.
alter table public.listings disable trigger a_auction_date_mode_guard;
alter table public.listings disable trigger c_listing_auction_guard;
with converted as (
  update public.listing_auctions a set date_flexible=true
  where not a.date_flexible and a.status in ('scheduled','open')
    and a.ends_at>clock_timestamp() and a.selected_bid_id is null
    and not exists(select 1 from public.listing_auction_bids b
      where b.auction_id=a.id and (b.selected_at is not null or b.booking_id is not null))
  returning listing_id
)
update public.listings set auction_date_flexible=true
where id in (select listing_id from converted);
alter table public.listings enable trigger a_auction_date_mode_guard;
alter table public.listings enable trigger c_listing_auction_guard;

create or replace function public.copy_listing_auction_date_mode()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.date_flexible:=true;
  return new;
end;
$$;

alter function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb)
  rename to owner_configure_listing_negotiation_before_required_windows;
revoke all on function public.owner_configure_listing_negotiation_before_required_windows(uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated,service_role;
create function public.owner_configure_listing_negotiation(p_listing_id uuid,p_revision bigint,p_offers jsonb,p_auction jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_auction ? 'date_flexible' and jsonb_typeof(p_auction->'date_flexible') is distinct from 'boolean' then
    raise exception 'Invalid auction preferences' using errcode='22023';
  end if;
  if p_auction->'enabled'='true'::jsonb
    and not exists(select 1 from public.listing_auctions where listing_id=p_listing_id) then
    p_auction:=jsonb_set(p_auction,'{date_flexible}','true'::jsonb);
  end if;
  return public.owner_configure_listing_negotiation_before_required_windows(p_listing_id,p_revision,p_offers,p_auction);
end;
$$;
revoke all on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) to authenticated;

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_required_windows;
revoke all on function public.owner_save_listing_flow_before_required_windows(uuid,bigint,jsonb,jsonb,boolean)
  from public,anon,authenticated,service_role;
create function public.owner_save_listing_flow(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_details->'auction_preferences' ? 'date_flexible'
    and jsonb_typeof(p_details->'auction_preferences'->'date_flexible') is distinct from 'boolean' then
    raise exception 'Invalid auction preferences' using errcode='22023';
  end if;
  if p_details->'auction_preferences'->'enabled'='true'::jsonb
    and not exists(select 1 from public.listing_auctions where listing_id=p_listing_id) then
    p_details:=jsonb_set(p_details,'{auction_preferences,date_flexible}','true'::jsonb);
  end if;
  return public.owner_save_listing_flow_before_required_windows(p_listing_id,p_revision,p_details,p_pickup,p_publish);
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

commit;
