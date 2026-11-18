begin;

create function public.get_listing_category_counts()
returns table(category_id uuid, listing_count bigint)
language sql stable security definer set search_path='' as $$
  select l.category_id, count(*) from public.listings l
  where l.status='published'
    and (l.availability_end is null or l.availability_end>public.listing_local_today(l.id))
  group by l.category_id;
$$;
revoke all on function public.get_listing_category_counts() from public;
grant execute on function public.get_listing_category_counts() to anon,authenticated;

notify pgrst,'reload schema';
commit;
