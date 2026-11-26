do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_renter uuid:=gen_random_uuid();
  v_session uuid:=gen_random_uuid();
  v_owner_session uuid:=gen_random_uuid();
  v_category uuid;
  v_listing uuid;
  v_listing2 uuid;
  v_start date:=current_date+10;
  v_booking public.bookings;
  v_quote jsonb;
  v_selection jsonb:=jsonb_build_object(
    'trip','both','setup',true,'dropoff_window','afternoon','return_window','afternoon',
    'address',jsonb_build_object('address_line1','123 Test St','address_line2','Unit 2',
      'city','Omaha','state','NE','postal_code','68102'));
  v_windows jsonb;
begin
  begin
    insert into auth.users(id,email) values
      (v_owner,v_owner::text||'@example.test'),(v_renter,v_renter::text||'@example.test');
    insert into auth.sessions(id,user_id) values (v_owner_session,v_owner),(v_session,v_renter);
    perform set_config('request.jwt.claims',jsonb_build_object(
      'sub',v_owner,'role','authenticated','session_id',v_owner_session,
      'exp',extract(epoch from now()+interval '1 hour'))::text,true);
    select id into v_category from public.categories limit 1;
    insert into public.listings(owner_id,category_id,title,description,price_per_day,estimated_value,item_condition,
      availability_start,availability_end,available_quantity,delivery_available,delivery_fee,
      delivery_round_trip_discount,delivery_setup_available,delivery_setup_fee,delivery_guaranteed_windows)
    values(v_owner,v_category,'Delivery test listing','Delivery test fixture',5,50,'good',
      v_start,v_start+20,5,true,2,0.5,true,10,array['morning','afternoon','evening'])
    returning id into v_listing;
    insert into public.listings(owner_id,category_id,title,description,price_per_day,estimated_value,item_condition,
      availability_start,availability_end,available_quantity,delivery_available,delivery_fee,
      delivery_round_trip_discount,delivery_setup_available,delivery_setup_fee,delivery_guaranteed_windows)
    values(v_owner,v_category,'Second delivery listing','Delivery test fixture',5,50,'good',
      v_start,v_start+20,5,true,2,0.5,true,10,array['morning','afternoon','evening'])
    returning id into v_listing2;
    insert into public.listing_images(listing_id,url) values (v_listing,'test.jpg'),(v_listing2,'test.jpg');
    insert into public.listing_photo_reviews(listing_id,photo_url,decision,reason,review_method)
    values (v_listing,'test.jpg','approved','Test fixture','system'),
      (v_listing2,'test.jpg','approved','Test fixture','system');
    insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,time_zone,latitude,longitude)
    values (v_listing,v_owner,'123 Test St','123 Test St','Omaha','NE','68102','US','America/Chicago',41.25,-96),
      (v_listing2,v_owner,'123 Test St','123 Test St','Omaha','NE','68102','US','America/Chicago',41.25,-96);
    update public.listings set status='published' where id in (v_listing,v_listing2);
    perform set_config('request.jwt.claims',jsonb_build_object(
      'sub',v_renter,'role','authenticated','session_id',v_session,
      'exp',extract(epoch from now()+interval '1 hour'))::text,true);

    v_quote:=public.get_checkout_delivery_quote(v_listing,v_start,v_start+1,3,'delivery',false,'both',true);
    if (v_quote->>'delivery_fee_amount')::numeric<>3.5 or (v_quote->>'delivery_setup_amount')::numeric<>10 then
      raise exception 'Delivery quote did not apply the trip discount and installation fee';
    end if;
    v_booking:=public.create_booking_request_with_delivery(v_listing,v_start,v_start+1,3,false,v_selection);
    if v_booking.delivery_trip<>'both' or v_booking.delivery_fee_amount<>3.5
      or v_booking.delivery_setup_amount<>10 or v_booking.total<>(v_quote->>'renter_checkout_total')::numeric then
      raise exception 'Booking delivery snapshot does not match the quote';
    end if;
    if (select count(*) from public.booking_pickup_slots where booking_id=v_booking.id and status='approved')<>2
      or not exists(select 1 from public.booking_delivery_addresses where booking_id=v_booking.id and address_line2='Unit 2') then
      raise exception 'Guaranteed windows or private address were not saved';
    end if;
    update public.bookings set status=status where id=v_booking.id;
    update public.bookings set status=status where id=v_booking.id;
    if (select total from public.bookings where id=v_booking.id)<>v_booking.total then
      raise exception 'Booking updates changed the delivery total';
    end if;
    v_windows:=public.get_checkout_delivery_windows(v_listing2,v_start,v_start+1);
    if not exists(select 1 from jsonb_array_elements(v_windows->'windows') x
      where x->>'window'='afternoon' and not (x->>'dropoff_available')::boolean and not (x->>'return_available')::boolean) then
      raise exception 'Owner commitments must block windows across listings';
    end if;
    begin
      perform public.create_booking_request_with_delivery(v_listing2,v_start,v_start+1,1,false,v_selection);
      raise exception 'Overlapping owner commitment was accepted';
    exception when exclusion_violation then null;
    end;
    begin
      perform public.create_booking_request_with_delivery(v_listing2,v_start,v_start+1,1,false,
        jsonb_set(v_selection,'{address,address_line1}','""'::jsonb));
      raise exception 'Empty delivery street address was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.get_checkout_delivery_quote(v_listing,v_start,v_start+1,1,'delivery',false,'return',true);
      raise exception 'Setup was accepted without drop-off';
    exception when invalid_parameter_value then null;
    end;
    update public.bookings set status='cancelled' where id=v_booking.id;
    v_windows:=public.get_checkout_delivery_windows(v_listing2,v_start,v_start+1);
    if not exists(select 1 from jsonb_array_elements(v_windows->'windows') x
      where x->>'window'='afternoon' and (x->>'dropoff_available')::boolean and (x->>'return_available')::boolean) then
      raise exception 'Cancellation did not release delivery windows';
    end if;
    raise exception 'rollback delivery fixtures' using errcode='PZ002';
  exception when sqlstate 'PZ002' then null;
  end;
end;
$$;
