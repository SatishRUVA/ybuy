begin;

alter table public.item_requests
  add column open_for_offers boolean not null default true,
  add column notify_matches_in_app boolean not null default true,
  add column main_site_flow boolean not null default false,
  add constraint fixed_request_budget_required check (open_for_offers or max_daily_budget is not null);

create function public.create_main_item_request(
  p_request jsonb, p_latitude double precision, p_longitude double precision,
  p_radius_miles integer, p_open_for_offers boolean, p_notify_matches_in_app boolean
) returns public.item_requests language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests;
begin
  perform public.marketplace_require_user();
  if p_open_for_offers is null or p_notify_matches_in_app is null
    or (not p_open_for_offers and (p_request->>'p_max_daily_budget') is null) then
    raise exception 'Choose offer and notification preferences, and a daily budget for fixed-budget requests' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('located-request:'||auth.uid()::text,0));
  select * into v_request from public.item_requests
    where renter_id=auth.uid() and idempotency_key=(p_request->>'p_idempotency_key')::uuid;
  if found and (not v_request.main_site_flow or v_request.open_for_offers<>p_open_for_offers
    or v_request.notify_matches_in_app<>p_notify_matches_in_app) then
    raise exception 'Request retry has different preferences' using errcode='22023';
  end if;
  v_request:=public.create_located_item_request(p_request,p_latitude,p_longitude,p_radius_miles);
  update public.item_requests set open_for_offers=p_open_for_offers,
    notify_matches_in_app=p_notify_matches_in_app, main_site_flow=true
    where id=v_request.id returning * into v_request;
  return v_request;
end;
$$;
revoke all on function public.create_main_item_request(jsonb,double precision,double precision,integer,boolean,boolean) from public,anon;
grant execute on function public.create_main_item_request(jsonb,double precision,double precision,integer,boolean,boolean) to authenticated;

create function public.update_request_match_preference(p_request_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.marketplace_require_user();
  if p_enabled is null then raise exception 'Choose a notification preference' using errcode='22023'; end if;
  update public.item_requests set notify_matches_in_app=p_enabled
    where id=p_request_id and renter_id=auth.uid() and main_site_flow;
  if not found then raise exception 'Your main-site request was not found' using errcode='42501'; end if;
end;
$$;
revoke all on function public.update_request_match_preference(uuid,boolean) from public,anon;
grant execute on function public.update_request_match_preference(uuid,boolean) to authenticated;

create function public.enforce_main_request_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests;
begin
  if new.category='requests' and new.event_key ~ '^request-match:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:listing:' then
    select * into v_request from public.item_requests where id=split_part(new.event_key,':',2)::uuid;
    if found and v_request.main_site_flow and new.user_id=v_request.renter_id then
      new.in_app_enabled:=new.in_app_enabled and v_request.notify_matches_in_app;
      new.destination:='/requests/'||v_request.id||'/matches';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_main_request_notification() from public,anon,authenticated;
-- Run after the category-level notification policy; neither preference can re-enable the other.
create trigger zz_main_request_notification before insert on public.notifications
  for each row execute function public.enforce_main_request_notification();

create function public.get_nearby_item_requests(
  p_latitude double precision default null,p_longitude double precision default null,
  p_radius_miles integer default null,p_search text default '',p_category_id uuid default null,
  p_location text default '',p_start_date date default null,p_end_date date default null,
  p_max_daily_budget numeric default null,p_sort text default 'newest',p_limit integer default 12,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.marketplace_require_user();
  if (p_latitude is null)<>(p_longitude is null)
    or (p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180))
    or (p_radius_miles is not null and (p_latitude is null or p_radius_miles not in (5,10,25,50)))
    or p_limit is null or p_limit not between 1 and 24 or p_offset is null or p_offset<0
    or p_sort is null or p_sort not in ('newest','earliest','budget')
    or length(coalesce(p_search,''))>100 or length(coalesce(p_location,''))>200
    or (p_max_daily_budget is not null and (p_max_daily_budget<=0 or p_max_daily_budget>100000)) then
    raise exception 'Invalid nearby request filters' using errcode='22023';
  end if;
  if not exists(select 1 from public.feature_flags where key='item_requests' and enabled) then
    raise exception 'Item requests are disabled' using errcode='55000';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date<p_start_date then
    raise exception 'Choose an end date on or after the start date' using errcode='22023';
  end if;
  with filtered as (
    select r.*,jsonb_build_object('name',c.name) as categories,
      case when p_latitude is not null and r.location_lat is not null and r.location_lng is not null then
        extensions.st_distance(
          extensions.st_setsrid(extensions.st_makepoint(r.location_lng,r.location_lat),4326)::extensions.geography,
          extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography)/1609.344
      end as distance_miles
    from public.item_requests r join public.categories c on c.id=r.category_id
    where r.visibility='public' and r.status in ('open','responses_received','negotiating')
      and r.renter_id<>auth.uid() and r.expires_at>now() and r.preferred_end_date>current_date
      and (p_category_id is null or r.category_id=p_category_id)
      and (coalesce(p_search,'')='' or strpos(lower(r.title),lower(p_search))>0)
      and (coalesce(p_location,'')='' or strpos(lower(r.location_label),lower(p_location))>0)
      and (p_start_date is null or r.preferred_end_date>=p_start_date)
      and (p_end_date is null or r.preferred_start_date<=p_end_date)
      and (p_max_daily_budget is null or r.max_daily_budget is null or r.max_daily_budget<=p_max_daily_budget)
  ), nearby as (
    select * from filtered where p_radius_miles is null or distance_miles<=p_radius_miles
  ), page as (
    select * from nearby order by
      case when p_sort='earliest' then preferred_start_date end,
      case when p_sort='budget' then max_daily_budget end nulls last,
      created_at desc,id limit p_limit offset p_offset
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
    'total',(select count(*) from nearby)) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_nearby_item_requests(double precision,double precision,integer,text,uuid,text,date,date,numeric,text,integer,integer) from public,anon;
grant execute on function public.get_nearby_item_requests(double precision,double precision,integer,text,uuid,text,date,date,numeric,text,integer,integer) to authenticated;

create function public.get_main_request_matches(p_request_id uuid,p_limit integer default 12,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_request public.item_requests; v_result jsonb;
begin
  perform public.marketplace_require_user();
  if p_limit is null or p_limit not between 1 and 24 or p_offset is null or p_offset<0 then
    raise exception 'Invalid matching-listing page' using errcode='22023';
  end if;
  if not exists(select 1 from public.feature_flags where key='item_requests' and enabled) then
    raise exception 'Item requests are disabled' using errcode='55000';
  end if;
  select * into v_request from public.item_requests where id=p_request_id and renter_id=auth.uid();
  if not found then raise exception 'Your request was not found' using errcode='42501'; end if;
  with matches as (
    select l.id,l.created_at,
      case when l.location_lat is not null and l.location_lng is not null then extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(l.location_lng,l.location_lat),4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(v_request.location_lng,v_request.location_lat),4326)::extensions.geography)/1609.344
      end as distance_miles
    from public.listings l where l.category_id=v_request.category_id and public.listing_matches_request(l,v_request)
  ), page as (select * from matches order by created_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('listing_id',id,'distance_miles',distance_miles)) from page),'[]'::jsonb),
    'total',(select count(*) from matches)) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_main_request_matches(uuid,integer,integer) from public,anon;
