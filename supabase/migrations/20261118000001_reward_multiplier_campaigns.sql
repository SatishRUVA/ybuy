begin;

-- Signup verification is the only points-earning activity implemented today.
create table public.reward_multiplier_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 3 and 100),
  event_type text not null default 'signup' check(event_type='signup'),
  multiplier numeric not null check(multiplier in (1,1.5,2,2.5,3)),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at),
  exclude using gist (tstzrange(starts_at,ends_at,'[)') with &&) where (active)
);
alter table public.reward_multiplier_campaigns enable row level security;
revoke all on public.reward_multiplier_campaigns from public,anon,authenticated,service_role;

alter table public.reward_transactions
  add column base_points integer,
  add column multiplier numeric,
  add column final_points integer,
  add column campaign_id uuid references public.reward_multiplier_campaigns(id) on delete restrict,
  add column campaign_snapshot jsonb,
  add column event_type text,
  add column event_ref uuid,
  add column event_at timestamptz,
  add column idempotency_key text;

-- Preserve historical amounts without claiming a campaign existed.
update public.reward_transactions set base_points=points,multiplier=1,final_points=points,
  event_type='signup',event_ref=user_id,event_at=created_at,idempotency_key='signup:'||user_id::text
  where kind='signup';
alter table public.reward_transactions add constraint reward_signup_snapshot check (
  kind<>'signup' or (
    base_points is not null and base_points>0 and multiplier is not null and multiplier in (1,1.5,2,2.5,3)
    and final_points is not null and final_points=points and final_points=round(base_points*multiplier)
    and event_type is not null and event_type='signup' and event_ref is not null and event_ref=user_id
    and event_at is not null and idempotency_key is not null and idempotency_key='signup:'||user_id::text
    and ((campaign_id is null and campaign_snapshot is null and multiplier=1)
      or (campaign_id is not null and campaign_snapshot is not null and jsonb_typeof(campaign_snapshot)='object'))
  )
);
create unique index reward_award_idempotency on public.reward_transactions(idempotency_key);
create trigger append_only before update or delete on public.reward_transactions
  for each row execute function public.forbid_audit_mutation();

create function public.admin_list_reward_campaigns(p_limit int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.admin_require('promotions.manage');
  return jsonb_build_object('total',(select count(*) from public.reward_multiplier_campaigns),'rows',
    coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from (
      select c.*,(select count(*) from public.reward_transactions t where t.campaign_id=c.id) awards,
        (select coalesce(sum(t.points-t.base_points),0) from public.reward_transactions t where t.campaign_id=c.id) bonus_points
      from public.reward_multiplier_campaigns c order by c.created_at desc,c.id
      limit least(greatest(coalesce(p_limit,25),1),100) offset greatest(coalesce(p_offset,0),0)
    ) p),'[]'::jsonb));
end;
$$;

