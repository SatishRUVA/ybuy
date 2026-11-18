begin;

alter table public.listings
  add column brand text not null default '',
  add column model text not null default '',
  add column included_items text[] not null default '{}',
  add column additional_details text not null default '',
  add column delivery_radius_miles integer,
  add constraint listing_delivery_radius_valid check(delivery_radius_miles in (5,10,25,50));

create function public.validate_listing_item_details()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_text text;
begin
  if char_length(new.brand)>80 or char_length(new.model)>80 or char_length(new.additional_details)>500 then
    raise exception 'Item details must be plain text within their field limits' using errcode='23514';
  end if;
  foreach v_text in array array[new.brand,new.model,new.additional_details] || new.included_items loop
    if v_text is null
      or v_text ~* '<\s*/?\s*[a-zA-Z!?]|javascript\s*:|[\x01-\x08\x0b\x0c\x0e-\x1f]' then
      raise exception 'Item details must be plain text within their field limits' using errcode='23514';
    end if;
  end loop;
  if cardinality(new.included_items)>12 or array_ndims(new.included_items)>1
    or exists(select 1 from unnest(new.included_items) item where char_length(btrim(item))=0 or char_length(item)>60)
    or (select count(distinct lower(btrim(item))) from unnest(new.included_items) item)<>cardinality(new.included_items) then
    raise exception 'Choose up to 12 unique included items, each 1 to 60 characters' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (new.brand,new.model,new.included_items,new.additional_details,new.delivery_radius_miles)
      is distinct from (old.brand,old.model,old.included_items,old.additional_details,old.delivery_radius_miles)
    and exists(select 1 from public.bookings where listing_id=old.id
      and status in ('pending_payment','confirmed','active','return_pending')) then
    raise exception 'Item and delivery detail changes require existing approved rentals to finish' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_listing_item_details() from public,anon,authenticated;
create trigger a_listing_item_details before insert or update on public.listings
  for each row execute function public.validate_listing_item_details();

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_item_details;
revoke all on function public.owner_save_listing_flow_before_item_details(uuid,bigint,jsonb,jsonb,boolean)
  from public,anon,authenticated;

create function public.owner_save_listing_flow(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_new public.listings; v_details jsonb; v_result jsonb;
begin
  if not coalesce(p_details ? 'item_details',false) then
    return public.owner_save_listing_flow_before_item_details(p_listing_id,p_revision,p_details,p_pickup,p_publish);
  end if;
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if p_publish is null then raise exception 'Publish must be true or false' using errcode='22023';end if;
  v_details:=p_details->'item_details';
  if jsonb_typeof(v_details) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_details) key
    where key not in ('brand','model','included_items','additional_details','delivery_radius_miles')) then
    raise exception 'Unsupported item details' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(v_details) e where
    (e.key in ('brand','model','additional_details') and jsonb_typeof(e.value)<>'string')
    or (e.key='included_items' and jsonb_typeof(e.value)<>'array')) then
    raise exception 'Invalid item detail types' using errcode='22023';
  end if;
  if v_details ? 'included_items' and exists(select 1 from jsonb_array_elements(v_details->'included_items') item where jsonb_typeof(item)<>'string') then
    raise exception 'Included items must be text' using errcode='22023';
  end if;
  if v_details ? 'delivery_radius_miles' and jsonb_typeof(v_details->'delivery_radius_miles') not in ('number','null') then
    raise exception 'Delivery radius must be a number or null' using errcode='22023';
  end if;
  v_new:=jsonb_populate_record(v_listing,v_details);
  if (v_new.brand,v_new.model,v_new.included_items,v_new.additional_details,v_new.delivery_radius_miles)
      is distinct from (v_listing.brand,v_listing.model,v_listing.included_items,v_listing.additional_details,v_listing.delivery_radius_miles) then
    update public.listings set brand=v_new.brand,model=v_new.model,included_items=v_new.included_items,
      additional_details=v_new.additional_details,delivery_radius_miles=v_new.delivery_radius_miles
      where id=p_listing_id returning revision into p_revision;
  end if;
  v_result:=public.owner_save_listing_flow_before_item_details(p_listing_id,p_revision,p_details-'item_details',p_pickup,p_publish);
  return v_result;
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

commit;
