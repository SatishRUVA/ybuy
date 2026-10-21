begin;
create or replace function public.admin_investigate_customers_geography(
  p_customer_ids text[], p_from timestamptz, p_to timestamptz, p_reason text,
  p_limit integer default 25, p_offset integer default 0,
  p_country_code text default null, p_region_code text default null,
  p_group_by text default 'input'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_country text := nullif(upper(btrim(p_country_code)),'');
  v_region text := nullif(upper(btrim(p_region_code)),'');
  v_ids text[];
  v_count integer;
  v_result jsonb;
begin
  perform public.admin_require('fraud.investigate');
  if p_customer_ids is null or cardinality(p_customer_ids) not between 1 and 100
    or exists(select 1 from unnest(p_customer_ids) value where length(coalesce(value,''))>64) then
    raise exception 'Use 1-100 identifiers of at most 64 characters' using errcode='22023';
  end if;
  if p_group_by is null or p_group_by not in ('input','country','region')
    or (v_country is not null and not exists(select 1 from public.reference_countries where code=v_country))
    or (v_region is not null and (v_country is null or not exists(
      select 1 from public.reference_regions where country_code=v_country and code=v_region))) then
    raise exception 'Choose a valid country/subdivision and input, country or region grouping' using errcode='22023';
  end if;
  with requested as (
    select upper(btrim(coalesce(value,''))) customer_id,min(ordinality) position
    from unnest(p_customer_ids) with ordinality input(value,ordinality)
    group by upper(btrim(coalesce(value,'')))
  ), eligible as (
    select r.*,p.country_code,p.state_region_code from requested r
    left join public.profiles p on p.customer_id=r.customer_id
    where p.id is null or ((v_country is null or p.country_code=v_country)
      and (v_region is null or p.state_region_code=v_region))
  )
  select (select count(*) from requested),array_agg(customer_id order by
    case when p_group_by in ('country','region') then country_code end nulls last,
    case when p_group_by='region' then state_region_code end nulls last,position)
  into v_count,v_ids from eligible;

  -- Reuse the permission, period, pagination, rate-limit and event-query boundary.
  v_result:=public.admin_investigate_customers(
    case when v_ids is null then p_customer_ids else v_ids end,
    p_from,p_to,p_reason,p_limit,p_offset);
  if v_ids is null then
    v_result:=v_result||jsonb_build_object('rows','[]'::jsonb,'total',0);
  else
    v_result:=v_result||jsonb_build_object('rows',coalesce((
      select jsonb_agg(r.value||jsonb_build_object(
        'country_code',p.country_code,'state_region_code',p.state_region_code,
        'location_updated_at',p.location_updated_at) order by r.ordinality)
      from jsonb_array_elements(v_result->'rows') with ordinality r(value,ordinality)
      left join public.profiles p on p.customer_id=r.value->>'customer_id'
    ),'[]'::jsonb));
  end if;
  perform public.admin_write_audit('customer.investigate.geography','customer_batch',null,null,
    jsonb_build_object('country_code',v_country,'region_code',v_region,'group_by',p_group_by,
      'customer_ids',p_customer_ids,'from',p_from,'to',p_to,'limit',p_limit,'offset',p_offset),
    public.admin_clean_reason(p_reason));
  return v_result||jsonb_build_object(
    'duplicate_count',cardinality(p_customer_ids)-v_count,
    'filtered_out_count',v_count-coalesce(cardinality(v_ids),0),
    'limitations',((v_result->'limitations')-'Historical transaction locations and shared payment/device identifiers are not collected.')
      ||jsonb_build_array('Profile geography is current and self-reported. New bookings store transaction geography separately; no continuous location/device history or cross-border risk score is collected.'));
end;
$$;
commit;
