begin;

delete from public.feature_flags where key='private_offers';

update public.listings listing set negotiation_enabled=false,offer_minimum_daily=null,offer_maximum_daily=null,
  offer_target_daily=null,offer_guardrail_pct=null,offer_start_date=null,offer_end_date=null,offer_expiration_hours=null
where (listing.negotiation_enabled or listing.offer_minimum_daily is not null or listing.offer_maximum_daily is not null
  or listing.offer_target_daily is not null or listing.offer_guardrail_pct is not null
  or listing.offer_start_date is not null or listing.offer_end_date is not null or listing.offer_expiration_hours is not null)
  and not exists(select 1 from public.listing_auctions auction where auction.listing_id=listing.id
    and auction.status in ('scheduled','open','owner_selection','awaiting_payment'));

delete from public.app_settings where key in (
  'listing_offers_configured','listing_offer_below_pct','listing_offer_above_pct'
);

update public.negotiation_proposals set status='cancelled' where status in ('pending','countered');
update public.marketplace_negotiations set status='cancelled' where status in ('pending','countered');
update public.item_requests request set status='open'
where request.status in ('responses_received','negotiating')
  and not exists(select 1 from public.marketplace_negotiations negotiation
    where negotiation.item_request_id=request.id and negotiation.status='accepted');
alter table public.item_requests drop constraint if exists fixed_request_budget_required;
update public.item_requests set open_for_offers=false where open_for_offers;
alter table public.item_requests alter column open_for_offers set default false;
alter table public.item_requests add constraint item_requests_private_offers_disabled check (not open_for_offers);

drop trigger if exists zzzz_guard_private_offers_feature_flag on public.listings;
create function public.reject_private_offer_listing_setting()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.negotiation_enabled then raise exception 'Private offers have been removed; publish rentals at their listed price.' using errcode='55000';end if;
  return new;
end;
$$;
revoke all on function public.reject_private_offer_listing_setting() from public,anon,authenticated;
create trigger aa_reject_private_offer_listing_setting before insert or update of negotiation_enabled on public.listings
  for each row execute function public.reject_private_offer_listing_setting();

alter function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb)
  rename to owner_configure_listing_negotiation_before_private_offers;
revoke all on function public.owner_configure_listing_negotiation_before_private_offers(uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated,service_role;
create function public.owner_configure_listing_negotiation(
  p_listing_id uuid,p_revision bigint,p_offers jsonb,p_auction jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_offers is not null and p_offers->>'negotiation_enabled'='true' then
    raise exception 'Private offers have been removed; use the listing price or enable competitive bidding.' using errcode='55000';
  end if;
  return public.owner_configure_listing_negotiation_before_private_offers(p_listing_id,p_revision,
    jsonb_build_object('negotiation_enabled',false,'offer_minimum_daily',null,'offer_maximum_daily',null,
      'offer_target_daily',null,'offer_start_date',null,'offer_end_date',null,'offer_expiration_hours',null),p_auction);
end;
$$;
revoke all on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_configure_listing_negotiation(uuid,bigint,jsonb,jsonb) to authenticated;

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_private_offers;
revoke all on function public.owner_save_listing_flow_before_private_offers(uuid,bigint,jsonb,jsonb,boolean)
  from public,anon,authenticated,service_role;
create function public.owner_save_listing_flow(
  p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_details)='object' and p_details ? 'offer_preferences' then
    raise exception 'Private offers have been removed; publish rentals at their listed price.' using errcode='55000';
  end if;
  return public.owner_save_listing_flow_before_private_offers(p_listing_id,p_revision,p_details,p_pickup,p_publish);
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

revoke all on function public.owner_save_offer_preferences(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.create_marketplace_offer(uuid,uuid,date,date,numeric,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.respond_to_marketplace_offer(uuid,text,numeric,date,date,text) from public,anon,authenticated,service_role;
revoke all on function public.link_request_offer_listing(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_item_request_response_counts(uuid[]) from public,anon,authenticated,service_role;
revoke all on public.marketplace_negotiations,public.negotiation_proposals from anon,authenticated;

create policy marketplace_notifications_no_private_offers on public.marketplace_notifications
  as restrictive for select to authenticated using (negotiation_id is null);
create policy marketplace_events_no_private_offers on public.marketplace_events
  as restrictive for select to authenticated using (negotiation_id is null);

create or replace function public.create_main_item_request(
  p_request jsonb,p_latitude double precision,p_longitude double precision,
  p_radius_miles integer,p_open_for_offers boolean,p_notify_matches_in_app boolean
)
returns public.item_requests language plpgsql security definer set search_path = '' as $$
declare v_request public.item_requests; v_existing public.item_requests;
begin
  perform public.marketplace_require_user();
  if p_open_for_offers is distinct from false or p_notify_matches_in_app is null then
    raise exception 'Private offers have been removed. Choose only your match-notification preference.' using errcode='55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('located-request:'||auth.uid()::text,0));
  select * into v_existing from public.item_requests
    where renter_id=auth.uid() and idempotency_key=(p_request->>'p_idempotency_key')::uuid;
  if found and (not v_existing.main_site_flow or v_existing.notify_matches_in_app<>p_notify_matches_in_app) then
    raise exception 'Request retry has different preferences' using errcode='22023';
  end if;
  v_request:=public.create_located_item_request(p_request,p_latitude,p_longitude,p_radius_miles);
  update public.item_requests set open_for_offers=false,notify_matches_in_app=p_notify_matches_in_app,main_site_flow=true
    where id=v_request.id returning * into v_request;
  return v_request;
end;
$$;
revoke all on function public.create_main_item_request(jsonb,double precision,double precision,integer,boolean,boolean) from public,anon;
grant execute on function public.create_main_item_request(jsonb,double precision,double precision,integer,boolean,boolean) to authenticated;

create or replace function public.get_listing_flow_policy()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.role()='authenticated' and not public.has_active_session() then
    raise exception 'An active signed-in session is required' using errcode='42501';
  end if;
  select jsonb_object_agg(substr(key,9),value) into v from public.app_settings
    where key in ('listing_duration_days','listing_max_quantity','listing_max_photos','listing_max_photo_bytes',
      'listing_min_photo_dimension','listing_max_delivery_fee','listing_high_value_threshold','listing_max_estimated_value');
  if v is null or (select count(*) from jsonb_object_keys(v))<>8 then
    raise exception 'Listing policy is unavailable. Contact support.' using errcode='55000';
  end if;
  if (v->>'high_value_threshold')::numeric>(v->>'max_estimated_value')::numeric then
    raise exception 'Listing review threshold exceeds the maximum replacement value. Contact support.' using errcode='55000';
  end if;
  return (v-'duration_days')||jsonb_build_object(
    'listing_duration_days',v->'duration_days',
    'high_value_threshold',case when (v->>'high_value_threshold')::numeric>0 then v->'high_value_threshold' else 'null'::jsonb end,
    'deposit_rules',coalesce((select jsonb_agg(to_jsonb(r)-'updated_at' order by r.category_id)
      from public.category_deposit_rules r),'[]'::jsonb));
end;
$$;
revoke all on function public.get_listing_flow_policy() from public,anon;
grant execute on function public.get_listing_flow_policy() to authenticated;

create or replace function public.listing_offer_within_rules(p_listing_id uuid,p_rate numeric,p_start date,p_end date)
returns boolean language sql stable security definer set search_path = '' as $$ select false $$;
revoke all on function public.listing_offer_within_rules(uuid,numeric,date,date) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;