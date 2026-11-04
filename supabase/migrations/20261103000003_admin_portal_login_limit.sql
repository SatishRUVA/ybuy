create table public.admin_login_attempts (
  key text primary key,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);
alter table public.admin_login_attempts enable row level security;
revoke all on public.admin_login_attempts from public, anon, authenticated;

create function public.consume_admin_login_attempt(p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid administrator login counter' using errcode = '22023';
  end if;
  delete from public.admin_login_attempts where window_start < now() - interval '1 day';
  insert into public.admin_login_attempts as a (key, window_start, attempts)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when a.window_start <= now() - interval '5 minutes' then now() else a.window_start end,
    attempts = case when a.window_start <= now() - interval '5 minutes' then 1 else a.attempts + 1 end
  returning attempts into v_attempts;
  return v_attempts <= 5;
end;
$$;
revoke all on function public.consume_admin_login_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_admin_login_attempt(text) to service_role;
