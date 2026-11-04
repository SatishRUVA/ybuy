begin;

create function public.admin_search_auction_decisions(
  p_search text default null,p_owner_id uuid default null,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_search text:=lower(btrim(coalesce(p_search,'')));
begin
  perform public.admin_require('config.manage');
  if length(v_search)>254 or p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0 then
    raise exception 'Use a search of at most 254 characters, a page size from 1 to 100 and a nonnegative offset' using errcode='22023';
  end if;
  with filtered as (
    select e.id,e.listing_id,l.title as listing_title,e.owner_id,p.full_name as owner_name,
      p.customer_id,e.deadline_at,e.detected_at,e.eligible_bid_count,
      e.rating_eligible,e.exclusion_reason,e.exclusion_detail,
      (select count(*)::integer from public.listing_auction_decision_events other
        where other.owner_id=e.owner_id and other.rating_eligible) as owner_missed_decision_count
    from public.listing_auction_decision_events e
    join public.listings l on l.id=e.listing_id
    join public.profiles p on p.id=e.owner_id
    where (p_owner_id is null or e.owner_id=p_owner_id)
      and (v_search='' or strpos(lower(coalesce(p.full_name,'')),v_search)>0
        or strpos(lower(coalesce(p.email,'')),v_search)>0
        or strpos(lower(p.customer_id),v_search)>0
        or strpos(e.owner_id::text,v_search)>0
        or strpos(lower(l.title),v_search)>0 or strpos(e.listing_id::text,v_search)>0)
  ), page as (
    select * from filtered order by detected_at desc,id limit p_limit offset p_offset
  )
  select jsonb_build_object('total',(select count(*) from filtered),
    'rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.detected_at desc,page.id) from page),'[]'::jsonb))
    into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_search_auction_decisions(text,uuid,integer,integer) from public,anon;
grant execute on function public.admin_search_auction_decisions(text,uuid,integer,integer) to authenticated;

create or replace function public.admin_list_auction_decisions(p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.admin_require('config.manage');
  if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0 then
    raise exception 'Choose a page size from 1 to 100 and a nonnegative offset' using errcode='22023';
  end if;
  return public.admin_search_auction_decisions(null,null,p_limit,p_offset);
end;
$$;

alter function public.admin_list_users(text,integer,integer) rename to admin_list_users_before_auction_history;
revoke all on function public.admin_list_users_before_auction_history(text,integer,integer)
  from public,anon,authenticated,service_role;
create function public.admin_list_users(p_search text default null,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  v_result:=public.admin_list_users_before_auction_history(p_search,p_limit,p_offset);
  if not public.has_admin_permission('config.manage') then return v_result;end if;
  return jsonb_set(v_result,'{rows}',coalesce((
    select jsonb_agg(row.value||jsonb_build_object(
      'missed_decision_count',(select count(*)::integer from public.listing_auction_decision_events e
        where e.owner_id=(row.value->>'id')::uuid and e.rating_eligible),
      'last_missed_decision_at',(select max(e.detected_at) from public.listing_auction_decision_events e
        where e.owner_id=(row.value->>'id')::uuid and e.rating_eligible)
    ) order by row.ordinality)
    from jsonb_array_elements(v_result->'rows') with ordinality row(value,ordinality)
  ),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_list_users(text,integer,integer) from public,anon;
grant execute on function public.admin_list_users(text,integer,integer) to authenticated;

commit;
