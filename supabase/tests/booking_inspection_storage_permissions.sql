begin;

do $$
begin
  if not has_function_privilege('authenticated',
    'public.can_access_booking_inspection_photo(text,boolean)', 'EXECUTE') then
    raise exception 'Authenticated storage policies require inspection helper execution';
  end if;
  if has_function_privilege('anon',
    'public.can_access_booking_inspection_photo(text,boolean)', 'EXECUTE') then
    raise exception 'Anonymous users must not execute the private inspection helper';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
begin
  perform id from storage.objects where bucket_id = 'listing-images' limit 1;
  if public.can_access_booking_inspection_photo('invalid-path')
    or public.can_access_booking_inspection_photo('invalid-path', true) then
    raise exception 'Inspection access must reject invalid paths and missing sessions';
  end if;
end;
$$;
reset role;

select 'Listing storage policies execute; private inspection access remains guarded' as result;
rollback;
