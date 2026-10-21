-- Rollback-only integration checks. Run: supabase test db --local supabase/tests/admin_operations.sql
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data)
select ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'operations'||n||'@test.invalid',jsonb_build_object('full_name','Operations '||n)
from generate_series(1,7) n;
insert into auth.sessions(id,user_id)
select ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,7) n;
insert into public.admin_users(user_id,role,permissions) values
 ('b0000000-0000-4000-8000-000000000001','super_admin','{}'),
 ('b0000000-0000-4000-8000-000000000002','admin','{support.manage,refunds.issue}'),
 ('b0000000-0000-4000-8000-000000000006','admin','{refunds.approve}'),
 ('b0000000-0000-4000-8000-000000000007','admin','{refunds.senior}');
insert into public.categories(id,name) values('b2000000-0000-4000-8000-000000000001','Operations category');
insert into public.categories(id,name) values('b2000000-0000-4000-8000-000000000002','Other operations category');
insert into public.listings(id,owner_id,category_id,title,price_per_day,status,estimated_value,item_condition) values
 ('b3000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003',
  'b2000000-0000-4000-8000-000000000001','Operations test listing',100,'published',200,'good');
insert into public.listings(id,owner_id,category_id,title,price_per_day,status,estimated_value,item_condition) values
 ('b3000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003',
  'b2000000-0000-4000-8000-000000000002','Other operations listing',100,'published',200,'good');
insert into public.bookings(id,listing_id,renter_id,owner_id,start_date,end_date,quantity,status,
  daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total)
select ('b4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'b3000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004',
 'b0000000-0000-4000-8000-000000000003',current_date+n*3,current_date+n*3+2,1,'requested',
 100,2,200,0.10,20,50,270 from generate_series(1,7) n;
insert into public.payments(id,booking_id,amount,currency,status,stripe_payment_intent_id) values
 ('b5000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',2000,'usd','succeeded','pi_operations_test'),
 ('b5000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000002',2000,'usd','pending','pi_operations_pending'),
 ('b5000000-0000-4000-8000-000000000003','b4000000-0000-4000-8000-000000000003',2000,'eur','succeeded','pi_operations_eur');

create temporary table test_ids(k text primary key,id uuid);
grant select,insert,update on test_ids to authenticated;
create function pg_temp.login(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','b0000000-0000-4000-8000-'||lpad(p_n::text,12,'0'),
    'role','authenticated','session_id','b1000000-0000-4000-8000-'||lpad(p_n::text,12,'0'),
    'exp',4102444800)::text,true);
end;
$$;
create function pg_temp.promotion(p_code text,p_patch jsonb default '{}')
returns jsonb language sql as $$
  select public.admin_save_promotion(null,jsonb_build_object(
    'code',p_code,'discount_type','fixed','discount_value',10,
    'starts_at',now()-interval '1 day','ends_at',now()+interval '1 day','active',true
  )||p_patch,'Sandbox eligibility check');
$$;

select ok(public.admin_grantable_permissions() @> array['disputes.manage','support.manage','promotions.manage',
  'credits.manage','refunds.issue','refunds.approve','refunds.senior'],'All operational permissions are grantable');
select ok(public.admin_all_permissions() @> public.admin_grantable_permissions(),'Super-admin catalog includes operations');
select ok(not has_function_privilege('anon','public.create_case(text,uuid,text,text,text)','execute'),'Anonymous cannot create cases');
select ok(not has_function_privilege('authenticated','public.operations_create_case(text,uuid,uuid,text,text,text,text)','execute'),'Creation helper is not exposed');
select ok(not has_function_privilege('authenticated','public.operations_credit_balance(uuid)','execute'),'Other users balances cannot be read through helper');
select ok(not has_function_privilege('authenticated','public.reconcile_test_refund_event(text,text,text,numeric,text,text,boolean)','execute'),'Clients cannot reconcile provider events');
select ok(has_function_privilege('service_role','public.reconcile_test_refund_event(text,text,text,numeric,text,text,boolean)','execute'),'Service role can reconcile verified sandbox events');
select is((select public from storage.buckets where id='admin-case-evidence'),false,'Evidence bucket is private');

set local role authenticated;
select pg_temp.login(4);
select is(public.admin_operations_status()->>'financial_test_enabled','false','Financial test operations default off');
select is(public.admin_operations_status()->>'refund_execution_enabled','false','Refund execution is always off');
select is(public.admin_operations_status()->>'credit_restoration_enabled','false','Restoration policy is disabled');
select throws_ok($$select public.admin_list_cases()$$,'42501','Not authorized','Participants cannot list the admin queue');
select throws_ok($$select public.admin_list_promotions()$$,'42501','Not authorized','Participants cannot read promotion administration');
select throws_ok($$select public.admin_list_credit_accounts()$$,'42501','Not authorized','Participants cannot list credit accounts');
select throws_ok($$select public.admin_list_refund_requests()$$,'42501','Not authorized','Participants cannot list refund requests');
select throws_ok($$update public.admin_financial_test_gate set enabled=true,environment='local_test'$$,
  '42501',null,'Clients cannot change the test gate');
