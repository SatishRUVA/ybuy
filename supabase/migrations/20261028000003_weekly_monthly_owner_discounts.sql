begin;

alter table public.listings
  add column weekly_discount_enabled boolean not null default false,
  add column weekly_discount_percent numeric(5,2) not null default 20 check(weekly_discount_percent between 0 and 50),
  add column monthly_discount_enabled boolean not null default false,
  add column monthly_discount_percent numeric(5,2) not null default 30 check(monthly_discount_percent between 0 and 50);

revoke all on function public.owner_save_duration_discount(uuid,bigint,integer,numeric) from public,anon,authenticated;
create function public.owner_save_duration_discount(
  p_listing_id uuid,p_revision bigint,p_weekly_discount_percent numeric,p_monthly_discount_percent numeric
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings;
begin
  perform public.operations_require_session();
  if not exists(select 1 from public.feature_flags where key='duration_discounts' and enabled) then
    raise exception 'Owner discounts are not enabled in this test environment' using errcode='55000';
  end if;
  if p_weekly_discount_percent is null or p_monthly_discount_percent is null
    or p_weekly_discount_percent::text in ('NaN','Infinity','-Infinity')
    or p_monthly_discount_percent::text in ('NaN','Infinity','-Infinity')
    or p_weekly_discount_percent not between 0 and 50 or p_monthly_discount_percent not between 0 and 50 then
    raise exception 'Weekly and monthly discounts must each be between 0 and 50 percent' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501';end if;
  if p_revision is null or v_listing.revision<>p_revision then raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';end if;
  update public.listings set duration_discount_min_days=null,duration_discount_percent=0,
    weekly_discount_enabled=p_weekly_discount_percent>0,weekly_discount_percent=p_weekly_discount_percent,
    monthly_discount_enabled=p_monthly_discount_percent>0,monthly_discount_percent=p_monthly_discount_percent
    where id=p_listing_id returning revision into p_revision;
  return p_revision;
end;
$$;
revoke all on function public.owner_save_duration_discount(uuid,bigint,numeric,numeric) from public,anon;
grant execute on function public.owner_save_duration_discount(uuid,bigint,numeric,numeric) to authenticated;

create function public.owner_save_rental_discounts(
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
  v_discount:=round(new.daily_rate*coalesce(nullif(v_package_days,0),new.days)*new.quantity*v_discount_pct/100,2);
  new.owner_discount_amount:=least(v_gross,v_discount);new.owner_discount_source:='duration';
  new.subtotal:=v_gross-new.owner_discount_amount;
  new.service_fee_amount:=round(new.subtotal*new.service_fee_pct,2);
  new.total:=new.subtotal+new.service_fee_amount+new.deposit;
  return new;
end;
$$;

notify pgrst,'reload schema';
commit;
