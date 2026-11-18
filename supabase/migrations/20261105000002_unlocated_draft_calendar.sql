begin;

-- Before pickup is chosen, drafts use the editor calendar; publication still requires pickup timezone.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)'::regprocedure);
  if position('if v_zone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then' in definition)=0 then
    raise exception 'Unexpected listing timezone guard';
  end if;
  definition:=replace(definition,
    'if v_zone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then',
    'if v_zone is null and not p_publish and not exists(
    select 1 from public.listing_pickup_locations where listing_id=p_listing_id
  ) then
    v_zone:=p_details->>''availability_timezone'';
  end if;
  if v_zone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then');
  execute definition;
end;
$$;

notify pgrst,'reload schema';
commit;
