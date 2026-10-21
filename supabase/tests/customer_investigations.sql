begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data)
select ('14000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'investigation'||n||'@example.test',jsonb_build_object('full_name','Investigation actor')
from generate_series(1,4) n;
insert into auth.sessions(id,user_id)
select ('64000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('14000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,4) n;
insert into public.admin_users(user_id,role,permissions) values
  ('14000000-0000-4000-8000-000000000003','admin','{users.manage}'),
  ('14000000-0000-4000-8000-000000000004','admin','{fraud.investigate}');
insert into public.categories(id,name) values ('24000000-0000-4000-8000-000000000001','Investigation category');
insert into public.listings(id,owner_id,category_id,title,price_per_day,status,estimated_value,item_condition) values
  ('34000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','Investigation fixture',10,'published',200,'good');
insert into public.bookings(id,listing_id,renter_id,owner_id,start_date,end_date,daily_rate,days,subtotal,service_fee_pct,service_fee_amount,total,status)
values ('44000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000002',
  '14000000-0000-4000-8000-000000000001',current_date+10,current_date+12,10,2,20,0.1,2,22,'cancelled');
insert into public.payments(id,booking_id,amount,currency,status) values
  ('54000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001',22,'usd','failed');
insert into public.operations_cases(kind,booking_id,created_by,participant_id,category,subject)
values ('dispute','44000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000002',
  '14000000-0000-4000-8000-000000000001','other','Investigation dispute fixture');
create temp table ids as select customer_id from public.profiles where id='14000000-0000-4000-8000-000000000002';
grant select on ids to authenticated;
create function pg_temp.investigate(p_ids text[] default null,p_from timestamptz default now()-interval '1 day',
  p_to timestamptz default now()+interval '1 day',p_reason text default 'QA investigation',p_limit integer default 25,p_offset integer default 0)
returns jsonb language sql as $$
  select public.admin_investigate_customers(coalesce(p_ids,array[(select customer_id from ids)]),p_from,p_to,p_reason,p_limit,p_offset);
$$;
select ok(not has_function_privilege('anon','public.admin_investigate_customers(text[],timestamptz,timestamptz,text,integer,integer)','execute'),'Anonymous cannot investigate');
set local role authenticated;
set local request.jwt.claims='{"sub":"14000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"64000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select pg_temp.investigate()$$,'42501','Not authorized','Ordinary customers cannot read internal indicators');
set local request.jwt.claims='{"sub":"14000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"64000000-0000-4000-8000-000000000003","exp":4102444800}';
select throws_ok($$select pg_temp.investigate()$$,'42501','Not authorized','User management alone does not grant investigation access');
set local request.jwt.claims='{"sub":"14000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"64000000-0000-4000-8000-000000000004","exp":4102444800}';
select throws_ok($$select pg_temp.investigate(p_ids=>array_fill('YB-0000000001'::text,array[101]))$$,'22023',null,'Oversized batches rejected');
select throws_ok($$select pg_temp.investigate(p_to=>now()-interval '2 days')$$,'22023',null,'Reversed dates rejected');
select throws_ok($$select pg_temp.investigate(p_from=>now()-interval '367 days')$$,'22023',null,'Overlong ranges rejected');
select throws_ok($$select pg_temp.investigate(p_limit=>26)$$,'22023',null,'Oversized result pages rejected');
select throws_ok($$select pg_temp.investigate(p_reason=>'')$$,'22023',null,'A recorded reason is mandatory');
create temp table result as select pg_temp.investigate(array[(select lower(customer_id) from ids),(select customer_id from ids),'invalid','YB-9999999999']) data;
select is((select (data->>'total')::int from result),3,'Batch normalization deduplicates and retains invalid/unknown entries');
select is((select (data->>'duplicate_count')::int from result),1,'Duplicate count is explicit');
select is((select data->'rows'->1->>'result_status' from result),'invalid','Invalid identifiers are reported');
select is((select data->'rows'->2->>'result_status' from result),'unknown','Unknown identifiers are reported');
select is((select (data->'rows'->0->>'failed_payments')::int from result),1,'Failed payment evidence is counted');
select is((select (data->'rows'->0->>'cancellations')::int from result),1,'Cancelled booking evidence is counted');
select is((select (data->'rows'->0->>'event_count')::int from result),3,'Underlying records are included once each');
select is((select (data->'rows'->0->>'unresolved_disputes')::int from result),1,'Unresolved dispute evidence is counted');
select ok((select data->'rows'->0->'events'->0 ? 'created_at' from result),'Evidence contains timestamps');
select ok(not (select data->'rows'->0 ? 'email' from result),'Unnecessary private contact data is omitted');
select is((pg_temp.investigate(p_from=>now()-interval '10 days',p_to=>now()-interval '2 days')->'rows'->0->>'event_count')::int,0,'Date filter excludes records outside the period');
select is(jsonb_array_length(pg_temp.investigate(array['invalid','YB-9999999999'],p_limit=>1,p_offset=>1)->'rows'),1,'Bulk results are server paginated');
reset role;
select is((select count(*) from public.admin_audit_log where actor_id='14000000-0000-4000-8000-000000000004' and action='customer.investigate'),3::bigint,'Every successful page query is audited');
select ok((select bool_and(reason='QA investigation') from public.admin_audit_log where actor_id='14000000-0000-4000-8000-000000000004'),'Audit stores the investigation reason');
set local role authenticated;
do $$ begin for n in 1..7 loop perform pg_temp.investigate(); end loop; end $$;
select throws_ok($$select pg_temp.investigate()$$,'P0001','Investigation rate limit reached; retry after one minute','Ten-per-minute server rate limit enforced');
reset role;
update public.admin_users set active=false where user_id='14000000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select pg_temp.investigate()$$,'42501','Not authorized','Revoked permission immediately blocks access');
reset role;
select * from finish();
rollback;
