begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('c0000000-0000-4000-8000-000000000001','workflow-owner@test.invalid','{"full_name":"Workflow owner"}'),
 ('c0000000-0000-4000-8000-000000000002','workflow-renter@test.invalid','{"full_name":"Workflow renter"}'),
 ('c0000000-0000-4000-8000-000000000003','workflow-other@test.invalid','{"full_name":"Workflow outsider"}');
insert into auth.sessions(id,user_id) values
 ('c1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001'),
 ('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002'),
 ('c1000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003');
insert into public.categories(id,name) values('c2000000-0000-4000-8000-000000000001','Workflow test');
insert into public.listings(id,owner_id,category_id,title,description,price_per_day,status,estimated_value,item_condition,
 availability_start,availability_end,pickup_windows)
values ('c3000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
 'c2000000-0000-4000-8000-000000000001','Workflow test item','A test item for revised handoff.',10,'draft',200,'good',
 current_date,current_date+30,array['morning']);
insert into public.listing_images(listing_id,url,sort_order)
values ('c3000000-0000-4000-8000-000000000001','https://example.test/workflow-item.jpg',0);
insert into public.listing_photo_reviews(listing_id,photo_url,decision,reason,review_method)
values ('c3000000-0000-4000-8000-000000000001','https://example.test/workflow-item.jpg','approved','Synthetic fixture','system');
insert into public.listing_pickup_locations(listing_id,owner_id,address,street_address,city,state,postal_code,country,latitude,longitude,time_zone)
values ('c3000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
 '123 Test Street, Dallas, TX 75201','123 Test Street','Dallas','TX','75201','US',32.8,-96.8,'America/Chicago');
update public.listings set status='published',available_quantity=10 where id='c3000000-0000-4000-8000-000000000001';

insert into public.bookings(id,listing_id,owner_id,renter_id,start_date,end_date,daily_rate,days,subtotal,
 service_fee_pct,service_fee_amount,deposit,total,status,payment_first,deposit_collection_model,return_scheduling_required)
values
 ('c4000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date,current_date+2,10,2,20,.1,2,50,72,'pending_payment',true,'authorization',false),
 ('c4000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date+1,current_date+3,10,2,20,.1,2,50,72,'pending_payment',false,'captured',false),
 ('c4000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001',
  current_date,current_date+2,10,2,20,.1,2,50,72,'pending_payment',false,'captured',false),
 ('c4000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date,current_date+2,10,2,20,.1,2,50,72,'pending_payment',false,'captured',false),
 ('c4000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
  current_date,current_date+2,10,2,20,.1,2,50,72,'pending_payment',true,'authorization',false);
select public.confirm_booking_payment(id,'cs_workflow_'||right(id::text,1),'pi_workflow_'||right(id::text,1),total)
from public.bookings where id::text like 'c4000000-0000-4000-8000-%';

insert into public.booking_pickup_slots(booking_id,kind,selected_date,slot_window,starts_at,ends_at,time_zone,
 status,proposed_by,approved_by)
values
 ('c4000000-0000-4000-8000-000000000001','pickup',current_date,'morning',
  clock_timestamp()+interval '2 hours 1 minute',clock_timestamp()+interval '3 hours 1 minute','America/Chicago','approved',
  'c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001'),
 ('c4000000-0000-4000-8000-000000000002','pickup',current_date+1,'morning',
  ((current_date+1)::timestamp+interval '10 hours') at time zone 'America/Chicago',
  ((current_date+1)::timestamp+interval '11 hours') at time zone 'America/Chicago','America/Chicago','approved',
  'c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001'),
 ('c4000000-0000-4000-8000-000000000005','pickup',current_date,'morning',
  clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '50 minutes','America/Chicago','approved',
  'c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001'),
 ('c4000000-0000-4000-8000-000000000004','return',current_date+2,'morning',
  ((current_date+2)::timestamp+interval '10 hours') at time zone 'America/Chicago',
  ((current_date+2)::timestamp+interval '11 hours') at time zone 'America/Chicago','America/Chicago','proposed',
  'c0000000-0000-4000-8000-000000000001',null);
update public.booking_deposit_authorizations set status='authorized',authorized_amount=72,
 authorization_at=clock_timestamp(),capture_before=clock_timestamp()+interval '2 days'
where booking_id='c4000000-0000-4000-8000-000000000001' and not is_claim_authorization;

update public.bookings set status='active' where id in
 ('c4000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000004');
insert into public.booking_handoffs(booking_id,status)
values ('c4000000-0000-4000-8000-000000000003','rental_active'),
 ('c4000000-0000-4000-8000-000000000004','rental_active');

create temporary table workflow_test_codes(booking_id uuid primary key,code text not null);
grant select,insert,update on workflow_test_codes to authenticated;
create function pg_temp.login(p_user integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','c0000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),
    'role','authenticated',
    'session_id','c1000000-0000-4000-8000-'||lpad(p_user::text,12,'0'),
    'exp',4102444800)::text,true);
end;
$$;

set local role authenticated;
select pg_temp.login(3);
select throws_ok($$select public.get_booking_handoff_workflow(
 'c4000000-0000-4000-8000-000000000001','pickup')$$,
 '42501','Booking not found or not authorized','Unrelated users cannot inspect a workflow');

select pg_temp.login(1);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->>'handoff_ready'),
 'false','A paid booking more than two hours early remains unavailable');