select throws_ok($$select public.quote_test_credit('b4000000-0000-4000-8000-000000000001')$$,
  '42501','Financial test operations are disabled','Quotes fail closed outside test mode');
select throws_ok($$select public.create_case('dispute',null,'other','Test subject','Body')$$,
  '23514',null,'Disputes require a booking; no deadline is invented');
insert into test_ids values('dispute',(public.create_case('dispute','b4000000-0000-4000-8000-000000000001',
  'missing','Item never arrived','Please investigate the missing item')->>'id')::uuid);
insert into test_ids values('support',(public.create_case('support',null,'other','Cannot open messages','Help with messages')->>'id')::uuid);
select is((public.list_my_cases()->>'total')::int,2,'Participant lists persistent cases');
select is(jsonb_array_length(public.list_my_cases(1,1)->'rows'),1,'Participant pagination works');
select is(jsonb_array_length(public.get_case_detail((select id from test_ids where k='dispute'))->'replies'),1,'Initial description is persisted as first reply');
select throws_ok($$select public.reply_to_case((select id from test_ids where k='dispute'),'Secret',true)$$,
 '42501','Not authorized','Participants cannot create private staff notes');
select lives_ok($$select public.reply_to_case((select id from test_ids where k='dispute'),'Additional details')$$,'Participant can reply');
select throws_ok($$select public.create_case('support',null,'other','<script>','Body')$$,
 '23514','subject can only contain plain text.','Case subjects reject markup');
select throws_ok($$select public.reply_to_case((select id from test_ids where k='dispute'),'<script>alert(1)</script>')$$,
 '23514','body can only contain plain text.','Case replies reject markup');
select ok(public.can_access_case_evidence((select id::text from test_ids where k='dispute')||
 '/b0000000-0000-4000-8000-000000000004/evidence.pdf',true),'Participant can upload to own case path');
select ok(not public.can_access_case_evidence((select id::text from test_ids where k='dispute')||
 '/b0000000-0000-4000-8000-000000000003/evidence.pdf',true),'Participant cannot upload as another user');
select ok(not public.can_access_case_evidence('not-a-uuid/anything/evidence.pdf',true),'Malformed evidence path fails closed');
select throws_ok($$select public.register_case_evidence((select id from test_ids where k='dispute'),
 (select id::text from test_ids where k='dispute')||'/b0000000-0000-4000-8000-000000000004/not-uploaded.pdf')$$,
 '22023','Upload evidence before registering it','Evidence cannot be registered before upload');

-- The other booking participant can read the dispute but not unrelated account support.
select pg_temp.login(3);
select lives_ok($$select public.get_case_detail((select id from test_ids where k='dispute'))$$,'Booking owner can read renter dispute');
select throws_ok($$select public.get_case_detail((select id from test_ids where k='support'))$$,
 '42501','Case not found or not authorized','Unrelated support cases remain private');
select is((public.list_my_notifications()->>'total')::int,2,'Case creation and public replies notify booking owner');
insert into test_ids values('notification',(public.list_my_notifications()->'rows'->0->>'id')::uuid);
select lives_ok($$select public.mark_notification_read((select id from test_ids where k='notification'))$$,'Recipient can acknowledge notifications');
select pg_temp.login(5);
select throws_ok($$select public.mark_notification_read((select id from test_ids where k='notification'))$$,
 'P0002','Notification not found','Nonrecipient cannot acknowledge another notification');
select throws_ok($$select public.get_case_detail((select id from test_ids where k='dispute'))$$,
 '42501','Case not found or not authorized','Nonparticipant cannot read a case by UUID');
select throws_ok($$select public.create_case('support','b4000000-0000-4000-8000-000000000001','booking','Other booking','Body')$$,
 '42501','Not a booking participant','Booking participant identity is verified server-side');
select ok(not public.can_access_case_evidence((select id::text from test_ids where k='dispute')||
 '/b0000000-0000-4000-8000-000000000004/evidence.pdf'),'Nonparticipant cannot read evidence');
select is((public.list_my_cases()->>'total')::int,0,'Unrelated user sees empty personal queue');
select throws_ok($$select * from public.operations_cases$$,'42501',null,'Case tables cannot be bypassed directly');

select pg_temp.login(2);
select is((public.admin_list_cases()->>'total')::int,1,'Support permission only returns support queue');
select throws_ok($$select public.get_case_detail((select id from test_ids where k='dispute'))$$,
 '42501','Case not found or not authorized','Support staff cannot read dispute details');
select throws_ok($$select public.admin_create_case('dispute','b4000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000004','other','Subject','Body','Staff request')$$,
 '42501','Not authorized','Support staff cannot create disputes');

