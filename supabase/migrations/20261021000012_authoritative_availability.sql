begin;
create function public.listing_has_capacity(p_listing_id uuid,p_start date,p_end date,p_quantity integer default 1,p_exclude_booking uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_start is not null and p_end>p_start and p_end-p_start<=366 and p_quantity between 1 and l.available_quantity
    and not exists(select 1 from public.listing_availability a where a.listing_id=l.id and not a.is_available and a.date>=p_start and a.date<p_end)
    and not exists(select 1 from generate_series(p_start::timestamp,(p_end-1)::timestamp,interval '1 day') day
      where (select coalesce(sum(b.quantity),0) from public.bookings b where b.listing_id=l.id
        and (p_exclude_booking is null or b.id<>p_exclude_booking)
        and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>now())
        and b.start_date<=day::date and b.end_date>day::date)+p_quantity>l.available_quantity)
  from public.listings l where l.id=p_listing_id;
$$;
revoke all on function public.listing_has_capacity(uuid,date,date,integer,uuid) from public,anon,authenticated;

create function public.get_listing_unavailable_dates(p_listing_id uuid,p_start date default current_date,p_end date default current_date+366)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_listing public.listings;
begin
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>366 then
    raise exception 'Availability range must be between 1 and 366 days' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id and
    (status='published' or (owner_id=auth.uid() and public.has_active_session()));
  if not found then raise exception 'Listing not found' using errcode='42501'; end if;
  return jsonb_build_object('blocked',coalesce((select jsonb_agg(a.date order by a.date) from public.listing_availability a
      where a.listing_id=p_listing_id and not a.is_available and a.date>=p_start and a.date<p_end),'[]'::jsonb),
    'booked',coalesce((select jsonb_agg(day::date order by day) from generate_series(p_start::timestamp,(p_end-1)::timestamp,interval '1 day') day
      where (select coalesce(sum(b.quantity),0) from public.bookings b where b.listing_id=p_listing_id
        and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>now())
        and b.start_date<=day::date and b.end_date>day::date)>=v_listing.available_quantity),'[]'::jsonb));
end;
$$;
revoke all on function public.get_listing_unavailable_dates(uuid,date,date) from public;
grant execute on function public.get_listing_unavailable_dates(uuid,date,date) to anon,authenticated;

