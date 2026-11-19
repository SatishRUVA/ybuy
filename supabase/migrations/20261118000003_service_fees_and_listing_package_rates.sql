begin;

alter table public.listings
  add column price_per_month numeric(10,2) check (price_per_month is null or price_per_month > 0);

alter table public.bookings
  alter column service_fee_pct type numeric(11,10),
  add column service_fee_total_pct numeric(9,8) check (service_fee_total_pct between 0 and 0.30),
  add column service_fee_renter_share_pct smallint check (service_fee_renter_share_pct between 0 and 100),
  add column owner_service_fee_pct numeric(11,10) check (owner_service_fee_pct between 0 and 0.30),
  add column owner_service_fee_amount numeric(10,2) check (owner_service_fee_amount >= 0);

create table public.service_fee_configurations (
  id uuid primary key default gen_random_uuid(),
  total_fee_pct numeric(9,8) not null check (total_fee_pct between 0 and 0.30),
  renter_share_percent smallint not null check (renter_share_percent between 0 and 100),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid references public.profiles(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_reason text,
  created_at timestamptz not null default clock_timestamp(),
  check (effective_to is null or effective_to > effective_from),
  check (updated_reason is null or length(btrim(updated_reason)) between 3 and 500),
  exclude using gist (tstzrange(effective_from, effective_to, '[)') with &&)
);
alter table public.service_fee_configurations enable row level security;
revoke all on public.service_fee_configurations from public, anon, authenticated, service_role;

insert into public.service_fee_configurations(total_fee_pct,renter_share_percent,effective_from,reason)
select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='platform_fee_pct'),0.10),
  100,'-infinity'::timestamptz,'Initial configuration migrated from the existing 10% platform fee; renter share remains 100%.';

create function public.get_effective_service_fee_configuration(p_as_of timestamptz default clock_timestamp())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_fee public.service_fee_configurations;
begin
  if p_as_of is null then raise exception 'An effective date is required' using errcode='22023'; end if;
  select * into v_fee from public.service_fee_configurations
    where effective_from<=p_as_of and (effective_to is null or effective_to>p_as_of)
    order by effective_from desc limit 1;
  if not found then raise exception 'No service fee configuration is effective for this date' using errcode='55000'; end if;
  return jsonb_build_object(
    'total_fee_pct',v_fee.total_fee_pct,
    'renter_share_percent',v_fee.renter_share_percent,
    'owner_share_percent',100-v_fee.renter_share_percent,
    'renter_service_fee_pct',v_fee.total_fee_pct*v_fee.renter_share_percent/100,
    'owner_service_fee_pct',v_fee.total_fee_pct*(100-v_fee.renter_share_percent)/100,
    'effective_from',v_fee.effective_from,'effective_to',v_fee.effective_to);
end;
$$;
revoke all on function public.get_effective_service_fee_configuration(timestamptz) from public;
grant execute on function public.get_effective_service_fee_configuration(timestamptz) to anon, authenticated;

create function public.admin_list_service_fee_configurations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require('config.manage');
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.effective_from desc,c.created_at desc)
    from public.service_fee_configurations c),'[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_service_fee_configurations() from public, anon;
grant execute on function public.admin_list_service_fee_configurations() to authenticated;

