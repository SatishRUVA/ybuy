begin;

create function public.owner_save_listing_availability(
  p_listing_id uuid,
  p_revision bigint,
  p_start date,
  p_end date,
  p_blocked date[],
  p_timezone text default 'UTC'
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_listing public.listings;
  v_result jsonb;
begin
  perform public.operations_require_session();
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id is distinct from auth.uid() then
    raise exception 'Listing not found or not owned' using errcode='42501';
  end if;
  if p_revision is null or p_revision<>v_listing.revision then
    raise exception 'This listing changed in another session. Reload before saving.' using errcode='40001';
  end if;
  if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Invalid availability timezone' using errcode='22023';
  end if;
  perform pg_catalog.set_config('TimeZone',p_timezone,true);
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>30
    or p_blocked is null or cardinality(p_blocked)>30 or coalesce(array_ndims(p_blocked),1)>1
    or exists(select 1 from unnest(p_blocked) d where d is null or d<p_start or d>=p_end)
    or (select count(distinct d) from unnest(p_blocked) d)<>cardinality(p_blocked)
    or cardinality(p_blocked)>=p_end-p_start then
    raise exception 'Choose a valid availability window and unique blocked rental days, keeping at least one day open' using errcode='22023';
  end if;
  if exists(select 1 from public.bookings b where b.listing_id=p_listing_id
    and b.status in ('requested','pending_payment','confirmed','active','return_pending')
    and (b.status<>'pending_payment' or b.checkout_expires_at is null or b.checkout_expires_at>clock_timestamp())
    and (b.start_date<p_start or b.end_date>p_end
      or exists(select 1 from unnest(p_blocked) d where d>=b.start_date and d<b.end_date))) then
    raise exception 'Keep reserved rental days inside the availability window and unblocked' using errcode='23514';
  end if;
  v_result:=public.owner_save_listing_flow(p_listing_id,p_revision,
    jsonb_build_object('availability_start',p_start,'availability_end',p_end,'availability_timezone',p_timezone));
  delete from public.listing_availability
    where listing_id=p_listing_id and not is_available and date>=current_date and not(date=any(p_blocked));
  insert into public.listing_availability(listing_id,date,is_available)
    select p_listing_id,d,false from unnest(p_blocked) d
    on conflict(listing_id,date) do update set is_available=false
      where public.listing_availability.is_available;
  return v_result || jsonb_build_object('blocked',to_jsonb(p_blocked));
end;
$$;
revoke all on function public.owner_save_listing_availability(uuid,bigint,date,date,date[],text) from public,anon;
grant execute on function public.owner_save_listing_availability(uuid,bigint,date,date,date[],text) to authenticated;

commit;