select pg_temp.login(1);
select is((public.admin_list_cases()->>'total')::int,2,'Super admin sees both queues');
select is((public.admin_list_cases('dispute','open',25,0,'never','normal')->>'total')::int,1,'Admin filters apply before pagination');
select is((public.admin_list_cases(null,null,25,0,'does not match',null)->>'total')::int,0,'Admin search excludes nonmatches');
select is((public.admin_list_cases(null,null,25,0,null,'urgent')->>'total')::int,0,'Admin priority filter works');
select is(public.get_case_detail((select id from test_ids where k='dispute'))->>'deadline_policy_unresolved','true','Dispute deadline remains explicitly unresolved');
select is(public.get_case_detail((select id from test_ids where k='support'))->>'deadline_policy_unresolved','false','Support does not imply unresolved dispute deadline');
select is(public.get_case_detail((select id from test_ids where k='dispute'))->'booking'->>'id',
 'b4000000-0000-4000-8000-000000000001','Detail includes authoritative booking identity');
select ok((public.get_case_detail((select id from test_ids where k='dispute'))->'booking') ?&
 array['start_date','end_date','created_at','updated_at','status'],'Detail includes actual booking dates and timestamps');
select is(public.get_case_detail((select id from test_ids where k='support'))->'booking','null'::jsonb,'Unlinked support has no invented booking');
select throws_ok($$select public.admin_update_case((select id from test_ids where k='support'),'investigating','normal',null,'Wrong workflow')$$,
 '22023','Invalid case transition','Support cannot enter dispute workflow');
select throws_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'in_progress','normal',null,'Wrong workflow')$$,
 '22023','Invalid case transition','Dispute cannot enter support workflow');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='support'),'in_progress','normal',null,'Support investigation')$$,'Support starts progress');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='support'),'awaiting_user','normal',null,'Await user response')$$,'Support awaits user');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='support'),'resolved','normal',null,'Support resolved')$$,'Support resolution');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='support'),'in_progress','normal',null,'Support reopened')$$,'Resolved support can reopen');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='support'),'closed','normal',null,'Support closed')$$,'Support closure');
select throws_ok($$select public.admin_update_case((select id from test_ids where k='support'),'open','normal',null,'Reopen closed support')$$,
 '22023','Invalid case transition','Closed support is terminal');
select lives_ok($$select public.reply_to_case((select id from test_ids where k='dispute'),'Internal staff note',true)$$,'Staff private note persists');
select is(jsonb_array_length(public.get_case_detail((select id from test_ids where k='dispute'))->'replies'),3,'Staff can read private notes');
select pg_temp.login(3);
select is((public.list_my_notifications()->>'total')::int,2,'Private staff notes do not notify participants');
select pg_temp.login(1);
select throws_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'decided','high',null,'Skip review')$$,
 '22023','Invalid case transition','Open cases cannot skip review');
select throws_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'investigating','high',null,'x')$$,
 '22023','A reason of 3-500 characters is required','Case transitions require a reason');
select throws_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'investigating','high',
 'b0000000-0000-4000-8000-000000000002','Wrong staff')$$,
 '22023','Assignee lacks case permission','Assignment enforces staff permissions');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'investigating','high',
 'b0000000-0000-4000-8000-000000000001','Investigation started')$$,'Staff can start investigation');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'awaiting_evidence','high',
 'b0000000-0000-4000-8000-000000000001','Need details')$$,'Review can await participant');

select pg_temp.login(4);
select is((public.list_my_cases(1,0,'dispute','awaiting_evidence','never','high')->>'total')::int,1,'Participant filters precede pagination');
select is((public.list_my_cases(1,1,'dispute','awaiting_evidence','never','high')->>'total')::int,1,'Participant filtered total stable across pages');
select is(jsonb_array_length(public.list_my_cases(1,1,'dispute','awaiting_evidence','never','high')->'rows'),0,'Participant offset applies after filters');
select is((public.list_my_cases(25,0,'dispute',null,null,'urgent')->>'total')::int,0,'Participant priority filter excludes nonmatches');
select is(jsonb_array_length(public.get_case_detail((select id from test_ids where k='dispute'))->'replies'),2,'Participant private-note redaction');
select is(jsonb_array_length(public.get_case_detail((select id from test_ids where k='dispute'))->'events'),0,'Internal reasons/events are redacted');
select lives_ok($$select public.reply_to_case((select id from test_ids where k='dispute'),'Here are the requested details')$$,'Participant can answer while waiting');

-- Upload policies are checked as authenticated; trusted fixture inserts represent a completed Storage upload.
reset role;
insert into storage.objects(bucket_id,name,owner_id)
select 'admin-case-evidence',id::text||'/b0000000-0000-4000-8000-000000000004/evidence.pdf',
 'b0000000-0000-4000-8000-000000000004' from test_ids where k='dispute';
