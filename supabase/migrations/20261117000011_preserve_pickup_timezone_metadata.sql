begin;

do $$
declare
  definition text;
  old_fragment text := 'if exists(select 1 from public.bookings where listing_id=v_id and status in (''pending_payment'',''confirmed'',''active'',''return_pending'')) then
    raise exception ''Photos and pickup details cannot change while an approved rental is outstanding'' using errcode=''23514'';
  end if;';
  new_fragment text := 'if tg_op=''UPDATE'' and tg_table_name=''listing_pickup_locations''
    and to_jsonb(old)->>''time_zone'' is null
    and (to_jsonb(new)-array[''time_zone'',''updated_at''])=(to_jsonb(old)-array[''time_zone'',''updated_at'']) then
    return new;
  end if;
  if exists(select 1 from public.bookings where listing_id=v_id and status in (''pending_payment'',''confirmed'',''active'',''return_pending'')) then
    raise exception ''Photos and pickup details cannot change while an approved rental is outstanding'' using errcode=''23514'';
  end if;';
begin
  definition:=pg_get_functiondef('public.protect_listing_related_edits()'::regprocedure);
  if position('to_jsonb(old)->>''time_zone'' is null' in definition)>0 then
    return;
  end if;
  if position(old_fragment in definition)=0 then
    raise exception 'Unexpected pickup edit guard; cannot preserve timezone metadata updates';
  end if;
  execute replace(definition,old_fragment,new_fragment);
end;
$$;

notify pgrst,'reload schema';
commit;
