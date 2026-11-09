begin;

create table public.listing_auction_activity (
  auction_id uuid primary key references public.listing_auctions(id) on delete cascade,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.listing_auction_activity enable row level security;
revoke all on public.listing_auction_activity from public,anon,authenticated;
grant select on public.listing_auction_activity to anon,authenticated;
create policy listing_auction_activity_public_read on public.listing_auction_activity
  for select to anon,authenticated using (true);

create function public.signal_listing_auction_bid_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_auction_id uuid;
begin
  if tg_op='DELETE' then
    v_auction_id:=old.auction_id;
    if not exists (select 1 from public.listing_auctions where id=v_auction_id) then return null; end if;
  else
    v_auction_id:=new.auction_id;
  end if;
  insert into public.listing_auction_activity(auction_id,updated_at)
    values(v_auction_id,clock_timestamp())
    on conflict(auction_id) do update set updated_at=excluded.updated_at;
  return null;
end;
$$;
revoke all on function public.signal_listing_auction_bid_activity() from public,anon,authenticated;
create trigger listing_auction_bid_activity
  after insert or update or delete on public.listing_auction_bids
  for each row execute function public.signal_listing_auction_bid_activity();

create function public.signal_listing_auction_state_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.listing_auction_activity(auction_id,updated_at)
    values(new.id,clock_timestamp())
    on conflict(auction_id) do update set updated_at=excluded.updated_at;
  return null;
end;
$$;
revoke all on function public.signal_listing_auction_state_activity() from public,anon,authenticated;
create trigger listing_auction_state_activity
  after insert or update of status,starts_at,ends_at on public.listing_auctions
  for each row execute function public.signal_listing_auction_state_activity();

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='listing_auction_activity') then
    alter publication supabase_realtime add table public.listing_auction_activity;
  end if;
end;
$$;

create or replace function public.get_top_listing_bids()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.expires_at,t.listing_id),'[]'::jsonb) from (
    select l.id as listing_id,l.title,coalesce(b.daily_rate,a.opening_daily_rate) as daily_rate,
      b.daily_rate is not null as has_bids,coalesce(b.bid_count,0)::integer as bid_count,
      coalesce(b.participant_count,0)::integer as participant_count,
      a.start_date,a.end_date,a.ends_at as expires_at,a.created_at,
      (select url from public.listing_images where listing_id=l.id order by sort_order limit 1) as image_url
    from public.listing_auctions a join public.listings l on l.id=a.listing_id
    left join lateral (
      select max(bid.daily_rate) as daily_rate,count(*)::integer as bid_count,
        count(distinct bid.renter_id)::integer as participant_count
      from public.listing_auction_bids bid where bid.auction_id=a.id and not bid.passed
        and not exists(select 1 from public.user_restrictions where user_id=bid.renter_id)
    ) b on true
    where l.status='published' and (l.availability_end is null or l.availability_end>current_date)
      and a.status='open' and a.starts_at<=statement_timestamp() and a.ends_at>statement_timestamp()
      and not exists(select 1 from public.user_restrictions where user_id=l.owner_id)
      and exists(select 1 from public.feature_flags where key='bidding' and enabled)
    order by a.ends_at,l.id limit 24
  ) t
$$;

commit;
