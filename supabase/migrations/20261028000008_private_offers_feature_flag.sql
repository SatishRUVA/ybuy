begin;

insert into public.feature_flags(key, enabled, description) values
  ('private_offers', false, 'Private renter-to-owner offers and counteroffers on individual listings.')
on conflict (key) do nothing;

create or replace function public.create_marketplace_offer(
  p_item_request_id uuid,p_listing_id uuid,p_start_date date,p_end_date date,
  p_daily_rate numeric,p_message text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request public.item_requests;
  v_listing public.listings;
  v_negotiation public.marketplace_negotiations;
  v_proposal public.negotiation_proposals;
  v_flag boolean;
  v_max_price numeric;
  v_expiry_hours integer;
  v_is_request boolean:=p_item_request_id is not null;
begin
  perform public.marketplace_require_user();
  if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode='22023';end if;
  if p_start_date is null or p_end_date is null or p_start_date<current_date or p_end_date<=p_start_date or p_end_date-p_start_date>366 then
    raise exception 'Choose a valid future date range' using errcode='22023';
  end if;
  if p_daily_rate is null or p_daily_rate<=0 or p_daily_rate::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Offer price must be greater than zero' using errcode='22023';
  end if;
  select coalesce((value #>> '{}')::numeric,100000) into v_max_price from public.app_settings where key='negotiation_max_daily_price';
  if p_daily_rate>coalesce(v_max_price,100000) then raise exception 'Offer price exceeds the platform limit' using errcode='22023';end if;
  if p_message is not null and char_length(p_message)>1000 then raise exception 'Message is too long' using errcode='22023';end if;
  select * into v_negotiation from public.marketplace_negotiations where created_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    select * into v_proposal from public.negotiation_proposals where negotiation_id=v_negotiation.id order by revision desc limit 1;
    return jsonb_build_object('negotiation',to_jsonb(v_negotiation),'proposal',to_jsonb(v_proposal));
  end if;
  if v_is_request then
    select * into v_request from public.item_requests where id=p_item_request_id for update;
    if not found or v_request.visibility<>'public' or v_request.status not in ('open','responses_received','negotiating') or v_request.expires_at<=now() then
      raise exception 'Request is no longer accepting offers' using errcode='55000';
    end if;
    if v_request.renter_id=auth.uid() then raise exception 'You cannot respond to your own request' using errcode='42501';end if;
    select enabled into v_flag from public.feature_flags where key='item_requests';
    if coalesce(v_flag,false) is not true then raise exception 'Item requests are not currently enabled' using errcode='55000';end if;
    if p_start_date<v_request.preferred_start_date or p_end_date>v_request.preferred_end_date then
      raise exception 'Offer dates must fit within the requested date range' using errcode='22023';
    end if;
    if v_request.max_daily_budget is not null and p_daily_rate>v_request.max_daily_budget then
      raise exception 'Offer price exceeds the renter budget' using errcode='22023';
    end if;
    if exists(select 1 from public.marketplace_negotiations where item_request_id=p_item_request_id and owner_id=auth.uid() and status in ('pending','countered')) then
      raise exception 'You already have an active offer for this request' using errcode='23505';
    end if;
    if p_listing_id is not null then
      select * into v_listing from public.listings where id=p_listing_id and owner_id=auth.uid() and status='published' for update;
      if not found or v_listing.category_id<>v_request.category_id then
        raise exception 'Choose your published listing in the requested category' using errcode='22023';
      end if;
      if v_listing.available_quantity<v_request.requested_quantity then
        raise exception 'Listing quantity cannot fulfill the request' using errcode='22023';
      end if;
    end if;
    insert into public.marketplace_negotiations(item_request_id,listing_id,renter_id,owner_id,created_by,idempotency_key)
      values(p_item_request_id,p_listing_id,v_request.renter_id,auth.uid(),auth.uid(),p_idempotency_key) returning * into v_negotiation;
    update public.item_requests set status=case when status='open' then 'responses_received' else status end where id=p_item_request_id;
  else
    select * into v_listing from public.listings where id=p_listing_id and status='published' for update;
    if not found or not v_listing.negotiation_enabled then raise exception 'This listing is not eligible for offers' using errcode='55000';end if;
    if v_listing.owner_id=auth.uid() then raise exception 'You cannot negotiate on your own listing' using errcode='42501';end if;
    select enabled into v_flag from public.feature_flags where key='private_offers';
    if coalesce(v_flag,false) is not true then raise exception 'Private offers are not currently enabled' using errcode='55000';end if;
    if exists(select 1 from public.marketplace_negotiations where item_request_id is null and listing_id=p_listing_id
      and renter_id=auth.uid() and owner_id=v_listing.owner_id and status in ('pending','countered')) then
      raise exception 'You already have an active offer for this listing' using errcode='23505';
    end if;
    insert into public.marketplace_negotiations(listing_id,renter_id,owner_id,created_by,idempotency_key)
      values(p_listing_id,auth.uid(),v_listing.owner_id,auth.uid(),p_idempotency_key) returning * into v_negotiation;
  end if;
  if p_listing_id is not null then
    perform public.expire_listing_checkouts(p_listing_id);
    if not public.listing_has_capacity(p_listing_id,p_start_date,p_end_date,case when v_is_request then v_request.requested_quantity else 1 end) then
      raise exception 'Listing is not available for the proposed dates' using errcode='23P01';
    end if;
  end if;
  v_expiry_hours:=public.marketplace_setting_int('negotiation_expiration_hours',72);
  insert into public.negotiation_proposals(negotiation_id,revision,proposed_by,proposed_to,daily_rate,start_date,end_date,message,expires_at)
    values(v_negotiation.id,1,auth.uid(),case when v_is_request then v_negotiation.renter_id else v_negotiation.owner_id end,
      p_daily_rate,p_start_date,p_end_date,p_message,now()+make_interval(hours=>v_expiry_hours)) returning * into v_proposal;
  perform public.marketplace_record(p_item_request_id,v_negotiation.id,'offer_created',
    jsonb_build_object('proposal_id',v_proposal.id,'daily_rate',v_proposal.daily_rate,'start_date',v_proposal.start_date,'end_date',v_proposal.end_date),
    'New rental offer','You have received a new rental offer.',v_proposal.proposed_to);
  return jsonb_build_object('negotiation',to_jsonb(v_negotiation),'proposal',to_jsonb(v_proposal));
end;
$$;

create or replace function public.respond_to_marketplace_offer_before_reservations(
  p_negotiation_id uuid,p_action text,p_daily_rate numeric default null,
  p_start_date date default null,p_end_date date default null,p_message text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_negotiation public.marketplace_negotiations;
  v_proposal public.negotiation_proposals;
  v_new_proposal public.negotiation_proposals;
  v_listing public.listings;
  v_request public.item_requests;
  v_booking public.bookings;
  v_actor_other uuid;
  v_round_limit integer;
  v_expiry_hours integer;
  v_fee_pct numeric(5,4);
  v_days integer;
  v_quantity integer := 1;
  v_subtotal numeric(10,2);
  v_fee numeric(10,2);
  v_max_price numeric;
  v_flag boolean;
begin
  perform public.marketplace_require_user();
  if p_action not in ('accept','decline','counter','withdraw') then raise exception 'Invalid offer action' using errcode='22023';end if;
  select * into v_negotiation from public.marketplace_negotiations where id=p_negotiation_id for update;
  if not found or (v_negotiation.renter_id<>auth.uid() and v_negotiation.owner_id<>auth.uid()) then
    raise exception 'Offer not found' using errcode='P0002';
  end if;
  if v_negotiation.status='accepted' and v_negotiation.booking_id is not null and p_action='accept' then
    select * into v_booking from public.bookings where id=v_negotiation.booking_id;
    return jsonb_build_object('negotiation',to_jsonb(v_negotiation),'booking',to_jsonb(v_booking),'idempotent',true);
  end if;
  if v_negotiation.status not in ('pending','countered') then raise exception 'Offer is no longer active' using errcode='55000';end if;
  select * into v_proposal from public.negotiation_proposals where negotiation_id=p_negotiation_id order by revision desc limit 1 for update;
  if not found or v_proposal.status<>'pending' then raise exception 'No active proposal is awaiting a response' using errcode='55000';end if;
  if v_proposal.expires_at<=now() then
    update public.negotiation_proposals set status='expired' where id=v_proposal.id;
    update public.marketplace_negotiations set status='expired' where id=p_negotiation_id returning * into v_negotiation;
    perform public.marketplace_record(v_negotiation.item_request_id,v_negotiation.id,'offer_expired',
      jsonb_build_object('proposal_id',v_proposal.id),'Rental offer expired','An offer in this conversation has expired.');
    return jsonb_build_object('negotiation',to_jsonb(v_negotiation),'expired',true);
  end if;
  if p_action='withdraw' then
    if v_proposal.proposed_by<>auth.uid() then raise exception 'Only the offer author can withdraw it' using errcode='42501';end if;
    update public.negotiation_proposals set status='withdrawn' where id=v_proposal.id returning * into v_proposal;
    update public.marketplace_negotiations set status='withdrawn' where id=p_negotiation_id returning * into v_negotiation;
    perform public.marketplace_record(v_negotiation.item_request_id,v_negotiation.id,'offer_withdrawn',
      jsonb_build_object('proposal_id',v_proposal.id),'Rental offer withdrawn','An offer you received has been withdrawn.');
    return jsonb_build_object('negotiation',to_jsonb(v_negotiation),'proposal',to_jsonb(v_proposal));
  end if;
  if v_proposal.proposed_to<>auth.uid() then raise exception 'Only the intended recipient can respond to this offer' using errcode='42501';end if;
  if p_action='decline' then
    update public.negotiation_proposals set status='declined' where id=v_proposal.id returning * into v_proposal;
    update public.marketplace_negotiations set status='declined' where id=p_negotiation_id returning * into v_negotiation;
    perform public.marketplace_record(v_negotiation.item_request_id,v_negotiation.id,'offer_declined',
      jsonb_build_object('proposal_id',v_proposal.id),'Rental offer declined','An offer was declined.');
    return jsonb_build_object('negotiation',to_jsonb(v_negotiation),'proposal',to_jsonb(v_proposal));
  end if;
  if p_action='counter' then
    if v_negotiation.item_request_id is not null then
      select enabled into v_flag from public.feature_flags where key='item_requests';
      if coalesce(v_flag,false) is not true then raise exception 'Item requests are not currently enabled' using errcode='55000';end if;
    else
      select enabled into v_flag from public.feature_flags where key='private_offers';
      if coalesce(v_flag,false) is not true then raise exception 'Private offers are not currently enabled' using errcode='55000';end if;
    end if;
    v_round_limit:=public.marketplace_setting_int('negotiation_max_rounds',10);
    if v_proposal.revision>v_round_limit then raise exception 'The maximum number of counteroffer rounds has been reached' using errcode='55000';end if;
    if p_daily_rate is null or p_daily_rate<=0 or p_start_date is null or p_end_date is null
      or p_start_date<current_date or p_end_date<=p_start_date then
      raise exception 'Provide a valid daily price and future date range' using errcode='22023';
    end if;
    select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='negotiation_max_daily_price'),100000) into v_max_price;
    if p_daily_rate>coalesce(v_max_price,100000) then raise exception 'Counteroffer price exceeds the platform limit' using errcode='22023';end if;
    if p_message is not null and char_length(p_message)>1000 then raise exception 'Message is too long' using errcode='22023';end if;
    if v_negotiation.item_request_id is not null then
      select * into v_request from public.item_requests where id=v_negotiation.item_request_id for update;
      if not found or v_request.status not in ('open','responses_received','negotiating') or v_request.expires_at<=now() then
        raise exception 'Request is no longer active' using errcode='55000';
      end if;
      if v_proposal.start_date<v_request.preferred_start_date or v_proposal.end_date>v_request.preferred_end_date
        or (v_request.max_daily_budget is not null and v_proposal.daily_rate>v_request.max_daily_budget) then
        raise exception 'Offer no longer fits the request dates and budget' using errcode='22023';
      end if;
      if p_start_date<v_request.preferred_start_date or p_end_date>v_request.preferred_end_date
        or (v_request.max_daily_budget is not null and p_daily_rate>v_request.max_daily_budget) then
        raise exception 'Counteroffer must fit the request dates and budget' using errcode='22023';
      end if;
      if auth.uid()=v_negotiation.renter_id and v_request.renter_id<>auth.uid() then
        raise exception 'Only the requesting renter can counter this request offer' using errcode='42501';
      end if;
      update public.item_requests set status='negotiating' where id=v_request.id and status<>'matched';
    end if;
    if v_negotiation.listing_id is not null then
      select * into v_listing from public.listings where id=v_negotiation.listing_id and status='published' for update;
      if not found then raise exception 'Linked listing is no longer available' using errcode='55000';end if;
      if exists(select 1 from public.bookings b where b.listing_id=v_listing.id
        and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and b.start_date<p_end_date and b.end_date>p_start_date) then
        raise exception 'Listing is not available for the counteroffer dates' using errcode='23P01';
      end if;
      if exists(select 1 from public.listing_availability a where a.listing_id=v_listing.id
        and a.date>=p_start_date and a.date<p_end_date and not a.is_available) then
        raise exception 'Listing is not available for the counteroffer dates' using errcode='23P01';
      end if;
    end if;
    update public.negotiation_proposals set status='countered' where id=v_proposal.id;
    v_expiry_hours:=public.marketplace_setting_int('negotiation_expiration_hours',72);
    v_actor_other:=case when auth.uid()=v_negotiation.renter_id then v_negotiation.owner_id else v_negotiation.renter_id end;
    insert into public.negotiation_proposals(negotiation_id,revision,proposed_by,proposed_to,daily_rate,start_date,end_date,message,expires_at)
      values(v_negotiation.id,v_proposal.revision+1,auth.uid(),v_actor_other,p_daily_rate,p_start_date,p_end_date,p_message,now()+make_interval(hours=>v_expiry_hours))
      returning * into v_new_proposal;
    update public.marketplace_negotiations set status='countered' where id=v_negotiation.id returning * into v_negotiation;
    perform public.marketplace_record(v_negotiation.item_request_id,v_negotiation.id,'offer_countered',
      jsonb_build_object('proposal_id',v_new_proposal.id,'daily_rate',v_new_proposal.daily_rate,'start_date',v_new_proposal.start_date,'end_date',v_new_proposal.end_date),
      'New counteroffer','You have received a counteroffer.',v_actor_other);
    return jsonb_build_object('negotiation',to_jsonb(v_negotiation),'proposal',to_jsonb(v_new_proposal));
  end if;

  if v_negotiation.item_request_id is not null then
    select * into v_request from public.item_requests where id=v_negotiation.item_request_id for update;
    if not found or v_request.status not in ('open','responses_received','negotiating') or v_request.expires_at<=now() then
      raise exception 'Request is no longer active' using errcode='55000';
    end if;
    v_quantity:=v_request.requested_quantity;
  end if;
  if v_negotiation.listing_id is null then raise exception 'The owner must link a published listing before acceptance' using errcode='55000';end if;
  select * into v_listing from public.listings where id=v_negotiation.listing_id and owner_id=v_negotiation.owner_id and status='published' for update;
  if not found then raise exception 'Linked listing is no longer available' using errcode='55000';end if;
  if v_negotiation.item_request_id is null and not v_listing.negotiation_enabled then
    raise exception 'Listing is no longer eligible for negotiation' using errcode='55000';
  end if;
  if v_quantity>v_listing.available_quantity then raise exception 'Listing quantity cannot fulfill the request' using errcode='22023';end if;
  if v_proposal.start_date<current_date or v_proposal.end_date<=v_proposal.start_date then
    raise exception 'Offer dates are no longer valid' using errcode='22023';
  end if;
  if exists(select 1 from generate_series(v_proposal.start_date,v_proposal.end_date-1,interval '1 day') day
    where (select coalesce(sum(b.quantity),0) from public.bookings b
      where b.listing_id=v_listing.id and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and b.start_date<=day::date and b.end_date>day::date)+v_quantity>v_listing.available_quantity) then
    raise exception 'Listing is no longer available for the offer dates' using errcode='23P01';
  end if;
  if exists(select 1 from public.listing_availability a where a.listing_id=v_listing.id
    and a.date>=v_proposal.start_date and a.date<v_proposal.end_date and not a.is_available) then
    raise exception 'Listing is no longer available for the offer dates' using errcode='23P01';
  end if;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key='platform_fee_pct'),0.10) into v_fee_pct;
  v_days:=v_proposal.end_date-v_proposal.start_date;
  v_subtotal:=round(v_proposal.daily_rate*v_days*v_quantity,2);
  v_fee:=round(v_subtotal*v_fee_pct,2);
  insert into public.bookings(listing_id,renter_id,owner_id,start_date,end_date,quantity,status,daily_rate,days,
    subtotal,service_fee_pct,service_fee_amount,deposit,total)
    values(v_listing.id,v_negotiation.renter_id,v_negotiation.owner_id,v_proposal.start_date,v_proposal.end_date,
      v_quantity,'pending_payment',v_proposal.daily_rate,v_days,v_subtotal,v_fee_pct,v_fee,v_listing.deposit,v_subtotal+v_fee+v_listing.deposit)
    returning * into v_booking;
  update public.negotiation_proposals set status='accepted' where id=v_proposal.id;
  update public.marketplace_negotiations set status='accepted',booking_id=v_booking.id where id=v_negotiation.id returning * into v_negotiation;
  if v_negotiation.item_request_id is not null then
    update public.item_requests set status='matched' where id=v_negotiation.item_request_id;
    update public.marketplace_negotiations set status='cancelled' where item_request_id=v_negotiation.item_request_id and id<>v_negotiation.id and status in ('pending','countered');
    update public.negotiation_proposals set status='cancelled' where negotiation_id in
      (select id from public.marketplace_negotiations where item_request_id=v_negotiation.item_request_id and id<>v_negotiation.id) and status='pending';
  end if;
  perform public.marketplace_record(v_negotiation.item_request_id,v_negotiation.id,'offer_accepted',
    jsonb_build_object('proposal_id',v_proposal.id,'booking_id',v_booking.id,'status',v_booking.status),
    'Offer accepted','Your offer was accepted and a booking is awaiting payment.');
  return jsonb_build_object('negotiation',to_jsonb(v_negotiation),'booking',to_jsonb(v_booking));
end;
$$;

create or replace function public.guard_private_offers_feature_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if new.negotiation_enabled and not exists(select 1 from public.feature_flags where key='private_offers' and enabled) then
      raise exception 'Private offers are not enabled' using errcode='55000';
    end if;
  elsif new.negotiation_enabled and not old.negotiation_enabled
    and not exists(select 1 from public.feature_flags where key='private_offers' and enabled) then
    raise exception 'Private offers are not enabled' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_private_offers_feature_flag() from public,anon,authenticated;
drop trigger if exists zzzz_guard_private_offers_feature_flag on public.listings;
create trigger zzzz_guard_private_offers_feature_flag before insert or update of negotiation_enabled on public.listings
  for each row execute function public.guard_private_offers_feature_flag();

notify pgrst,'reload schema';
commit;