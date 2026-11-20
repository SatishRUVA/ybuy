-- Limit Realtime row visibility to staff already authorized for each case kind.
grant select on public.operations_cases to authenticated;

create policy operations_cases_staff_realtime_read on public.operations_cases
  for select to authenticated
  using (
    (kind = 'dispute' and public.has_admin_permission('disputes.manage'))
    or (kind = 'support' and public.has_admin_permission('support.manage'))
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'operations_cases'
    ) then
    alter publication supabase_realtime add table public.operations_cases;
  end if;
end;
$$;