create function public.admin_schedule_service_fee_configuration(
  p_total_fee_percent numeric,
  p_renter_share_percent integer,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_previous public.service_fee_configurations;
  v_next public.service_fee_configurations;
  v_created public.service_fee_configurations;
  v_continuation public.service_fee_configurations;
begin
  perform public.admin_require('config.manage');
  if not exists(select 1 from public.admin_users where user_id=auth.uid() and active and role='super_admin') then
    raise exception 'Only a Super Admin can change service fee configurations' using errcode='42501';
  end if;
  v_reason:=public.admin_clean_reason(p_reason);
  if p_total_fee_percent is null or p_total_fee_percent::text in ('NaN','Infinity','-Infinity')
    or p_total_fee_percent<0 or p_total_fee_percent>30
    or p_renter_share_percent is null or p_renter_share_percent not between 0 and 100
    or p_effective_from is null or p_effective_from<transaction_timestamp()
    or (p_effective_to is not null and p_effective_to<=p_effective_from) then
    raise exception 'Enter a total fee from 0 to 30 percent, an integer renter share from 0 to 100 percent, and a valid non-retroactive effective period'
      using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('service_fee_configurations',0));
  if exists(select 1 from public.service_fee_configurations c
    where tstzrange(c.effective_from,c.effective_to,'[)') && tstzrange(p_effective_from,p_effective_to,'[)')
      and not (c.effective_from<p_effective_from and c.effective_to is null)) then
    raise exception 'The requested service fee period overlaps an existing configuration' using errcode='23P01';
  end if;

  select * into v_previous from public.service_fee_configurations
    where effective_from<=p_effective_from and (effective_to is null or effective_to>p_effective_from)
    order by effective_from desc limit 1 for update;
  if found then
    update public.service_fee_configurations set effective_to=p_effective_from,
      updated_by=auth.uid(),updated_reason=v_reason
      where id=v_previous.id and effective_from<p_effective_from;
    if not found then
      raise exception 'A service fee configuration already starts at that time' using errcode='23P01';
    end if;
    perform public.admin_write_audit('service_fee.close_period','service_fee_configuration',v_previous.id::text,
      jsonb_build_object('effective_to',v_previous.effective_to),
      jsonb_build_object('effective_to',p_effective_from),v_reason);
  else
    raise exception 'No prior service fee configuration is available for this period' using errcode='55000';
  end if;

  insert into public.service_fee_configurations(total_fee_pct,renter_share_percent,effective_from,effective_to,created_by,reason)
    values(p_total_fee_percent/100,p_renter_share_percent,p_effective_from,p_effective_to,auth.uid(),v_reason)
    returning * into v_created;
  perform public.admin_write_audit('service_fee.schedule','service_fee_configuration',v_created.id::text,null,to_jsonb(v_created),v_reason);

  if p_effective_to is not null and not exists(
    select 1 from public.service_fee_configurations where effective_from=p_effective_to
  ) then
    select * into v_next from public.service_fee_configurations where effective_from>p_effective_to
      order by effective_from limit 1;
    insert into public.service_fee_configurations(
      total_fee_pct,renter_share_percent,effective_from,effective_to,created_by,reason
    ) values(v_previous.total_fee_pct,v_previous.renter_share_percent,p_effective_to,
      v_next.effective_from,auth.uid(),'Continuation after scheduled service fee period: '||v_reason)
    returning * into v_continuation;
    perform public.admin_write_audit('service_fee.continue_period','service_fee_configuration',
      v_continuation.id::text,null,to_jsonb(v_continuation),v_reason);
  end if;
  return to_jsonb(v_created);
exception when exclusion_violation then
  raise exception 'The requested service fee period overlaps an existing configuration' using errcode='23P01';
end;
$$;
revoke all on function public.admin_schedule_service_fee_configuration(numeric,integer,timestamptz,timestamptz,text)
  from public, anon;
grant execute on function public.admin_schedule_service_fee_configuration(numeric,integer,timestamptz,timestamptz,text)
  to authenticated;

