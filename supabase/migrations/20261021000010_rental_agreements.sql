begin;
create table public.rental_agreement_templates (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  terms text not null check(length(terms) between 20 and 20000),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approval_reference text not null,
  created_at timestamptz not null default now()
);
alter table public.rental_agreement_templates enable row level security;
revoke all on public.rental_agreement_templates from anon,authenticated;

create table public.rental_agreements (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  renter_id uuid not null references public.profiles(id) on delete restrict,
  version integer not null default 1 check(version=1),
  template_id uuid references public.rental_agreement_templates(id) on delete restrict,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.rental_agreements enable row level security;
revoke all on public.rental_agreements from anon,authenticated;
grant select on public.rental_agreements to authenticated;
create policy rental_agreement_participants on public.rental_agreements for select to authenticated
  using(public.has_active_session() and auth.uid() in (owner_id,renter_id));

create table public.rental_agreement_acceptances (
  agreement_id uuid not null references public.rental_agreements(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key(agreement_id,user_id)
);
alter table public.rental_agreement_acceptances enable row level security;
revoke all on public.rental_agreement_acceptances from anon,authenticated;
grant select on public.rental_agreement_acceptances to authenticated;
create policy rental_agreement_acceptance_participants on public.rental_agreement_acceptances for select to authenticated
  using(public.has_active_session() and exists(select 1 from public.rental_agreements a
    where a.id=agreement_id and auth.uid() in (a.owner_id,a.renter_id)));

create function public.immutable_rental_document()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Rental documents and acceptances are immutable' using errcode='42501'; end;
$$;
create trigger agreement_immutable before update or delete on public.rental_agreements for each row execute function public.immutable_rental_document();
create trigger agreement_acceptance_immutable before update or delete on public.rental_agreement_acceptances for each row execute function public.immutable_rental_document();
create trigger agreement_template_immutable before update or delete on public.rental_agreement_templates for each row execute function public.immutable_rental_document();
create function public.admin_publish_agreement_terms(p_terms text,p_approval_reference text,p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_reason text;
begin
  perform public.admin_require('config.manage');
  v_reason:=public.admin_clean_reason(p_reason);
  if p_terms is null or length(btrim(p_terms)) not between 20 and 20000
    or p_approval_reference is null or length(btrim(p_approval_reference)) not between 3 and 500 then
    raise exception 'Provide approved legal terms and an approval reference' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agreement-terms',0));
  select coalesce(max(version),0)+1 into v_version from public.rental_agreement_templates;
  insert into public.rental_agreement_templates(version,terms,approved_by,approval_reference)
    values(v_version,btrim(p_terms),auth.uid(),btrim(p_approval_reference));
  perform public.admin_write_audit('agreement.terms.publish','agreement_template',v_version::text,null,
    jsonb_build_object('version',v_version,'approval_reference',btrim(p_approval_reference)),v_reason);
  return v_version;
end;
$$;
revoke all on function public.admin_publish_agreement_terms(text,text,text) from public,anon;
grant execute on function public.admin_publish_agreement_terms(text,text,text) to authenticated;

create function public.capture_rental_agreement(p_booking_id uuid)
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
    'service_fee',v_booking.service_fee_amount,'deposit',v_booking.deposit,'total',v_booking.total,
    'deposit_model','Charged with checkout; refunded after owner-confirmed return when no unresolved dispute exists. No automatic deductions.',
    'terms_version',v_template.version,'terms',v_template.terms,
    'legal_status',case when v_template.id is null then 'approval_pending' else 'approved_template' end,
    'missing_policy_approval',case when v_template.id is null then jsonb_build_array('Pickup and return obligations','Damage liability','Cancellation and refund policy','Extensions') else '[]'::jsonb end
  )) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.capture_rental_agreement(uuid) from public,anon,authenticated,service_role;

create function public.capture_booking_agreement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('pending_payment','confirmed') and (tg_op='INSERT' or new.status is distinct from old.status) then
    perform public.capture_rental_agreement(new.id);
  end if;
  return new;
end;
$$;
create trigger booking_capture_agreement after insert or update on public.bookings
  for each row execute function public.capture_booking_agreement();

create function public.get_rental_agreement(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_agreement public.rental_agreements;
begin
  perform public.operations_require_session();
  if not exists(select 1 from public.bookings where id=p_booking_id and auth.uid() in (owner_id,renter_id)) then
    raise exception 'Booking not found' using errcode='42501';
  end if;
  select * into v_agreement from public.rental_agreements where booking_id=p_booking_id;
  if not found then return null; end if;
  return to_jsonb(v_agreement)||jsonb_build_object('acceptances',coalesce((select jsonb_agg(jsonb_build_object(
    'role',case when user_id=v_agreement.owner_id then 'Owner' else 'Renter' end,'accepted_at',accepted_at
  ) order by accepted_at) from public.rental_agreement_acceptances where agreement_id=v_agreement.id),'[]'::jsonb));
end;
$$;
revoke all on function public.get_rental_agreement(uuid) from public,anon;
grant execute on function public.get_rental_agreement(uuid) to authenticated;

create function public.accept_rental_agreement(p_agreement_id uuid,p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_agreement public.rental_agreements;
begin
  perform public.operations_require_session();
  select * into v_agreement from public.rental_agreements where id=p_agreement_id for update;
  if not found or auth.uid() not in (v_agreement.owner_id,v_agreement.renter_id) then
    raise exception 'Agreement not found' using errcode='42501';
  end if;
  if p_version is null or v_agreement.version<>p_version then raise exception 'Agreement version mismatch' using errcode='40001'; end if;
  if v_agreement.template_id is null then raise exception 'Legal policy approval is required before agreement acceptance' using errcode='55000'; end if;
  if not exists(select 1 from public.bookings where id=v_agreement.booking_id and status in ('pending_payment','confirmed','active','return_pending','completed')) then
    raise exception 'This rental is no longer eligible for agreement acceptance' using errcode='55000';
  end if;
  insert into public.rental_agreement_acceptances(agreement_id,user_id) values(p_agreement_id,auth.uid()) on conflict do nothing;
end;
$$;
revoke all on function public.accept_rental_agreement(uuid,integer) from public,anon;
grant execute on function public.accept_rental_agreement(uuid,integer) to authenticated;
revoke all on function public.immutable_rental_document(),public.capture_booking_agreement() from public,anon,authenticated;
commit;
