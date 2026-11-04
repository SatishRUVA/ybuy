begin;

alter policy listing_auction_decision_owner_read on public.listing_auction_decision_events
  using (public.has_active_session() and public.has_admin_permission('config.manage'));

alter function public.get_listing_auction(uuid) rename to get_listing_auction_before_private_decisions;
revoke all on function public.get_listing_auction_before_private_decisions(uuid)
  from public,anon,authenticated,service_role;
create function public.get_listing_auction(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
  v:=public.get_listing_auction_before_private_decisions(p_listing_id);
  if public.has_active_session() and public.has_admin_permission('config.manage') then return v;end if;
  return (v-array['owner_missed_decision_count','owner_reliability_flag','owner_decision_missed_at'])
    ||jsonb_build_object('owner_decision_missed_at',null);
end;
$$;
revoke all on function public.get_listing_auction(uuid) from public;
grant execute on function public.get_listing_auction(uuid) to anon,authenticated;

alter function public.get_owner_rating_stats(uuid[]) rename to get_owner_rating_stats_before_private_decisions;
revoke all on function public.get_owner_rating_stats_before_private_decisions(uuid[])
  from public,anon,authenticated,service_role;
create function public.get_owner_rating_stats(p_owner_ids uuid[])
returns table(owner_id uuid,rating numeric,review_count integer,missed_decision_count integer,rating_adjustment numeric)
language sql stable security definer set search_path='' as $$
  select s.owner_id,s.rating,s.review_count,
    case when public.has_active_session() and public.has_admin_permission('config.manage')
      then s.missed_decision_count else 0 end,s.rating_adjustment
  from public.get_owner_rating_stats_before_private_decisions(p_owner_ids) s
$$;
revoke all on function public.get_owner_rating_stats(uuid[]) from public;
grant execute on function public.get_owner_rating_stats(uuid[]) to anon,authenticated;

commit;
