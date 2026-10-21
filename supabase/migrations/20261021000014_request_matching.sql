begin;
alter table public.item_requests add column location_lat double precision,add column location_lng double precision,
  add column radius_miles integer default 5,
  add constraint item_request_coordinates_valid check((location_lat is null and location_lng is null) or
    (location_lat is not null and location_lng is not null and location_lat between -90 and 90 and location_lng between -180 and 180)),
  add constraint item_request_radius_valid check(radius_miles in (5,10,25,50));
create table public.item_request_match_queue (
  request_id uuid primary key references public.item_requests(id) on delete cascade,
  queued_at timestamptz not null default now()
);
create table public.item_request_listing_matches (
  request_id uuid not null references public.item_requests(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(request_id,listing_id)
);
alter table public.item_request_match_queue enable row level security;
alter table public.item_request_listing_matches enable row level security;
revoke all on public.item_request_match_queue,public.item_request_listing_matches from public,anon,authenticated;

create function public.listing_matches_request(p_listing public.listings,p_request public.item_requests)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_request.status in ('open','responses_received','negotiating') and p_request.visibility='public'
    and p_request.expires_at>now() and p_request.preferred_start_date>=current_date
    and p_listing.status='published' and p_listing.owner_id<>p_request.renter_id
    and p_listing.category_id=p_request.category_id and p_listing.available_quantity>=p_request.requested_quantity
    and (p_request.max_daily_budget is null or p_listing.price_per_day<=p_request.max_daily_budget)
    and p_request.location_lat is not null and p_request.location_lng is not null
    and (p_request.radius_miles is null or (p_listing.location_lat between -90 and 90 and p_listing.location_lng between -180 and 180
      and extensions.st_dwithin(
        extensions.st_setsrid(extensions.st_makepoint(p_listing.location_lng,p_listing.location_lat),4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(p_request.location_lng,p_request.location_lat),4326)::extensions.geography,
        p_request.radius_miles*1609.344)))
    and not exists(select 1 from public.user_restrictions r where r.user_id in (p_listing.owner_id,p_request.renter_id))
    and public.listing_has_capacity(p_listing.id,p_request.preferred_start_date,p_request.preferred_end_date,p_request.requested_quantity);
$$;
revoke all on function public.listing_matches_request(public.listings,public.item_requests) from public,anon,authenticated;

create function public.queue_item_request_matches()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and old.location_lat is not null and new.location_label is distinct from old.location_label then
    raise exception 'Cancel this request and create a new one to change its verified area' using errcode='22023';
  end if;
  if new.status in ('open','responses_received','negotiating') and new.expires_at>now() then
    insert into public.item_request_match_queue(request_id) values(new.id) on conflict(request_id) do update set queued_at=now();
  else
    delete from public.item_request_match_queue where request_id=new.id;
    update public.notification_email_jobs set status='failed',last_error='The item request is no longer active.'
      where status in ('pending','retrying') and event_key like 'request-match:'||new.id::text||':%';
  end if;
  return new;
end;
$$;
create trigger item_request_match_changes after insert or update on public.item_requests
  for each row execute function public.queue_item_request_matches();

create function public.queue_inventory_request_matches()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_listing_id uuid;
begin
  v_listing_id:=case when tg_op='DELETE' then old.listing_id else new.listing_id end;
  insert into public.item_request_match_queue(request_id)
    select r.id from public.item_requests r join public.listings l on l.category_id=r.category_id
    where l.id=v_listing_id and r.status in ('open','responses_received','negotiating') and r.expires_at>now()
    on conflict(request_id) do update set queued_at=now();
  return null;
end;
$$;
create trigger booking_request_match_changes after insert or update or delete on public.bookings
  for each row execute function public.queue_inventory_request_matches();
create trigger availability_request_match_changes after insert or update or delete on public.listing_availability
  for each row execute function public.queue_inventory_request_matches();

create function public.queue_listing_request_matches()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='published' then
    insert into public.item_request_match_queue(request_id) select id from public.item_requests
      where category_id=new.category_id and status in ('open','responses_received','negotiating') and expires_at>now()
      on conflict(request_id) do update set queued_at=now();
  end if;
  return new;
end;
$$;
create trigger listing_request_match_changes after insert or update on public.listings
  for each row execute function public.queue_listing_request_matches();

create function public.process_item_request_matches()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests;v_listing public.listings;v_inserted integer;v_count integer:=0;
begin
  if not exists(select 1 from public.feature_flags where key='item_requests' and enabled) then return 0;end if;
  for v_request in select r.* from public.item_requests r join public.item_request_match_queue q on q.request_id=r.id
    order by q.queued_at,r.id limit 25 for update of r skip locked loop
    for v_listing in select l.* from public.listings l where l.category_id=v_request.category_id
      and not exists(select 1 from public.item_request_listing_matches m where m.request_id=v_request.id and m.listing_id=l.id)
      and public.listing_matches_request(l,v_request) order by l.created_at desc,l.id limit 100 loop
      insert into public.item_request_listing_matches(request_id,listing_id) values(v_request.id,v_listing.id) on conflict do nothing;
      get diagnostics v_inserted=row_count;
      if v_inserted=1 then
        perform public.create_notification(v_listing.owner_id,'request-match:'||v_request.id||':owner:'||v_listing.owner_id,'requests',
          'Nearby renter request matches your item',left(v_request.title||' matches your inventory, rental dates and advertised price. Review the request before offering.',500),'/requests');
        perform public.create_notification(v_request.renter_id,'request-match:'||v_request.id||':listing:'||v_listing.id,'requests',
          'An available listing matches your request',left(v_listing.title||' matches your category, dates, area and budget. Availability is rechecked at booking.',500),'/listing/'||v_listing.id);
        v_count:=v_count+1;
      end if;
    end loop;
    if not exists(select 1 from public.listings l where l.category_id=v_request.category_id
      and not exists(select 1 from public.item_request_listing_matches m where m.request_id=v_request.id and m.listing_id=l.id)
      and public.listing_matches_request(l,v_request)) then
      delete from public.item_request_match_queue where request_id=v_request.id;
    else
      update public.item_request_match_queue set queued_at=now() where request_id=v_request.id;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.process_item_request_matches() from public,anon,authenticated;
grant execute on function public.process_item_request_matches() to service_role;
select cron.schedule('match-item-requests','* * * * *',$$select public.process_item_request_matches();$$);

create function public.create_located_item_request(p_request jsonb,p_latitude double precision,p_longitude double precision,p_radius_miles integer default 5)
returns public.item_requests language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests;v_key uuid;
begin
  perform public.marketplace_require_user();
  if p_latitude is null or p_longitude is null or not(p_latitude between -90 and 90 and p_longitude between -180 and 180)
    or (p_radius_miles is not null and p_radius_miles not in (5,10,25,50)) then
    raise exception 'Choose a valid city or postal code and search radius' using errcode='22023';
  end if;
  if p_request is null or jsonb_typeof(p_request)<>'object' then raise exception 'Invalid request payload' using errcode='22023';end if;
  v_key:=(p_request->>'p_idempotency_key')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('located-request:'||auth.uid()::text,0));
  select * into v_request from public.item_requests where renter_id=auth.uid() and idempotency_key=v_key;
  if found then
    if v_request.location_lat is distinct from p_latitude or v_request.location_lng is distinct from p_longitude
      or v_request.radius_miles is distinct from p_radius_miles
      or jsonb_build_object('p_id',v_request.id,'p_idempotency_key',v_request.idempotency_key,
        'p_category_id',v_request.category_id,'p_title',v_request.title,'p_description',v_request.description,
        'p_intended_use',v_request.intended_use,'p_start_date',v_request.preferred_start_date,
        'p_end_date',v_request.preferred_end_date,'p_location_label',v_request.location_label,
        'p_max_daily_budget',v_request.max_daily_budget,'p_quantity',v_request.requested_quantity,
        'p_specifications',v_request.specifications,'p_additional_notes',v_request.additional_notes,
        'p_visibility',v_request.visibility,'p_reference_image_paths',v_request.reference_image_paths) is distinct from p_request then
      raise exception 'Request retry has different details or location settings' using errcode='22023';
    end if;
    return v_request;
  end if;
  if exists(select 1 from public.item_requests where renter_id=auth.uid() and status in ('open','responses_received','negotiating')
    and expires_at>now() and lower(btrim(title))=lower(btrim(p_request->>'p_title'))
    and category_id=(p_request->>'p_category_id')::uuid
    and preferred_start_date=(p_request->>'p_start_date')::date and preferred_end_date=(p_request->>'p_end_date')::date) then
    raise exception 'An active request already exists for this item and date range' using errcode='23505';
  end if;
  v_request:=public.create_item_request((p_request->>'p_id')::uuid,v_key,(p_request->>'p_category_id')::uuid,
    p_request->>'p_title',p_request->>'p_description',p_request->>'p_intended_use',
    (p_request->>'p_start_date')::date,(p_request->>'p_end_date')::date,p_request->>'p_location_label',
    (p_request->>'p_max_daily_budget')::numeric,(p_request->>'p_quantity')::integer,
    p_request->>'p_specifications',p_request->>'p_additional_notes',p_request->>'p_visibility',
    array(select jsonb_array_elements_text(coalesce(p_request->'p_reference_image_paths','[]'::jsonb))));
  update public.item_requests set location_lat=p_latitude,location_lng=p_longitude,radius_miles=p_radius_miles
    where id=v_request.id returning * into v_request;
  return v_request;