set local role authenticated;
select pg_temp.login(4);
select lives_ok($$select public.register_case_evidence((select id from test_ids where k='dispute'),
 (select id::text from test_ids where k='dispute')||'/b0000000-0000-4000-8000-000000000004/evidence.pdf')$$,'Uploaded evidence can be registered');
select is((select count(*)::int from storage.objects where bucket_id='admin-case-evidence'),1,'Participant can read evidence object');
select pg_temp.login(5);
select is((select count(*)::int from storage.objects where bucket_id='admin-case-evidence'),0,'Storage RLS hides evidence from outsiders');
select pg_temp.login(1);
select is(public.admin_update_case((select id from test_ids where k='dispute'),'escalated','high',null,'Escalation with proposal',75.50)->>'proposed_amount',
 '75.50','Escalation records proposed compensation without execution');
select throws_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'escalated','high',null,'Negative proposal',-1)$$,
 '23514',null,'Negative proposed compensation rejected');
select ok(exists(select 1 from jsonb_array_elements(public.get_case_detail((select id from test_ids where k='dispute'))->'events') e
 where e->'detail'->'new'->>'proposed_amount'='75.50'),'Proposed compensation preserved in event history');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'decided','normal',null,'Resolved after investigation')$$,'Reviewed dispute can be decided');
select throws_ok($$select public.reply_to_case((select id from test_ids where k='dispute'),'Late reply')$$,
 '22023','Case is not accepting replies','Resolved cases reject replies until reopened');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'investigating','normal',null,'Reopened with new evidence')$$,'Decided disputes can reopen');
select lives_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'closed','normal',null,'Case closed')$$,'Reviewed case can close');
select throws_ok($$select public.admin_update_case((select id from test_ids where k='dispute'),'investigating','normal',null,'Attempt reopening')$$,
 '22023','Invalid case transition','Closed cases are terminal');
select throws_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000004',100,'manual','manual-1','Test credit')$$,
 '42501','Financial test operations are disabled','Even super admin cannot bypass disabled test gate');

-- Promotion metadata CRUD is safe while execution is disabled.
insert into test_ids values('promo',(public.admin_save_promotion(null,jsonb_build_object(
 'code','TEST20','description','Platform funded test','discount_type','percent','discount_value',20,
 'max_discount',25,'min_subtotal',100,'starts_at',now()-interval '1 day','ends_at',now()+interval '1 day',
 'max_redemptions',1,'per_user_limit',1,'category_ids',jsonb_build_array('b2000000-0000-4000-8000-000000000001'),
 'listing_ids',jsonb_build_array('b3000000-0000-4000-8000-000000000001'),'active',true
),'Sandbox campaign')->>'id')::uuid);
select is((public.admin_list_promotions()->>'total')::int,1,'Promotion CRUD persists a platform-funded rule');
select throws_ok($$select public.admin_save_promotion(null,jsonb_build_object('code','BAD','funding','owner',
 'discount_type','fixed','discount_value',10,'starts_at',now(),'ends_at',now()+interval '1 day'),'Bad funding')$$,
 '23514',null,'Owner-funded promotions are forbidden');
select throws_ok($$select public.admin_save_promotion(null,'{"unknown":true}','Bad fields')$$,
 '22023','Invalid promotion fields','Unrecognized promotion fields fail');
select throws_ok($$select public.admin_save_promotion(null,jsonb_build_object(
 'code','MISSING','discount_type','fixed','discount_value',1,'starts_at',now(),'ends_at',now()+interval '1 day',
 'category_ids',jsonb_build_array('ffffffff-ffff-4fff-8fff-ffffffffffff')),'Bad category')$$,
 '22023','Unknown eligibility category or listing','Eligibility references are verified');

-- Only a database owner, not an API caller, enables the disposable local simulation.
reset role;
update public.admin_financial_test_gate set environment='local_test',enabled=true;
set local role authenticated;
select pg_temp.login(1);
select is(public.admin_operations_status()->>'financial_test_enabled','true','Database owner can enable local simulation');
insert into test_ids values('credit',(public.admin_grant_credit('b0000000-0000-4000-8000-000000000004',
 5,'signup','signup-1','Sandbox signup credit')->>'id')::uuid);
select is((public.admin_grant_credit('b0000000-0000-4000-8000-000000000004',
 5,'signup','signup-1','Repeated request')->>'id')::uuid,(select id from test_ids where k='credit'),'USD 5 signup grant retries are idempotent');
select throws_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000004',
 5,'manual','signup-1','Changed retry')$$,'22023','Idempotency key already used for different credit','Idempotency payload mismatch is rejected');
select throws_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000004',
 5,'signup','signup-2','Second signup')$$,'22023','Account has already received signup credit','Signup credit cannot be issued twice');
select throws_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000006',
 20,'signup','wrong-signup','Wrong signup amount')$$,'22023','Test signup credit must be exactly USD 5','Signup grants reject amounts other than USD 5');
