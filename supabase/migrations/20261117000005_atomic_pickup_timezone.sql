begin;

-- Publication validates the stored address, so its time zone must travel through the same upsert.
do $$
declare definition text; updated text; old_fragment text; new_fragment text;
begin
  definition:=pg_get_functiondef('public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)'::regprocedure);
  old_fragment:='p_listing_id,p_revision,p_details,p_pickup-''timeZone'',p_publish);';
  new_fragment:='p_listing_id,p_revision,p_details,
      case when p_pickup is not null and v_zone is not null
        then p_pickup || jsonb_build_object(''timeZone'',v_zone) else p_pickup end,p_publish);';
  if position(old_fragment in definition)=0 then
    raise exception 'Unexpected listing time zone wrapper; cannot update pickup persistence';
  end if;
  execute replace(definition,old_fragment,new_fragment);

  definition:=pg_get_functiondef('public.owner_save_listing_flow_before_offers(uuid,bigint,jsonb,jsonb,boolean)'::regprocedure);
  updated:=replace(definition,
    '''latitude'',''longitude'',''placeId''))',
    '''latitude'',''longitude'',''placeId'',''timeZone''))');
  updated:=replace(updated,
    'coalesce(p.place_id,''''))',
    'coalesce(p.place_id,''''),p.time_zone)');
  updated:=replace(updated,
    'coalesce(p_pickup->>''placeId'','''')))',
    'coalesce(p_pickup->>''placeId'',''''),p_pickup->>''timeZone''))');
  if position('''placeId'',''timeZone''))' in updated)=0
    or position('coalesce(p.place_id,''''),p.time_zone)' in updated)=0
    or position('coalesce(p_pickup->>''placeId'',''''),p_pickup->>''timeZone''))' in updated)=0 then
    raise exception 'Unexpected listing pickup comparison; cannot update pickup persistence';
  end if;
  execute updated;

  definition:=pg_get_functiondef('public.owner_save_listing_before_flow(uuid,bigint,jsonb,jsonb)'::regprocedure);
  updated:=replace(definition,
    'latitude,longitude,place_id)',
    'latitude,longitude,place_id,time_zone)');
  updated:=replace(updated,
    'nullif(p_pickup->>''placeId'',''''))',
    'nullif(p_pickup->>''placeId'',''''),p_pickup->>''timeZone'')');
  updated:=replace(updated,
    'place_id=excluded.place_id;',
    'place_id=excluded.place_id,time_zone=excluded.time_zone;');
  if position('latitude,longitude,place_id,time_zone)' in updated)=0
    or position('nullif(p_pickup->>''placeId'',''''),p_pickup->>''timeZone'')' in updated)=0
    or position('place_id=excluded.place_id,time_zone=excluded.time_zone;' in updated)=0 then
    raise exception 'Unexpected listing pickup upsert; cannot update pickup persistence';
  end if;
  execute updated;
end;
$$;

notify pgrst,'reload schema';
commit;
