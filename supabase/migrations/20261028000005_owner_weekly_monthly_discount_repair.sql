begin;

-- Earlier deployments recorded the tier migrations while missing the enabled
-- columns and save RPC. Keep this migration safe for both partial and fresh schemas.
alter table public.listings
  add column if not exists weekly_discount_enabled boolean not null default false,
  add column if not exists monthly_discount_enabled boolean not null default false;
alter table public.listings
  alter column weekly_discount_percent set default 20,
  alter column monthly_discount_percent set default 30;

create or replace function public.owner_save_rental_discounts(
  p_listing_id uuid,p_revision bigint,p_weekly_enabled boolean,p_weekly_discount_percent numeric,
  p_monthly_enabled boolean,p_monthly_discount_percent numeric
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings;
begin
  perform public.operations_require_session();
  if not exists(select 1 from public.feature_flags where key='duration_discounts' and enabled) then
    raise exception 'Owner discounts are not enabled in this test environment' using errcode='55000';
  end if;
  if p_weekly_enabled is null or p_monthly_enabled is null or p_weekly_discount_percent is null or p_monthly_discount_percent is null
    or p_weekly_discount_percent::text in ('NaN','Infinity','-Infinity')
    or p_monthly_discount_percent::text in ('NaN','Infinity','-Infinity')
    or p_weekly_discount_percent not between 0 and 50 or p_monthly_discount_percent not between 0 and 50 then
    raise exception 'Rental discounts must each be between 0 and 50 percent' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or v_listing.revision<>p_revision then raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';end if;
  update public.listings set duration_discount_min_days=null,duration_discount_percent=0,
    weekly_discount_enabled=p_weekly_enabled,weekly_discount_percent=p_weekly_discount_percent,
    monthly_discount_enabled=p_monthly_enabled,monthly_discount_percent=p_monthly_discount_percent
    where id=p_listing_id returning revision into p_revision;
  return p_revision;
end;
$$;
revoke all on function public.owner_save_rental_discounts(uuid,bigint,boolean,numeric,boolean,numeric) from public,anon;
grant execute on function public.owner_save_rental_discounts(uuid,bigint,boolean,numeric,boolean,numeric) to authenticated;

create or replace function public.apply_owner_duration_discount()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings;v_gross numeric(10,2);v_discount_pct numeric(5,2);v_discount numeric(10,2);v_package_days integer:=0;
begin
  select * into v_listing from public.listings where id=new.listing_id;
  if not found or new.auction_bid_id is not null
    or not exists(select 1 from public.feature_flags where key='duration_discounts' and enabled) then
    new.owner_discount_amount:=0;new.owner_discount_source:='none';return new;
  end if;
  if new.days>=30 and v_listing.monthly_discount_enabled then
    v_package_days:=30;v_discount_pct:=v_listing.monthly_discount_percent;
  elsif new.days>=7 and v_listing.weekly_discount_enabled then
    v_package_days:=7;v_discount_pct:=v_listing.weekly_discount_percent;
  else
    v_discount_pct:=0;
  end if;
  if v_discount_pct<=0 then new.owner_discount_amount:=0;new.owner_discount_source:='none';return new;end if;
  v_gross:=round(new.daily_rate*new.days*new.quantity,2);
  v_discount:=round(new.daily_rate*v_package_days*new.quantity*v_discount_pct/100,2);
  new.owner_discount_amount:=least(v_gross,v_discount);new.owner_discount_source:='duration';
  new.subtotal:=v_gross-new.owner_discount_amount;
  new.service_fee_amount:=round(new.subtotal*new.service_fee_pct,2);
  new.total:=new.subtotal+new.service_fee_amount+new.deposit;
  return new;
end;
$$;

create or replace function public.owner_save_listing_flow(
  p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_listing public.listings; v_weekly numeric; v_monthly numeric; v_weekly_enabled boolean; v_monthly_enabled boolean; v_has_discounts boolean;
begin
  if jsonb_typeof(p_details) is distinct from 'object' then raise exception 'Invalid listing details' using errcode='22023';end if;
  v_has_discounts:=p_details ? 'weekly_discount_enabled' or p_details ? 'weekly_discount_percent' or p_details ? 'monthly_discount_enabled' or p_details ? 'monthly_discount_percent';
  if v_has_discounts then
    if (p_details ? 'weekly_discount_enabled' and jsonb_typeof(p_details->'weekly_discount_enabled') is distinct from 'boolean')
      or (p_details ? 'monthly_discount_enabled' and jsonb_typeof(p_details->'monthly_discount_enabled') is distinct from 'boolean')
      or (p_details ? 'weekly_discount_percent' and jsonb_typeof(p_details->'weekly_discount_percent') is distinct from 'number')
      or (p_details ? 'monthly_discount_percent' and jsonb_typeof(p_details->'monthly_discount_percent') is distinct from 'number') then
      raise exception 'Enter valid rental discounts' using errcode='22023';
    end if;
    select * into v_listing from public.listings where id=p_listing_id;
    v_weekly_enabled:=case when p_details ? 'weekly_discount_enabled' then (p_details->>'weekly_discount_enabled')::boolean else v_listing.weekly_discount_enabled end;
    v_weekly:=case when p_details ? 'weekly_discount_percent' then (p_details->>'weekly_discount_percent')::numeric else v_listing.weekly_discount_percent end;
    v_monthly_enabled:=case when p_details ? 'monthly_discount_enabled' then (p_details->>'monthly_discount_enabled')::boolean else v_listing.monthly_discount_enabled end;
    v_monthly:=case when p_details ? 'monthly_discount_percent' then (p_details->>'monthly_discount_percent')::numeric else v_listing.monthly_discount_percent end;
    if v_weekly_enabled is null or v_monthly_enabled is null or v_weekly is null or v_monthly is null or v_weekly not between 0 and 50 or v_monthly not between 0 and 50 then
      raise exception 'Choose discounts from 0 to 50 percent' using errcode='22023';
    end if;
    if ((v_weekly_enabled and v_weekly>0) or (v_monthly_enabled and v_monthly>0))
      and (v_weekly_enabled,v_weekly,v_monthly_enabled,v_monthly) is distinct from (v_listing.weekly_discount_enabled,v_listing.weekly_discount_percent,v_listing.monthly_discount_enabled,v_listing.monthly_discount_percent)
      and not exists(select 1 from public.feature_flags where key='duration_discounts' and enabled) then
      raise exception 'Long-rental discounts are not enabled in this test environment' using errcode='55000';
    end if;
  end if;
  v_result:=public.owner_save_listing_flow_before_tier_discounts(
    p_listing_id,p_revision,p_details-array['weekly_discount_enabled','weekly_discount_percent','monthly_discount_enabled','monthly_discount_percent'],p_pickup,p_publish
  );
  if v_has_discounts then
    update public.listings set weekly_discount_enabled=v_weekly_enabled,weekly_discount_percent=v_weekly,
      monthly_discount_enabled=v_monthly_enabled,monthly_discount_percent=v_monthly where id=p_listing_id;
  end if;
  select jsonb_build_object('revision',revision,'status',status,'deposit',deposit) into v_result from public.listings where id=p_listing_id;
  return v_result;
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
