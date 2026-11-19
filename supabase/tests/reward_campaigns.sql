begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

update public.admin_financial_test_gate set environment='local_test',enabled=false;
update public.reward_multiplier_campaigns set active=false;
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','campaign-super@example.test','{"full_name":"Campaign super"}'),
 ('b1000000-0000-4000-8000-000000000002','campaign-admin@example.test','{"full_name":"Campaign admin"}'),
 ('b1000000-0000-4000-8000-000000000003','campaign-limited@example.test','{"full_name":"Campaign limited"}'),
 ('b1000000-0000-4000-8000-000000000004','campaign-customer@example.test','{"full_name":"Campaign customer"}');
insert into auth.sessions(id,user_id) select
 ('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,4) n;
insert into public.admin_users(user_id,role,permissions) values
 ('b1000000-0000-4000-8000-000000000001','super_admin','{}'),
 ('b1000000-0000-4000-8000-000000000002','admin','{promotions.manage}'),
 ('b1000000-0000-4000-8000-000000000003','admin','{audit.view}');

select ok((select relrowsecurity from pg_class where oid='public.reward_multiplier_campaigns'::regclass),'Campaigns have RLS');
select is((select count(*) from pg_policies where schemaname='public' and tablename='reward_multiplier_campaigns'),0::bigint,'No direct client campaign policies');
select ok(not has_function_privilege('anon','public.admin_list_reward_campaigns(integer,integer)','execute'),'Anonymous campaign access is denied');
select ok(not has_function_privilege('authenticated','public.reward_signup_offer(timestamptz)','execute'),'Internal offer calculation is not client callable');
select ok(not has_function_privilege('service_role','public.award_signup_points(uuid)','execute'),'Service role cannot fabricate award events');

set local role authenticated;
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000004","exp":4102444800}';
select throws_ok($$select public.admin_list_reward_campaigns()$$,'42501','Not authorized','Customer cannot list campaigns');
select throws_ok($$select public.admin_save_reward_campaign(null,'Not allowed',2,now(),now()+interval '1 day',false,'Unauthorized')$$,'42501','Not authorized','Customer cannot create campaigns');
select throws_ok($$select * from public.reward_multiplier_campaigns$$,'42501',null,'Direct campaign reads are denied');
select throws_ok($$insert into public.reward_multiplier_campaigns(name,multiplier,starts_at,ends_at) values('Forged',3,now(),now()+interval '1 day')$$,'42501',null,'Direct campaign writes are denied');
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000003","exp":4102444800}';
select throws_ok($$select public.admin_save_reward_campaign(null,'Not allowed',2,now(),now()+interval '1 day',false,'Unauthorized')$$,'42501','Not authorized','Admin without promotions permission cannot manage campaigns');
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000002","exp":4102444800}';
select throws_ok($$select public.admin_save_reward_campaign(null,'Test campaign',2,now(),now()+interval '1 day',false,' ')$$,'22023','A reason of 3-500 characters is required','Change reason is mandatory');
select throws_ok($$select public.admin_save_reward_campaign(null,'Test campaign',2,now(),now()+interval '1 day',true,'Activate immediately')$$,'22023','New reward campaigns must be inactive; save before activating','Creation cannot bypass inactive default');
select throws_ok($$select public.admin_save_reward_campaign(null,'Test campaign',1.51,now(),now()+interval '1 day',false,'Invalid multiplier')$$,'22023',null,'Unsupported fractional multipliers are rejected, not rounded');
select throws_ok($$select public.admin_save_reward_campaign(null,'Test campaign',2,now(),now(),false,'Invalid window')$$,'22023',null,'Empty windows are rejected');
select throws_ok($$select public.admin_save_reward_campaign(null,'Test campaign',2,now(),'infinity',false,'Invalid window')$$,'22023',null,'Infinite windows are rejected');
select throws_ok($$select public.admin_save_reward_campaign('b3000000-0000-4000-8000-000000000099','Missing',2,now(),now()+interval '1 day',false,'Missing campaign')$$,'P0002','Reward campaign not found','Unknown campaign IDs fail explicitly');
select set_config('test.reward_campaign',public.admin_save_reward_campaign(null,'Signup boost',1.5,now()-interval '1 hour',now()+interval '1 hour',false,'Create signup boost')->>'id',true);
select set_config('test.reward_overlap',public.admin_save_reward_campaign(null,'Another boost',3,now()-interval '1 hour',now()+interval '1 hour',false,'Create draft overlap')->>'id',true);
select is((public.admin_list_reward_campaigns()->'rows'->0->>'active')::boolean,false,'Saved drafts remain inactive');

reset role;
update public.admin_financial_test_gate set enabled=true;
update public.app_settings set value='500' where key='signup_reward_points';
update public.app_settings set value='true' where key='signup_reward_enabled';
update public.reward_launch set launched_at=clock_timestamp()-interval '10 days';
create function pg_temp.reward_user(p_number integer,p_event_at timestamptz default clock_timestamp())
returns uuid language plpgsql as $$
declare v_id uuid:=('b1000000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid;
begin
  insert into auth.users(id,email,phone,created_at,email_confirmed_at,phone_confirmed_at,raw_user_meta_data)
    values(v_id,'campaign-'||p_number||'@example.test','1555010'||lpad(p_number::text,4,'0'),p_event_at,p_event_at,p_event_at,'{"full_name":"Reward fixture"}');
  return v_id;
end;
$$;
select pg_temp.reward_user(10);
select is((select reward_balance from public.reward_wallets where user_id='b1000000-0000-4000-8000-000000000010'),500,'Inactive campaigns leave the existing 500-point award unchanged');

set local role authenticated;
select lives_ok($$select public.admin_save_reward_campaign(current_setting('test.reward_campaign')::uuid,'Signup boost',1.5,now()-interval '1 hour',now()+interval '1 hour',true,'Activate signup boost')$$,'Authorized admin can activate a saved campaign');
select throws_ok($$select public.admin_save_reward_campaign(current_setting('test.reward_overlap')::uuid,'Another boost',3,now()-interval '1 hour',now()+interval '1 hour',true,'Attempt overlap')$$,'23P01','Active signup reward campaigns cannot overlap','Overlapping active campaigns cannot stack');
select lives_ok($$select public.admin_save_reward_campaign(current_setting('test.reward_overlap')::uuid,'Adjacent boost',3,now()+interval '1 hour',now()+interval '2 hours',true,'Allow adjacent window')$$,'Adjacent end-exclusive windows are allowed');
reset role;
select pg_temp.reward_user(11);
select is((select reward_balance from public.reward_wallets where user_id='b1000000-0000-4000-8000-000000000011'),750,'Eligible verified signup earns 500 × 1.5 exactly once');
select is(public.reward_signup_offer(now()-interval '1 hour')->>'multiplier','1.5','Verification exactly at the campaign start is included');
select is((select base_points from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000011'),500,'Ledger preserves the base');
select is((select multiplier from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000011'),1.5::numeric,'Ledger preserves the multiplier');
select is((select final_points from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000011'),750,'Ledger preserves final points');
select is((select campaign_snapshot->>'name' from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000011'),'Signup boost','Ledger preserves campaign details');
select ok((select event_type='signup' and event_ref=user_id and event_at is not null
  and idempotency_key='signup:'||user_id::text and campaign_id=current_setting('test.reward_campaign')::uuid
  from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000011'),'Ledger preserves event, reference, time, campaign ID and idempotency key');
select set_config('test.reward_snapshot',(select to_jsonb(t)::text from public.reward_transactions t where user_id='b1000000-0000-4000-8000-000000000011'),true);
select throws_ok($$update public.reward_transactions set multiplier=3 where user_id='b1000000-0000-4000-8000-000000000011'$$,'42501',null,'Even privileged ledger updates cannot rewrite snapshots');
select throws_ok($$delete from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000011'$$,'42501',null,'Ledger snapshots cannot be deleted');

-- A genuine verification predating the campaign cannot be turned into a campaign award by a lazy retry.
select pg_temp.reward_user(12,now()-interval '2 hours');
select is((select reward_balance from public.reward_wallets where user_id='b1000000-0000-4000-8000-000000000012'),500,'Pre-window verification earns the unchanged base');
select pg_temp.reward_user(13,now()+interval '1 hour');
select is((select reward_balance from public.reward_wallets where user_id='b1000000-0000-4000-8000-000000000013'),500,'Future verification evidence never earns a multiplier');
select is(public.reward_signup_offer(now()+interval '1 hour')->>'multiplier','1','The campaign end is exclusive and future campaigns cannot award early');

set local role authenticated;
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000001","exp":4102444800}';
select lives_ok($$select public.admin_save_reward_campaign(current_setting('test.reward_campaign')::uuid,'Renamed boost',3,now()-interval '1 hour',now()+interval '1 hour',true,'Super admin revision')$$,'Super admin can revise campaigns without an explicit permission grant');
reset role;
select public.award_signup_points('b1000000-0000-4000-8000-000000000011');
update auth.users set phone_confirmed_at=clock_timestamp() where id='b1000000-0000-4000-8000-000000000011';
select is((select count(*) from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000011'),1::bigint,'RPC and verification retries cannot award again');
select is((select to_jsonb(t) from public.reward_transactions t where user_id='b1000000-0000-4000-8000-000000000011'),current_setting('test.reward_snapshot')::jsonb,'Campaign edits and retries do not recalculate history');
select is((select reward_balance from public.reward_wallets where user_id='b1000000-0000-4000-8000-000000000011'),750,'Retries do not change the wallet');
insert into auth.sessions(id,user_id) values('b2000000-0000-4000-8000-000000000011','b1000000-0000-4000-8000-000000000011');
set local role authenticated;
set local request.jwt.claims='{"sub":"b1000000-0000-4000-8000-000000000011","role":"authenticated","session_id":"b2000000-0000-4000-8000-000000000011","exp":4102444800}';
select is(public.get_my_rewards()->'transactions'->0->'campaign_snapshot'->>'name','Signup boost','Customer RPC exposes the original campaign snapshot, not its edited name');
select is(public.get_my_rewards()->'transactions'->0->>'final_points','750','Customer RPC preserves the original final award');
reset role;
select ok(exists(select 1 from public.admin_audit_log where entity_id=current_setting('test.reward_campaign')
  and action='reward_campaign.update' and reason='Super admin revision'
  and old_value->>'name'='Signup boost' and new_value->>'name'='Renamed boost' and outcome='success'),'Reasoned audit preserves actor change and old/new campaign snapshots');

-- Exercise every supported multiplier through the actual award trigger, including half-point rounding.
update public.app_settings set value='501' where key='signup_reward_points';
do $$
declare v_multiplier numeric; v_number integer:=20;
begin
  foreach v_multiplier in array array[1,1.5,2,2.5,3] loop
    update public.reward_multiplier_campaigns set multiplier=v_multiplier where id=current_setting('test.reward_campaign')::uuid;
    perform pg_temp.reward_user(v_number);
    v_number:=v_number+1;
  end loop;
end;
$$;
select results_eq($$select reward_balance from public.reward_wallets where user_id between 'b1000000-0000-4000-8000-000000000020' and 'b1000000-0000-4000-8000-000000000024' order by user_id$$,
  $$select * from (values(501),(752),(1002),(1253),(1503)) expected(points)$$,'All five supported multipliers use deterministic half-up whole-point rounding');
update public.reward_multiplier_campaigns set active=false;
select pg_temp.reward_user(30);
select is((select reward_balance from public.reward_wallets where user_id='b1000000-0000-4000-8000-000000000030'),501,'Deactivation restores configured base-only awards');
update public.reward_multiplier_campaigns set active=true,starts_at=now()+interval '1 day',ends_at=now()+interval '2 days'
  where id=current_setting('test.reward_campaign')::uuid;
select pg_temp.reward_user(31);
select is((select reward_balance from public.reward_wallets where user_id='b1000000-0000-4000-8000-000000000031'),501,'Scheduled campaigns do not award early');
update public.reward_multiplier_campaigns set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'
  where id=current_setting('test.reward_campaign')::uuid;
select pg_temp.reward_user(32,now()-interval '36 hours');
select is((select reward_balance from public.reward_wallets where user_id='b1000000-0000-4000-8000-000000000032'),501,'Expired campaigns do not apply on delayed awards even for an in-window event');
update public.reward_multiplier_campaigns set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day'
  where id=current_setting('test.reward_campaign')::uuid;
update public.admin_financial_test_gate set enabled=false;
select pg_temp.reward_user(33);
select ok(not exists(select 1 from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000033'),'Active campaigns cannot bypass the local financial gate');
update public.admin_financial_test_gate set enabled=true;
update public.app_settings set value='false' where key='signup_reward_enabled';
select pg_temp.reward_user(34);
select ok(not exists(select 1 from public.reward_transactions where user_id='b1000000-0000-4000-8000-000000000034'),'Active campaigns cannot bypass paused signup rewards');
select ok(not exists(select 1 from public.reward_wallets w where user_id::text like 'b1000000-%'
  and reward_balance<>(select coalesce(sum(points),0) from public.reward_transactions t where t.user_id=w.user_id)),'Campaign wallets reconcile with immutable ledger points');

select * from finish();
rollback;