select throws_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000004',
 6,'signup','signup-1','Wrong retry amount')$$,'22023','Test signup credit must be exactly USD 5','Signup retries cannot change the fixed reward');
select throws_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000004',
 1.001,'manual','fractional','Bad cents')$$,'23514',null,'Fractional-cent grants fail');
select is((public.admin_credit_history('b0000000-0000-4000-8000-000000000004')->>'total')::int,1,'Credit history does not duplicate retries');
select is((public.admin_credit_history('b0000000-0000-4000-8000-000000000004')->'rows'->0->>'expires_at')::timestamptz,
 now()+interval '90 days','Credits expire after 90 days by default');
select lives_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000004',
 95,'manual','manual-top-up','Manual balance fixture')$$,'Manual grant amount remains configurable');
select throws_ok($$select public.restore_test_credit('ffffffff-ffff-4fff-8fff-ffffffffffff','Policy not approved')$$,
 '42501','Credit restoration policy is not approved','Restoration always fails even with financial test gate enabled');
select pg_temp.login(4);
select is((public.get_my_credits()->>'available')::numeric,100::numeric,'Renter sees real test credit balance');
select is((public.quote_test_promotion('b4000000-0000-4000-8000-000000000001','TEST20')->>'discount_amount')::numeric,
 25::numeric,'Promotion quote caps discount and excludes deposits');
select is((public.redeem_test_promotion('b4000000-0000-4000-8000-000000000001','TEST20')->>'discount_amount')::numeric,
 25::numeric,'Promotion redemption persists');
select is((public.redeem_test_promotion('b4000000-0000-4000-8000-000000000001','TEST20')->>'discount_amount')::numeric,
 25::numeric,'Promotion redemption retry is idempotent');
select throws_ok($$select public.redeem_test_promotion('b4000000-0000-4000-8000-000000000002','TEST20')$$,
 '22023','Promotion is not eligible','Global/per-user usage limits are enforced');
select throws_ok($$select public.reserve_test_credit('b4000000-0000-4000-8000-000000000001')$$,
 '22023','Discount stacking is disabled','Credit cannot stack with a promotion');
select is((public.quote_test_credit('b4000000-0000-4000-8000-000000000002')->>'credit_amount')::numeric,100::numeric,'Credit quote uses available balance');
select is((public.reserve_test_credit('b4000000-0000-4000-8000-000000000002')->>'amount')::numeric,100::numeric,'Credit reservation persists');
select is((public.reserve_test_credit('b4000000-0000-4000-8000-000000000002')->>'amount')::numeric,100::numeric,'Reservation retry does not double reserve');
select is((public.get_my_credits()->>'available')::numeric,0::numeric,'Reserved credit is unavailable to other bookings');
select throws_ok($$select public.reserve_test_credit('b4000000-0000-4000-8000-000000000003')$$,
 '22023','No available credit','Credit cannot overspend');
select is(public.release_test_credit('b4000000-0000-4000-8000-000000000002')->>'status','released','Unused reservation can be released');
select is(public.release_test_credit('b4000000-0000-4000-8000-000000000002')->>'status','released','Release retry is idempotent');
select is((public.get_my_credits()->>'available')::numeric,100::numeric,'Release restores availability, not refund credit');
select pg_temp.login(5);
select throws_ok($$select public.quote_test_promotion('b4000000-0000-4000-8000-000000000003','TEST20')$$,
 '42501','Booking not found or not authorized','Other renters cannot quote another booking');
select is((public.get_my_credits()->>'balance')::numeric,0::numeric,'Credit balances are user scoped');
select pg_temp.login(1);
select throws_ok($$select public.admin_delete_promotion((select id from test_ids where k='promo'),'Delete used code')$$,
 '22023','Redeemed promotions must be deactivated, not deleted','Redemption history is preserved');
select is((public.admin_list_promotions()->'rows'->0->>'redemptions')::int,1,'Promotion statistics count actual redemptions');
select is((public.admin_list_promotions()->'rows'->0->>'discount_total')::numeric,25::numeric,'Promotion statistics total actual discounts');
select is((public.admin_promotion_redemptions((select id from test_ids where k='promo'),1,0)->>'total')::int,1,'Campaign redemption history total');
select is(jsonb_array_length(public.admin_promotion_redemptions((select id from test_ids where k='promo'),1,1)->'rows'),0,'Campaign redemption history pagination');

