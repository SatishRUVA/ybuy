begin;

insert into public.app_settings(key,value,value_type,min_value,max_value,description,is_public) values
  ('auction_missed_decision_rating_penalty','0.1','number',0,1,
    'Stars deducted per attributable missed auction decision, capped at one star. Changes are admin-audited.',false)
on conflict(key) do nothing;

create table public.listing_auction_decision_events (
  id uuid primary key default gen_random_uuid(),
  listing_auction_id uuid not null unique references public.listing_auctions(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  deadline_at timestamptz not null,
  detected_at timestamptz not null,
  eligible_bid_count integer not null check(eligible_bid_count>=0),
  rating_eligible boolean not null,
  exclusion_reason text check(exclusion_reason is null or length(exclusion_reason)<=120),
  excluded_by uuid references public.profiles(id),
  exclusion_detail text check(exclusion_detail is null or length(exclusion_detail)<=500),
  excluded_at timestamptz,
  created_at timestamptz not null default now()
);
create index listing_auction_decision_owner_rating_idx
  on public.listing_auction_decision_events(owner_id,rating_eligible) where rating_eligible;
alter table public.listing_auction_decision_events enable row level security;
revoke all on public.listing_auction_decision_events from public,anon,authenticated;
grant select on public.listing_auction_decision_events to authenticated;
grant all on public.listing_auction_decision_events to service_role;
create policy listing_auction_decision_owner_read on public.listing_auction_decision_events
  for select to authenticated using(public.has_active_session() and
    (owner_id=auth.uid() or public.has_admin_permission('config.manage')));

create table public.auction_lifecycle_heartbeats(run_at timestamptz primary key default clock_timestamp());
alter table public.auction_lifecycle_heartbeats enable row level security;
revoke all on public.auction_lifecycle_heartbeats from public,anon,authenticated;
grant all on public.auction_lifecycle_heartbeats to service_role;

create function public.record_auction_decision_rating_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_eligible_count integer;
  v_healthy boolean;
  v_exclusion_reason text;
begin
  if old.owner_decision_missed_at is not null or new.owner_decision_missed_at is null then return new;end if;
  select owner_id into strict v_owner from public.listings where id=new.listing_id;
  select count(*)::integer into v_eligible_count from public.listing_auction_ranked_bids(new.id);
  with ordered as (
    select run_at,lag(run_at) over(order by run_at) as previous_run
    from public.auction_lifecycle_heartbeats
    where run_at between old.selection_deadline-interval '5 minutes' and new.owner_decision_missed_at
  ), health as (
    select coalesce(bool_and(case when previous_run is null
      then run_at-(old.selection_deadline-interval '5 minutes')<=interval '5 minutes'
      else run_at-previous_run<=interval '5 minutes' end),false) as no_gaps,
      min(run_at) as first_run,max(run_at) as last_run
    from ordered
  )
  select no_gaps and first_run<=old.selection_deadline+interval '5 minutes'
    and last_run>=new.owner_decision_missed_at-interval '5 minutes'
    and new.owner_decision_missed_at<=old.selection_deadline+interval '5 minutes'
    into v_healthy from health;
  v_exclusion_reason:=case when v_eligible_count=0 then 'no_eligible_bid'
    when not coalesce(v_healthy,false) then 'scheduler_unhealthy' else null end;
  insert into public.listing_auction_decision_events(
    listing_auction_id,listing_id,owner_id,deadline_at,detected_at,eligible_bid_count,rating_eligible,exclusion_reason
  ) values(new.id,new.listing_id,v_owner,old.selection_deadline,new.owner_decision_missed_at,
    v_eligible_count,v_exclusion_reason is null,v_exclusion_reason)
    on conflict(listing_auction_id) do nothing;
  return new;
end;
$$;
revoke all on function public.record_auction_decision_rating_event() from public,anon,authenticated;
create trigger record_auction_decision_rating_event after update on public.listing_auctions
  for each row execute function public.record_auction_decision_rating_event();

alter function public.get_listing_auction(uuid) rename to get_listing_auction_before_decision_rating;
revoke all on function public.get_listing_auction_before_decision_rating(uuid) from public,anon,authenticated;
create function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_owner uuid;
begin
  v_result:=public.get_listing_auction_before_decision_rating(p_listing_id);
  if v_result is null then return null;end if;
  select owner_id into v_owner from public.listings where id=p_listing_id;
  return v_result||jsonb_build_object('owner_missed_decision_count',
    (select count(*)::integer from public.listing_auction_decision_events where owner_id=v_owner and rating_eligible));
end;
$$;
revoke all on function public.get_listing_auction(uuid) from public;
grant execute on function public.get_listing_auction(uuid) to anon,authenticated;

create or replace function public.process_scheduled_listing_auctions()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_processed integer;
begin
  insert into public.auction_lifecycle_heartbeats default values;
  v_processed:=public.process_listing_auctions();
  delete from public.auction_lifecycle_heartbeats where run_at<clock_timestamp()-interval '2 days';
  return v_processed;
end;
$$;
revoke all on function public.process_scheduled_listing_auctions() from public,anon,authenticated;
grant execute on function public.process_scheduled_listing_auctions() to service_role;
select cron.unschedule(jobid) from cron.job where jobname='competitive-listing-auctions';
select cron.schedule('competitive-listing-auctions','* * * * *','select public.process_scheduled_listing_auctions();');

create function public.admin_exclude_auction_decision_event(p_event_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event public.listing_auction_decision_events; v_reason text;
begin
  perform public.admin_require('config.manage');
  v_reason:=public.admin_clean_reason(p_reason);
  select * into v_event from public.listing_auction_decision_events where id=p_event_id for update;
  if not found then raise exception 'Auction decision event not found' using errcode='P0002';end if;
  update public.listing_auction_decision_events set rating_eligible=false,excluded_by=auth.uid(),
    exclusion_detail=v_reason,excluded_at=clock_timestamp() where id=p_event_id;
  perform public.admin_write_audit('auction_decision.exclude','auction_decision_event',p_event_id::text,
    to_jsonb(v_event),jsonb_build_object('rating_eligible',false,'exclusion_detail',v_reason),v_reason);
end;
$$;
revoke all on function public.admin_exclude_auction_decision_event(uuid,text) from public,anon;
grant execute on function public.admin_exclude_auction_decision_event(uuid,text) to authenticated;

create function public.get_owner_rating_stats(p_owner_ids uuid[])
returns table(owner_id uuid,rating numeric,review_count integer,missed_decision_count integer,rating_adjustment numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_penalty numeric;
begin
  if p_owner_ids is null or cardinality(p_owner_ids)=0 or cardinality(p_owner_ids)>100
    or array_position(p_owner_ids,null) is not null then
    raise exception 'Choose between 1 and 100 valid owner ids' using errcode='22023';
  end if;
  select (value #>> '{}')::numeric into v_penalty from public.app_settings
    where key='auction_missed_decision_rating_penalty';
  v_penalty:=coalesce(v_penalty,0.1);
  return query
    with requested as (select distinct unnest(p_owner_ids) as id),
    reviews as (
      select r.reviewee_id,avg(r.rating)::numeric as average,count(*)::integer as review_count
      from public.reviews r join requested q on q.id=r.reviewee_id group by r.reviewee_id
    ), missed as (
      select e.owner_id,count(*)::integer as missed_count
      from public.listing_auction_decision_events e join requested q on q.id=e.owner_id
      where e.rating_eligible group by e.owner_id
    )
    select q.id,
      case when coalesce(r.review_count,0)=0 then 0::numeric
        else round(greatest(0::numeric,r.average-least(1::numeric,coalesce(m.missed_count,0)*v_penalty)),2) end,
      coalesce(r.review_count,0),coalesce(m.missed_count,0),
      least(1::numeric,coalesce(m.missed_count,0)*v_penalty)
    from requested q left join reviews r on r.reviewee_id=q.id left join missed m on m.owner_id=q.id;
end;
$$;
revoke all on function public.get_owner_rating_stats(uuid[]) from public;
grant execute on function public.get_owner_rating_stats(uuid[]) to anon,authenticated;

notify pgrst,'reload schema';
commit;