create function public.admin_save_reward_campaign(
  p_id uuid,p_name text,p_multiplier numeric,p_starts_at timestamptz,p_ends_at timestamptz,p_active boolean,p_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_old public.reward_multiplier_campaigns; v_row public.reward_multiplier_campaigns; v_reason text;
begin
  perform public.admin_require('promotions.manage');
  v_reason:=public.admin_clean_reason(p_reason);
  if p_name is null or length(btrim(p_name)) not between 3 and 100
    or p_multiplier is null or p_multiplier not in (1,1.5,2,2.5,3)
    or p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
    or p_ends_at<=p_starts_at or p_active is null then
    raise exception 'Invalid reward campaign: name, supported multiplier, finite window and activation are required' using errcode='22023';
  end if;
  if p_id is null and p_active then
    raise exception 'New reward campaigns must be inactive; save before activating' using errcode='22023';
  end if;
  if p_id is not null then
    select * into v_old from public.reward_multiplier_campaigns where id=p_id for update;
    if not found then raise exception 'Reward campaign not found' using errcode='P0002'; end if;
  end if;
  begin
    if p_id is null then
      insert into public.reward_multiplier_campaigns(name,multiplier,starts_at,ends_at)
        values(btrim(p_name),p_multiplier,p_starts_at,p_ends_at) returning * into v_row;
    else
      update public.reward_multiplier_campaigns set name=btrim(p_name),multiplier=p_multiplier,
        starts_at=p_starts_at,ends_at=p_ends_at,active=p_active,updated_at=clock_timestamp()
        where id=p_id returning * into v_row;
    end if;
  exception when exclusion_violation then
    raise exception 'Active signup reward campaigns cannot overlap' using errcode='23P01';
  end;
  perform public.admin_write_audit(case when p_id is null then 'reward_campaign.create' else 'reward_campaign.update' end,
    'reward_campaign',v_row.id::text,case when p_id is not null then to_jsonb(v_old) end,to_jsonb(v_row),v_reason);
  return to_jsonb(v_row);
end;
$$;

-- Both the earning event and award must be in [start,end); paused/expired campaigns never catch up.
create function public.reward_signup_offer(p_event_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_campaign public.reward_multiplier_campaigns; v_base integer; v_now timestamptz:=clock_timestamp(); v_multiplier numeric;
begin
  select (value #>> '{}')::integer into strict v_base from public.app_settings where key='signup_reward_points';
  select * into v_campaign from public.reward_multiplier_campaigns
    where active and event_type='signup' and starts_at<=v_now and v_now<ends_at
      and starts_at<=coalesce(p_event_at,v_now) and coalesce(p_event_at,v_now)<ends_at
      and coalesce(p_event_at,v_now)<=v_now;
  v_multiplier:=coalesce(v_campaign.multiplier,1);
  -- PostgreSQL numeric round: nearest whole point, .5 rounds up for positive awards.
  return jsonb_build_object('base_points',v_base,'multiplier',v_multiplier,'final_points',round(v_base*v_multiplier)::integer,
    'campaign',case when v_campaign.id is not null then to_jsonb(v_campaign) end);
end;
$$;

create or replace function public.award_signup_points(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u auth.users; v_points integer; v_claim uuid; v_offer jsonb; v_event_at timestamptz;
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
  insert into public.reward_wallets(user_id) values(p_user_id) on conflict do nothing;
  perform 1 from public.reward_wallets where user_id=p_user_id for update;
  insert into public.reward_signup_claims(user_id,email_hash,phone_hash) values(
    p_user_id,encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex'),
    encode(sha256(convert_to(ltrim(u.phone,'+'),'UTF8')),'hex'))
    on conflict do nothing returning user_id into v_claim;
  if v_claim is null then return; end if;
  v_event_at:=greatest(u.created_at,u.email_confirmed_at,u.phone_confirmed_at);
  v_offer:=public.reward_signup_offer(v_event_at);
  v_points:=(v_offer->>'final_points')::integer;
  insert into public.reward_transactions(user_id,points,kind,base_points,multiplier,final_points,
    campaign_id,campaign_snapshot,event_type,event_ref,event_at,idempotency_key)
  values(p_user_id,v_points,'signup',(v_offer->>'base_points')::integer,(v_offer->>'multiplier')::numeric,v_points,
    (v_offer->'campaign'->>'id')::uuid,nullif(v_offer->'campaign','null'::jsonb),'signup',p_user_id,v_event_at,'signup:'||p_user_id::text);
  update public.reward_wallets set reward_balance=reward_balance+v_points where user_id=p_user_id;
end;
$$;

create or replace function public.get_my_rewards()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_enabled boolean; v_verified boolean; v_eligible boolean; v_event_at timestamptz; v_offer jsonb;
begin
  perform public.operations_require_session();
  select exists(select 1 from public.admin_financial_test_gate where enabled and environment='local_test') into v_enabled;
  perform public.award_signup_points(auth.uid());
  select email_confirmed_at is not null and phone_confirmed_at is not null,
    exists(select 1 from public.reward_launch where launched_at is not null and u.created_at>=launched_at),
    case when email_confirmed_at is not null and phone_confirmed_at is not null
      then greatest(u.created_at,u.email_confirmed_at,u.phone_confirmed_at) end
    into v_verified,v_eligible,v_event_at from auth.users u where id=auth.uid();
  v_offer:=public.reward_signup_offer(v_event_at);
  return jsonb_build_object('test_only',true,'enabled',v_enabled,'verified',v_verified,'eligible',v_eligible,
    'signup_enabled',exists(select 1 from public.app_settings where key='signup_reward_enabled' and value='true'::jsonb),
    'signup_points',(v_offer->>'base_points')::integer,'signup_offer',v_offer,
    'balance',coalesce((select reward_balance from public.reward_wallets where user_id=auth.uid()),0),
    'awarded',exists(select 1 from public.reward_signup_claims where user_id=auth.uid()),
    'transactions',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id) from (
      select * from public.reward_transactions where user_id=auth.uid()
      order by created_at desc,id limit 100) t),'[]'::jsonb));
end;
$$;

revoke all on function public.admin_list_reward_campaigns(int,int),
  public.admin_save_reward_campaign(uuid,text,numeric,timestamptz,timestamptz,boolean,text),
  public.reward_signup_offer(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_reward_campaigns(int,int),
  public.admin_save_reward_campaign(uuid,text,numeric,timestamptz,timestamptz,boolean,text) to authenticated;

commit;
