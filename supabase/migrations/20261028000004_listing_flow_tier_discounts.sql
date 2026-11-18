begin;

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_tier_discounts;
revoke all on function public.owner_save_listing_flow_before_tier_discounts(uuid,bigint,jsonb,jsonb,boolean) from public,anon,authenticated;

create function public.owner_save_listing_flow(
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
