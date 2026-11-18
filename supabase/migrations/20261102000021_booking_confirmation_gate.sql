begin;

alter table public.bookings add column confirmation_gate text not null default 'awaiting_payment'
  check (confirmation_gate in ('awaiting_payment','awaiting_authorization','authorization_action_required',
    'authorization_failed','authorization_expired','availability_conflict','confirmed'));

update public.bookings set confirmation_gate=case
  when status in ('confirmed','active','return_pending','completed') then 'confirmed'
  when deposit_collection_model='authorization' and deposit>0 then 'awaiting_authorization'
  else 'awaiting_payment' end;

create function public.initialize_booking_confirmation_gate()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.confirmation_gate:=case when new.deposit_collection_model='authorization' and new.deposit>0
    then 'awaiting_authorization' else 'awaiting_payment' end;
  if new.status in ('confirmed','active','return_pending','completed') then new.confirmation_gate:='confirmed';end if;
  return new;
end;
$$;
revoke all on function public.initialize_booking_confirmation_gate() from public,anon,authenticated;
create trigger zzzzzzzzz_bookings_confirmation_gate_insert before insert on public.bookings
  for each row execute function public.initialize_booking_confirmation_gate();

create function public.enforce_booking_confirmation_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_paid boolean;
  v_authorization public.booking_deposit_authorizations;
  v_authorized boolean:=true;
begin
  if new.status<>'confirmed' or old.status='confirmed' then return new;end if;
  select exists(select 1 from public.payments where booking_id=new.id and status='succeeded') into v_paid;
  if not v_paid then
    new.status:='pending_payment';
    new.confirmation_gate:='awaiting_payment';
    return new;
  end if;
  if new.deposit_collection_model='authorization' and new.deposit>0 then
    select * into v_authorization from public.booking_deposit_authorizations
      where booking_id=new.id and not is_claim_authorization order by attempt desc limit 1;
    v_authorized:=found and v_authorization.status='authorized'
      and v_authorization.authorized_amount>=new.deposit and v_authorization.capture_before>clock_timestamp();
    if not v_authorized then
      new.status:='pending_payment';
      new.confirmation_gate:=case
        when v_authorization.status='requires_action' then 'authorization_action_required'
        when v_authorization.status='failed' then 'authorization_failed'
        when v_authorization.status='expired' or (v_authorization.status='authorized' and v_authorization.capture_before<=clock_timestamp()) then 'authorization_expired'
        else 'awaiting_authorization' end;
      return new;
    end if;
  end if;
  new.confirmation_gate:='confirmed';
  return new;
end;
$$;
revoke all on function public.enforce_booking_confirmation_gate() from public,anon,authenticated;
create trigger booking_confirmation_gate before update of status on public.bookings
  for each row execute function public.enforce_booking_confirmation_gate();

create function public.extend_deposit_confirmation_deadline()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status='pending_payment' and new.auction_bid_id is null
    and new.deposit_collection_model='authorization' and new.deposit>0 and new.deposit_hold_consent_at is not null then
    new.checkout_expires_at:=greatest(coalesce(new.checkout_expires_at,clock_timestamp()),clock_timestamp()+interval '30 minutes');
  end if;
  return new;
end;
$$;
revoke all on function public.extend_deposit_confirmation_deadline() from public,anon,authenticated;
create trigger zzzzzzzz_extend_deposit_confirmation_deadline before insert or update of status,deposit_hold_consent_at
  on public.bookings for each row execute function public.extend_deposit_confirmation_deadline();

