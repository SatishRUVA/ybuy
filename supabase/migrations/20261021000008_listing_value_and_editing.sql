begin;
alter table public.listings
  add column estimated_value numeric(12,2),
  add column item_condition text,
  add column revision bigint not null default 1,
  add constraint listings_estimated_value_valid check (estimated_value > 0 and estimated_value <= 1000000),
  add constraint listings_item_condition_valid check (item_condition in ('new','like_new','good','fair'));

create table public.category_deposit_rules (
  category_id uuid primary key references public.categories(id) on delete cascade,
  suggested_pct numeric not null default 0.30 check (suggested_pct between 0 and 1),
  minimum_amount numeric(10,2) not null default 0 check (minimum_amount between 0 and 10000),
  maximum_amount numeric(10,2) not null default 10000 check (maximum_amount between minimum_amount and 10000),
  updated_at timestamptz not null default now()
);
alter table public.category_deposit_rules enable row level security;
grant select on public.category_deposit_rules to anon,authenticated;
revoke insert,update,delete on public.category_deposit_rules from anon,authenticated;
create policy category_deposit_rules_read on public.category_deposit_rules for select to anon,authenticated using (true);

create function public.admin_save_deposit_rule(p_category_id uuid,p_pct numeric,p_min numeric,p_max numeric,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_reason text;
begin
  perform public.admin_require('categories.manage');
  v_reason := public.admin_clean_reason(p_reason);
  if p_pct is null or not (p_pct between 0 and 1) or p_min is null or p_max is null
    or not (p_min between 0 and p_max and p_max <= 10000)
    or p_min<>round(p_min,2) or p_max<>round(p_max,2) then
    raise exception 'Use a percentage between 0 and 100 and deposit limits between 0 and 10000' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('deposit-rule:'||p_category_id::text,0));
  select to_jsonb(r) into v_old from public.category_deposit_rules r where category_id=p_category_id;
  insert into public.category_deposit_rules(category_id,suggested_pct,minimum_amount,maximum_amount)
    values(p_category_id,p_pct,p_min,p_max)
    on conflict(category_id) do update set suggested_pct=excluded.suggested_pct,
      minimum_amount=excluded.minimum_amount,maximum_amount=excluded.maximum_amount,updated_at=now()
    returning to_jsonb(category_deposit_rules) into v_new;
  perform public.admin_write_audit('category.deposit_rule','category',p_category_id::text,v_old,v_new,v_reason);
end;
$$;
revoke all on function public.admin_save_deposit_rule(uuid,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.admin_save_deposit_rule(uuid,numeric,numeric,numeric,text) to authenticated;

create table public.listing_change_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  actor_id uuid,
  revision bigint not null,
  old_value jsonb not null,
  new_value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.listing_change_history enable row level security;
revoke all on public.listing_change_history from anon,authenticated;
grant select on public.listing_change_history to authenticated;
create policy listing_history_owner on public.listing_change_history for select to authenticated
  using (public.has_active_session() and old_value->>'owner_id'=auth.uid()::text);
create index listing_change_history_listing_idx on public.listing_change_history(listing_id,revision desc);

create function public.protect_listing_edits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rule public.category_deposit_rules; v_material boolean;
begin
  if tg_op='UPDATE' then
    if new.id<>old.id or new.owner_id<>old.owner_id then
      raise exception 'Listing identity and ownership cannot be changed' using errcode='42501';
    end if;
    new.revision := old.revision+1;
    v_material := (new.title,new.description,new.category_id,new.item_condition,new.estimated_value,
      new.location_lat,new.location_lng,new.location_label,new.available_quantity)
      is distinct from (old.title,old.description,old.category_id,old.item_condition,old.estimated_value,
      old.location_lat,old.location_lng,old.location_label,old.available_quantity);
    if v_material and exists(select 1 from public.bookings where listing_id=old.id
      and status in ('pending_payment','confirmed','active','return_pending')) then
      raise exception 'Item, location and quantity changes require existing approved rentals to finish. Future pricing may still be updated.' using errcode='23514';
    end if;
  else
    new.revision:=1;
  end if;
  if new.estimated_value::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Estimated value must be a finite amount' using errcode='23514';
  end if;
  if new.status='published' and (tg_op='INSERT' or old.status<>'published') then
    if new.estimated_value is null or new.item_condition is null then
      raise exception 'Enter an owner-declared value and item condition before publishing' using errcode='23514';
    end if;
  end if;
  if new.status='published' and (tg_op='INSERT' or new.deposit is distinct from old.deposit
    or new.category_id is distinct from old.category_id or new.status is distinct from old.status) then
    select * into v_rule from public.category_deposit_rules where category_id=new.category_id;
    if found and not (new.deposit between v_rule.minimum_amount and v_rule.maximum_amount) then
      raise exception 'Security deposit is outside this category''s configured limits' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger listings_protect_edits before insert or update on public.listings
  for each row execute function public.protect_listing_edits();

create function public.record_listing_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new)-array['revision','updated_at']) is distinct from (to_jsonb(old)-array['revision','updated_at']) then
    insert into public.listing_change_history(listing_id,actor_id,revision,old_value,new_value)
      values(new.id,auth.uid(),new.revision,
        to_jsonb(old)-array['location_lat','location_lng'],
        to_jsonb(new)-array['location_lat','location_lng']);
  end if;
  return new;
