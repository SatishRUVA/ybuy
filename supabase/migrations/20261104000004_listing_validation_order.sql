begin;

-- Preserve existing validation errors; a failed timezone check still rolls back the save.
do $$
declare
  definition text;
  timezone_check text := 'if p_publish and v_zone is null then
    raise exception ''Confirm the pickup location to determine its timezone before publishing'' using errcode=''55000'';
  end if;';
begin
  definition := pg_get_functiondef('public.owner_save_listing_flow(uuid,bigint,jsonb,jsonb,boolean)'::regprocedure);
  if position(timezone_check in definition)=0
    or position('perform public.operations_require_session();' in definition)=0
    or position('p_listing_id,p_revision,p_details,p_pickup-''timeZone'',p_publish);' in definition)=0 then
    raise exception 'Unexpected listing-save handler; cannot preserve validation ordering';
  end if;
  definition := replace(definition, 'perform public.operations_require_session();',
    'if jsonb_typeof(p_details)=''object'' and p_details ? ''offer_preferences'' then
    return public.owner_save_listing_flow_before_required_windows(
      p_listing_id,p_revision,p_details,p_pickup,p_publish);
  end if;
  perform public.operations_require_session();');
  definition := replace(definition, timezone_check, '');
  definition := replace(definition,
    'p_listing_id,p_revision,p_details,p_pickup-''timeZone'',p_publish);',
    'p_listing_id,p_revision,p_details,p_pickup-''timeZone'',p_publish);
  ' || timezone_check);
  execute definition;
end;
$$;

notify pgrst,'reload schema';
commit;