create function public.calculate_listing_rental_amount(
  p_listing_id uuid,
  p_days integer,
  p_quantity integer,
  p_overrides jsonb default '{}'::jsonb,
  p_apply_legacy_discounts boolean default true
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_listing public.listings;
  v_daily numeric;
  v_weekly numeric;
  v_monthly numeric;
  v_weekly_enabled boolean;
  v_monthly_enabled boolean;
  v_weekly_discount numeric;
  v_monthly_discount numeric;
  v_package_kind text;
  v_package_days integer:=0;
  v_package_rate numeric:=0;
  v_discount_pct numeric:=0;
  v_discount numeric:=0;
  v_package_amount numeric:=0;
  v_extra_amount numeric:=0;
  v_subtotal numeric;
  v_legacy_enabled boolean;
begin
  if p_days is null or p_days not between 1 and 366 or p_quantity is null or p_quantity not between 1 and 100
    or jsonb_typeof(coalesce(p_overrides,'{}'::jsonb)) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_overrides,'{}'::jsonb)) k where k not in (
      'price_per_day','price_per_week','price_per_month','weekly_discount_enabled','weekly_discount_percent',
      'monthly_discount_enabled','monthly_discount_percent')) then
    raise exception 'Choose a rental length from 1 to 366 days and a quantity from 1 to 100' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id;
  if not found then raise exception 'Listing not found' using errcode='P0002'; end if;

  if (p_overrides ? 'price_per_day' and jsonb_typeof(p_overrides->'price_per_day') is distinct from 'number')
    or (p_overrides ? 'price_per_week' and jsonb_typeof(p_overrides->'price_per_week') not in ('number','null'))
    or (p_overrides ? 'price_per_month' and jsonb_typeof(p_overrides->'price_per_month') not in ('number','null'))
    or (p_overrides ? 'weekly_discount_enabled' and jsonb_typeof(p_overrides->'weekly_discount_enabled') is distinct from 'boolean')
    or (p_overrides ? 'monthly_discount_enabled' and jsonb_typeof(p_overrides->'monthly_discount_enabled') is distinct from 'boolean')
    or (p_overrides ? 'weekly_discount_percent' and jsonb_typeof(p_overrides->'weekly_discount_percent') is distinct from 'number')
    or (p_overrides ? 'monthly_discount_percent' and jsonb_typeof(p_overrides->'monthly_discount_percent') is distinct from 'number') then
    raise exception 'Listing rate overrides have invalid types' using errcode='22023';
  end if;

  v_daily:=case when p_overrides ? 'price_per_day' then (p_overrides->>'price_per_day')::numeric else v_listing.price_per_day end;
  v_weekly:=case when p_overrides ? 'price_per_week' then (p_overrides->>'price_per_week')::numeric else v_listing.price_per_week end;
  v_monthly:=case when p_overrides ? 'price_per_month' then (p_overrides->>'price_per_month')::numeric else v_listing.price_per_month end;
  v_weekly_enabled:=case when p_overrides ? 'weekly_discount_enabled' then (p_overrides->>'weekly_discount_enabled')::boolean else v_listing.weekly_discount_enabled end;
  v_monthly_enabled:=case when p_overrides ? 'monthly_discount_enabled' then (p_overrides->>'monthly_discount_enabled')::boolean else v_listing.monthly_discount_enabled end;
  v_weekly_discount:=case when p_overrides ? 'weekly_discount_percent' then (p_overrides->>'weekly_discount_percent')::numeric else v_listing.weekly_discount_percent end;
  v_monthly_discount:=case when p_overrides ? 'monthly_discount_percent' then (p_overrides->>'monthly_discount_percent')::numeric else v_listing.monthly_discount_percent end;
  if v_daily is null or v_daily::text in ('NaN','Infinity','-Infinity') or v_daily<=0 or v_daily<>round(v_daily,2)
    or (v_weekly is not null and (v_weekly::text in ('NaN','Infinity','-Infinity') or v_weekly<=0 or v_weekly<>round(v_weekly,2)))
    or (v_monthly is not null and (v_monthly::text in ('NaN','Infinity','-Infinity') or v_monthly<=0 or v_monthly<>round(v_monthly,2)))
    or v_weekly_discount is null or v_weekly_discount not between 0 and 50
    or v_monthly_discount is null or v_monthly_discount not between 0 and 50 then
    raise exception 'Listing rates or discounts are invalid' using errcode='22023';
  end if;
  v_legacy_enabled:=coalesce(p_apply_legacy_discounts,false)
    and exists(select 1 from public.feature_flags where key='duration_discounts' and enabled);

  if p_days>=30 and (v_monthly is not null or (v_legacy_enabled and v_monthly_enabled)) then
    v_package_kind:='monthly'; v_package_days:=30;
    v_package_rate:=coalesce(v_monthly,v_daily*30);
    if v_monthly is null then v_discount_pct:=v_monthly_discount; end if;
  elsif p_days>=7 and (v_weekly is not null or (v_legacy_enabled and v_weekly_enabled)) then
    v_package_kind:='weekly'; v_package_days:=7;
    v_package_rate:=coalesce(v_weekly,v_daily*7);
    if v_weekly is null then v_discount_pct:=v_weekly_discount; end if;
  end if;
  v_package_amount:=round(v_package_rate*p_quantity,2);
  v_discount:=round(v_package_amount*v_discount_pct/100,2);
  v_extra_amount:=round(v_daily*(p_days-v_package_days)*p_quantity,2);
  v_subtotal:=round(v_package_amount-v_discount+v_extra_amount,2);
  return jsonb_build_object(
    'days',p_days,'quantity',p_quantity,'daily_rate',v_daily,'package_kind',v_package_kind,
    'package_days',v_package_days,'package_rate',v_package_rate,'package_amount',v_package_amount,
    'extra_days',p_days-v_package_days,'extra_days_amount',v_extra_amount,
    'discount_amount',v_discount,'rental_subtotal',v_subtotal);
