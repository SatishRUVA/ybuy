-- Publish flag changes using the existing public-read RLS policy.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'feature_flags'
  ) then
    alter publication supabase_realtime add table public.feature_flags;
  end if;
end;
$$;
