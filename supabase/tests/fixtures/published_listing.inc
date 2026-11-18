-- Explicit setup for suites testing behavior other than the publication wizard.
-- Include after BEGIN; the helper and all synthetic records roll back with the suite.
create function pg_temp.publish_listing_fixture(p_id uuid, p_start date, p_end date)
returns void language plpgsql as $$
declare
  v_listing public.listings;
  v_url text := 'https://example.test/' || p_id || '.jpg';
begin
  update public.listings set availability_start=p_start,availability_end=p_end,
    description=coalesce(nullif(description,''),'Synthetic rental fixture with a carrying case.')
    where id=p_id and status='draft' returning * into strict v_listing;
  insert into public.listing_images(listing_id,url,sort_order) values(p_id,v_url,0);
  insert into public.listing_photo_reviews(listing_id,photo_url,decision,reason,review_method)
    values(p_id,v_url,'approved','Synthetic publication fixture','system');
  insert into public.listing_pickup_locations(
    listing_id,owner_id,address,street_address,city,state,postal_code,country,latitude,longitude,time_zone)
    values(p_id,v_listing.owner_id,'123 Test Street, Dallas, TX 75201','123 Test Street',
      'Dallas','TX','75201','US',v_listing.location_lat,v_listing.location_lng,'America/Chicago');
  update public.listings set status='published' where id=p_id;
end;
$$;