-- Independent eligibility checks ensure no client can bypass a date, minimum or targeting rule.
select pg_temp.promotion('FUTURE',jsonb_build_object('starts_at',now()+interval '1 hour'));
select pg_temp.promotion('EXPIRED',jsonb_build_object('starts_at',now()-interval '2 days','ends_at',now()-interval '1 day'));
select pg_temp.promotion('MINIMUM','{"min_subtotal":201}');
select pg_temp.promotion('CATEGORY','{"category_ids":["b2000000-0000-4000-8000-000000000002"]}');
select pg_temp.promotion('LISTING','{"listing_ids":["b3000000-0000-4000-8000-000000000002"]}');
select pg_temp.promotion('INACTIVE','{"active":false}');
insert into test_ids values('unused_promo',(pg_temp.promotion('UNUSED')->>'id')::uuid);
select lives_ok($$select public.admin_save_promotion((select id from test_ids where k='unused_promo'),jsonb_build_object(
 'code','UNUSED','discount_type','fixed','discount_value',20,'starts_at',now()-interval '1 day',
 'ends_at',now()+interval '1 day','active',false),'Disable unused promotion')$$,'Promotion metadata can be updated');
select is(public.admin_delete_promotion((select id from test_ids where k='unused_promo'),'Remove unused test promotion')->>'ok','true','Unused promotion can be deleted');
select pg_temp.promotion('SUBTOTAL_CAP','{"discount_value":500}');
select pg_temp.promotion('USER_LIMIT','{"per_user_limit":1}');
select pg_temp.login(4);
select throws_ok($$select public.quote_test_promotion('b4000000-0000-4000-8000-000000000003','FUTURE')$$,
 '22023','Promotion is not eligible','Future promotions cannot be used early');
select throws_ok($$select public.quote_test_promotion('b4000000-0000-4000-8000-000000000003','EXPIRED')$$,
 '22023','Promotion is not eligible','Expired promotions cannot be used');
select throws_ok($$select public.quote_test_promotion('b4000000-0000-4000-8000-000000000003','MINIMUM')$$,
 '22023','Promotion is not eligible','Minimum applies to rental subtotal, not deposit-inclusive total');
select throws_ok($$select public.quote_test_promotion('b4000000-0000-4000-8000-000000000003','CATEGORY')$$,
 '22023','Promotion is not eligible','Category eligibility is enforced');
select throws_ok($$select public.quote_test_promotion('b4000000-0000-4000-8000-000000000003','LISTING')$$,
 '22023','Promotion is not eligible','Listing eligibility is enforced');
select throws_ok($$select public.quote_test_promotion('b4000000-0000-4000-8000-000000000003','INACTIVE')$$,
 '22023','Promotion is not eligible','Inactive promotions cannot redeem');
select is((public.quote_test_promotion('b4000000-0000-4000-8000-000000000003','SUBTOTAL_CAP')->>'discount_amount')::numeric,
 200::numeric,'Discounts cannot exceed rental subtotal');
select lives_ok($$select public.redeem_test_promotion('b4000000-0000-4000-8000-000000000003','USER_LIMIT')$$,'First per-user redemption succeeds');
select throws_ok($$select public.redeem_test_promotion('b4000000-0000-4000-8000-000000000004','USER_LIMIT')$$,
 '22023','Promotion is not eligible','Per-user limit is enforced independently of global limit');

-- Refund request tiers use cumulative amounts against the verified payment.
select pg_temp.login(2);
select throws_ok($$select public.admin_request_refund('b5000000-0000-4000-8000-000000000002',10,'Pending payment')$$,
 '22023','Refund requires a verified USD payment','Pending payments cannot be refunded');
select throws_ok($$select public.admin_request_refund('b5000000-0000-4000-8000-000000000003',10,'Euro payment')$$,
 '22023','Refund requires a verified USD payment','USD thresholds cannot silently apply to other currencies');
insert into test_ids values('refund250',(public.admin_request_refund('b5000000-0000-4000-8000-000000000001',250,'Sandbox refund request','refund-250')->>'id')::uuid);
select is((public.admin_request_refund('b5000000-0000-4000-8000-000000000001',250,'Repeated request','refund-250')->>'id')::uuid,
 (select id from test_ids where k='refund250'),'Refund requests retry idempotently');
select throws_ok($$select public.admin_request_refund('b5000000-0000-4000-8000-000000000001',251,'Changed request','refund-250')$$,
 '22023','Idempotency key already used for different refund','Refund request retry payload must match');
select throws_ok($$select public.admin_approve_refund((select id from test_ids where k='refund250'),'Self approval')$$,
 '42501','A different administrator must approve','Requester cannot self-approve');
select pg_temp.login(1);
select is(public.admin_approve_refund((select id from test_ids where k='refund250'),'Independent approval')->>'status',
 'approved','A different issuer can approve up to USD 250');
select pg_temp.login(2);
insert into test_ids values('refund750',(public.admin_request_refund('b5000000-0000-4000-8000-000000000001',750,'Sandbox refund next tier')->>'id')::uuid);
select throws_ok($$select public.admin_approve_refund((select id from test_ids where k='refund750'),'Insufficient permission')$$,
 '42501','Not authorized','USD 1000 cumulative requires refund approver');
select pg_temp.login(6);
select is(public.admin_approve_refund((select id from test_ids where k='refund750'),'Approver threshold review')->>'status',
 'approved','USD 1000 can be approved by refunds.approve');