select throws_ok($$select public.begin_booking_handoff(
 'c4000000-0000-4000-8000-000000000002','pickup',1)$$,
 '55000','Pickup requires an approved window, opening 2 hours before its start and closing at its end',
 'Owner cannot bypass the two-hour opening boundary');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->>'handoff_ready'),
 'false','A valid security hold does not open pickup more than two hours early');
select throws_ok($$select public.begin_booking_handoff(
 'c4000000-0000-4000-8000-000000000001','pickup',1)$$,
 '55000','Pickup requires an approved window, opening 2 hours before its start and closing at its end',
 'Owner with payment and hold ready is blocked just before the two-hour boundary');
reset role;
update public.booking_pickup_slots set starts_at=statement_timestamp()+interval '2 hours',
 ends_at=statement_timestamp()+interval '3 hours'
 where booking_id='c4000000-0000-4000-8000-000000000001' and kind='pickup';
set local role authenticated;
select pg_temp.login(1);
select ok((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000001','pickup')
 ->'workflow'->'allowed_actions') ? 'start_pickup',
 'Owner can begin before the approved time when payment and the hold are ready');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->>'handoff_ready'),
 'true', 'Scheduling readiness opens at the two-hour boundary with payment and hold ready');
select pg_temp.login(2);
select throws_ok($$select public.begin_booking_handoff(
 'c4000000-0000-4000-8000-000000000001','pickup',1)$$,
 '42501','Only the owner can start pickup inspection','Early pickup still cannot be started by the renter');
select pg_temp.login(1);
select throws_ok($$select public.begin_booking_handoff(
 'c4000000-0000-4000-8000-000000000005','pickup',1)$$,
 '55000','The security deposit hold must cover the approved pickup window','An expired or missing deposit hold blocks pickup');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000005','pickup')->'workflow'->>'action'),
 'renew_deposit','Missing hold directs the renter to deposit recovery');
select lives_ok($$select public.begin_booking_handoff(
 'c4000000-0000-4000-8000-000000000001','pickup',1)$$,
 'Owner starts pickup early with a confirmed payment and provider-valid hold');
select lives_ok($$select public.start_booking_handoff('c4000000-0000-4000-8000-000000000001')$$,
 'Legacy start endpoint delegates safely to the authoritative transition');
reset role;
update public.booking_pickup_slots set starts_at=clock_timestamp()-interval '70 minutes',
 ends_at=clock_timestamp()-interval '10 minutes'
 where booking_id in ('c4000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000005')
 and kind='pickup';
update public.booking_deposit_authorizations set status='authorized',authorized_amount=50,
 authorization_at=clock_timestamp(),capture_before=clock_timestamp()+interval '2 days'
 where booking_id='c4000000-0000-4000-8000-000000000005' and not is_claim_authorization;
