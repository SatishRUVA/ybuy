begin;

alter table public.booking_deposit_claims
  add column requested_amount numeric(10,2) not null default 0
    check(requested_amount>=0 and requested_amount<=100000 and requested_amount=round(requested_amount,2));

create function public.submit_booking_deposit_claim(
  p_booking_id uuid,p_subject text,p_description text,p_requested_amount numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_case jsonb;
  v_case_id uuid;
begin
  perform public.operations_require_session();
  select * into b from public.bookings where id=p_booking_id and owner_id=auth.uid() for update;
  if not found or b.deposit_collection_model<>'authorization' or b.deposit<=0
    or b.status not in ('return_pending','completed') then
    raise exception 'Only the owner can submit a deposit claim during return inspection' using errcode='42501';
  end if;
  if p_subject is null or length(btrim(p_subject)) not between 3 and 160
    or p_description is null or length(btrim(p_description)) not between 10 and 2000
    or p_requested_amount is null or p_requested_amount<=0 or p_requested_amount>b.deposit
    or p_requested_amount<>round(p_requested_amount,2) then
    raise exception 'Enter a clear damage reason and an amount within the authorized deposit' using errcode='22023';
  end if;
  v_case:=public.operations_create_case('dispute',b.id,auth.uid(),'damaged',btrim(p_subject),btrim(p_description),null);
  v_case_id:=(v_case->>'id')::uuid;
  update public.booking_deposit_claims set requested_amount=p_requested_amount where case_id=v_case_id;
  return v_case;
end;
$$;
revoke all on function public.submit_booking_deposit_claim(uuid,text,text,numeric) from public,anon;
grant execute on function public.submit_booking_deposit_claim(uuid,text,text,numeric) to authenticated;

commit;
