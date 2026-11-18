begin;

-- Existing ceilings are retained. New commercial permissions start disabled, not implicitly approved.
insert into public.app_settings(key,value,value_type,min_value,max_value,description,is_public) values
 ('listing_duration_days','366','integer',1,366,'Maximum listing availability span in days (end date exclusive). Seed matches the existing 366-day booking ceiling.',false),
 ('listing_max_quantity','100','integer',1,100,'Maximum units per listing; existing hard ceiling is 100.',false),
 ('listing_max_photos','6','integer',1,6,'Maximum photos per listing; existing hard ceiling is six.',false),
 ('listing_max_photo_bytes','10485760','integer',1,10485760,'Maximum uploaded photo bytes; existing hard ceiling is 10 MiB.',false),
 ('listing_min_photo_dimension','320','integer',320,10000,'Minimum photo width and height. Browser validated; SQL cannot decode image bytes.',false),
 ('listing_max_delivery_fee','0','number',0,10000,'Maximum delivery fee. Paid delivery is disabled until explicitly configured. Fee is not yet charged at checkout.',false),
 ('listing_offers_configured','false','boolean',null,null,'Enable only after approving both asymmetric offer percentages. The bidding feature flag must also be enabled.',false),
 ('listing_offer_below_pct','0','number',0,1,'Approved maximum fraction below asking price. Inactive until listing_offers_configured is enabled.',false),
 ('listing_offer_above_pct','0','number',0,10,'Approved maximum fraction above asking price. Inactive until listing_offers_configured is enabled.',false),
 ('listing_high_value_threshold','0','number',0,1000000,'Values at or above this require individual admin approval. Zero means no threshold has been approved: all publications require review.',false)
on conflict(key) do nothing;

insert into public.category_deposit_rules(category_id)
select id from public.categories on conflict(category_id) do nothing;
create function public.seed_category_deposit_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.category_deposit_rules(category_id) values(new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger categories_seed_deposit_rule after insert on public.categories
  for each row execute function public.seed_category_deposit_rule();

alter table public.listings
  add column availability_start date,
  add column availability_end date,
  add column delivery_fee numeric(10,2) not null default 0,
  add column offer_maximum_daily numeric(10,2),
  add constraint listing_availability_range check (
    (availability_start is null and availability_end is null) or
    (availability_start is not null and availability_end is not null and availability_end>availability_start)),
  add constraint listing_delivery_fee_valid check (delivery_fee between 0 and 10000 and delivery_fee::text<>'NaN'),
  add constraint listing_offer_maximum_valid check (offer_maximum_daily between 0.01 and 100000 and offer_maximum_daily::text<>'NaN');
alter table public.listings drop constraint listings_status_check;
alter table public.listings add constraint listings_status_check
  check(status in ('draft','pending_approval','published','archived','suspended'));

create table public.listing_publication_approvals(
  listing_id uuid primary key references public.listings(id) on delete cascade,
  revision bigint not null,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  reason text not null
);
alter table public.listing_publication_approvals enable row level security;
revoke all on public.listing_publication_approvals from anon,authenticated;

create function public.get_listing_flow_policy()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_configured boolean;
begin
  if auth.role()='authenticated' and not public.has_active_session() then
    raise exception 'An active signed-in session is required' using errcode='42501';
  end if;
  select jsonb_object_agg(substr(key,9),value) into v from public.app_settings
    where key in ('listing_duration_days','listing_max_quantity','listing_max_photos',
      'listing_max_photo_bytes','listing_min_photo_dimension','listing_max_delivery_fee',
      'listing_offers_configured','listing_offer_below_pct','listing_offer_above_pct','listing_high_value_threshold');
  if v is null or (select count(*) from jsonb_object_keys(v))<>10 then
    raise exception 'Listing policy is unavailable. Contact support.' using errcode='55000';
  end if;
  v_configured:=(v->>'offers_configured')::boolean;
  return (v-'duration_days'-'offers_configured') || jsonb_build_object(
    'listing_duration_days',v->'duration_days',
    'offer_below_pct',case when v_configured then v->'offer_below_pct' else 'null'::jsonb end,
    'offer_above_pct',case when v_configured then v->'offer_above_pct' else 'null'::jsonb end,
    'high_value_threshold',case when (v->>'high_value_threshold')::numeric>0 then v->'high_value_threshold' else 'null'::jsonb end,
    'deposit_rules',coalesce((select jsonb_agg(to_jsonb(r)-'updated_at' order by r.category_id)
      from public.category_deposit_rules r),'[]'::jsonb));
end;
$$;
revoke all on function public.get_listing_flow_policy() from public,anon;
grant execute on function public.get_listing_flow_policy() to authenticated;

create function public.listing_offer_preferences_valid(p public.listings)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (policy->>'offer_below_pct') is not null and (policy->>'offer_above_pct') is not null
    and p.availability_start is not null and p.availability_end is not null
    and p.offer_minimum_daily>=greatest(0.01,round(p.price_per_day*(1-(policy->>'offer_below_pct')::numeric),2))
    and p.offer_maximum_daily<=least(100000,round(p.price_per_day*(1+(policy->>'offer_above_pct')::numeric),2))
    and p.offer_maximum_daily>=p.offer_minimum_daily
    and (p.offer_target_daily is null or p.offer_target_daily between p.offer_minimum_daily and p.offer_maximum_daily)
    and p.offer_start_date>=p.availability_start and p.offer_end_date<=p.availability_end
    and p.offer_end_date>p.offer_start_date
    and p.offer_expiration_hours between 1 and 168
    and not exists(select 1 from public.listing_flags where listing_id=p.id and not resolved
      and confidence='high' and type in ('prohibited_item','drug_related')),false)
  from (select public.get_listing_flow_policy() policy) s;
