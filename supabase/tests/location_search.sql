begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
  ('13000000-0000-4000-8000-000000000001','search-owner@example.test','{"full_name":"Search Owner"}'),
  ('13000000-0000-4000-8000-000000000002','search-renter@example.test','{"full_name":"Search Renter"}');
insert into public.categories(id,name) values ('23000000-0000-4000-8000-000000000001','Search test category');
insert into public.listings(id,owner_id,category_id,title,price_per_day,status,location_lat,location_lng,available_quantity,estimated_value,item_condition)
select id,'13000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
  'GeoQA '||label,10,'published',
  extensions.st_y(point::extensions.geometry),extensions.st_x(point::extensions.geometry),2,200,'good'
from (values
  ('33000000-0000-4000-8000-000000000001'::uuid,'Within 5',4.99),
  ('33000000-0000-4000-8000-000000000002'::uuid,'Beyond 5',5.01),
  ('33000000-0000-4000-8000-000000000003'::uuid,'Beyond 10',10.01)
) fixture(id,label,miles)
cross join lateral (select extensions.st_project(
  extensions.st_setsrid(extensions.st_makepoint(0,0),4326)::extensions.geography,miles*1609.344,0) point) position;
insert into public.listings(id,owner_id,category_id,title,price_per_day,status,estimated_value,item_condition) values
  ('33000000-0000-4000-8000-000000000004','13000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','GeoQA Missing coordinates',10,'published',200,'good'),
  ('33000000-0000-4000-8000-000000000005','13000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','GeoQA Private draft',10,'draft',200,'good');

set local role anon;
select is((public.search_available_listings(p_latitude=>0,p_longitude=>0,p_keyword=>'GeoQA')->>'total')::int,1,'Default is exactly 5 miles and zero coordinates are valid');
select is((public.search_available_listings(p_latitude=>0,p_longitude=>0,p_keyword=>'GeoQA')->'rows'->0->>'id'),'33000000-0000-4000-8000-000000000001','4.99-mile item included, 5.01-mile item excluded');
select ok((public.search_available_listings(p_latitude=>0,p_longitude=>0,p_keyword=>'GeoQA')->'rows'->0->>'distance_miles')::numeric between 4.98 and 5,'Distance is calculated from listing coordinates');
select is((public.search_available_listings(p_latitude=>0,p_longitude=>0,p_radius_miles=>10,p_keyword=>'GeoQA')->>'total')::int,2,'Ten-mile radius includes 5.01 but excludes 10.01');
select is((public.search_available_listings(p_latitude=>0,p_longitude=>0,p_radius_miles=>25,p_keyword=>'GeoQA')->>'total')::int,3,'Twenty-five-mile radius supported');
select is((public.search_available_listings(p_latitude=>0,p_longitude=>0,p_radius_miles=>50,p_keyword=>'GeoQA')->>'total')::int,3,'Fifty-mile radius supported');
select is((public.search_available_listings(p_latitude=>0,p_longitude=>0,p_radius_miles=>null,p_keyword=>'GeoQA')->>'total')::int,4,'Unlimited radius includes unknown coordinates, not private drafts');
select is((public.search_available_listings(p_keyword=>'GeoQA')->>'total')::int,4,'No location means explicit global discovery, not fabricated proximity');
select is(jsonb_array_length(public.search_available_listings(p_latitude=>0,p_longitude=>0,p_radius_miles=>25,p_keyword=>'GeoQA',p_limit=>1,p_offset=>1)->'rows'),1,'Pagination occurs after radius filtering');
select is((public.search_available_listings(p_latitude=>0,p_longitude=>0,p_radius_miles=>25,p_keyword=>'GeoQA',p_sort=>'distance',p_limit=>1,p_offset=>1)->'rows'->0->>'id'),
  '33000000-0000-4000-8000-000000000002','Distance sorting applies before pagination');
select ok(not ((public.search_available_listings(p_keyword=>'GeoQA')->'rows'->0->'owner') ? 'email'),'Owner contact details are not exposed');
select ok(not ((public.search_available_listings(p_keyword=>'GeoQA')->'rows'->0->'owner') ? 'customer_id'),'Owner Customer IDs are not exposed by search');
select throws_ok($$select public.search_available_listings(p_latitude=>91,p_longitude=>0)$$,'22023','Choose valid search coordinates','Invalid latitude rejected');
select throws_ok($$select public.search_available_listings(p_latitude=>0)$$,'22023','Choose valid search coordinates','Coordinate pairs required');
select throws_ok($$select public.search_available_listings(p_radius_miles=>6)$$,'22023','Radius must be 5, 10, 25, 50 miles or unlimited','Invalid radius rejected');
select throws_ok($$select public.search_available_listings(p_max_price=>'NaN'::numeric)$$,'22023','Invalid search filters or pagination','Non-finite price rejected explicitly');
select throws_ok($$select public.search_available_listings(p_start_date=>current_date,p_end_date=>current_date)$$,'22023',
  'Choose both dates, with an end after the start and a range of at most 366 days','Equal dates rejected');
select throws_ok($$select public.search_available_listings(p_end_date=>current_date+1)$$,'22023',
  'Choose both dates, with an end after the start and a range of at most 366 days','Incomplete date range rejected');
reset role;

insert into public.listing_availability(listing_id,date,is_available) values
  ('33000000-0000-4000-8000-000000000001',current_date+1,false);
select is((public.search_available_listings(p_keyword=>'GeoQA')->>'total')::int,4,'Without dates tomorrow-blocked items remain discoverable');
select is((public.search_available_listings(p_keyword=>'GeoQA',p_start_date=>current_date,p_end_date=>current_date+2)->>'total')::int,3,'A blocked day within the requested period excludes the listing');
select is((public.search_available_listings(p_keyword=>'GeoQA',p_start_date=>current_date,p_end_date=>current_date+1)->>'total')::int,4,'End date is exclusive');

insert into public.bookings(id,listing_id,renter_id,owner_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,total,quantity)
values ('43000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000002',
  '13000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000001',current_date+10,current_date+12,10,2,20,0.1,2,22,1);
select is((public.search_available_listings(p_keyword=>'GeoQA',p_start_date=>current_date+10,p_end_date=>current_date+12)->>'total')::int,4,
  'One booked unit does not hide a listing with two units');
update public.bookings set quantity=2 where id='43000000-0000-4000-8000-000000000001';
set local role anon;
select is((public.search_available_listings(p_keyword=>'GeoQA',p_start_date=>current_date+10,p_end_date=>current_date+12)->>'total')::int,3,
  'Anonymous discovery sees authoritative capacity without reading private bookings');
reset role;
update public.bookings set status='cancelled' where id='43000000-0000-4000-8000-000000000001';
select is((public.search_available_listings(p_keyword=>'GeoQA',p_start_date=>current_date+10,p_end_date=>current_date+12)->>'total')::int,4,
  'Cancellation releases search availability');
select * from finish();
rollback;
