begin;

create function public.listing_search_document(public.listings)
returns tsvector
language sql immutable parallel safe set search_path = ''
as $$
  select pg_catalog.to_tsvector('pg_catalog.english'::regconfig, coalesce(($1).title, ''));
$$;

do $$
declare
  definition text;
  old_filter constant text := 'strpos(lower(l.title||'' ''||coalesce(l.description,'''')),lower(btrim(p_keyword)))>0';
begin
  definition := pg_get_functiondef(
    'public.search_available_listings(double precision,double precision,integer,date,date,text,uuid,numeric,boolean,boolean,boolean,boolean,text,integer,integer)'::regprocedure);
  if position(old_filter in definition) = 0 then
    raise exception 'Unexpected listing search keyword filter';
  end if;
  definition := replace(definition, old_filter,
    'public.listing_search_document(l) @@ pg_catalog.plainto_tsquery(''pg_catalog.english''::regconfig, p_keyword)');
  execute definition;
end $$;

notify pgrst, 'reload schema';
commit;
