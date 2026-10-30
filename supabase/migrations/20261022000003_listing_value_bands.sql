begin;

insert into public.app_settings(key,value,value_type,min_value,max_value,description,is_public)
values ('listing_max_estimated_value','5000','number',0.01,1000000,
 'Maximum permitted declared replacement value in USD. Larger values cannot be saved or published, including after admin review.',false);

update public.app_settings
set value='1000'::jsonb,
    description='Declared replacement values strictly above this USD amount require admin approval. Values equal to or below it can publish after all other checks. Zero disables automatic value approval.'
where key='listing_high_value_threshold';

alter table public.listings drop constraint listings_estimated_value_valid;
alter table public.listings add constraint listings_estimated_value_valid
  check (estimated_value between 0 and 1000000);

create or replace function public.get_listing_flow_policy()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_configured boolean;
begin
  if auth.role()='authenticated' and not public.has_active_session() then
    raise exception 'An active signed-in session is required' using errcode='42501';
  end if;
  select jsonb_object_agg(substr(key,9),value) into v from public.app_settings
    where key in ('listing_duration_days','listing_max_quantity','listing_max_photos',
      'listing_max_photo_bytes','listing_min_photo_dimension','listing_max_delivery_fee',
      'listing_offers_configured','listing_offer_below_pct','listing_offer_above_pct',
      'listing_high_value_threshold','listing_max_estimated_value');
  if v is null or (select count(*) from jsonb_object_keys(v))<>11 then
    raise exception 'Listing policy is unavailable. Contact support.' using errcode='55000';
  end if;
  if (v->>'high_value_threshold')::numeric>(v->>'max_estimated_value')::numeric then
    raise exception 'Listing review threshold exceeds the maximum replacement value. Contact support.' using errcode='55000';
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

create function public.enforce_listing_value_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max numeric;
begin
  v_max:=(public.get_listing_flow_policy()->>'max_estimated_value')::numeric;
  if new.estimated_value is not null and (new.estimated_value::text in ('NaN','Infinity','-Infinity')
    or new.estimated_value<0 or new.estimated_value>v_max) then
    raise exception 'Estimated replacement value must be between $0 and $%. Items above this limit cannot be listed.',v_max
      using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_listing_value_limit() from public,anon,authenticated;
create trigger a_listing_declared_value before insert or update on public.listings
  for each row execute function public.enforce_listing_value_limit();

create or replace function public.owner_save_listing_flow(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false)
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
  if p_publish and (v_listing.status not in ('published','pending_approval')
    or (v_listing.status='pending_approval' and
      v_listing.estimated_value<=(public.get_listing_flow_policy()->>'high_value_threshold')::numeric)) then
    if v_listing.status='suspended' then raise exception 'Suspended listings cannot be published by owners' using errcode='42501';end if;
    update public.listings set status='published' where id=p_listing_id;
  end if;
  select * into v_listing from public.listings where id=p_listing_id;
  return jsonb_build_object('revision',v_listing.revision,'status',v_listing.status,'deposit',v_listing.deposit);
end;
$$;

commit;
