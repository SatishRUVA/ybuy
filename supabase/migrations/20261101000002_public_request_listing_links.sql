begin;

create function public.link_item_request_listing(p_request_id uuid, p_listing_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_request public.item_requests;
  v_listing public.listings;
begin
  perform public.marketplace_require_user();
  if not exists(select 1 from public.feature_flags where key='item_requests' and enabled) then
    raise exception 'Item requests are disabled' using errcode='55000';
  end if;
  select * into v_request from public.item_requests where id=p_request_id for update;
  if not found then raise exception 'Request not found' using errcode='22023'; end if;
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.owner_id is distinct from auth.uid() then
    raise exception 'Choose your own published rental' using errcode='42501';
  end if;
  if public.listing_matches_request(v_listing,v_request) is not true then
    raise exception 'This rental does not match the requested category, dates, area, quantity or listed-price budget' using errcode='22023';
  end if;
  insert into public.item_request_listing_matches(request_id,listing_id)
    values(v_request.id,v_listing.id) on conflict do nothing;
  perform public.create_notification(v_request.renter_id,
    'request-match:'||v_request.id||':listing:'||v_listing.id,'requests',
    'An available listing matches your request',
    left(v_listing.title||' matches your category, dates, area and budget. Availability is rechecked at booking.',500),
    '/listing/'||v_listing.id);
end;
$$;
revoke all on function public.link_item_request_listing(uuid,uuid) from public,anon;
grant execute on function public.link_item_request_listing(uuid,uuid) to authenticated;

commit;