$$;

create function public.enforce_listing_flow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_policy jsonb; v_rule public.category_deposit_rules; v_approved boolean; v_changed boolean;
begin
  v_policy:=public.get_listing_flow_policy();
  if new.deposit::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Security deposit must be finite' using errcode='23514';
  end if;
  if new.estimated_value is not null then
    if new.estimated_value::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Estimated value must be a finite amount' using errcode='23514';
    end if;
    select * into v_rule from public.category_deposit_rules where category_id=new.category_id;
    if not found then raise exception 'Category deposit policy is unavailable' using errcode='55000';end if;
    new.deposit:=least(v_rule.maximum_amount,greatest(v_rule.minimum_amount,round(new.estimated_value*v_rule.suggested_pct,2)));
  else
    new.deposit:=0;
  end if;
  if new.available_quantity>(v_policy->>'max_quantity')::integer
    or new.delivery_fee>(v_policy->>'max_delivery_fee')::numeric
    or (not new.delivery_available and new.delivery_fee<>0) then
    raise exception 'Quantity or delivery fee exceeds listing policy' using errcode='23514';
  end if;
  if new.availability_start is not null and (new.availability_end is null
    or new.availability_end<=new.availability_start
    or new.availability_end-new.availability_start>(v_policy->>'listing_duration_days')::integer) then
    raise exception 'Availability exceeds the configured listing duration' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (new.available_quantity,new.availability_start,new.availability_end)
      is distinct from (old.available_quantity,old.availability_start,old.availability_end) then
    if exists(select 1 from public.bookings b where b.listing_id=old.id
      and b.status in ('requested','pending_payment','confirmed','active','return_pending')
      and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>now())
      and (new.availability_start is null or new.availability_end is null
        or b.start_date<new.availability_start or b.end_date>new.availability_end)) then
      raise exception 'Availability must contain existing reserved and rented dates' using errcode='23514';
    end if;
    if exists(select 1 from public.bookings b where b.listing_id=old.id
      and b.status in ('requested','pending_payment','confirmed','active','return_pending')
      and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>now())
      and (select coalesce(sum(other.quantity),0) from public.bookings other where other.listing_id=old.id
        and other.status in ('requested','pending_payment','confirmed','active','return_pending')
        and (other.status<>'pending_payment' or other.checkout_expires_at is null or other.checkout_expires_at>now())
        and other.start_date<=b.start_date and other.end_date>b.start_date)>new.available_quantity) then
      raise exception 'Quantity cannot be less than existing reserved and rented units' using errcode='23514';
    end if;
  end if;
  if new.negotiation_enabled and not public.listing_offer_preferences_valid(new) then
    if tg_op='UPDATE' and new.price_per_day is distinct from old.price_per_day
      and (new.offer_minimum_daily,new.offer_maximum_daily,new.offer_target_daily,new.offer_start_date,new.offer_end_date,new.offer_expiration_hours)
        is not distinct from (old.offer_minimum_daily,old.offer_maximum_daily,old.offer_target_daily,old.offer_start_date,old.offer_end_date,old.offer_expiration_hours) then
      new.negotiation_enabled:=false;
    elsif tg_op='UPDATE' and new.negotiation_enabled is not distinct from old.negotiation_enabled
      and (new.offer_minimum_daily,new.offer_maximum_daily,new.offer_target_daily,new.offer_start_date,new.offer_end_date,new.offer_expiration_hours)
        is not distinct from (old.offer_minimum_daily,old.offer_maximum_daily,old.offer_target_daily,old.offer_start_date,old.offer_end_date,old.offer_expiration_hours) then
      new.negotiation_enabled:=false;
    else
      raise exception 'Offer preferences are outside the approved listing policy' using errcode='23514';
    end if;
  end if;
  if tg_op='UPDATE' and old.status='published' and new.status='published'
    and (to_jsonb(new)-array['revision','updated_at','negotiation_enabled','offer_minimum_daily','offer_maximum_daily',
      'offer_target_daily','offer_guardrail_pct','offer_start_date','offer_end_date','offer_expiration_hours'])
      is not distinct from (to_jsonb(old)-array['revision','updated_at','negotiation_enabled','offer_minimum_daily','offer_maximum_daily',
      'offer_target_daily','offer_guardrail_pct','offer_start_date','offer_end_date','offer_expiration_hours'])
    and (new.negotiation_enabled,new.offer_minimum_daily,new.offer_maximum_daily,new.offer_target_daily,
      new.offer_guardrail_pct,new.offer_start_date,new.offer_end_date,new.offer_expiration_hours)
      is distinct from (old.negotiation_enabled,old.offer_minimum_daily,old.offer_maximum_daily,old.offer_target_daily,
      old.offer_guardrail_pct,old.offer_start_date,old.offer_end_date,old.offer_expiration_hours) then
    update public.listing_publication_approvals set revision=old.revision+1
      where listing_id=new.id and revision=old.revision;
  end if;
  if new.status in ('published','pending_approval') then
    v_changed:=tg_op='INSERT';
    if tg_op='UPDATE' then v_changed:=new.status is distinct from old.status;end if;
    if v_changed then
      if new.estimated_value is null or new.item_condition is null then
        raise exception 'Enter an owner-declared value and item condition before publishing' using errcode='23514';
      end if;
      if new.availability_start is null or new.availability_end is null or new.availability_end<=current_date then
        raise exception 'Choose a current listing availability range before publishing' using errcode='23514';
      end if;
      if not exists(select 1 from public.listing_images where listing_id=new.id)
        or not exists(select 1 from public.listing_pickup_locations where listing_id=new.id) then
        raise exception 'Add at least one photo and a private pickup location before publishing' using errcode='23514';
      end if;
      if (select count(*) from public.listing_images where listing_id=new.id)>(v_policy->>'max_photos')::integer then
        raise exception 'Listing photo limit reached' using errcode='23514';
      end if;
      if exists(select 1 from public.listing_flags where listing_id=new.id and not resolved
        and confidence='high' and type in ('prohibited_item','drug_related')) then
        raise exception 'This listing requires moderation review before publication' using errcode='23514';
      end if;
    end if;
    if v_policy->>'high_value_threshold' is null or new.estimated_value>=(v_policy->>'high_value_threshold')::numeric then
      select exists(select 1 from public.listing_publication_approvals where listing_id=new.id
        and revision=case when tg_op='INSERT' then 1 else old.revision+1 end) into v_approved;
      if not v_approved then new.status:='pending_approval';new.negotiation_enabled:=false;end if;
    end if;
    if new.status<>'published' then new.negotiation_enabled:=false;end if;
  elsif new.negotiation_enabled then
    raise exception 'Only published listings can accept offers' using errcode='23514';
  end if;
  return new;