grant execute on function public.get_main_request_matches(uuid,integer,integer) to authenticated;

create function public.link_main_request_listing(p_request_id uuid,p_listing_id uuid,p_notify boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests; v_listing public.listings; v_notified boolean;
begin
  perform public.marketplace_require_user();
  if p_notify is null then raise exception 'Choose whether to notify the renter' using errcode='22023'; end if;
  if not exists(select 1 from public.feature_flags where key='item_requests' and enabled) then
    raise exception 'Item requests are disabled' using errcode='55000';
  end if;
  select * into v_request from public.item_requests where id=p_request_id for update;
  if not found then raise exception 'Request not found' using errcode='22023'; end if;
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id is distinct from auth.uid() then
    raise exception 'Choose your own published rental' using errcode='42501';
  end if;
  if public.listing_matches_request(v_listing,v_request) is not true then
    raise exception 'This rental does not match the category, dates, area, quantity or daily budget' using errcode='22023';
  end if;
  insert into public.item_request_listing_matches(request_id,listing_id)
    values(p_request_id,p_listing_id) on conflict do nothing;
  v_notified:=p_notify and v_request.notify_matches_in_app
    and public.notification_preference_enabled(v_request.renter_id,'requests','in_app');
  if v_notified then
    perform public.create_notification(v_request.renter_id,
      'request-match:'||v_request.id||':listing:'||v_listing.id,'requests',
      'An owner has an item for your request',
      left(v_listing.title||' is available for your requested dates. Review the listing before booking.',500),
      case when v_request.main_site_flow then '/requests/'||v_request.id||'/matches' else '/listing/'||v_listing.id end);
    select exists(select 1 from public.notifications where user_id=v_request.renter_id
      and event_key='request-match:'||v_request.id||':listing:'||v_listing.id and in_app_enabled) into v_notified;
  end if;
  return jsonb_build_object('linked',true,'in_app_notified',v_notified);
end;
$$;
revoke all on function public.link_main_request_listing(uuid,uuid,boolean) from public,anon;
grant execute on function public.link_main_request_listing(uuid,uuid,boolean) to authenticated;

commit;