select pg_temp.login(2);
insert into test_ids values('refund1',(public.admin_request_refund('b5000000-0000-4000-8000-000000000001',1,'Sandbox senior threshold')->>'id')::uuid);
select pg_temp.login(6);
select throws_ok($$select public.admin_approve_refund((select id from test_ids where k='refund1'),'Insufficient seniority')$$,
 '42501','Not authorized','Split requests above USD 1000 require senior approval');
select pg_temp.login(7);
select is(public.admin_approve_refund((select id from test_ids where k='refund1'),'Senior threshold review')->>'status',
 'approved','Senior permission can approve above USD 1000');
select pg_temp.login(2);
select throws_ok($$select public.admin_request_refund('b5000000-0000-4000-8000-000000000001',1000,'Excessive amount')$$,
 '22023','Invalid or excessive refund amount','Cumulative refund amount cannot exceed payment');
select is((public.admin_list_refund_requests(1,1)->>'total')::int,3,'Refund queue total is independent of pagination');
select is(jsonb_array_length(public.admin_list_refund_requests(1,1)->'rows'),1,'Refund queue pagination works');

-- Service-only, signature-verified provider receipts do not execute refunds or change payments.
reset role;
update public.refund_requests set provider_ref='re_operations_test' where id=(select id from test_ids where k='refund250');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.reconcile_test_refund_event('evt_live','re_live','pi_operations_test',250,'usd','succeeded',true)$$,
 '42501','Financial test operations are disabled','Live provider events are rejected');
select is(public.reconcile_test_refund_event('evt_unmatched','re_unknown','pi_operations_test',250,'usd','succeeded',false)->>'processing_status',
 'unmatched','Unmatched provider event persists as exception, not fake completion');
select is(public.reconcile_test_refund_event('evt_mismatch','re_operations_test','pi_wrong',250,'usd','succeeded',false)->>'processing_status',
 'exception','Incorrect payment intent is a durable exception');
select is(public.reconcile_test_refund_event('evt_matched','re_operations_test','pi_operations_test',250,'usd','succeeded',false)->>'processing_status',
 'matched','Prebound sandbox receipt can reconcile');
select is(public.reconcile_test_refund_event('evt_matched','re_operations_test','pi_operations_test',250,'usd','succeeded',false)->>'processing_status',
 'matched','Duplicate provider event is idempotent');
select throws_ok($$select public.reconcile_test_refund_event('evt_matched','re_operations_test','pi_operations_test',251,'usd','succeeded',false)$$,
 '22023','Event ID payload mismatch','Event ID cannot be reused with a different payload');
select is(public.reconcile_test_refund_event('evt_stale','re_operations_test','pi_operations_test',250,'usd','pending',false)->>'processing_status',
 'exception','Out-of-order receipt cannot regress terminal provider status');
select is(public.reconcile_test_refund_event('evt_action','re_operations_test','pi_operations_test',250,'usd','requires_action',false)->>'processing_status',
 'exception','Requires-action provider receipt is durably queued as exception');
select is(public.reconcile_test_refund_event('evt_action','re_operations_test','pi_operations_test',250,'usd','requires_action',false)->>'exception_reason',
 'Provider refund requires action; manual reconciliation is required','Requires-action replay is idempotent and explains necessary intervention');
select is(public.reconcile_test_refund_event('evt_action_unmatched','re_action_unknown','pi_operations_test',250,'usd','requires_action',false)->>'processing_status',
 'exception','Unmatched requires-action receipt also enters exception queue');
reset role;
select is((select count(*)::int from public.refund_provider_events),6,'Retries do not duplicate receipt records including requires-action');
select is((select provider_status from public.refund_requests where provider_ref='re_operations_test'),'succeeded',
 'Requires-action receipt never overwrites previously matched provider status');
select is((select status from public.refund_provider_events where event_id='evt_action'),'requires_action',
 'Actual requires-action provider status is preserved in receipt history');
insert into public.credit_ledger(user_id,amount,kind,idempotency_key,reason,created_by,created_at,expires_at)
values('b0000000-0000-4000-8000-000000000005',500,'manual','expired-grant','Expired fixture',
 'b0000000-0000-4000-8000-000000000001',now()-interval '100 days',now()-interval '10 days');
insert into public.user_restrictions(user_id,reason,restricted_by)
values('b0000000-0000-4000-8000-000000000005','Credit eligibility fixture','b0000000-0000-4000-8000-000000000001');
insert into public.bookings(id,listing_id,renter_id,owner_id,start_date,end_date,quantity,status,
 daily_rate,days,subtotal,service_fee_pct,service_fee_amount,deposit,total)
values('b4000000-0000-4000-8000-000000000008','b3000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000003',
 current_date+80,current_date+82,1,'requested',100,2,200,0.10,20,50,270);