end;
$$;
-- Runs before existing deposit checks, revision/history and validation triggers.
create trigger a_listing_flow_policy before insert or update on public.listings
  for each row execute function public.enforce_listing_flow();

create or replace function public.listing_has_capacity(p_listing_id uuid,p_start date,p_end date,p_quantity integer default 1,p_exclude_booking uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_start is not null and p_end>p_start and p_end-p_start<=366 and p_quantity between 1 and l.available_quantity
    and (l.availability_start is null or p_start>=l.availability_start)
    and (l.availability_end is null or p_end<=l.availability_end)
    and not exists(select 1 from public.listing_availability a where a.listing_id=l.id and not a.is_available and a.date>=p_start and a.date<p_end)
    and not exists(select 1 from generate_series(p_start::timestamp,(p_end-1)::timestamp,interval '1 day') day
      where (select coalesce(sum(b.quantity),0) from public.bookings b where b.listing_id=l.id
        and (p_exclude_booking is null or b.id<>p_exclude_booking)
        and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>now())
        and b.start_date<=day::date and b.end_date>day::date)+p_quantity>l.available_quantity)
  from public.listings l where l.id=p_listing_id;
$$;

create or replace function public.listing_offer_within_rules(p_listing_id uuid,p_rate numeric,p_start date,p_end date)
returns boolean language sql stable security definer set search_path = '' as $$
  select l.status='published' and l.negotiation_enabled and public.listing_offer_preferences_valid(l)
    and p_rate is not null and p_rate::text not in ('NaN','Infinity','-Infinity')
    and p_rate between l.offer_minimum_daily and l.offer_maximum_daily
    and p_start>=current_date and p_end>p_start and p_end-p_start<=366
    and p_start>=l.offer_start_date and p_end<=l.offer_end_date
    and p_start>=l.availability_start and p_end<=l.availability_end
  from public.listings l where l.id=p_listing_id;
