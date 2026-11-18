begin;

alter table public.listing_pickup_locations
  alter column latitude drop not null,
  alter column longitude drop not null,
  add constraint listing_pickup_coordinates_pair check (
    (latitude is null) = (longitude is null)
    and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))
  );

create or replace function public.protect_listing_related_edits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_listing public.listings;
  v_id uuid;
  v_address_changed boolean := false;
begin
  v_id:=case when tg_op='DELETE' then old.listing_id else new.listing_id end;
  select * into v_listing from public.listings where id=v_id for update;
  if not found then
    if tg_op='DELETE' then return old; end if;
    raise exception 'Listing not found' using errcode='23503';
  end if;
  if auth.role()='authenticated' and (not public.has_active_session() or v_listing.owner_id<>auth.uid()) then
    raise exception 'Only the listing owner can change its photos or pickup details' using errcode='42501';
  end if;
  if tg_op='UPDATE' and new.listing_id<>old.listing_id then
    raise exception 'Cannot move photos or pickup details to another listing' using errcode='42501';
  end if;
  if exists(select 1 from public.bookings where listing_id=v_id and status in ('pending_payment','confirmed','active','return_pending')) then
    raise exception 'Photos and pickup details cannot change while an approved rental is outstanding' using errcode='23514';
  end if;
  if tg_table_name='listing_images' then
    update public.listings set revision=revision where id=v_id;
    insert into public.listing_change_history(listing_id,actor_id,revision,old_value,new_value)
      values(v_id,auth.uid(),v_listing.revision+1,
        case when tg_op='INSERT' then '{}'::jsonb else jsonb_build_object('photo',old.url) end,
        case when tg_op='DELETE' then '{}'::jsonb else jsonb_build_object('photo',new.url) end);
  elsif tg_op<>'DELETE' then
    if (new.latitude is null)<>(new.longitude is null)
      or (new.latitude is not null and (new.latitude not between -90 and 90 or new.longitude not between -180 and 180)) then
      raise exception 'Invalid pickup coordinates' using errcode='23514';
    end if;
    if new.owner_id<>v_listing.owner_id then raise exception 'Pickup owner does not match listing' using errcode='42501'; end if;
    if tg_op='INSERT' then
      v_address_changed:=true;
    else
      v_address_changed:=(new.address,new.street_address,new.city,new.state,new.postal_code,new.country)
        is distinct from (old.address,old.street_address,old.city,old.state,old.postal_code,old.country);
    end if;
    if v_address_changed and (
      nullif(btrim(new.address),'') is null or nullif(btrim(new.street_address),'') is null
      or nullif(btrim(new.city),'') is null or nullif(btrim(new.state),'') is null
      or nullif(btrim(new.postal_code),'') is null or new.country is null or new.country !~ '^[A-Z]{2}$'
    ) then
      raise exception 'Enter a complete pickup address, city, state, ZIP code and country' using errcode='23514';
    end if;
    update public.listings set
      location_lat=case when new.latitude is null then null else round(new.latitude::numeric,2)::double precision end,
      location_lng=case when new.longitude is null then null else round(new.longitude::numeric,2)::double precision end,
      location_label=concat_ws(', ',nullif(new.city,''),nullif(new.state,''))
      where id=v_id;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.enforce_public_listing_location_privacy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_latitude double precision; v_longitude double precision; v_has_pickup boolean;
begin
  if pg_trigger_depth()>1 then return new; end if;
  select latitude,longitude into v_latitude,v_longitude
    from public.listing_pickup_locations where listing_id=new.id;
  v_has_pickup:=found;
  if v_has_pickup then
    new.location_lat:=case when v_latitude is null then null else round(v_latitude::numeric,2)::double precision end;
    new.location_lng:=case when v_longitude is null then null else round(v_longitude::numeric,2)::double precision end;
  else
    new.location_lat:=case when new.location_lat is null then null else round(new.location_lat::numeric,2)::double precision end;
    new.location_lng:=case when new.location_lng is null then null else round(new.location_lng::numeric,2)::double precision end;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_public_listing_location_privacy() from public,anon,authenticated;
create trigger b_listing_location_privacy
  before insert or update on public.listings
  for each row execute function public.enforce_public_listing_location_privacy();

alter table public.listings
  add constraint listings_public_coordinates_approximate check (
    (location_lat is null) = (location_lng is null)
    and (location_lat is null or (
      location_lat between -90 and 90 and location_lng between -180 and 180
      and location_lat=round(location_lat::numeric,2)::double precision
      and location_lng=round(location_lng::numeric,2)::double precision
    ))
  );

update public.listings set location_lat=location_lat,location_lng=location_lng
where location_lat is distinct from round(location_lat::numeric,2)::double precision
  or location_lng is distinct from round(location_lng::numeric,2)::double precision;

create function public.validate_listing_pickup_before_publish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status not in ('published','pending_approval') then return new; end if;
  if tg_op='UPDATE' and new.status=old.status then return new; end if;
  if not exists(
    select 1 from public.listing_pickup_locations p
    where p.listing_id=new.id
      and nullif(btrim(p.address),'') is not null
      and nullif(btrim(p.street_address),'') is not null
      and nullif(btrim(p.city),'') is not null
      and nullif(btrim(p.state),'') is not null
      and nullif(btrim(p.postal_code),'') is not null
      and public.marketplace_country_allowed(p.country)
      and p.time_zone is not null
      and exists(select 1 from pg_catalog.pg_timezone_names z where z.name=p.time_zone)
      and ((p.latitude is null and p.longitude is null)
        or (p.latitude between -90 and 90 and p.longitude between -180 and 180))
  ) then
    raise exception 'Enter a complete pickup address and confirm its city, state, ZIP code and time zone before publishing'
      using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_listing_pickup_before_publish() from public,anon,authenticated;
create trigger z_listing_pickup_required_before_publish
  before insert or update of status on public.listings
  for each row execute function public.validate_listing_pickup_before_publish();

commit;
