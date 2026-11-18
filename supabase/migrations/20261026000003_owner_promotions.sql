begin;

create table public.owner_promotions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  discount_percent numeric(5,2) not null check(discount_percent between 1 and 50),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index owner_promotions_code_ci on public.owner_promotions(lower(code));
create trigger owner_promotions_updated before update on public.owner_promotions
  for each row execute function public.set_updated_at();
alter table public.owner_promotions enable row level security;
revoke all on public.owner_promotions from public,anon,authenticated;

alter table public.bookings
  add column owner_promotion_id uuid references public.owner_promotions(id) on delete restrict,
  add column owner_promotion_code text check(owner_promotion_code is null or owner_promotion_code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$');

insert into public.feature_flags(key,enabled,description) values
  ('owner_promotions',false,'Owner-funded promo codes for the test environment. One discount per booking; no stacking.')
on conflict(key) do nothing;

create function public.owner_list_promotion(p_listing_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.owner_promotions;
begin
  perform public.operations_require_session();
  if not exists(select 1 from public.listings where id=p_listing_id and owner_id=auth.uid()) then
    raise exception 'Listing not found or not owned' using errcode='42501';
  end if;
  select * into v_row from public.owner_promotions where listing_id=p_listing_id;
  if not found then return null; end if;
  return to_jsonb(v_row)||jsonb_build_object('redemptions',
    (select count(*) from public.bookings where owner_promotion_id=v_row.id and status in ('pending_payment','confirmed','active','return_pending','completed')));
end;
$$;

create function public.owner_save_promotion(
  p_listing_id uuid,p_code text,p_discount_percent numeric,p_active boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.listings;v_row public.owner_promotions;
begin
  perform public.operations_require_session();
  if not exists(select 1 from public.feature_flags where key='owner_promotions' and enabled) then
    raise exception 'Owner promotions are not enabled in this test environment' using errcode='55000';
  end if;
  select * into v_listing from public.listings where id=p_listing_id and owner_id=auth.uid() for update;
  if not found or v_listing.status<>'published' then raise exception 'Published listing not found or not owned' using errcode='42501'; end if;
  if p_code is null or upper(btrim(p_code)) !~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'
    or p_discount_percent is null or p_discount_percent::text in ('NaN','Infinity','-Infinity')
    or p_discount_percent<1 or p_discount_percent>50 or p_active is null then
    raise exception 'Use a 3 to 24 character code and a discount from 1 to 50 percent' using errcode='22023';
  end if;
  insert into public.owner_promotions(owner_id,listing_id,code,discount_percent,active)
    values(auth.uid(),p_listing_id,upper(btrim(p_code)),p_discount_percent,p_active)
    on conflict(listing_id) do update set code=excluded.code,discount_percent=excluded.discount_percent,active=excluded.active
    returning * into v_row;
  return to_jsonb(v_row)||jsonb_build_object('redemptions',
    (select count(*) from public.bookings where owner_promotion_id=v_row.id and status in ('pending_payment','confirmed','active','return_pending','completed')));
end;
$$;

create function public.owner_quote_promotion(p_listing_id uuid,p_code text,p_days integer,p_quantity integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_listing public.listings;v_promo public.owner_promotions;v_gross numeric(10,2);v_discount numeric(10,2);
begin
  perform public.operations_require_session();
  if p_days is null or p_days<1 or p_days>366 or p_quantity is null or p_quantity<1 then
    raise exception 'Choose a valid rental length and quantity' using errcode='22023';
  end if;
  select * into v_listing from public.listings where id=p_listing_id and status='published';
  if not found then raise exception 'Listing not found or not published' using errcode='P0002'; end if;
  select * into v_promo from public.owner_promotions
    where listing_id=p_listing_id and owner_id=v_listing.owner_id and code=upper(btrim(p_code)) and active;
  if not found or not exists(select 1 from public.feature_flags where key='owner_promotions' and enabled) then
    raise exception 'This promo code is invalid or unavailable' using errcode='22023';
  end if;
  v_gross:=round(v_listing.price_per_day*p_days*p_quantity,2);
  v_discount:=least(v_gross,round(v_gross*v_promo.discount_percent/100,2));
  return jsonb_build_object('discount_amount',v_discount,'discount_percent',v_promo.discount_percent,
    'source','promotion','test_only',true);
end;
$$;

create function public.apply_owner_promotion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_code text;v_promo public.owner_promotions;v_listing public.listings;v_gross numeric(10,2);v_discount numeric(10,2);
begin
  v_code:=nullif(upper(btrim(current_setting('ybuy.owner_promotion_code',true))), '');
  if v_code is null then return new; end if;
  if not exists(select 1 from public.feature_flags where key='owner_promotions' and enabled) then
    raise exception 'Owner promotions are not enabled in this test environment' using errcode='55000';
  end if;
  select * into v_listing from public.listings where id=new.listing_id;
  select * into v_promo from public.owner_promotions where listing_id=new.listing_id
    and owner_id=v_listing.owner_id and code=v_code and active for update;
  if not found then raise exception 'This promo code is invalid or unavailable' using errcode='22023'; end if;
  v_gross:=round(new.daily_rate*new.days*new.quantity,2);
  v_discount:=least(v_gross,round(v_gross*v_promo.discount_percent/100,2));
  new.owner_promotion_id:=v_promo.id;
  new.owner_promotion_code:=v_promo.code;
  new.owner_discount_source:='promotion';
  new.owner_discount_amount:=v_discount;
  new.subtotal:=v_gross-v_discount;
  new.service_fee_amount:=round(new.subtotal*new.service_fee_pct,2);
  new.total:=new.subtotal+new.service_fee_amount+new.deposit;
  return new;
end;
$$;
revoke all on function public.owner_list_promotion(uuid),public.owner_save_promotion(uuid,text,numeric,boolean),
  public.owner_quote_promotion(uuid,text,integer,integer),public.apply_owner_promotion() from public,anon;
grant execute on function public.owner_list_promotion(uuid),public.owner_save_promotion(uuid,text,numeric,boolean),
  public.owner_quote_promotion(uuid,text,integer,integer) to authenticated;
create trigger bookings_apply_owner_promotion before insert on public.bookings
  for each row execute function public.apply_owner_promotion();

create function public.create_booking_request_with_owner_promo(
  p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer,p_code text default null
) returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;
begin
  perform public.operations_require_session();
  perform set_config('ybuy.owner_promotion_code',coalesce(p_code,''),true);
  v_booking:=public.create_booking_request(p_listing_id,p_start_date,p_end_date,p_quantity);
  perform set_config('ybuy.owner_promotion_code','',true);
  return v_booking;
end;
$$;
revoke all on function public.create_booking_request_with_owner_promo(uuid,date,date,integer,text) from public,anon;
grant execute on function public.create_booking_request_with_owner_promo(uuid,date,date,integer,text) to authenticated;

commit;
