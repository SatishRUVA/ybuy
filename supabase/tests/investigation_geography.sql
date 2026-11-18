begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('a9500000-0000-4000-8000-000000000001','investigation-us@example.test'),
 ('a9500000-0000-4000-8000-000000000002','investigation-ca@example.test');
insert into auth.sessions(id,user_id) values
 ('a9600000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001');
update public.profiles set country_code='US',state_region_code='US-TX' where id='a9500000-0000-4000-8000-000000000001';
update public.profiles set country_code='CA',state_region_code='CA-ON' where id='a9500000-0000-4000-8000-000000000002';
create temp table investigation_ids as
select array[
 (select customer_id from public.profiles where id='a9500000-0000-4000-8000-000000000001'),
 (select customer_id from public.profiles where id='a9500000-0000-4000-8000-000000000002'),
 'bogus','YB-9999999999',
 (select customer_id from public.profiles where id='a9500000-0000-4000-8000-000000000001')
] ids;
grant select on investigation_ids to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"a9500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a9600000-0000-4000-8000-000000000001","exp":4102444800}';
select throws_ok($$select public.admin_investigate_customers_geography((select ids from investigation_ids),now()-interval '1 day',now(),'Unauthorized test')$$,
 '42501',null,'Ordinary users cannot retrieve investigation geography');
reset role;
insert into public.admin_users(user_id,role,permissions) values
 ('a9500000-0000-4000-8000-000000000001','admin',array['fraud.investigate']);
set local role authenticated;
create temp table geography_all as select public.admin_investigate_customers_geography(
 (select ids from investigation_ids),now()-interval '1 day',now(),'Geography default test') result;
select is((select (result->>'total')::integer from geography_all),4,'Normalized identifiers are deduplicated');
select is((select (result->>'duplicate_count')::integer from geography_all),1,'Duplicates are reported after geographic filtering');
select is((select result->'rows'->0->>'country_code' from geography_all),'US','Authorized results include current profile country');
select ok((select result->'rows'->0->>'location_updated_at' is not null from geography_all),'Current geography is timestamped');
create temp table geography_us as select public.admin_investigate_customers_geography(
 (select ids from investigation_ids),now()-interval '1 day',now(),'Geography US test',25,0,'us','us-tx','country') result;
select is((select (result->>'total')::integer from geography_us),3,'Country/subdivision filters apply before pagination');
select is((select (result->>'filtered_out_count')::integer from geography_us),1,'Excluded known accounts are counted');
select is((select result->'rows'->1->>'result_status' from geography_us),'invalid','Invalid identifiers remain visible through filters');
select is((select result->'rows'->2->>'result_status' from geography_us),'unknown','Unknown identifiers remain visible through filters');
create temp table geography_empty as select public.admin_investigate_customers_geography(
 (select ids[1:2] from investigation_ids),now()-interval '1 day',now(),'Geography no matches',25,0,'IN') result;
select is((select (result->>'total')::integer from geography_empty),0,'A valid filter with no matches has zero total');
select is((select jsonb_array_length(result->'rows') from geography_empty),0,'Empty filters never return unfiltered private results');
create temp table geography_page as select public.admin_investigate_customers_geography(
 (select ids[1:2] from investigation_ids),now()-interval '1 day',now(),'Geography grouped page',1,1,null,null,'region') result;
select is((select result->'rows'->0->>'country_code' from geography_page),'US','Country/region grouping orders the complete batch before paging');
select is((select (result->>'total')::integer from geography_page),2,'Grouped pagination preserves full filtered total');
select throws_ok($$select public.admin_investigate_customers_geography((select ids from investigation_ids),now()-interval '1 day',now(),'Invalid geography',25,0,'XX')$$,
 '22023',null,'Unknown country is rejected');
select throws_ok($$select public.admin_investigate_customers_geography((select ids from investigation_ids),now()-interval '1 day',now(),'Invalid geography',25,0,'US','CA-ON')$$,
 '22023',null,'A subdivision from a different country is rejected');
select throws_ok($$select public.admin_investigate_customers_geography((select ids from investigation_ids),now()-interval '1 day',now(),'Invalid geography',25,0,null,'US-TX')$$,
 '22023',null,'Subdivision filtering requires a country');
select throws_ok($$select public.admin_investigate_customers_geography((select ids from investigation_ids),now()-interval '1 day',now(),'Invalid grouping',25,0,null,null,'fraud_score')$$,
 '22023',null,'Unsupported fraud score grouping is not fabricated');
reset role;
select is((select count(*)::integer from public.admin_audit_log where actor_id='a9500000-0000-4000-8000-000000000001'
 and action='customer.investigate.geography'),4,'Every geographic read records filter and grouping provenance');
set local role anon;
select throws_ok($$select public.admin_investigate_customers_geography(array['YB-0000000001'],now()-interval '1 day',now(),'Anonymous test')$$,
 '42501',null,'Anonymous callers cannot invoke the geography RPC');
reset role;
select * from finish();
rollback;
