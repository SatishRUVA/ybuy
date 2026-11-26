do $$
declare
  v_result jsonb;
  v_listing public.listings;
  v_expected integer;
begin
  v_listing.title := 'Comfortable cordless drill';
  v_listing.description := 'A comfortable grip';
  if public.listing_search_document(v_listing) @@ plainto_tsquery('english', 'table') then
    raise exception 'The word table matched comfortable';
  end if;
  v_listing.description := 'A folding table';
  if public.listing_search_document(v_listing) @@ plainto_tsquery('english', 'table') then
    raise exception 'Search matched a word found only in the description';
  end if;
  v_listing.title := 'Searchprobe folding tables';
  v_listing.description := 'A useful rental';
  if not (public.listing_search_document(v_listing) @@ plainto_tsquery('english', 'table'))
    or not (public.listing_search_document(v_listing) @@ plainto_tsquery('english', 'SEARCHPROBE table')) then
    raise exception 'The table listing did not match singular, plural or case-insensitive search';
  end if;

  select count(*) into v_expected from public.listings l
  where l.status = 'published'
    and (l.availability_end is null or l.availability_end > public.listing_local_today(l.id))
    and public.listing_search_document(l) @@ plainto_tsquery('english', 'table');
  for v_result in
    select public.search_available_listings(p_keyword => 'table', p_limit => 100)
    union all
    select public.search_available_listings(p_latitude => 32.8, p_longitude => -96.8,
      p_radius_miles => null, p_keyword => 'table', p_limit => 100)
  loop
    if (v_result->>'total')::integer <> v_expected then
      raise exception 'Search count does not match word-aware listing matches';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_result->'rows') r
      join public.listings l on l.id = (r->>'id')::uuid
      where not (public.listing_search_document(l) @@ plainto_tsquery('english', 'table'))
    ) then
      raise exception 'Search returned a listing without a matching word';
    end if;
  end loop;
end $$;
