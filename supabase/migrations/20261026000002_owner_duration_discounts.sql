begin;

alter table public.listings
  add column duration_discount_min_days integer,
  add column duration_discount_percent numeric(5,2) not null default 0,
  add constraint listings_duration_discount_valid check (
    (duration_discount_percent=0 and duration_discount_min_days is null) or
    (duration_discount_percent between 0.01 and 50 and duration_discount_min_days between 2 and 366)
  );

alter table public.bookings add column owner_discount_amount numeric(10,2) not null default 0
  check(owner_discount_amount>=0 and owner_discount_amount::text<>'NaN');
alter table public.bookings add column owner_discount_source text not null default 'none'
  check(owner_discount_source in ('none','duration','promotion'));

insert into public.feature_flags(key,enabled,description) values
  ('duration_discounts',false,'Owner-funded long-rental discounts for the test environment. One discount per booking; no stacking.')
on conflict(key) do nothing;

create function public.owner_save_duration_discount(
  p_listing_id uuid,p_revision bigint,p_min_days integer,p_discount_percent numeric
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings;
begin
  perform public.operations_require_session();
  if not exists(select 1 from public.feature_flags where key='duration_discounts' and enabled) then
    raise exception 'Owner discounts are not enabled in this test environment' using errcode='55000';
  end if;
  if p_discount_percent is null or p_discount_percent::text in ('NaN','Infinity','-Infinity')
    or p_discount_percent<0 or p_discount_percent>50
    or (p_discount_percent=0 and p_min_days is not null)
    or (p_discount_percent>0 and (p_min_days is null or p_min_days<2 or p_min_days>366)) then
    raise exception 'Use a discount from 0 to 50 percent and a minimum rental length from 2 to 366 days' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id<>auth.uid() then raise exception 'Listing not found or not owned' using errcode='42501'; end if;
  if p_revision is null or v_listing.revision<>p_revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  update public.listings set duration_discount_min_days=p_min_days,
    duration_discount_percent=p_discount_percent where id=p_listing_id returning revision into p_revision;
  return p_revision;
end;
$$;
revoke all on function public.owner_save_duration_discount(uuid,bigint,integer,numeric) from public,anon;
grant execute on function public.owner_save_duration_discount(uuid,bigint,integer,numeric) to authenticated;

create function public.apply_owner_duration_discount()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings;v_gross numeric(10,2);v_discount numeric(10,2);
begin
  select * into v_listing from public.listings where id=new.listing_id;
  if not found or not exists(select 1 from public.feature_flags where key='duration_discounts' and enabled)
    or v_listing.duration_discount_percent=0 or new.days<v_listing.duration_discount_min_days then
    new.owner_discount_amount:=0;
    new.owner_discount_source:='none';
    return new;
  end if;
  v_gross:=round(new.daily_rate*new.days*new.quantity,2);
  v_discount:=round(v_gross*v_listing.duration_discount_percent/100,2);
  new.owner_discount_amount:=least(v_gross,v_discount);
  new.owner_discount_source:='duration';
  new.subtotal:=v_gross-new.owner_discount_amount;
  new.service_fee_amount:=round(new.subtotal*new.service_fee_pct,2);
  new.total:=new.subtotal+new.service_fee_amount+new.deposit;
  return new;
end;
$$;
revoke all on function public.apply_owner_duration_discount() from public,anon,authenticated;
create trigger bookings_apply_owner_duration_discount before insert on public.bookings
  for each row execute function public.apply_owner_duration_discount();

commit;