select is((select status from public.payments where id='b5000000-0000-4000-8000-000000000001'),'succeeded','Test receipts never mark production payment refunded');
select is((select total from public.bookings where id='b4000000-0000-4000-8000-000000000001'),270::numeric,'Promotion simulation never changes authoritative booking price');
select ok(not exists(select 1 from public.refund_requests where execution_enabled),'No request can enable financial execution');
select throws_ok($$update public.refund_requests set execution_enabled=true$$,'23514',null,'Even direct database updates cannot enable refund execution');
select throws_ok($$update public.credit_ledger set amount=0$$,'42501','admin_audit_log is append-only','Credit ledger is append-only');
select throws_ok($$delete from public.operations_case_events$$,'42501','admin_audit_log is append-only','Case event history is append-only');
select throws_ok($$delete from public.refund_provider_events$$,'42501','admin_audit_log is append-only','Provider receipt history is append-only');
select ok(exists(select 1 from public.admin_audit_log where action='case.update' and reason='Investigation started'),'Case transitions are audited with reason');
select ok(exists(select 1 from public.admin_audit_log where action='credit.grant.test'),'Test credit grant is audited');
select ok(exists(select 1 from public.admin_audit_log where action='refund.approve.test'),'Refund approval is audited');
select ok(exists(select 1 from public.admin_audit_log where action='refund.provider_event.test' and outcome='failed'),'Unmatched receipts are audited as failed outcomes');
set local role authenticated;
select pg_temp.login(1);
select throws_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000005',100,'signup','blocked-signup','Restricted signup')$$,
 '42501','Restricted accounts are not eligible for credit grants','Restricted accounts cannot receive signup credit');
select throws_ok($$select public.admin_grant_credit('ffffffff-ffff-4fff-8fff-ffffffffffff',100,'signup','missing-signup','Unknown account')$$,
 'P0002','User not found','Signup grants require an existing account');
select is((public.admin_credit_history('b0000000-0000-4000-8000-000000000005')->>'balance')::numeric,0::numeric,'Admin balances exclude expired grants');
select is((public.admin_credit_history('b0000000-0000-4000-8000-000000000005')->>'total')::int,1,'Expired grants remain in append-only history');
select lives_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000006',10,'manual','valid-before-signup','Manual award')$$,'Manual grant before signup permitted');
select lives_ok($$select public.admin_grant_credit('b0000000-0000-4000-8000-000000000006',5,'signup','eligible-signup','Signup award')$$,'Eligible account receives only one USD 5 signup award independently of manual grants');
select is((public.admin_credit_history('b0000000-0000-4000-8000-000000000006')->>'balance')::numeric,15::numeric,'Eligible manual and USD 5 signup grants sum correctly');
select is((public.admin_list_refund_events()->>'total')::int,6,'Admin can inspect real provider exception queue');
select is(public.admin_operations_status()->>'refund_execution_enabled','false','Local test gate never enables actual execution');
select pg_temp.login(5);
select is((public.get_my_credits()->>'available')::numeric,0::numeric,'Expired credit cannot appear available');
select is(jsonb_array_length(public.get_my_credits()->'history'),1,'Expired entries remain visible in user history');
select is((public.quote_test_credit('b4000000-0000-4000-8000-000000000008')->>'credit_amount')::numeric,0::numeric,'Quotes exclude expired credit');
select throws_ok($$select public.reserve_test_credit('b4000000-0000-4000-8000-000000000008')$$,
 '22023','No available credit','Expired credit cannot be reserved');
select pg_temp.login(4);
select lives_ok($$select public.create_case('dispute','b4000000-0000-4000-8000-000000000001',category,'Category check','Category body')
 from unnest(array['damaged','missing','incorrect','malfunction','late_return','other']) category$$,'Every approved dispute category accepted');
select lives_ok($$select public.create_case('support',null,category,'Category check','Category body')
 from unnest(array['booking','cancellation','pickup_return','payment','refund','deposit_release','other']) category$$,'Every approved support category accepted');
select throws_ok($$select public.create_case('dispute','b4000000-0000-4000-8000-000000000001','payment','Invalid category','Body')$$,
 '23514',null,'Unapproved dispute category rejected');
select throws_ok($$select public.create_case('support',null,'technical','Invalid category','Body')$$,
 '23514',null,'Unapproved support category rejected');
select pg_temp.login(5);
select throws_ok($$select public.admin_promotion_redemptions((select id from test_ids where k='promo'))$$,
 '42501','Not authorized','Campaign redemption history requires promotion permission');
select throws_ok($$select public.restore_test_credit('ffffffff-ffff-4fff-8fff-ffffffffffff','Unauthorized restore')$$,
 '42501','Not authorized','Restoration primitive enforces admin permission before policy check');
set local request.jwt.claims='{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"b1000000-0000-4000-8000-000000000004","exp":1}';
select throws_ok($$select public.list_my_cases()$$,'42501','Active session required','Expired sessions fail closed');

reset role;
select * from finish();
rollback;
