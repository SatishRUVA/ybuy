begin;

-- Preserve settings already seeded or configured.
insert into public.app_settings(key,value,value_type,min_value,max_value,description,is_public) values
 ('signup_reward_enabled','false','boolean',null,null,'Enable verified signup points in the local financial simulation only.',true),
 ('signup_reward_points','500','integer',500,100000,'Points for a new verified signup. 100 points = $1; simulated redemption is exactly 500 points per booking.',true)
on conflict (key) do nothing;

create table public.reward_launch (
  singleton boolean primary key default true check(singleton),
  launched_at timestamptz
);
insert into public.reward_launch default values;
revoke all on public.reward_launch from public,anon,authenticated,service_role;

create function public.start_reward_launch()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.key='signup_reward_enabled' and new.value='true'::jsonb then
    update public.reward_launch set launched_at=clock_timestamp() where launched_at is null;
  end if;
  return new;
end;
$$;
create trigger signup_reward_launch after update on public.app_settings
  for each row execute function public.start_reward_launch();

create table public.reward_wallets (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  reward_balance integer not null default 0 check(reward_balance>=0)
);
create table public.reward_signup_claims (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  email_hash text not null unique,
  phone_hash text not null unique
);
create table public.reward_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.reward_wallets(user_id) on delete restrict,
  points integer not null,
  kind text not null check(kind in ('signup','redemption','reversal')),
  booking_id uuid references public.bookings(id) on delete restrict,
  created_at timestamptz not null default now(),
  check((kind='signup' and points>0 and booking_id is null)
    or (kind='redemption' and points=-500 and booking_id is not null)
    or (kind='reversal' and points=500 and booking_id is not null)),
  unique(booking_id,kind)
);
create unique index reward_one_signup on public.reward_transactions(user_id) where kind='signup';
create index reward_history on public.reward_transactions(user_id,created_at desc);
alter table public.reward_wallets enable row level security;
alter table public.reward_signup_claims enable row level security;
alter table public.reward_transactions enable row level security;
revoke all on public.reward_wallets,public.reward_signup_claims,public.reward_transactions from public,anon,authenticated,service_role;

create function public.award_signup_points(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u auth.users; v_points integer; v_claim uuid;
begin
  if not exists(select 1 from public.admin_financial_test_gate where enabled and environment='local_test')
    or not exists(select 1 from public.app_settings where key='signup_reward_enabled' and value='true'::jsonb) then
    return;
  end if;
  select * into u from auth.users where id=p_user_id;
  if u.email_confirmed_at is null or u.phone_confirmed_at is null
    or coalesce(btrim(u.email),'')='' or coalesce(u.phone,'') !~ '^\+?[1-9][0-9]{6,14}$'
    or not exists(select 1 from public.reward_launch where launched_at is not null and u.created_at>=launched_at)
    or exists(select 1 from public.user_restrictions where user_id=p_user_id) then return; end if;
  select (value #>> '{}')::integer into strict v_points from public.app_settings where key='signup_reward_points';
  insert into public.reward_wallets(user_id) values(p_user_id) on conflict do nothing;
  perform 1 from public.reward_wallets where user_id=p_user_id for update;
  insert into public.reward_signup_claims(user_id,email_hash,phone_hash) values(
    p_user_id,encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex'),
    encode(sha256(convert_to(ltrim(u.phone,'+'),'UTF8')),'hex'))
    on conflict do nothing returning user_id into v_claim;
  if v_claim is null then return; end if;
  insert into public.reward_transactions(user_id,points,kind) values(p_user_id,v_points,'signup');
  update public.reward_wallets set reward_balance=reward_balance+v_points where user_id=p_user_id;
end;
$$;

create function public.award_verified_signup_points()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.award_signup_points(new.id);
  return new;
end;
$$;
-- Runs after the existing profile-creation trigger; metadata is never verification evidence.
create trigger z_award_verified_signup_points after insert or update of email_confirmed_at,phone_confirmed_at on auth.users
  for each row execute function public.award_verified_signup_points();

create function public.get_my_rewards()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_enabled boolean; v_verified boolean; v_eligible boolean;
begin
  perform public.operations_require_session();
  select exists(select 1 from public.admin_financial_test_gate where enabled and environment='local_test') into v_enabled;
  perform public.award_signup_points(auth.uid());
  select email_confirmed_at is not null and phone_confirmed_at is not null,
    exists(select 1 from public.reward_launch where launched_at is not null and u.created_at>=launched_at)
    into v_verified,v_eligible from auth.users u where id=auth.uid();
  return jsonb_build_object('test_only',true,'enabled',v_enabled,'verified',v_verified,'eligible',v_eligible,
    'signup_enabled',exists(select 1 from public.app_settings where key='signup_reward_enabled' and value='true'::jsonb),
    'signup_points',(select (value #>> '{}')::integer from public.app_settings where key='signup_reward_points'),
    'balance',coalesce((select reward_balance from public.reward_wallets where user_id=auth.uid()),0),
    'awarded',exists(select 1 from public.reward_signup_claims where user_id=auth.uid()),
    'transactions',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id) from (
      select id,points,kind,booking_id,created_at from public.reward_transactions
      where user_id=auth.uid() order by created_at desc,id limit 100) t),'[]'::jsonb));
end;
$$;

create function public.redeem_test_reward_points(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; v_balance integer;
begin
  perform public.operations_require_financial_test();
  select * into b from public.bookings where id=p_booking_id and renter_id=auth.uid() for update;
  if not found then raise exception 'Booking not found or not authorized' using errcode='42501';end if;
  if b.status not in ('requested','pending_payment')
    or (b.status='pending_payment' and (b.checkout_expires_at is null or b.checkout_expires_at<=clock_timestamp())) then
    raise exception 'Booking is not eligible for simulated points redemption' using errcode='22023';end if;
  if b.subtotal<5 then raise exception 'Rental subtotal must be at least $5' using errcode='22023';end if;
  perform public.award_signup_points(auth.uid());
  select reward_balance into v_balance from public.reward_wallets where user_id=auth.uid() for update;
  if not exists(select 1 from public.reward_transactions where booking_id=b.id and kind='redemption') then
    if coalesce(v_balance,0)<500 then raise exception 'At least 500 points are required' using errcode='22023';end if;
    insert into public.reward_transactions(user_id,points,kind,booking_id) values(auth.uid(),-500,'redemption',b.id);
    update public.reward_wallets set reward_balance=reward_balance-500 where user_id=auth.uid();
  end if;
  return jsonb_build_object('test_only',true,'points',500,'discount',5,'simulated_total',b.total-5,'payment_total',b.total);
end;
$$;

create function public.reverse_cancelled_reward_points()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if new.status in ('cancelled','rejected') and new.status is distinct from old.status then
    perform 1 from public.reward_wallets where user_id=new.renter_id for update;
    insert into public.reward_transactions(user_id,points,kind,booking_id)
      select user_id,500,'reversal',booking_id from public.reward_transactions
      where booking_id=new.id and kind='redemption' on conflict do nothing returning id into v_id;
    if v_id is not null then
      update public.reward_wallets set reward_balance=reward_balance+500 where user_id=new.renter_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger reverse_cancelled_reward_points after update of status on public.bookings
  for each row execute function public.reverse_cancelled_reward_points();

revoke all on function public.start_reward_launch(),public.award_signup_points(uuid),
  public.award_verified_signup_points(),public.reverse_cancelled_reward_points(),
  public.get_my_rewards(),public.redeem_test_reward_points(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_rewards(),public.redeem_test_reward_points(uuid) to authenticated;
commit;