$$;

create or replace function public.create_booking_request(p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer default 1)
returns public.bookings language plpgsql security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  if p_start_date is null or p_end_date is null or p_quantity is null or p_end_date-p_start_date>366 then
    raise exception 'Choose a complete rental period of at most 366 days and a valid quantity' using errcode='22023';
  end if;
  perform public.expire_listing_checkouts(p_listing_id);
  if not coalesce(public.listing_has_capacity(p_listing_id,p_start_date,p_end_date,p_quantity),false) then
    raise exception 'Listing is not available for the requested dates and quantity' using errcode='23P01';
  end if;
  return public.create_booking_request_before_reservations(p_listing_id,p_start_date,p_end_date,p_quantity);
end;
$$;

create function public.enforce_booking_listing_window()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('requested','pending_payment','confirmed','active','return_pending')
    and (tg_op='INSERT' or (new.start_date,new.end_date,new.quantity,new.status)
      is distinct from (old.start_date,old.end_date,old.quantity,old.status)) then
    perform 1 from public.listings where id=new.listing_id for update;
    if not coalesce(public.listing_has_capacity(new.listing_id,new.start_date,new.end_date,new.quantity,new.id),false) then
      raise exception 'Listing is not available for the requested dates and quantity' using errcode='23P01';
    end if;
  end if;
  return new;
end;
$$;
create trigger a_booking_listing_window before insert or update on public.bookings
  for each row execute function public.enforce_booking_listing_window();

alter function public.owner_save_listing(uuid,bigint,jsonb,jsonb) rename to owner_save_listing_before_flow;
revoke all on function public.owner_save_listing_before_flow(uuid,bigint,jsonb,jsonb) from public,anon,authenticated;