set local role authenticated;
select pg_temp.login(1);
select is((public.get_booking_pickup('c4000000-0000-4000-8000-000000000001')->>'address'),
 '123 Test Street, Dallas, TX 75201','Started pickup retains the private address after the approved hour ends');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->>'handoff_ready'),
 'true','Started pickup remains ready after the approved window while its provider hold is valid');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000001','pickup')
 ->'workflow'->>'scheduling_ready'),'true','Started inspection does not contradict scheduling readiness after its window');
select lives_ok($$select public.start_booking_handoff('c4000000-0000-4000-8000-000000000001')$$,
 'Retrying an already-started pickup does not reapply the initial scheduling gate');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000005')->>'handoff_ready'),
 'false','Unstarted pickup with a valid hold remains blocked after its approved window');
select throws_ok($$select public.begin_booking_handoff(
 'c4000000-0000-4000-8000-000000000005','pickup',1)$$,
 '55000','Pickup requires an approved window, opening 2 hours before its start and closing at its end','Expired window cannot be bypassed for an unstarted pickup');
select throws_ok($$select public.get_booking_pickup('c4000000-0000-4000-8000-000000000005')$$,
 '55000','Complete check-in before accessing the private handoff address','Unstarted expired-window pickup does not gain private-address access');
select pg_temp.login(2);
select is((public.get_booking_pickup('c4000000-0000-4000-8000-000000000001')->>'address'),
 '123 Test Street, Dallas, TX 75201','Renter also retains the started pickup address after its window');
select pg_temp.login(1);
select throws_ok($$select public.save_booking_inspection_draft(
 'c4000000-0000-4000-8000-000000000001','pickup',1,'','',array[]::text[],'','')$$,
 '40001','This handoff changed in another session. Refresh before saving.','Stale workflow versions cannot overwrite a draft');
select is(jsonb_typeof(public.save_booking_inspection_draft(
 'c4000000-0000-4000-8000-000000000001','pickup',2,'','',array[]::text[],'','')->'workflow_version'),
 'number','Owner can save an incomplete draft and receives numeric workflow_version');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000001','pickup')->'workflow'->>'stage'),
 'inspection','An incomplete owner draft remains in the inspection stage');
reset role;
update public.booking_deposit_authorizations set status='expired',capture_before=clock_timestamp()-interval '1 second'
where booking_id='c4000000-0000-4000-8000-000000000001' and not is_claim_authorization;
set local role authenticated;
select pg_temp.login(1);
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000001','pickup')->'workflow'->>'action'),
 'renew_deposit','A started pickup with a now-missing hold asks the renter to renew it');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->>'handoff_ready'),
 'false','Started pickup readiness still requires a provider-valid deposit hold');
select ok((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000001','pickup')->'workflow'->'allowed_actions') ? 'save_draft',
 'Missing deposit does not block owner draft editing');
select pg_temp.login(2);
select is((public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'inspection')::text,
 'null','Renter never sees an unpublished owner draft');

reset role;
insert into storage.objects(bucket_id,name,owner_id) values
 ('booking-inspection-evidence','c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v1-a.jpg','c0000000-0000-4000-8000-000000000001'),
 ('booking-inspection-evidence','c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v1-b.jpg','c0000000-0000-4000-8000-000000000001'),
 ('booking-inspection-evidence','c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v2-a.jpg','c0000000-0000-4000-8000-000000000001'),
 ('booking-inspection-evidence','c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v2-b.jpg','c0000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.login(1);
select throws_ok($$select public.publish_booking_inspection(
 'c4000000-0000-4000-8000-000000000001','pickup',3)$$,
 '22023','Complete the condition, damage, accessory and functional checklist','Incomplete drafts cannot be published');
select lives_ok($$select public.save_booking_inspection_draft(
 'c4000000-0000-4000-8000-000000000001','pickup',3,
 'Clean exterior with no visible cracks.','One minor scratch on the side.',
 array['charger','case'],'Powers on and operates normally.','WF-001')$$,
 'Owner completes the draft after deposit state changes');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->>'workflow_version'),
 '4','Saving a draft returns and advances workflow_version');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000001' and kind='pickup'),
 'c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v1-a.jpg')$$,
 'Owner registers the first photo');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000001' and kind='pickup'),
 'c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v1-b.jpg')$$,
 'Owner registers the second photo');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000001')->>'workflow_version'),
 '4','Photo registration does not invalidate the draft workflow version');