create or replace function public.expire_listing_checkouts(p_listing_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform 1 from public.listings where id=p_listing_id for update;
  update public.bookings set status='cancelled',checkout_expired_at=clock_timestamp()
    where listing_id=p_listing_id and status='pending_payment' and checkout_expires_at<=clock_timestamp()
      and not exists(select 1 from public.payments where booking_id=bookings.id and status='succeeded');
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.expire_listing_checkouts(uuid) from public,anon,authenticated;

create or replace function public.expire_checkout_reservations()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_listing record; v_count integer:=0;
begin
  for v_listing in select l.id from public.listings l where exists(
    select 1 from public.bookings b where b.listing_id=l.id and b.status='pending_payment'
      and b.checkout_expires_at<=clock_timestamp()
      and not exists(select 1 from public.payments p where p.booking_id=b.id and p.status='succeeded')
  ) order by l.id limit 100 for update of l skip locked loop
    v_count:=v_count+public.expire_listing_checkouts(v_listing.id);
  end loop;
  return v_count;
end;
$$;
revoke all on function public.expire_checkout_reservations() from public,anon,authenticated;
grant execute on function public.expire_checkout_reservations() to service_role;

create or replace function public.get_checkout_reservation(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_authorization public.booking_deposit_authorizations;
begin
  perform public.operations_require_session();
  select * into v_booking from public.bookings where id=p_booking_id and auth.uid() in (owner_id,renter_id);
  if not found then raise exception 'Booking not found' using errcode='42501';end if;
  perform public.expire_listing_checkouts(v_booking.listing_id);
  select * into v_booking from public.bookings where id=p_booking_id;
  select * into v_authorization from public.booking_deposit_authorizations
    where booking_id=p_booking_id and not is_claim_authorization order by attempt desc limit 1;
  return jsonb_build_object('status',v_booking.status,'expires_at',v_booking.checkout_expires_at,
    'expired_at',v_booking.checkout_expired_at,'server_now',clock_timestamp(),
    'confirmation_gate',v_booking.confirmation_gate,
    'payment_received',exists(select 1 from public.payments where booking_id=p_booking_id and status='succeeded'),
    'authorization_status',v_authorization.status,'capture_before',v_authorization.capture_before);
end;
$$;
revoke all on function public.get_checkout_reservation(uuid) from public,anon;
grant execute on function public.get_checkout_reservation(uuid) to authenticated;

create function public.sync_booking_confirmation_after_authorization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_paid boolean;
  v_available boolean;
  v_payment public.payments;
begin
  select * into b from public.bookings where id=new.booking_id for update;
  if not found or b.deposit_collection_model<>'authorization' or b.deposit<=0 or new.is_claim_authorization
    or b.status not in ('requested','pending_payment') then return new;end if;
  v_paid:=exists(select 1 from public.payments where booking_id=b.id and status='succeeded');
  if new.status='authorized' and new.authorized_amount>=b.deposit and new.capture_before>clock_timestamp() then
    if not v_paid then
      update public.bookings set confirmation_gate='awaiting_payment' where id=b.id;
      return new;
    end if;
    perform 1 from public.listings where id=b.listing_id for update;
    if b.auction_bid_id is not null then
      v_available:=coalesce(public.auction_has_capacity(b.listing_id,b.start_date,b.end_date,b.id),false);
    else
      v_available:=coalesce(public.listing_has_capacity(b.listing_id,b.start_date,b.end_date,b.quantity,b.id),false);
    end if;
    if v_available then
      update public.bookings set status='confirmed',confirmation_gate='confirmed' where id=b.id;
    else
      update public.bookings set confirmation_gate='availability_conflict' where id=b.id;
      select * into v_payment from public.payments where booking_id=b.id and status='succeeded' order by created_at desc limit 1;
      if found then
        insert into public.checkout_payment_exceptions(booking_id,checkout_session_id,payment_intent_id,amount,reason)
          values(b.id,v_payment.stripe_checkout_session_id,v_payment.stripe_payment_intent_id,v_payment.amount,
            'Payment and deposit authorization succeeded after the reserved inventory became unavailable.')
          on conflict(checkout_session_id) do nothing;
      end if;
    end if;
  elsif new.status='requires_action' then
    update public.bookings set confirmation_gate='authorization_action_required' where id=b.id;
  elsif new.status='failed' then
    update public.bookings set confirmation_gate='authorization_failed' where id=b.id;
  elsif new.status='expired' or (new.status='authorized' and new.capture_before<=clock_timestamp()) then
    update public.bookings set confirmation_gate='authorization_expired' where id=b.id;
  elsif new.status in ('setup_required','scheduled','authorizing') then
    update public.bookings set confirmation_gate='awaiting_authorization' where id=b.id;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_booking_confirmation_after_authorization() from public,anon,authenticated;
create trigger sync_booking_confirmation_after_authorization after insert or update on public.booking_deposit_authorizations
  for each row execute function public.sync_booking_confirmation_after_authorization();

notify pgrst,'reload schema';
commit;