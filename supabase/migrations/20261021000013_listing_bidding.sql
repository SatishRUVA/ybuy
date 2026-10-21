begin;
alter table public.listings add column offer_minimum_daily numeric(10,2),
  add column offer_target_daily numeric(10,2),
  add column offer_guardrail_pct numeric(5,4),
  add column offer_start_date date,
  add column offer_end_date date,
  add column offer_expiration_hours integer,
  add constraint listing_offer_prices_valid check(
    (offer_minimum_daily is null or offer_minimum_daily between 0.01 and 100000)
    and (offer_target_daily is null or offer_target_daily between coalesce(offer_minimum_daily,0.01) and 100000)
    and (offer_guardrail_pct is null or offer_guardrail_pct between 0 and 1)),
  add constraint listing_offer_period_valid check(
    (offer_start_date is null and offer_end_date is null) or
    (offer_start_date is not null and offer_end_date is not null and offer_end_date>offer_start_date)),
  add constraint listing_offer_expiration_valid check(offer_expiration_hours between 1 and 168);

create function public.listing_offer_within_rules(p_listing_id uuid,p_rate numeric,p_start date,p_end date)
returns boolean language sql stable security definer set search_path = '' as $$
  select l.status='published' and l.negotiation_enabled and p_rate is not null and p_rate::text<>'NaN'
    and p_rate>=coalesce(l.offer_minimum_daily,0.01)
    and (l.offer_guardrail_pct is null or p_rate between round(l.price_per_day*(1-l.offer_guardrail_pct),2) and round(l.price_per_day*(1+l.offer_guardrail_pct),2))
    and p_start>=current_date and p_end>p_start and p_end-p_start<=366
    and (l.offer_start_date is null or (p_start>=l.offer_start_date and p_end<=l.offer_end_date))
    from public.listings l where l.id=p_listing_id;
$$;
revoke all on function public.listing_offer_within_rules(uuid,numeric,date,date) from public,anon,authenticated;

create function public.enforce_listing_offer_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_negotiation public.marketplace_negotiations;v_listing public.listings;
begin
  select * into v_negotiation from public.marketplace_negotiations where id=new.negotiation_id;
  if v_negotiation.item_request_id is not null or v_negotiation.listing_id is null then return new;end if;
  if tg_op='INSERT' or (new.status='accepted' and old.status<>'accepted') then
    select * into v_listing from public.listings where id=v_negotiation.listing_id for update;
    if not coalesce(public.listing_offer_within_rules(v_listing.id,new.daily_rate,new.start_date,new.end_date),false) then
      raise exception 'Offer price or dates are outside the listing''s current bidding rules' using errcode='22023';
    end if;
    if tg_op='INSERT' then
      if not coalesce(public.listing_has_capacity(v_listing.id,new.start_date,new.end_date),false) then
        raise exception 'Listing is not available for the offer dates' using errcode='23P01';
      end if;
      if v_listing.offer_expiration_hours is not null then
        new.expires_at:=clock_timestamp()+make_interval(hours=>v_listing.offer_expiration_hours);
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger negotiation_listing_rules before insert or update on public.negotiation_proposals
  for each row execute function public.enforce_listing_offer_rules();
revoke all on function public.enforce_listing_offer_rules() from public,anon,authenticated;

create function public.get_top_listing_bids()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(top)-'ordering_id' order by top.daily_rate desc,top.created_at,top.ordering_id),'[]'::jsonb) from (
    select l.id as listing_id,l.title,p.id as ordering_id,p.daily_rate,p.start_date,p.end_date,p.expires_at,p.created_at,
      (select url from public.listing_images where listing_id=l.id order by sort_order,id limit 1) as image_url
    from public.marketplace_negotiations n join public.listings l on l.id=n.listing_id
      join public.negotiation_proposals p on p.negotiation_id=n.id
    where exists(select 1 from public.feature_flags where key='bidding' and enabled)
      and n.item_request_id is null and n.status in ('pending','countered') and p.status='pending'
      and p.proposed_by=n.renter_id and p.expires_at>now()
      and not exists(select 1 from public.negotiation_proposals newer where newer.negotiation_id=n.id and newer.revision>p.revision)
      and public.listing_offer_within_rules(l.id,p.daily_rate,p.start_date,p.end_date)
      and public.listing_has_capacity(l.id,p.start_date,p.end_date)
      and not exists(select 1 from public.user_restrictions r where r.user_id in (n.renter_id,n.owner_id))
    order by p.daily_rate desc,p.created_at,p.id limit 5
  ) top;
$$;
revoke all on function public.get_top_listing_bids() from public;
grant execute on function public.get_top_listing_bids() to anon,authenticated;

create or replace function public.owner_save_listing(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings;v_revision bigint;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or v_listing.revision<>p_revision then raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';end if;
  if p_details is null or jsonb_typeof(p_details)<>'object' or exists(
    select 1 from jsonb_object_keys(p_details) key where key not in (
      'title','description','category_id','price_per_day','deposit','location_label','instant_booking',
      'protection_eligible','delivery_available','available_quantity','negotiation_enabled','estimated_value','item_condition',
      'offer_minimum_daily','offer_target_daily','offer_guardrail_pct','offer_start_date','offer_end_date','offer_expiration_hours')
  ) then raise exception 'Unsupported listing changes' using errcode='22023';end if;
  v_listing:=jsonb_populate_record(v_listing,p_details);
  update public.listings set title=v_listing.title,description=v_listing.description,category_id=v_listing.category_id,
    price_per_day=v_listing.price_per_day,deposit=v_listing.deposit,location_label=v_listing.location_label,
    instant_booking=v_listing.instant_booking,protection_eligible=v_listing.protection_eligible,
    delivery_available=v_listing.delivery_available,available_quantity=v_listing.available_quantity,
    negotiation_enabled=v_listing.negotiation_enabled,estimated_value=v_listing.estimated_value,item_condition=v_listing.item_condition,
    offer_minimum_daily=v_listing.offer_minimum_daily,offer_target_daily=v_listing.offer_target_daily,
    offer_guardrail_pct=v_listing.offer_guardrail_pct,offer_start_date=v_listing.offer_start_date,offer_end_date=v_listing.offer_end_date,
    offer_expiration_hours=v_listing.offer_expiration_hours where id=p_listing_id returning revision into v_revision;
  if p_pickup is not null then
    insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,latitude,longitude,place_id)
    values(p_listing_id,auth.uid(),p_pickup->>'formattedAddress',p_pickup->>'streetAddress',p_pickup->>'city',p_pickup->>'state',
      p_pickup->>'postalCode',p_pickup->>'country',(p_pickup->>'latitude')::double precision,(p_pickup->>'longitude')::double precision,nullif(p_pickup->>'placeId',''))
    on conflict(listing_id) do update set address=excluded.address,street_address=excluded.street_address,city=excluded.city,state=excluded.state,
      postal_code=excluded.postal_code,country=excluded.country,latitude=excluded.latitude,longitude=excluded.longitude,place_id=excluded.place_id;
    select revision into v_revision from public.listings where id=p_listing_id;
  end if;
  return v_revision;
end;
$$;
commit;