select lives_ok($$select public.publish_booking_inspection(
 'c4000000-0000-4000-8000-000000000001','pickup',4)$$,
 'Complete draft and two registered photos publish atomically');
select is((public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'inspection'->>'publication_status'),
 'published','Published inspection is visible to both participants');
select throws_ok($$select public.save_booking_inspection(
 'c4000000-0000-4000-8000-000000000001','pickup',
 'Changed published condition.','A previously unrecorded scratch.',array['charger'],
 'Still works.','WF-001')$$,
 '55000','Published evidence cannot be edited; request a correction first','Legacy save cannot mutate published evidence');
select pg_temp.login(2);
select lives_ok($$select public.review_booking_inspection(
 'c4000000-0000-4000-8000-000000000001','pickup',1,5,'request_correction',
 'Please clarify the scratch location and test the charger.')$$,
 'Renter can request a reasoned correction');
select is((public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'inspection'->>'revision'),
 '1','Renter continues to see the last published revision while owner edits');
select is((select count(*)::integer from public.booking_inspections
 where booking_id='c4000000-0000-4000-8000-000000000001' and publication_status='draft'),
 0,'Row-level security hides owner drafts from direct table reads');
select is(jsonb_array_length(public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'history'),
 1,'Published revision is retained in history after correction is requested');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000001','pickup')
 ->'pickup'->>'review_reason'),'Please clarify the scratch location and test the charger.',
 'Workflow exposes review_reason at the kind detail level');
select ok((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000001','pickup')
 ->'pickup'->'history'->0) ?& array['inspection','photos'],
 'Workflow history snapshots contain inspection and photos');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000001','pickup')
 ->'pickup'->'history'->0->'inspection'->>'revision'),'1',
 'Workflow history inspection retains its published revision');
select pg_temp.login(1);
select is((public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'inspection'->>'revision'),
 '2','Owner receives a new draft revision for correction');
select is((public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'inspection')
 - array['revision','publication_status','published_at','owner_acknowledged_at','renter_acknowledged_at',
   'condition_status','review_reason','submitted_at','updated_at'],
 (public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'history'->0->'inspection')
 - array['revision','publication_status','published_at','owner_acknowledged_at','renter_acknowledged_at',
   'condition_status','review_reason','submitted_at','updated_at'],
 'Correction draft retains all prior condition fields before any owner editing');
select is(jsonb_array_length(public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'photos'),
 2,'Correction draft retains two registered evidence references without uploading again');
select is((select array_agg(p->>'object_path' order by p->>'object_path')
 from jsonb_array_elements(public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'photos') p),
 (select array_agg(p->>'object_path' order by p->>'object_path')
 from jsonb_array_elements(public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'history'->0->'photos') p),
 'Correction evidence references the same immutable storage object as published history');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000001' and kind='pickup'),
 'c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v1-a.jpg')$$,
 'Retrying inherited photo registration is idempotent on the new revision');
select lives_ok($$select public.save_booking_inspection_draft(
 'c4000000-0000-4000-8000-000000000001','pickup',6,
 'Clean exterior with a scratch on the left panel.','One minor scratch on the left panel.',
 array['charger','case'],'Powers on; charger tested successfully.','WF-001')$$,
 'Owner revises the draft without overwriting the publication');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000001' and kind='pickup'),
 'c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v2-a.jpg')$$,
 'Owner attaches a new-revision photo');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000001' and kind='pickup'),
 'c4000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000001/pickup/v2-b.jpg')$$,
 'Owner attaches the second new-revision photo');
select pg_temp.login(2);
select is((select count(*)::integer from public.booking_inspection_photos p
 join public.booking_inspections i on i.id=p.inspection_id
 where i.booking_id='c4000000-0000-4000-8000-000000000001' and p.revision=2),
 0,'Renter cannot read newly uploaded draft photos');
