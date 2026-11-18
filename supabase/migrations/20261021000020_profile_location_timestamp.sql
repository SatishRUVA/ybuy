begin;
alter table public.profiles add column location_updated_at timestamptz;
revoke select(location_updated_at) on public.profiles from public,anon,authenticated;
create function public.timestamp_profile_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' then
    new.location_updated_at:=case when new.country_code is not null or new.location is not null then clock_timestamp() else null end;
  elsif (new.country_code,new.state_region_code,new.location) is distinct from (old.country_code,old.state_region_code,old.location) then
    new.location_updated_at:=clock_timestamp();
  elsif new.location_updated_at is distinct from old.location_updated_at then
    raise exception 'Location timestamps are assigned by the server' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger profile_location_timestamp before insert or update on public.profiles for each row execute function public.timestamp_profile_location();
revoke all on function public.timestamp_profile_location() from public,anon,authenticated;
commit;
