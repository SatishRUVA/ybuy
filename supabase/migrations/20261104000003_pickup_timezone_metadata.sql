begin;

-- Filling previously absent derived metadata does not move an agreed pickup address.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.protect_listing_related_edits()'::regprocedure);
  definition:=replace(definition,
    'if exists(select 1 from public.bookings where listing_id=v_id',
    'if tg_op=''UPDATE'' and tg_table_name=''listing_pickup_locations''
      and to_jsonb(old)->>''time_zone'' is null
      and (to_jsonb(new)-array[''time_zone'',''updated_at''])=(to_jsonb(old)-array[''time_zone'',''updated_at'']) then
      return new;
    end if;
    if exists(select 1 from public.bookings where listing_id=v_id');
  execute definition;
  definition:=pg_get_functiondef('public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)'::regprocedure);
  definition:=replace(definition,
    'set time_zone=v_zone where listing_id=p_listing_id;',
    'set time_zone=v_zone where listing_id=p_listing_id and time_zone is distinct from v_zone;');
  execute definition;
end;
$$;

notify pgrst,'reload schema';
commit;