select is((select count(*)::integer from storage.objects where bucket_id='booking-inspection-evidence'
 and name like 'c4000000-0000-4000-8000-000000000001/%/pickup/v2-%'),
 0,'Storage RLS hides unsubmitted photos from the renter');
select is((select count(*)::integer from storage.objects where bucket_id='booking-inspection-evidence'
 and name like 'c4000000-0000-4000-8000-000000000001/%/pickup/v1-%'),
 2,'Renter retains access to evidence from the prior published revision');
select pg_temp.login(1);
select lives_ok($$select public.publish_booking_inspection(
 'c4000000-0000-4000-8000-000000000001','pickup',7)$$,
 'Corrected inspection publishes as a new immutable revision');
select is((select count(*)::integer from public.booking_inspection_photos p
 join public.booking_inspections i on i.id=p.inspection_id
 where i.booking_id='c4000000-0000-4000-8000-000000000001' and i.kind='pickup' and p.revision=1),
 2,'Original revision photos remain registered');
select is((public.get_booking_handoff('c4000000-0000-4000-8000-000000000001')->'pickup'->'history'->0->'photos')::text,
 (select photos::text from public.booking_inspection_revisions where booking_id='c4000000-0000-4000-8000-000000000001'
  and kind='pickup' and revision=1),'Published history preserves the original photo evidence');
reset role;
update public.booking_deposit_authorizations set status='authorized',capture_before=clock_timestamp()+interval '2 days'
where booking_id='c4000000-0000-4000-8000-000000000001' and not is_claim_authorization;
set local role authenticated;
select pg_temp.login(2);
select throws_ok($$select public.review_booking_inspection(
 'c4000000-0000-4000-8000-000000000001','pickup',2,6,'agree',null)$$,
 '40001','This handoff changed in another session. Refresh before responding.','Stale inspection responses are rejected');
select lives_ok($$select public.review_booking_inspection(
 'c4000000-0000-4000-8000-000000000001','pickup',2,8,'agree',null)$$,
 'Renter agrees to the current published revision');
insert into workflow_test_codes(booking_id,code)
select 'c4000000-0000-4000-8000-000000000001',x->>'code'
from (select public.get_booking_handoff_otp('c4000000-0000-4000-8000-000000000001','pickup') x) s;
reset role;
select is((select revision from public.booking_handoff_otp_challenges where booking_id='c4000000-0000-4000-8000-000000000001'
 and kind='pickup' order by generation desc limit 1),2,'OTP is bound to the reviewed inspection revision');
set local role authenticated;
select pg_temp.login(1);
select is((public.verify_booking_handoff_otp('c4000000-0000-4000-8000-000000000001','pickup',
 (select code from workflow_test_codes where booking_id='c4000000-0000-4000-8000-000000000001'))->>'verified'),
 'true','Owner verifies the renter code for the published revision');

select pg_temp.login(2);
select throws_ok($$select public.propose_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000002','pickup','afternoon',12,'Unavailable window',1)$$,
 '22023','This window is not available for this listing','Configured pickup windows are enforced');
select throws_ok($$select public.propose_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000002','pickup','morning',12,'Unavailable hour',1)$$,
 '22023','Choose an available hour in the pickup location timezone','Hours outside a window are rejected');
select lives_ok($$select public.propose_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000002','pickup','morning',9,'Earlier is better',1)$$,
 'Either participant can propose a fixed-date replacement');
select ok((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->'pickup_proposal')
 ?& array['proposed_by_is_owner','version','starts_at','ends_at'],
 'Replacement proposal exposes role, version and slot fields');
select is((select starts_at from public.booking_pickup_slots where booking_id='c4000000-0000-4000-8000-000000000002'
 and kind='pickup'),((current_date+1)::timestamp+interval '10 hours') at time zone 'America/Chicago',
 'Unapproved replacement leaves the current approved slot intact');
select throws_ok($$select public.respond_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000002','pickup',true,1)$$,
 '40001','This handoff changed in another session. Refresh before responding.','Stale proposal responses are rejected');
select throws_ok($$select public.respond_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000002','pickup',true,2)$$,
 '55000','This proposal changed or is no longer available','The proposing participant cannot approve their own replacement');