end;
$$;
revoke all on function public.calculate_listing_rental_amount(uuid,integer,integer,jsonb,boolean) from public, anon, authenticated;

create function public.get_listing_pricing_quotes(p_listing_id uuid,p_days integer[],p_quantity integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_listing public.listings; v_fee jsonb; v_quotes jsonb;
begin
  if p_days is null or cardinality(p_days) not between 1 and 8 or p_quantity is null or p_quantity not between 1 and 100
    or exists(select 1 from unnest(p_days) d where d is null or d not between 1 and 366) then
    raise exception 'Choose between 1 and 8 rental lengths from 1 to 366 days and a valid quantity' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id and status='published';
  if not found then raise exception 'Listing not found or not published' using errcode='P0002'; end if;
  v_fee:=public.get_effective_service_fee_configuration(clock_timestamp());
  select coalesce(jsonb_agg(q.quote order by q.days),'[]'::jsonb) into v_quotes
  from (
    select distinct d.days days,
      r.quote||
      jsonb_build_object(
        'renter_service_fee_amount',round((r.quote->>'rental_subtotal')::numeric
          *(v_fee->>'renter_service_fee_pct')::numeric,2),
        'owner_service_fee_amount',round((r.quote->>'rental_subtotal')::numeric
          *(v_fee->>'owner_service_fee_pct')::numeric,2),
        'tax_rate',0.07,
        'tax_amount',round(((r.quote->>'rental_subtotal')::numeric
          +round((r.quote->>'rental_subtotal')::numeric
            *(v_fee->>'renter_service_fee_pct')::numeric,2))*0.07,2),
        'renter_checkout_total',(r.quote->>'rental_subtotal')::numeric
          +round((r.quote->>'rental_subtotal')::numeric
            *(v_fee->>'renter_service_fee_pct')::numeric,2)
          +round(((r.quote->>'rental_subtotal')::numeric
            +round((r.quote->>'rental_subtotal')::numeric
              *(v_fee->>'renter_service_fee_pct')::numeric,2))*0.07,2),
        'expected_owner_net',(r.quote->>'rental_subtotal')::numeric
          -round((r.quote->>'rental_subtotal')::numeric
            *(v_fee->>'owner_service_fee_pct')::numeric,2)
      ) quote
    from (select distinct input_days.days from unnest(p_days) as input_days(days)) d
    cross join lateral (select public.calculate_listing_rental_amount(p_listing_id,d.days,p_quantity) quote) r
  ) q;
  return jsonb_build_object('quotes',v_quotes,'service_fee_total_pct',(v_fee->>'total_fee_pct')::numeric,
    'renter_share_percent',(v_fee->>'renter_share_percent')::integer,
    'owner_share_percent',(v_fee->>'owner_share_percent')::integer,
    'renter_service_fee_pct',(v_fee->>'renter_service_fee_pct')::numeric,
    'owner_service_fee_pct',(v_fee->>'owner_service_fee_pct')::numeric);
end;
$$;
revoke all on function public.get_listing_pricing_quotes(uuid,integer[],integer) from public;
grant execute on function public.get_listing_pricing_quotes(uuid,integer[],integer) to anon, authenticated;

create function public.get_checkout_price_quote(
  p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer,
  p_delivery_mode text default 'pickup',p_insurance_selected boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_listing public.listings;
  v_days integer;
  v_rental jsonb;
  v_fee jsonb;
  v_renter_fee numeric(10,2);
  v_owner_fee numeric(10,2);
  v_delivery numeric(10,2);
  v_insurance numeric(10,2);
  v_tax_rate numeric(4,3):=0.07;
  v_tax numeric(10,2);
  v_total numeric(10,2);
begin
  perform public.operations_require_session();
  if p_start_date is null or p_end_date is null or p_end_date<=p_start_date
    or p_end_date-p_start_date>366 or p_quantity is null or p_quantity not between 1 and 100
    or p_delivery_mode not in ('pickup','delivery') or p_insurance_selected is null then
    raise exception 'Choose a valid rental period, quantity, handoff and insurance option' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id and status='published';
  if not found then raise exception 'Listing not found or not published' using errcode='P0002'; end if;
  if p_delivery_mode='delivery' and not v_listing.delivery_available then
    raise exception 'Delivery is not available for this listing' using errcode='22023';
  end if;
  v_days:=p_end_date-p_start_date;
  v_rental:=public.calculate_listing_rental_amount(p_listing_id,v_days,p_quantity);
  v_fee:=public.get_effective_service_fee_configuration(clock_timestamp());
  v_renter_fee:=round((v_rental->>'rental_subtotal')::numeric*(v_fee->>'renter_service_fee_pct')::numeric,2);
  v_owner_fee:=round((v_rental->>'rental_subtotal')::numeric*(v_fee->>'owner_service_fee_pct')::numeric,2);
  v_delivery:=case when p_delivery_mode='delivery' then round(coalesce(v_listing.delivery_fee,0),2) else 0 end;
  v_insurance:=case when p_insurance_selected
    then round(coalesce(v_listing.estimated_value,0)*0.01*v_days*p_quantity,2) else 0 end;
  v_tax:=round(((v_rental->>'rental_subtotal')::numeric+v_renter_fee)*v_tax_rate,2);
  v_total:=(v_rental->>'rental_subtotal')::numeric+v_renter_fee+v_delivery+v_insurance+v_tax;
  return v_rental||jsonb_build_object(
    'service_fee_total_pct',(v_fee->>'total_fee_pct')::numeric,
    'service_fee_renter_share_pct',(v_fee->>'renter_share_percent')::integer,
    'service_fee_renter_pct',(v_fee->>'renter_service_fee_pct')::numeric,
    'service_fee_owner_pct',(v_fee->>'owner_service_fee_pct')::numeric,
    'renter_service_fee_amount',v_renter_fee,'owner_service_fee_amount',v_owner_fee,
    'delivery_fee_amount',v_delivery,'insurance_amount',v_insurance,'tax_rate',v_tax_rate,'tax_amount',v_tax,
    'deposit',v_listing.deposit,'renter_checkout_total',v_total,
    'expected_owner_net',(v_rental->>'rental_subtotal')::numeric+v_delivery-v_owner_fee);
end;
$$;
revoke all on function public.get_checkout_price_quote(uuid,date,date,integer,text,boolean) from public, anon;
grant execute on function public.get_checkout_price_quote(uuid,date,date,integer,text,boolean) to authenticated;

create function public.get_owner_listing_earnings_quote(
  p_listing_id uuid,p_daily_rate numeric,p_weekly_rate numeric,p_monthly_rate numeric,
  p_weekly_discount_enabled boolean,p_weekly_discount_percent numeric,
  p_monthly_discount_enabled boolean,p_monthly_discount_percent numeric,
  p_days integer,p_quantity integer default 1
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_listing public.listings; v_pricing jsonb; v_fee jsonb; v_owner_fee numeric(10,2);
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id and owner_id=auth.uid();
  if not found then raise exception 'Listing not found or not owned' using errcode='42501'; end if;
  if p_daily_rate is null or p_daily_rate::text in ('NaN','Infinity','-Infinity') or p_daily_rate<=0
    or p_weekly_discount_enabled is null or p_monthly_discount_enabled is null
    or p_weekly_discount_percent is null or p_weekly_discount_percent not between 0 and 50
    or p_monthly_discount_percent is null or p_monthly_discount_percent not between 0 and 50 then
    raise exception 'Enter valid listing rates and rental discounts' using errcode='22023';
  end if;
  v_pricing:=public.calculate_listing_rental_amount(p_listing_id,p_days,p_quantity,jsonb_build_object(
    'price_per_day',p_daily_rate,'price_per_week',p_weekly_rate,'price_per_month',p_monthly_rate,
    'weekly_discount_enabled',p_weekly_discount_enabled,'weekly_discount_percent',p_weekly_discount_percent,
    'monthly_discount_enabled',p_monthly_discount_enabled,'monthly_discount_percent',p_monthly_discount_percent));
  v_fee:=public.get_effective_service_fee_configuration(clock_timestamp());
  v_owner_fee:=round((v_pricing->>'rental_subtotal')::numeric*(v_fee->>'owner_service_fee_pct')::numeric,2);
  return v_pricing||jsonb_build_object(
    'service_fee_total_pct',(v_fee->>'total_fee_pct')::numeric,
    'renter_share_percent',(v_fee->>'renter_share_percent')::integer,
    'owner_service_fee_pct',(v_fee->>'owner_service_fee_pct')::numeric,
    'owner_service_fee_amount',v_owner_fee,
    'estimated_owner_net',(v_pricing->>'rental_subtotal')::numeric-v_owner_fee);
end;
$$;
revoke all on function public.get_owner_listing_earnings_quote(uuid,numeric,numeric,numeric,boolean,numeric,boolean,numeric,integer,integer)
  from public, anon;
grant execute on function public.get_owner_listing_earnings_quote(uuid,numeric,numeric,numeric,boolean,numeric,boolean,numeric,integer,integer)
  to authenticated;

alter function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)
  rename to owner_save_listing_flow_before_package_rates;
revoke all on function public.owner_save_listing_flow_before_package_rates(uuid,bigint,jsonb,jsonb,boolean)
  from public, anon, authenticated;
create function public.owner_save_listing_flow(
  p_listing_id uuid,p_revision bigint,p_details jsonb,p_pickup jsonb default null,p_publish boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_listing public.listings; v_weekly numeric; v_monthly numeric; v_rates boolean;
begin
  if jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'Invalid listing details' using errcode='22023';
  end if;
  v_rates:=p_details ? 'price_per_week' or p_details ? 'price_per_month';
  if (p_details ? 'price_per_week' and jsonb_typeof(p_details->'price_per_week') not in ('number','null'))
    or (p_details ? 'price_per_month' and jsonb_typeof(p_details->'price_per_month') not in ('number','null')) then
    raise exception 'Weekly and monthly package rates must be valid amounts or blank' using errcode='22023';
  end if;
  v_weekly:=case when p_details ? 'price_per_week' then (p_details->>'price_per_week')::numeric end;
  v_monthly:=case when p_details ? 'price_per_month' then (p_details->>'price_per_month')::numeric end;
  if (v_weekly is not null and (v_weekly::text in ('NaN','Infinity','-Infinity') or v_weekly<=0 or v_weekly<>round(v_weekly,2)))
    or (v_monthly is not null and (v_monthly::text in ('NaN','Infinity','-Infinity') or v_monthly<=0 or v_monthly<>round(v_monthly,2))) then
    raise exception 'Weekly and monthly package rates must be positive amounts with at most two decimal places' using errcode='22023';
  end if;
  v_result:=public.owner_save_listing_flow_before_package_rates(
    p_listing_id,p_revision,p_details-'price_per_week'-'price_per_month',p_pickup,p_publish);
  if v_rates then
    select * into v_listing from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
    if not found then raise exception 'Listing not found or not owned' using errcode='42501'; end if;
    update public.listings set
      price_per_week=case when p_details ? 'price_per_week' then v_weekly else price_per_week end,
      price_per_month=case when p_details ? 'price_per_month' then v_monthly else price_per_month end
      where id=p_listing_id returning * into v_listing;
    v_result:=jsonb_build_object('revision',v_listing.revision,'status',v_listing.status,'deposit',v_listing.deposit);
  end if;
  return v_result;
end;
$$;
revoke all on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) from public, anon;
grant execute on function public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean) to authenticated;

create function public.apply_booking_service_fee_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_listing public.listings;
  v_fee jsonb;
  v_pricing jsonb;
  v_base_pricing jsonb;
  v_promotion public.owner_promotions;
  v_discount numeric(10,2):=0;
  v_total_pct numeric(9,8);
  v_renter_pct numeric(11,10);
  v_owner_pct numeric(11,10);
begin
  if tg_op='UPDATE' then
    if (new.service_fee_pct,new.service_fee_amount,new.service_fee_total_pct,new.service_fee_renter_share_pct,
        new.owner_service_fee_pct,new.owner_service_fee_amount)
      is distinct from
      (old.service_fee_pct,old.service_fee_amount,old.service_fee_total_pct,old.service_fee_renter_share_pct,
        old.owner_service_fee_pct,old.owner_service_fee_amount) then
      raise exception 'Booking service fee snapshots are immutable' using errcode='42501';
    end if;
    return new;
  end if;

  select * into v_listing from public.listings where id=new.listing_id;
  if not found then raise exception 'Listing not found' using errcode='P0002'; end if;
  if new.auction_bid_id is null then
    if new.owner_promotion_id is not null then
      select * into v_promotion from public.owner_promotions where id=new.owner_promotion_id;
      if not found then raise exception 'Owner promotion not found' using errcode='23514'; end if;
      v_base_pricing:=public.calculate_listing_rental_amount(new.listing_id,new.days,new.quantity,
        jsonb_build_object('price_per_day',new.daily_rate),false);
      v_discount:=round((v_base_pricing->>'rental_subtotal')::numeric*v_promotion.discount_percent/100,2);
      v_pricing:=v_base_pricing||jsonb_build_object('rental_subtotal',
        (v_base_pricing->>'rental_subtotal')::numeric-v_discount,'discount_amount',v_discount);
      new.owner_discount_source:='promotion';
    else
      v_pricing:=public.calculate_listing_rental_amount(new.listing_id,new.days,new.quantity,
        jsonb_build_object('price_per_day',new.daily_rate),true);
      v_discount:=(v_pricing->>'discount_amount')::numeric;
      new.owner_discount_source:=case when v_discount>0 then 'duration' else 'none' end;
    end if;
    new.subtotal:=(v_pricing->>'rental_subtotal')::numeric;
    new.owner_discount_amount:=v_discount;
  else
    new.owner_discount_amount:=0;
    new.owner_discount_source:='none';
  end if;

  v_fee:=public.get_effective_service_fee_configuration(clock_timestamp());
  v_total_pct:=(v_fee->>'total_fee_pct')::numeric;
  v_renter_pct:=(v_fee->>'renter_service_fee_pct')::numeric;
  v_owner_pct:=(v_fee->>'owner_service_fee_pct')::numeric;
  new.service_fee_total_pct:=v_total_pct;
  new.service_fee_renter_share_pct:=(v_fee->>'renter_share_percent')::smallint;
  new.service_fee_pct:=v_renter_pct;
  new.owner_service_fee_pct:=v_owner_pct;
  new.service_fee_amount:=round(new.subtotal*v_renter_pct,2);
  new.owner_service_fee_amount:=round(new.subtotal*v_owner_pct,2);
  new.tax_amount:=round((new.subtotal+new.service_fee_amount)*new.tax_rate,2);
  if new.deposit_collection_model='authorization' then
    new.total:=new.subtotal+new.service_fee_amount+new.insurance_amount+coalesce(new.delivery_fee_amount,0)+new.tax_amount;
  else
    new.total:=new.subtotal+new.service_fee_amount+new.deposit+new.insurance_amount+coalesce(new.delivery_fee_amount,0)+new.tax_amount;
  end if;
  return new;
end;
$$;
revoke all on function public.apply_booking_service_fee_allocation() from public, anon, authenticated;
create trigger zzzzzzzzzzzzz_booking_service_fee_allocation
  before insert or update on public.bookings
  for each row execute function public.apply_booking_service_fee_allocation();

alter table public.rental_settlements
  add column owner_service_fee_pct numeric(11,10) not null default 0 check (owner_service_fee_pct between 0 and 0.30),
  add column owner_service_fee_amount numeric(10,2) not null default 0 check (owner_service_fee_amount >= 0);

create function public.apply_rental_settlement_owner_fee()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id=new.booking_id;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  new.owner_service_fee_pct:=coalesce(v_booking.owner_service_fee_pct,0);
  new.owner_service_fee_amount:=coalesce(v_booking.owner_service_fee_amount,0);
  new.owner_amount:=v_booking.subtotal+coalesce(v_booking.delivery_fee_amount,0)-new.owner_service_fee_amount;
  if new.owner_amount<=0 then raise exception 'Owner settlement amount must be positive' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function public.apply_rental_settlement_owner_fee() from public, anon, authenticated;
create trigger zzzzzzzzzzz_rental_settlement_owner_fee
  before insert on public.rental_settlements
  for each row execute function public.apply_rental_settlement_owner_fee();

do $$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.claim_rental_settlement(uuid,text)'::regprocedure);
  if position('or v_row.owner_amount<>v_booking.subtotal+coalesce(v_booking.delivery_fee_amount,0) then' in v_definition)=0 then
    raise exception 'The current settlement amount guard is not the expected version; refusing to replace it';
  end if;
  v_definition:=replace(v_definition,
    'or v_row.owner_amount<>v_booking.subtotal+coalesce(v_booking.delivery_fee_amount,0) then',
    'or v_row.owner_service_fee_amount<>coalesce(v_booking.owner_service_fee_amount,0) or v_row.owner_amount<>v_booking.subtotal+coalesce(v_booking.delivery_fee_amount,0)-v_row.owner_service_fee_amount then');
  execute v_definition;
end;
$$;

create function public.reject_legacy_platform_fee_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.key='platform_fee_pct' and new.value is distinct from old.value then
    raise exception 'Use the effective-dated service fee configuration instead' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_legacy_platform_fee_write() from public, anon, authenticated;
create trigger app_settings_platform_fee_legacy_guard
  before update of value on public.app_settings
  for each row execute function public.reject_legacy_platform_fee_write();
update public.app_settings set description='Legacy display value; service fees are managed through effective-dated configurations.'
  where key='platform_fee_pct';

notify pgrst, 'reload schema';
commit;
