begin;

create or replace function public.enforce_listing_flow()
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
  if new.availability_start is not null and (tg_op='INSERT' or
    (new.availability_start,new.availability_end) is distinct from (old.availability_start,old.availability_end))
    and (new.availability_end is null or new.availability_end<=new.availability_start
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
    if v_policy->>'high_value_threshold' is null or new.estimated_value>(v_policy->>'high_value_threshold')::numeric then
      select exists(select 1 from public.listing_publication_approvals where listing_id=new.id
        and revision=case when tg_op='INSERT' then 1 else old.revision+1 end) into v_approved;
      if not v_approved then new.status:='pending_approval';end if;
    end if;
  elsif new.negotiation_enabled and new.status<>'draft' then
    raise exception 'Offers require a draft, pending or published listing' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function public.owner_save_offer_preferences(p_listing_id uuid,p_revision bigint,p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings; v_previous public.listings;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if v_listing.status not in ('draft','pending_approval','published') then
    raise exception 'Offer preferences require a draft, pending or published listing' using errcode='55000';
  end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences)<>'object' or not(p_preferences ? 'negotiation_enabled')
    or exists(select 1 from jsonb_object_keys(p_preferences) key where key not in (
      'negotiation_enabled','offer_minimum_daily','offer_maximum_daily','offer_target_daily',
      'offer_start_date','offer_end_date','offer_expiration_hours')) then
    raise exception 'Unsupported offer preferences' using errcode='22023';
  end if;
  v_previous:=v_listing;
  v_listing:=jsonb_populate_record(v_listing,p_preferences);
  if v_listing.negotiation_enabled and not public.listing_offer_preferences_valid(v_listing) then
    raise exception 'Offer preferences are outside the approved listing policy' using errcode='23514';
  end if;
  if (v_listing.negotiation_enabled,v_listing.offer_minimum_daily,v_listing.offer_maximum_daily,
      v_listing.offer_target_daily,v_listing.offer_start_date,v_listing.offer_end_date,v_listing.offer_expiration_hours)
    is distinct from (v_previous.negotiation_enabled,v_previous.offer_minimum_daily,v_previous.offer_maximum_daily,
      v_previous.offer_target_daily,v_previous.offer_start_date,v_previous.offer_end_date,v_previous.offer_expiration_hours) then
    update public.listings set negotiation_enabled=v_listing.negotiation_enabled,
      offer_minimum_daily=v_listing.offer_minimum_daily,offer_maximum_daily=v_listing.offer_maximum_daily,
      offer_target_daily=v_listing.offer_target_daily,offer_guardrail_pct=null,
      offer_start_date=v_listing.offer_start_date,offer_end_date=v_listing.offer_end_date,
      offer_expiration_hours=v_listing.offer_expiration_hours where id=p_listing_id returning * into v_listing;
  end if;
  return jsonb_build_object('revision',v_listing.revision,'status',v_listing.status,'deposit',v_listing.deposit);
end;
$$;

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_offers;
revoke all on function public.owner_save_listing_flow_before_offers(uuid,bigint,jsonb,jsonb,boolean)
  from public,anon,authenticated;

-- Save draft terms and offers before publication, rolling everything back if either fails.
create function public.owner_save_listing_flow(p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not coalesce(p_details ? 'offer_preferences',false) then
    return public.owner_save_listing_flow_before_offers(p_listing_id,p_revision,p_details,p_pickup,p_publish);
  end if;
  if p_publish is null then raise exception 'Publish must be true or false' using errcode='22023';end if;
  if jsonb_typeof(p_details->'offer_preferences') is distinct from 'object' then
    raise exception 'Unsupported offer preferences' using errcode='22023';
  end if;
  v_result:=public.owner_save_listing_flow_before_offers(p_listing_id,p_revision,p_details-'offer_preferences',p_pickup,false);
  v_result:=public.owner_save_offer_preferences(p_listing_id,(v_result->>'revision')::bigint,p_details->'offer_preferences');
  if p_publish then
    v_result:=public.owner_save_listing_flow_before_offers(p_listing_id,(v_result->>'revision')::bigint,'{}',null,true);
  end if;
  return v_result;
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

commit;