select pg_temp.login(1);
select lives_ok($$select public.respond_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000002','pickup',false,2)$$,
 'Other participant can decline a replacement');
select is((select status from public.booking_handoff_slot_proposals
 where booking_id='c4000000-0000-4000-8000-000000000002' and kind='pickup'),
 'declined','Declined alternatives retain their status');
select lives_ok($$select public.propose_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000002','pickup','morning',11,'Owner alternative',3)$$,
 'Owner can propose an alternative after declining the renter proposal');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000002')->'pickup_proposal'->>'proposed_by_is_owner'),
 'true','The renter sees that the alternative came from the owner');
select is((select count(*) from public.booking_handoff_events where booking_id='c4000000-0000-4000-8000-000000000002'
 and event_type='pickup_replacement_declined'),1::bigint,'Decline history survives the next proposal');
select pg_temp.login(2);
select lives_ok($$select public.respond_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000002','pickup',true,4)$$,
 'Renter can approve the owner alternative');
select is((select slot_window from public.booking_pickup_slots where booking_id='c4000000-0000-4000-8000-000000000002'
 and kind='pickup'),'morning','Approval applies the replacement atomically');
select is((select extract(hour from starts_at at time zone 'America/Chicago')::integer
 from public.booking_pickup_slots where booking_id='c4000000-0000-4000-8000-000000000002' and kind='pickup'),
 11,'Approved slot uses the owner alternative');

select pg_temp.login(2);
select lives_ok($$select public.begin_booking_handoff(
 'c4000000-0000-4000-8000-000000000003','return',1)$$,
 'Owner can initiate return inspection without a required renter arrival or scheduled slot for legacy rentals');
select lives_ok($$select public.save_booking_inspection_draft(
 'c4000000-0000-4000-8000-000000000003','return',2,
 'Item returned with a visible crack.','Crack near the lower hinge.',
 array['charger'],'Powers on, but hinge is loose.','WF-003')$$,
 'Owner documents return condition before renter review');
reset role;
insert into storage.objects(bucket_id,name,owner_id) values
 ('booking-inspection-evidence','c4000000-0000-4000-8000-000000000003/c0000000-0000-4000-8000-000000000002/return/return-a.jpg','c0000000-0000-4000-8000-000000000002'),
 ('booking-inspection-evidence','c4000000-0000-4000-8000-000000000003/c0000000-0000-4000-8000-000000000002/return/return-b.jpg','c0000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.login(2);
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000003' and kind='return'),
 'c4000000-0000-4000-8000-000000000003/c0000000-0000-4000-8000-000000000002/return/return-a.jpg')$$,
 'Owner registers return photo');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000003' and kind='return'),
 'c4000000-0000-4000-8000-000000000003/c0000000-0000-4000-8000-000000000002/return/return-b.jpg')$$,
 'Owner registers second return photo');
select lives_ok($$select public.publish_booking_inspection(
 'c4000000-0000-4000-8000-000000000003','return',3)$$,
 'Complete return inspection can be published');
select pg_temp.login(1);
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000004')->'return_proposal'->>'proposed_by_is_owner'),
 'true','Legacy proposed slots remain visible as proposals');
select is((public.get_booking_precheckin('c4000000-0000-4000-8000-000000000004')->'return_proposal'->>'version'),
 '1','Legacy proposal responses use the current workflow version');
select pg_temp.login(2);
select lives_ok($$select public.respond_booking_handoff_replacement(
 'c4000000-0000-4000-8000-000000000004','return',true,1)$$,
 'New versioned response supports an existing legacy proposal');
select is((select status from public.booking_pickup_slots where booking_id='c4000000-0000-4000-8000-000000000004'
 and kind='return'),'approved','Legacy slot proposal is approved without replacing its date');
select pg_temp.login(1);
select lives_ok($$select public.report_booking_return_receipt(
 'c4000000-0000-4000-8000-000000000004',2,'Item is physically present; please verify with support.')$$,
 'Owner can report receipt for support review');