end;
$$;
create trigger listings_record_edit after update on public.listings for each row execute function public.record_listing_edit();

create function public.owner_save_listing(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_revision bigint;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501'; end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if p_details is null or jsonb_typeof(p_details)<>'object' or exists(
    select 1 from jsonb_object_keys(p_details) key where key not in
      ('title','description','category_id','price_per_day','deposit','location_label','instant_booking',
       'protection_eligible','delivery_available','available_quantity','negotiation_enabled','estimated_value','item_condition')
  ) then raise exception 'Unsupported listing changes' using errcode='22023'; end if;
  v_listing := jsonb_populate_record(v_listing,p_details);
  update public.listings set title=v_listing.title,description=v_listing.description,category_id=v_listing.category_id,
    price_per_day=v_listing.price_per_day,deposit=v_listing.deposit,location_label=v_listing.location_label,
    instant_booking=v_listing.instant_booking,protection_eligible=v_listing.protection_eligible,
    delivery_available=v_listing.delivery_available,available_quantity=v_listing.available_quantity,
    negotiation_enabled=v_listing.negotiation_enabled,estimated_value=v_listing.estimated_value,item_condition=v_listing.item_condition
    where id=p_listing_id returning revision into v_revision;
  if p_pickup is not null then
    if exists(select 1 from public.bookings where listing_id=p_listing_id and status in ('pending_payment','confirmed','active','return_pending')) then
      raise exception 'Pickup changes require existing approved rentals to finish' using errcode='23514';
    end if;
    insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,latitude,longitude,place_id)
    values(p_listing_id,auth.uid(),p_pickup->>'formattedAddress',p_pickup->>'streetAddress',p_pickup->>'city',p_pickup->>'state',
      p_pickup->>'postalCode',p_pickup->>'country',(p_pickup->>'latitude')::double precision,(p_pickup->>'longitude')::double precision,
      nullif(p_pickup->>'placeId',''))
    on conflict(listing_id) do update set address=excluded.address,street_address=excluded.street_address,city=excluded.city,
      state=excluded.state,postal_code=excluded.postal_code,country=excluded.country,latitude=excluded.latitude,longitude=excluded.longitude,place_id=excluded.place_id;
    select revision into v_revision from public.listings where id=p_listing_id;
  end if;
  return v_revision;
end;
$$;
revoke all on function public.owner_save_listing(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_save_listing(uuid,bigint,jsonb,jsonb) to authenticated;

create function public.protect_listing_related_edits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_id uuid;
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
    if not (new.latitude between -90 and 90 and new.longitude between -180 and 180) then
      raise exception 'Invalid pickup coordinates' using errcode='23514';
    end if;
    if new.owner_id<>v_listing.owner_id then raise exception 'Pickup owner does not match listing' using errcode='42501'; end if;
    update public.listings set location_lat=round(new.latitude::numeric,2),location_lng=round(new.longitude::numeric,2),
      location_label=concat_ws(', ',nullif(new.city,''),nullif(new.state,'')) where id=v_id;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger listing_images_protect_changes before insert or update or delete on public.listing_images
  for each row execute function public.protect_listing_related_edits();
create trigger listing_pickup_protect_changes before insert or update or delete on public.listing_pickup_locations
  for each row execute function public.protect_listing_related_edits();
revoke all on function public.protect_listing_related_edits() from public,anon,authenticated;
revoke all on function public.protect_listing_edits(),public.record_listing_edit() from public,anon,authenticated;
commit;