create or replace function public.search_available_listings(
  p_latitude double precision default null,p_longitude double precision default null,
  p_radius_miles integer default 5,p_start_date date default null,p_end_date date default null,
  p_keyword text default null,p_category_id uuid default null,p_max_price numeric default null,
  p_verified_only boolean default false,p_instant_only boolean default false,
  p_protection_only boolean default false,p_delivery_only boolean default false,
  p_sort text default 'recommended',p_limit integer default 24,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_origin extensions.geography;v_result jsonb;
begin
  if auth.role()='authenticated' and not public.has_active_session() then
    raise exception 'An active signed-in session is required' using errcode='42501';
  end if;
  if (p_latitude is null)<>(p_longitude is null)
    or (p_latitude is not null and not(p_latitude between -90 and 90 and p_longitude between -180 and 180)) then
    raise exception 'Choose valid search coordinates' using errcode='22023';
  end if;
  if p_radius_miles is not null and p_radius_miles not in (5,10,25,50) then
    raise exception 'Radius must be 5, 10, 25, 50 miles or unlimited' using errcode='22023';
  end if;
  if (p_start_date is null)<>(p_end_date is null)
    or (p_start_date is not null and (p_end_date<=p_start_date or p_end_date-p_start_date>366)) then
    raise exception 'Choose both dates, with an end after the start and a range of at most 366 days' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000
    or length(coalesce(p_keyword,''))>200 or p_max_price<0 or p_max_price::text in ('NaN','Infinity','-Infinity')
    or p_sort is null or p_sort not in ('recommended','newest','price-low','price-high','distance') then
    raise exception 'Invalid search filters or pagination' using errcode='22023';
  end if;
  if p_latitude is not null then
    v_origin:=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography;
  end if;
  with candidates as materialized (
    select l.*,case when v_origin is not null and l.location_lat between -90 and 90 and l.location_lng between -180 and 180
      then extensions.st_distance(extensions.st_setsrid(extensions.st_makepoint(l.location_lng,l.location_lat),4326)::extensions.geography,v_origin)/1609.344 end as distance_miles
    from public.listings l where l.status='published'
      and (p_category_id is null or l.category_id=p_category_id)
      and (p_max_price is null or l.price_per_day<=p_max_price)
      and (not coalesce(p_verified_only,false) or l.owner_verified)
      and (not coalesce(p_instant_only,false) or l.instant_booking)
      and (not coalesce(p_protection_only,false) or l.protection_eligible)
      and (not coalesce(p_delivery_only,false) or l.delivery_available)
      and (nullif(btrim(p_keyword),'') is null or strpos(lower(l.title||' '||coalesce(l.description,'')),lower(btrim(p_keyword)))>0)
      and (v_origin is null or p_radius_miles is null or (l.location_lat between -90 and 90 and l.location_lng between -180 and 180
        and extensions.st_dwithin(extensions.st_setsrid(extensions.st_makepoint(l.location_lng,l.location_lat),4326)::extensions.geography,v_origin,p_radius_miles*1609.344)))
      and (p_start_date is null or public.listing_has_capacity(l.id,p_start_date,p_end_date))
  ),page as (
    select * from candidates order by
      case when p_sort='price-low' then price_per_day end asc,
      case when p_sort='price-high' then price_per_day end desc,
      case when p_sort='distance' then distance_miles end asc nulls last,
      case when p_sort='recommended' then owner_verified end desc,
      case when p_sort='recommended' then instant_booking end desc,created_at desc,id
    limit p_limit offset p_offset
  )
  select jsonb_build_object('total',(select count(*) from candidates),'rows',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',p.id,'owner_id',p.owner_id,'category_id',p.category_id,'title',p.title,'description',p.description,
      'price_per_day',p.price_per_day,'price_per_week',p.price_per_week,'deposit',p.deposit,
      'estimated_value',p.estimated_value,'item_condition',p.item_condition,
      'location_lat',p.location_lat,'location_lng',p.location_lng,'location_label',p.location_label,
      'instant_booking',p.instant_booking,'owner_verified',p.owner_verified,'protection_eligible',p.protection_eligible,
      'delivery_available',p.delivery_available,'available_quantity',p.available_quantity,'negotiation_enabled',p.negotiation_enabled,
      'status',p.status,'created_at',p.created_at,'distance_miles',p.distance_miles,
      'listing_images',coalesce((select jsonb_agg(jsonb_build_object('url',i.url,'sort_order',i.sort_order) order by i.sort_order,i.id)
        from public.listing_images i where i.listing_id=p.id),'[]'::jsonb),
      'owner',(select jsonb_build_object('id',o.id,'full_name',o.full_name,'avatar_url',o.avatar_url) from public.profiles o where o.id=p.owner_id),
      'categories',(select jsonb_build_object('name',c.name) from public.categories c where c.id=p.category_id)
    ) order by case when p_sort='price-low' then p.price_per_day end asc,
      case when p_sort='price-high' then p.price_per_day end desc,
      case when p_sort='distance' then p.distance_miles end asc nulls last,
      case when p_sort='recommended' then p.owner_verified end desc,
      case when p_sort='recommended' then p.instant_booking end desc,p.created_at desc,p.id)
    from page p),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;

create or replace function public.respond_to_booking_request(p_booking_id uuid,p_approve boolean)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;v_listing public.listings;
begin
  perform public.operations_require_session();
  select * into v_booking from public.bookings where id=p_booking_id and owner_id=auth.uid();
  if not found then raise exception 'Booking not found or not owned' using errcode='42501';end if;
  perform public.expire_listing_checkouts(v_booking.listing_id);
  select * into v_listing from public.listings where id=v_booking.listing_id;
  if p_approve and (v_listing.status<>'published' or v_booking.start_date<current_date
    or not public.listing_has_capacity(v_listing.id,v_booking.start_date,v_booking.end_date,v_booking.quantity,v_booking.id)) then
    raise exception 'Listing is no longer available for these dates' using errcode='23P01';
  end if;
  return public.respond_to_booking_request_before_reservations(p_booking_id,p_approve);
end;
$$;
commit;
