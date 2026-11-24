do $$
declare
  result jsonb;
  expected integer;
  owned_id uuid;
  status_total integer;
  category_id uuid;
  test_category uuid;
  test_status text;
  test_owner uuid;
  test_result jsonb;
  test_search text;
begin
  if to_regprocedure('public.get_global_bidding_feed(uuid,integer,text)') is null then
    raise exception 'Global bidding feed is missing';
  end if;

  select l.id into owned_id
  from public.listings l join public.listing_auctions a on a.listing_id=l.id
  where l.status='published'
    and not exists(select 1 from public.user_restrictions r where r.user_id=l.owner_id)
  order by a.created_at desc limit 1;
  if owned_id is not null then
    perform set_config('request.jwt.claim.sub', (select owner_id::text from public.listings where id=owned_id), true);
  end if;

  select count(*) into expected
  from public.listings l join public.listing_auctions a on a.listing_id=l.id
  join public.categories c on c.id=l.category_id
  where l.status='published'
    and not exists(select 1 from public.user_restrictions r where r.user_id=l.owner_id)
    and exists(select 1 from public.feature_flags f where f.key='bidding' and f.enabled);

  result := public.get_global_bidding_feed(null, 0, 'all');
  if (result->>'total')::integer <> expected then
    raise exception 'Global total excludes eligible listings';
  end if;
  if exists (
    select 1 from jsonb_array_elements(result->'items') item
    where not item ? 'status' or item ? 'owner_bids' or item ? 'renter_id'
  ) then
    raise exception 'Global feed exposes private bid details or omits status';
  end if;
  if owned_id is not null and expected <= 24 and not exists (
    select 1 from jsonb_array_elements(result->'items') item
    where item->>'listing_id'=owned_id::text
  ) then
    raise exception 'Global feed excludes the signed-in owner';
  end if;
  if (public.get_global_bidding_feed(null, 0, 'live')->>'total')::integer <>
     (select count(*) from public.listings l join public.listing_auctions a on a.listing_id=l.id
      join public.categories c on c.id=l.category_id
      where l.status='published' and a.status='open'
        and a.starts_at<=statement_timestamp() and a.ends_at>statement_timestamp()
        and not exists(select 1 from public.user_restrictions r where r.user_id=l.owner_id)
        and exists(select 1 from public.feature_flags f where f.key='bidding' and f.enabled)) then
    raise exception 'Live filter does not match open bidding';
  end if;
  select sum((public.get_global_bidding_feed(null, 0, s)->>'total')::integer)
    into status_total from unnest(array['live','scheduled','completed','closed']) s;
  if status_total <> expected then
    raise exception 'Status filters do not partition the global total';
  end if;
  for test_category in
    select null::uuid
    union all select (item->>'id')::uuid from jsonb_array_elements(result->'categories') item
    union all select '00000000-0000-0000-0000-000000000000'::uuid
  loop
    foreach test_status in array array['all','live','scheduled','completed','closed'] loop
      if (public.get_global_bidding_feed(test_category,0,'live')->'status_counts'->>test_status)::integer
          is distinct from (public.get_global_bidding_feed(test_category,0,test_status)->>'total')::integer then
        raise exception 'Status count for % does not match category %', test_status, test_category;
      end if;
      if test_category is not null
        and (public.get_global_bidding_feed(test_category,0,'all')->>'total')::integer > 0
        and not exists (
          select 1 from jsonb_array_elements(public.get_global_bidding_feed(test_category,0,test_status)->'categories') item
          where item->>'id'=test_category::text
        ) then
        raise exception 'Selected category disappears for status %', test_status;
      end if;
    end loop;
  end loop;
  if (select count(distinct item->>'listing_id')
      from generate_series(0, greatest(expected-1,0),24) page_offset
      cross join lateral jsonb_array_elements(public.get_global_bidding_feed(null,page_offset,'all')->'items') item) <> expected then
    raise exception 'Paginated listings are missing or duplicated';
  end if;
  select (item->>'id')::uuid into category_id
    from jsonb_array_elements(result->'categories') item limit 1;
  if category_id is not null and
    (public.get_global_bidding_feed(category_id,0,'all')->>'total')::integer <>
      (select (item->>'count')::integer from jsonb_array_elements(result->'categories') item
       where (item->>'id')::uuid=category_id) then
    raise exception 'Category count does not match filtered results';
  end if;
  test_result := public.get_global_bidding_feed(null,0,'all','a search that matches no listings',false,'ending');
  if (test_result->>'total')::integer <> 0 or (test_result->'status_counts'->>'all')::integer <> 0 then
    raise exception 'Search does not filter results and counts';
  end if;
  if owned_id is not null then
    select owner_id into test_owner from public.listings where id=owned_id;
    select upper(left(title, 5)) into test_search from public.listings where id=owned_id;
    test_result := public.get_global_bidding_feed(null,0,'all',test_search,false,'ending');
    if (test_result->>'total')::integer <> (
      select count(*) from public.listings l join public.listing_auctions a on a.listing_id=l.id
      join public.categories c on c.id=l.category_id
      where l.status='published' and strpos(lower(l.title),lower(test_search))>0
        and not exists(select 1 from public.user_restrictions r where r.user_id=l.owner_id)
        and exists(select 1 from public.feature_flags f where f.key='bidding' and f.enabled)
    ) then raise exception 'Search does not match titles case-insensitively'; end if;
    test_result := public.get_global_bidding_feed(null,0,'all','',true,'ending');
    if (test_result->>'total')::integer <> (
      select count(*) from public.listings l join public.listing_auctions a on a.listing_id=l.id
      join public.categories c on c.id=l.category_id
      where l.owner_id=test_owner and l.status='published'
        and not exists(select 1 from public.user_restrictions r where r.user_id=l.owner_id)
        and exists(select 1 from public.feature_flags f where f.key='bidding' and f.enabled)
    ) or exists(select 1 from jsonb_array_elements(test_result->'items') item where item->>'is_mine' <> 'true') then
      raise exception 'Only mine includes other owners or omits owned listings';
    end if;
  end if;
  if (public.get_global_bidding_feed(null,0,'past','',false,'ending')->>'total')::integer <>
     (result->'status_counts'->>'completed')::integer + (result->'status_counts'->>'closed')::integer then
    raise exception 'Past includes scheduled or live bidding';
  end if;
  if exists (
    select 1 from (
      select (item->>'opening_daily_rate')::numeric as rate,
        lag((item->>'opening_daily_rate')::numeric) over (order by n) as previous_rate
      from jsonb_array_elements(public.get_global_bidding_feed(null,0,'live','',false,'low')->'items')
        with ordinality as rows(item,n)
    ) prices where rate < previous_rate
  ) then raise exception 'Lowest starting bid sorting is incorrect'; end if;
  if exists (
    select 1 from (
      select (item->>'opening_daily_rate')::numeric as rate,
        lag((item->>'opening_daily_rate')::numeric) over (order by n) as previous_rate
      from jsonb_array_elements(public.get_global_bidding_feed(null,0,'past','',false,'high')->'items')
        with ordinality as rows(item,n)
    ) prices where rate is null or rate > previous_rate
  ) then raise exception 'Highest starting bid sorting is incorrect'; end if;
  begin
    perform public.get_global_bidding_feed(null,0,'all','',false,'invalid');
    raise exception 'Invalid sort was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.get_global_bidding_feed(null,0,'invalid');
    raise exception 'Invalid status was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
