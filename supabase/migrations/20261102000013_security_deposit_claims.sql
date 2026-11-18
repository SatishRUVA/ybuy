begin;

create table public.booking_deposit_claims (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  case_id uuid not null unique references public.operations_cases(id) on delete restrict,
  authorization_id uuid references public.booking_deposit_authorizations(id) on delete restrict,
  status text not null check(status in ('submitted','approved','rejected','capturing','captured','payment_required','failed')),
  approved_amount numeric(10,2) check(approved_amount is null or (approved_amount>=0 and approved_amount<=100000 and approved_amount=round(approved_amount,2))),
  approved_by uuid references public.profiles(id) on delete restrict,
  decided_at timestamptz,
  captured_at timestamptz,
  failure_reason text check(failure_reason is null or length(failure_reason)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger booking_deposit_claims_updated before update on public.booking_deposit_claims
  for each row execute function public.set_updated_at();
alter table public.booking_deposit_claims enable row level security;
revoke all on public.booking_deposit_claims from public,anon,authenticated;
grant select on public.booking_deposit_claims to authenticated;
grant all on public.booking_deposit_claims to service_role;
create policy booking_deposit_claim_participant_read on public.booking_deposit_claims
  for select to authenticated using(public.has_active_session() and exists(
    select 1 from public.bookings b where b.id=booking_id and auth.uid() in (b.renter_id,b.owner_id)
  ));

create function public.create_booking_deposit_claim_case()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b public.bookings; a public.booking_deposit_authorizations;
begin
  if new.kind<>'dispute' or new.category not in ('damaged','missing','incorrect','malfunction') or new.booking_id is null then return new;end if;
  select * into b from public.bookings where id=new.booking_id;
  if not found or b.deposit_collection_model<>'authorization' or b.deposit<=0 or new.created_by<>b.owner_id then return new;end if;
  if b.status not in ('return_pending','completed') then
    raise exception 'Damage claims can be filed only during return inspection' using errcode='55000';
  end if;
  select * into a from public.booking_deposit_authorizations where booking_id=b.id order by attempt desc limit 1;
  insert into public.booking_deposit_claims(booking_id,case_id,authorization_id,status)
    values(b.id,new.id,a.id,'submitted');
  return new;
end;
$$;
revoke all on function public.create_booking_deposit_claim_case() from public,anon,authenticated;
create trigger booking_deposit_claim_case after insert on public.operations_cases
  for each row execute function public.create_booking_deposit_claim_case();

create function public.approve_booking_deposit_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_evidence integer;
begin
  if old.status is not distinct from new.status or new.status<>'decided' then return new;end if;
  if new.kind<>'dispute' or new.booking_id is null then return new;end if;
  if not exists(select 1 from public.booking_deposit_claims where case_id=new.id) then return new;end if;
  if not public.operations_case_staff('dispute') then raise exception 'Dispute approval permission is required' using errcode='42501';end if;
  select * into b from public.bookings where id=new.booking_id;
  select count(*)::integer into v_evidence from public.operations_case_evidence where case_id=new.id;
  if b.status<>'completed' or b.return_confirmed_at is null or v_evidence=0 then
    raise exception 'A completed return and evidence are required before approving a deposit deduction' using errcode='23514';
  end if;
  if new.proposed_amount is null or new.proposed_amount<=0 then
    update public.booking_deposit_claims set status='rejected',approved_amount=0,approved_by=auth.uid(),decided_at=clock_timestamp()
      where case_id=new.id;
  else
    if new.proposed_amount>b.deposit then raise exception 'Approved deduction exceeds the authorized deposit' using errcode='23514';end if;
    update public.booking_deposit_claims set status='approved',approved_amount=new.proposed_amount,approved_by=auth.uid(),decided_at=clock_timestamp()
      where case_id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.approve_booking_deposit_claim() from public,anon,authenticated;
create trigger booking_deposit_claim_approval before update of status on public.operations_cases
  for each row execute function public.approve_booking_deposit_claim();

notify pgrst,'reload schema';
commit;