create function public.owner_save_listing_flow(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_new public.listings; v_core jsonb; v_changed boolean; v_pickup_changed boolean:=false;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if p_details is null or jsonb_typeof(p_details)<>'object' or exists(
    select 1 from jsonb_object_keys(p_details) key where key not in
      ('title','description','category_id','price_per_day','location_label','instant_booking','protection_eligible',
       'delivery_available','available_quantity','estimated_value','item_condition','availability_start','availability_end','delivery_fee')
  ) then raise exception 'Unsupported listing changes' using errcode='22023';end if;
  if p_publish is null then raise exception 'Publish must be true or false' using errcode='22023';end if;
  if p_pickup is not null then
    if jsonb_typeof(p_pickup)<>'object' or exists(select 1 from jsonb_object_keys(p_pickup) key
      where key not in ('formattedAddress','streetAddress','city','state','postalCode','country','latitude','longitude','placeId')) then
      raise exception 'Unsupported pickup changes' using errcode='22023';
    end if;
    select not exists(select 1 from public.listing_pickup_locations p where p.listing_id=p_listing_id
      and (p.address,p.street_address,p.city,p.state,p.postal_code,p.country,p.latitude,p.longitude,coalesce(p.place_id,''))
        is not distinct from (p_pickup->>'formattedAddress',p_pickup->>'streetAddress',p_pickup->>'city',
          p_pickup->>'state',p_pickup->>'postalCode',p_pickup->>'country',
          (p_pickup->>'latitude')::double precision,(p_pickup->>'longitude')::double precision,coalesce(p_pickup->>'placeId','')))
      into v_pickup_changed;
  end if;
  v_new:=jsonb_populate_record(v_listing,p_details);
  v_core:=p_details-array['availability_start','availability_end','delivery_fee'];
  select exists(select 1 from jsonb_each(p_details) e where e.value is distinct from to_jsonb(v_listing)->e.key) into v_changed;
  if v_changed or v_pickup_changed then
    -- Set terms in the same transaction; preserve the existing owner-save pickup and edit protections.
    if (v_new.availability_start,v_new.availability_end,v_new.delivery_fee) is distinct from
      (v_listing.availability_start,v_listing.availability_end,v_listing.delivery_fee) then
      update public.listings set availability_start=v_new.availability_start,availability_end=v_new.availability_end,
        delivery_fee=case when v_new.delivery_available then v_new.delivery_fee else 0 end,
        delivery_available=v_new.delivery_available where id=p_listing_id;
      select revision into p_revision from public.listings where id=p_listing_id;
    end if;
    perform public.owner_save_listing_before_flow(p_listing_id,p_revision,v_core,case when v_pickup_changed then p_pickup else null end);
  end if;
  select * into v_listing from public.listings where id=p_listing_id;
  if p_publish and v_listing.status not in ('published','pending_approval') then
    if v_listing.status='suspended' then raise exception 'Suspended listings cannot be published by owners' using errcode='42501';end if;
    update public.listings set status='published' where id=p_listing_id;
  end if;
  select * into v_listing from public.listings where id=p_listing_id;
  return jsonb_build_object('revision',v_listing.revision,'status',v_listing.status,'deposit',v_listing.deposit);
end;
$$;

-- Compatibility for existing callers; deposits are always computed by the trigger.
create function public.owner_save_listing(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result:=public.owner_save_listing_flow(p_listing_id,p_revision,p_details-'deposit',p_pickup,false);
  return (v_result->>'revision')::bigint;
end;
$$;

create function public.owner_save_offer_preferences(p_listing_id uuid,p_revision bigint,p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if v_listing.status<>'published' then raise exception 'Only published listings can accept offers' using errcode='55000';end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences)<>'object' or not(p_preferences ? 'negotiation_enabled')
    or exists(select 1 from jsonb_object_keys(p_preferences) key where key not in (
      'negotiation_enabled','offer_minimum_daily','offer_maximum_daily','offer_target_daily',
      'offer_start_date','offer_end_date','offer_expiration_hours')) then
    raise exception 'Unsupported offer preferences' using errcode='22023';
  end if;
  v_listing:=jsonb_populate_record(v_listing,p_preferences);
  if v_listing.negotiation_enabled and not public.listing_offer_preferences_valid(v_listing) then
    raise exception 'Offer preferences are outside the approved listing policy' using errcode='23514';
  end if;
  update public.listings set negotiation_enabled=v_listing.negotiation_enabled,
    offer_minimum_daily=v_listing.offer_minimum_daily,offer_maximum_daily=v_listing.offer_maximum_daily,
    offer_target_daily=v_listing.offer_target_daily,offer_guardrail_pct=null,
    offer_start_date=v_listing.offer_start_date,offer_end_date=v_listing.offer_end_date,
    offer_expiration_hours=v_listing.offer_expiration_hours where id=p_listing_id returning * into v_listing;
  return jsonb_build_object('revision',v_listing.revision,'status',v_listing.status,'deposit',v_listing.deposit);
end;
$$;

create function public.admin_approve_listing_publication(p_listing_id uuid,p_revision bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_reason text;
begin
  perform public.admin_require('listings.moderate');
  v_reason:=public.admin_clean_reason(p_reason);
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.status<>'pending_approval' then raise exception 'Listing is not awaiting approval' using errcode='55000';end if;
  if p_revision is null or p_revision<>v_listing.revision then raise exception 'Listing changed. Reload before reviewing.' using errcode='40001';end if;
  insert into public.listing_publication_approvals(listing_id,revision,approved_by,reason)
    values(p_listing_id,p_revision+1,auth.uid(),v_reason) on conflict(listing_id)
    do update set revision=excluded.revision,approved_by=excluded.approved_by,approved_at=now(),reason=excluded.reason;
  update public.listings set status='published' where id=p_listing_id returning * into v_listing;
  perform public.admin_write_audit('listing.publication_approved','listing',p_listing_id::text,
    jsonb_build_object('status','pending_approval','revision',p_revision),to_jsonb(v_listing),v_reason);
  return jsonb_build_object('revision',v_listing.revision,'status',v_listing.status,'deposit',v_listing.deposit);
end;
$$;

create function public.admin_get_listing_publication_review(p_listing_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.admin_require('listings.moderate');
  select to_jsonb(l)-array['location_lat','location_lng'] || jsonb_build_object(
    'images',coalesce((select jsonb_agg(jsonb_build_object('url',url,'sort_order',sort_order) order by sort_order,id)
      from public.listing_images where listing_id=l.id),'[]'::jsonb),
    'blocking_flags',coalesce((select jsonb_agg(jsonb_build_object('type',type,'reason',reason))
      from public.listing_flags where listing_id=l.id and not resolved and confidence='high'
        and type in ('prohibited_item','drug_related')),'[]'::jsonb))
    into v from public.listings l where l.id=p_listing_id and l.status='pending_approval';
  if v is null then raise exception 'Listing is not awaiting approval' using errcode='55000';end if;
  return v;
end;
$$;
create policy listing_images_storage_admin_review on storage.objects for select to authenticated
  using(bucket_id='listing-images' and public.has_admin_permission('listings.moderate'));

create function public.owner_reorder_listing_images(p_listing_id uuid,p_urls text[])
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_count integer; v_revision bigint;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  select count(*) into v_count from public.listing_images where listing_id=p_listing_id;
  if p_urls is null or cardinality(p_urls)<>v_count
    or (select count(distinct url) from unnest(p_urls) url)<>v_count
    or exists(select 1 from unnest(p_urls) input(url) where input.url is null or not exists(
      select 1 from public.listing_images i where i.listing_id=p_listing_id and i.url=input.url)) then
    raise exception 'Photo order must include each saved photo exactly once' using errcode='22023';
  end if;
  update public.listing_images i set sort_order=ordered.position-1
    from unnest(p_urls) with ordinality ordered(url,position)
    where i.listing_id=p_listing_id and i.url=ordered.url and i.sort_order<>ordered.position-1;
  select revision into v_revision from public.listings where id=p_listing_id;
  return v_revision;
end;
$$;

create function public.guard_published_listing_media()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.listings where id=old.listing_id for update;
  if v_status='published' and (tg_table_name='listing_pickup_locations'
    or (select count(*) from public.listing_images where listing_id=old.listing_id)<=1) then
    raise exception 'Archive the listing before removing its last photo or pickup location' using errcode='23514';
  end if;
  return old;
end;
$$;
create trigger a_listing_images_keep_published_photo before delete on public.listing_images
  for each row execute function public.guard_published_listing_media();
create trigger a_listing_pickup_keep_published_location before delete on public.listing_pickup_locations
  for each row execute function public.guard_published_listing_media();

create or replace function public.enforce_listing_photo_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max integer;
begin
  perform 1 from public.listings where id=new.listing_id for update;
  v_max:=(public.get_listing_flow_policy()->>'max_photos')::integer;
  if (select count(*) from public.listing_images where listing_id=new.listing_id)>=v_max then
    raise exception 'Listing photo limit reached' using errcode='23514';
  end if;
  return new;
end;
$$;

create function public.sync_listing_photo_bucket_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.key='listing_max_photo_bytes' then
    update storage.buckets set file_size_limit=(new.value #>> '{}')::bigint where id='listing-images';
  end if;
  return new;
end;
$$;
create trigger app_settings_listing_photo_bytes after update of value on public.app_settings
  for each row execute function public.sync_listing_photo_bucket_limit();

revoke all on function public.seed_category_deposit_rule(),public.listing_offer_preferences_valid(public.listings),
  public.enforce_listing_flow(),public.enforce_booking_listing_window(),public.sync_listing_photo_bucket_limit() from public,anon,authenticated;
revoke all on function public.guard_published_listing_media() from public,anon,authenticated;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean),
  public.owner_save_listing(uuid,bigint,jsonb,jsonb),public.owner_save_offer_preferences(uuid,bigint,jsonb),
  public.admin_approve_listing_publication(uuid,bigint,text),public.admin_get_listing_publication_review(uuid),
  public.owner_reorder_listing_images(uuid,text[]) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean),
  public.owner_save_listing(uuid,bigint,jsonb,jsonb),public.owner_save_offer_preferences(uuid,bigint,jsonb),
  public.admin_approve_listing_publication(uuid,bigint,text),public.admin_get_listing_publication_review(uuid),
  public.owner_reorder_listing_images(uuid,text[]) to authenticated;
commit;
