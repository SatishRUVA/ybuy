begin;

grant execute on function public.can_access_booking_inspection_photo(text, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