end;
$$;
revoke all on function public.create_located_item_request(jsonb,double precision,double precision,integer) from public,anon;
grant execute on function public.create_located_item_request(jsonb,double precision,double precision,integer) to authenticated;

create function public.get_request_listing_matches(p_request_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.marketplace_require_user();
  if cardinality(p_request_ids)>50 then raise exception 'Too many request IDs' using errcode='22023';end if;
  if not exists(select 1 from public.feature_flags where key='item_requests' and enabled) then raise exception 'Item requests are disabled' using errcode='55000';end if;
  return coalesce((select jsonb_object_agg(r.id::text,(select coalesce(jsonb_agg(jsonb_build_object(
    'id',matched.id,'title',matched.title,'price_per_day',matched.price_per_day,'category_id',matched.category_id,
    'available_quantity',matched.available_quantity,'location_label',matched.location_label,'status',matched.status
  ) order by matched.created_at desc,matched.id),'[]'::jsonb) from (
    select l.* from public.listings l where l.category_id=r.category_id and (r.renter_id=auth.uid() or l.owner_id=auth.uid())
      and public.listing_matches_request(l,r) order by l.created_at desc,l.id limit 20
  ) matched)) from public.item_requests r where r.id=any(p_request_ids) and
    (r.renter_id=auth.uid() or (r.visibility='public' and r.status in ('open','responses_received','negotiating') and r.expires_at>now()))),'{}'::jsonb);
end;
$$;
revoke all on function public.get_request_listing_matches(uuid[]) from public,anon;
grant execute on function public.get_request_listing_matches(uuid[]) to authenticated;
revoke all on function public.queue_item_request_matches(),public.queue_listing_request_matches(),public.queue_inventory_request_matches() from public,anon,authenticated;
commit;
