begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select hasnt_trigger('public','listings','z_listing_required_identity','Identity is optional on listing writes');
insert into auth.users(id,email) values('a1000000-0000-4000-8000-000000000091','optional-identity@example.test');
insert into public.categories(id,name) values('a3000000-0000-4000-8000-000000000091','Optional identity');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
  location_lat,location_lng,availability_start,availability_end,brand,model)
values('a4000000-0000-4000-8000-000000000091','a1000000-0000-4000-8000-000000000091',
  'a3000000-0000-4000-8000-000000000091','Unbranded tool','Tool with carrying case.',20,'draft',100,'good',0,0,current_date,current_date+30,'','');
insert into public.listing_images(listing_id,url,sort_order) values('a4000000-0000-4000-8000-000000000091','https://example.test/tool.png',0);
insert into public.listing_pickup_locations(listing_id,owner_id,address,city,state,postal_code,country,latitude,longitude)
values('a4000000-0000-4000-8000-000000000091','a1000000-0000-4000-8000-000000000091','Private pickup','Dallas','TX','75201','US',0,0);
select lives_ok($$update public.listings set status='published' where id='a4000000-0000-4000-8000-000000000091'$$,'Blank identity permits publication');
select is((select status from public.listings where id='a4000000-0000-4000-8000-000000000091'),'published','Backend confirms publication without identity');
select lives_ok($$update public.listings set brand='Sony',model='FX3' where id='a4000000-0000-4000-8000-000000000091'$$,'Supplied identity can be saved');
select lives_ok($$update public.listings set brand='',model='' where id='a4000000-0000-4000-8000-000000000091'$$,'Optional identity can be cleared');
select throws_ok($$update public.listings set availability_start=current_date+1,availability_end=current_date+32 where id='a4000000-0000-4000-8000-000000000091'$$,
 '23514','Choose no more than 30 consecutive available days. Blocked days do not extend this window.','Ranges longer than thirty days are rejected');
select lives_ok($$update public.listings set availability_start=current_date+1,availability_end=current_date+31 where id='a4000000-0000-4000-8000-000000000091'$$,'Thirty available days are accepted');
select throws_ok($$update public.listings set availability_start=current_date-1,availability_end=current_date+1 where id='a4000000-0000-4000-8000-000000000091'$$,
 '23514','Choose dates from today through 180 days from today','Past starts are rejected');
select throws_ok($$update public.listings set availability_end=current_date+181 where id='a4000000-0000-4000-8000-000000000091'$$,
 '23514','Choose dates from today through 180 days from today','Day 181 is rejected');
select throws_ok($$update public.listings set availability_end=availability_start where id='a4000000-0000-4000-8000-000000000091'$$,
 '23514','Availability exceeds the configured listing duration','Exclusive return must follow start');
select lives_ok($$update public.listings set availability_start=current_date+179,availability_end=current_date+180 where id='a4000000-0000-4000-8000-000000000091'$$,'Final day is accepted as exclusive return');
select * from finish();
rollback;
