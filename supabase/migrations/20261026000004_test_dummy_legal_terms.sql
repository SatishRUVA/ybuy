begin;

insert into public.feature_flags(key,enabled,description) values
  ('test_dummy_legal_terms',false,'Publish visibly labeled sample rental terms for isolated testing only. Never enable in production.')
on conflict(key) do nothing;

create function public.admin_publish_test_dummy_terms(p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer;v_reason text;v_issuer text;
begin
  perform public.admin_require('config.manage');
  v_reason:=public.admin_clean_reason(p_reason);
  if not exists(select 1 from public.feature_flags where key='test_dummy_legal_terms' and enabled) then
    raise exception 'Test dummy terms are disabled' using errcode='55000';
  end if;
  v_issuer:=coalesce(auth.jwt()->>'iss','');
  if v_issuer not in ('http://localhost:54321/auth/v1','https://jzyjmsixfuwzfnntewqn.supabase.co/auth/v1') then
    raise exception 'Test-only terms may only be published in the local or approved test project' using errcode='55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agreement-terms',0));
  select coalesce(max(version),0)+1 into v_version from public.rental_agreement_templates;
  insert into public.rental_agreement_templates(version,terms,approved_by,approval_reference)
  values(v_version,
    'TEST ONLY — SAMPLE TERMS. These terms are fictional and are not a legal contract. For isolated end-to-end testing only. A renter requests the item for the dates shown. The owner and renter should agree on pickup and return details. Any payment, deposit, damage, cancellation, or dispute behavior in this test environment is simulated and creates no real-world rights or obligations.',
    auth.uid(),'TEST ONLY: fictional sample terms; not legally approved');
  perform public.admin_write_audit('agreement.test_dummy.publish','agreement_template',v_version::text,null,
    jsonb_build_object('version',v_version,'test_only',true),v_reason);
  return v_version;
end;
$$;
revoke all on function public.admin_publish_test_dummy_terms(text) from public,anon;
grant execute on function public.admin_publish_test_dummy_terms(text) to authenticated;

create or replace function public.capture_rental_agreement(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_listing public.listings; v_template public.rental_agreement_templates; v_id uuid;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found or v_booking.status not in ('pending_payment','confirmed','active','return_pending','completed') then
    raise exception 'An approved booking is required for a rental agreement' using errcode='55000';
  end if;
  select id into v_id from public.rental_agreements where booking_id=p_booking_id;
  if found then return v_id; end if;
  select * into v_listing from public.listings where id=v_booking.listing_id;
  select * into v_template from public.rental_agreement_templates order by version desc limit 1;
  insert into public.rental_agreements(booking_id,owner_id,renter_id,template_id,snapshot)
  values(p_booking_id,v_booking.owner_id,v_booking.renter_id,v_template.id,jsonb_build_object(
    'booking_id',v_booking.id,'currency','USD',
    'owner_name',(select full_name from public.profiles where id=v_booking.owner_id),
    'renter_name',(select full_name from public.profiles where id=v_booking.renter_id),
    'listing',jsonb_build_object('id',v_listing.id,'title',v_listing.title,'description',v_listing.description,
      'condition',v_listing.item_condition,'owner_declared_value',v_listing.estimated_value,
      'photos',coalesce((select jsonb_agg(url order by sort_order,id) from public.listing_images where listing_id=v_listing.id),'[]'::jsonb),
      'approximate_pickup_area',v_listing.location_label),
    'start_date',v_booking.start_date,'end_date',v_booking.end_date,'quantity',v_booking.quantity,
    'daily_rate',v_booking.daily_rate,'rental_subtotal',v_booking.subtotal,
    'owner_discount_amount',v_booking.owner_discount_amount,
    'owner_discount_source',v_booking.owner_discount_source,
    'promo_code',v_booking.owner_promotion_code,
    'service_fee',v_booking.service_fee_amount,'deposit',v_booking.deposit,'total',v_booking.total,
    'deposit_model','Charged with checkout; refunded after owner-confirmed return when no unresolved dispute exists. No automatic deductions.',
    'terms_version',v_template.version,'terms',v_template.terms,
    'test_only_dummy_terms',coalesce(v_template.approval_reference like 'TEST ONLY:%',false),
    'legal_status',case when v_template.id is null then 'approval_pending'
      when v_template.approval_reference like 'TEST ONLY:%' then 'test_dummy' else 'approved_template' end,
    'missing_policy_approval',case when v_template.id is null then jsonb_build_array('Pickup and return obligations','Damage liability','Cancellation and refund policy','Extensions') else '[]'::jsonb end
  )) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.capture_rental_agreement(uuid) from public,anon,authenticated,service_role;

commit;