select is((select status from public.bookings where id='c4000000-0000-4000-8000-000000000004'),
 'active','A receipt report does not complete the booking');
select ok((select actual_return_at is null from public.booking_handoffs
 where booking_id='c4000000-0000-4000-8000-000000000004'),
 'A receipt report does not set the physical-return timestamp');
reset role;
select is((select count(*)::integer from public.operations_cases
 where booking_id='c4000000-0000-4000-8000-000000000004' and kind='support'),
 1,'A receipt report creates an auditable support case');
set local role authenticated;
select pg_temp.login(1);
select lives_ok($$select public.start_booking_return('c4000000-0000-4000-8000-000000000004')$$,
 'Legacy return start safely uses the authoritative transition');
select lives_ok($$select public.save_booking_inspection(
 'c4000000-0000-4000-8000-000000000004','return',
 'Item is present and in working condition.','No additional damage noted.',
 array['charger'],'Powers on and operates normally.','WF-004')$$,
 'Legacy save endpoint creates a draft without bypassing publication');
reset role;
insert into storage.objects(bucket_id,name,owner_id) values
 ('booking-inspection-evidence','c4000000-0000-4000-8000-000000000004/c0000000-0000-4000-8000-000000000001/return/legacy-a.jpg','c0000000-0000-4000-8000-000000000001'),
 ('booking-inspection-evidence','c4000000-0000-4000-8000-000000000004/c0000000-0000-4000-8000-000000000001/return/legacy-b.jpg','c0000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.login(1);
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000004' and kind='return'),
 'c4000000-0000-4000-8000-000000000004/c0000000-0000-4000-8000-000000000001/return/legacy-a.jpg')$$,
 'Legacy upload registration attaches evidence to the current draft revision');
select lives_ok($$select public.register_booking_inspection_photo(
 (select id from public.booking_inspections where booking_id='c4000000-0000-4000-8000-000000000004' and kind='return'),
 'c4000000-0000-4000-8000-000000000004/c0000000-0000-4000-8000-000000000001/return/legacy-b.jpg')$$,
 'Legacy upload registration accepts a second draft photo');
select pg_temp.login(2);
select throws_ok($$select public.acknowledge_booking_inspection(
 'c4000000-0000-4000-8000-000000000004','return')$$,
 '55000','The owner must publish the inspection before the renter can acknowledge it',
 'Legacy renter-first acknowledgment never fabricates owner consent');
select pg_temp.login(1);
select lives_ok($$select public.acknowledge_booking_inspection(
 'c4000000-0000-4000-8000-000000000004','return')$$,
 'Legacy owner acknowledgment explicitly publishes the complete draft');
select is((public.get_booking_handoff('c4000000-0000-4000-8000-000000000004')->'return'->'inspection'->>'publication_status'),
 'published','Legacy owner acknowledgment leaves an immutable publication');
select pg_temp.login(2);
select lives_ok($$select public.review_booking_inspection(
 'c4000000-0000-4000-8000-000000000004','return',1,
 (select workflow_version from public.bookings where id='c4000000-0000-4000-8000-000000000004'),
 'request_correction','Please review the recorded condition once more.')$$,
 'Return correction retains a complete starting draft');
select pg_temp.login(1);
select lives_ok($$select public.acknowledge_booking_inspection(
 'c4000000-0000-4000-8000-000000000004','return')$$,
 'Owner can republish a correction using inherited photos without reuploading any evidence');
select pg_temp.login(2);
select lives_ok($$select public.acknowledge_booking_inspection(
 'c4000000-0000-4000-8000-000000000004','return')$$,
 'Legacy renter acknowledgment agrees to the published revision');
insert into workflow_test_codes(booking_id,code)
select 'c4000000-0000-4000-8000-000000000004',x->>'code'
from (select public.get_booking_handoff_otp('c4000000-0000-4000-8000-000000000004','return') x) s;
select pg_temp.login(1);
select is((public.verify_booking_handoff_otp('c4000000-0000-4000-8000-000000000004','return',
 (select code from workflow_test_codes where booking_id='c4000000-0000-4000-8000-000000000004'))->>'verified'),
 'true','Legacy published inspection and OTP flow remains functional');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000004','return')->'workflow'->>'financially_closed'),
 'false','Legacy physical completion does not expose premature financial closure');
