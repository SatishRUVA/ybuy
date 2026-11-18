begin;

create function public.admin_list_auction_decisions(p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;
begin
  perform public.admin_require('config.manage');
  if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0 then
    raise exception 'Choose a page size from 1 to 100 and a nonnegative offset' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(page) order by page.detected_at desc,page.id),'[]'::jsonb) into v_rows
  from (
    select e.id,e.listing_id,l.title as listing_title,e.owner_id,p.full_name as owner_name,
      e.deadline_at,e.detected_at,e.eligible_bid_count,e.rating_eligible,e.exclusion_reason,e.exclusion_detail,
      (select count(*)::integer from public.listing_auction_decision_events other
        where other.owner_id=e.owner_id and other.rating_eligible) as owner_missed_decision_count
    from public.listing_auction_decision_events e
    join public.listings l on l.id=e.listing_id
    join public.profiles p on p.id=e.owner_id
    order by e.detected_at desc,e.id limit p_limit offset p_offset
  ) page;
  return jsonb_build_object('total',(select count(*) from public.listing_auction_decision_events),'rows',v_rows);
end;
$$;
revoke all on function public.admin_list_auction_decisions(integer,integer) from public,anon;
grant execute on function public.admin_list_auction_decisions(integer,integer) to authenticated;

commit;