select pg_temp.login(1);
select lives_ok($$select public.review_booking_inspection(
 'c4000000-0000-4000-8000-000000000003','return',1,4,'dispute',
 'The reported crack is not shown in the return photos.')$$,
 'Renter can dispute return condition and receive a physical-receipt code');
reset role;
select is((select count(*)::integer from public.operations_cases
 where booking_id='c4000000-0000-4000-8000-000000000003' and kind='dispute'),
 1,'A return-condition dispute creates a case atomically');
set local role authenticated;
select pg_temp.login(1);
select is((public.get_booking_handoff('c4000000-0000-4000-8000-000000000003')->'return'->'inspection'->>'condition_status'),
 'disputed','Disputed condition remains distinct from receipt verification');
insert into workflow_test_codes(booking_id,code)
select 'c4000000-0000-4000-8000-000000000003',x->>'code'
from (select public.get_booking_handoff_otp('c4000000-0000-4000-8000-000000000003','return') x) s;
select pg_temp.login(2);
select is((public.verify_booking_handoff_otp('c4000000-0000-4000-8000-000000000003','return',
 (select code from workflow_test_codes where booking_id='c4000000-0000-4000-8000-000000000003'))->>'verified'),
 'true','Owner verifies physical receipt without renter agreeing to condition');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000003','return')->'workflow'->>'physical_return_verified'),
 'true','Verified OTP records physical return');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000003','return')->'workflow'->>'financially_closed'),
 'false','Physical return does not imply financial closure');
select ok((select actual_return_at is not null from public.booking_handoffs
 where booking_id='c4000000-0000-4000-8000-000000000003'),
 'Disputed receipt verification records actual physical return');
select is((select status from public.bookings where id='c4000000-0000-4000-8000-000000000003'),
 'completed','Physical return completes the rental independently of dispute settlement');
reset role;
select is((select refund_status from public.rental_settlements where booking_id='c4000000-0000-4000-8000-000000000003'),
 'pending','Disputed return queues settlement without settling it');

update public.operations_cases set status='closed'
 where booking_id='c4000000-0000-4000-8000-000000000003' and kind='dispute';
update public.rental_settlements set refund_status='succeeded',transfer_status='succeeded'
 where booking_id='c4000000-0000-4000-8000-000000000003';
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000003','return')
 ->'workflow'->>'financially_closed'),'true','Settled rental with closed dispute can report financial closure');
insert into public.booking_deposit_authorizations(booking_id,attempt,renter_id,owner_id,
 authorized_amount,status,is_claim_authorization,idempotency_key)
values
 ('c4000000-0000-4000-8000-000000000003',1,'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',50,'authorized',true,'workflow-closure-old'),
 ('c4000000-0000-4000-8000-000000000003',2,'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',50,'released',false,'workflow-closure-new');
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000003','return')
 ->'workflow'->>'financially_closed'),'false','Older live claim authorization prevents financial closure');
update public.booking_deposit_authorizations set status='failed',stripe_payment_intent_id='pi_workflow_uncertain'
 where idempotency_key='workflow-closure-old';
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000003','return')
 ->'workflow'->>'financially_closed'),'false','Uncertain failed provider attempt prevents financial closure');
update public.booking_deposit_authorizations set status='released'
 where idempotency_key='workflow-closure-old';
insert into public.booking_deposit_claims(booking_id,case_id,status)
select booking_id,id,'submitted' from public.operations_cases
 where booking_id='c4000000-0000-4000-8000-000000000003' and kind='dispute';
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000003','return')
 ->'workflow'->>'financially_closed'),'false','Unresolved claim prevents financial closure despite successful payout');
update public.booking_deposit_claims set status='rejected'
 where booking_id='c4000000-0000-4000-8000-000000000003';
select is((public.get_booking_handoff_workflow('c4000000-0000-4000-8000-000000000003','return')
 ->'workflow'->>'financially_closed'),'true','Resolved claim and released attempts permit financial closure');

reset role;
select * from finish();
rollback;
