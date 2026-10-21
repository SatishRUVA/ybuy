begin;
alter table public.bookings add column checkout_expires_at timestamptz,
  add column checkout_expired_at timestamptz,
  add column checkout_session_closed_at timestamptz,
  add column checkout_session_id text unique;
update public.bookings set checkout_expires_at=now()+interval '15 minutes' where status='pending_payment';
create index bookings_checkout_expiry_idx on public.bookings(checkout_expires_at) where status='pending_payment';

create function public.set_checkout_deadline()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status='pending_payment' and (tg_op='INSERT' or old.status<>'pending_payment') then
    new.checkout_expires_at:=clock_timestamp()+interval '15 minutes';
    new.checkout_expired_at:=null;
  end if;
  return new;
end;
$$;
create trigger bookings_checkout_deadline before insert or update on public.bookings
  for each row execute function public.set_checkout_deadline();

create function public.expire_listing_checkouts(p_listing_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform 1 from public.listings where id=p_listing_id for update;
  update public.bookings set status='cancelled',checkout_expired_at=clock_timestamp()
    where listing_id=p_listing_id and status='pending_payment' and checkout_expires_at<=clock_timestamp();
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.expire_listing_checkouts(uuid) from public,anon,authenticated;

create function public.expire_checkout_reservations()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_listing record; v_count integer:=0;
begin
  for v_listing in select l.id from public.listings l where exists(
    select 1 from public.bookings b where b.listing_id=l.id and b.status='pending_payment' and b.checkout_expires_at<=clock_timestamp()
  ) order by l.id limit 100 for update of l skip locked loop
    v_count:=v_count+public.expire_listing_checkouts(v_listing.id);
  end loop;
  return v_count;
end;
$$;
revoke all on function public.expire_checkout_reservations() from public,anon,authenticated;
grant execute on function public.expire_checkout_reservations() to service_role;
select cron.schedule('expire-checkout-reservations','* * * * *',$$select public.expire_checkout_reservations();$$);

alter function public.create_booking_request(uuid,date,date,integer) rename to create_booking_request_before_reservations;
revoke all on function public.create_booking_request_before_reservations(uuid,date,date,integer) from public,anon,authenticated;
create function public.create_booking_request(p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer default 1)
returns public.bookings language plpgsql security definer set search_path = '' as $$
begin
  perform public.operations_require_session();
  if p_start_date is null or p_end_date is null or p_quantity is null or p_end_date-p_start_date>366 then
    raise exception 'Choose a complete rental period of at most 366 days and a valid quantity' using errcode='22023';
  end if;
  perform public.expire_listing_checkouts(p_listing_id);
  return public.create_booking_request_before_reservations(p_listing_id,p_start_date,p_end_date,p_quantity);
end;
$$;
revoke all on function public.create_booking_request(uuid,date,date,integer) from public,anon;
grant execute on function public.create_booking_request(uuid,date,date,integer) to authenticated;

alter function public.respond_to_booking_request(uuid,boolean) rename to respond_to_booking_request_before_reservations;
revoke all on function public.respond_to_booking_request_before_reservations(uuid,boolean) from public,anon,authenticated;
create function public.respond_to_booking_request(p_booking_id uuid,p_approve boolean)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_listing_id uuid;
begin
  perform public.operations_require_session();
  select listing_id into v_listing_id from public.bookings where id=p_booking_id and owner_id=auth.uid();
  if v_listing_id is null then raise exception 'Booking not found or not owned' using errcode='42501'; end if;
  perform public.expire_listing_checkouts(v_listing_id);
  return public.respond_to_booking_request_before_reservations(p_booking_id,p_approve);
end;
$$;
revoke all on function public.respond_to_booking_request(uuid,boolean) from public,anon;
grant execute on function public.respond_to_booking_request(uuid,boolean) to authenticated;

alter function public.respond_to_marketplace_offer(uuid,text,numeric,date,date,text) rename to respond_to_marketplace_offer_before_reservations;
revoke all on function public.respond_to_marketplace_offer_before_reservations(uuid,text,numeric,date,date,text) from public,anon,authenticated;
create function public.respond_to_marketplace_offer(p_negotiation_id uuid,p_action text,p_daily_rate numeric default null,
  p_start_date date default null,p_end_date date default null,p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing_id uuid;
begin
  perform public.operations_require_session();
  select listing_id into v_listing_id from public.marketplace_negotiations
    where id=p_negotiation_id and auth.uid() in (owner_id,renter_id);
  if v_listing_id is not null then perform public.expire_listing_checkouts(v_listing_id); end if;
  return public.respond_to_marketplace_offer_before_reservations(p_negotiation_id,p_action,p_daily_rate,p_start_date,p_end_date,p_message);
end;
$$;
revoke all on function public.respond_to_marketplace_offer(uuid,text,numeric,date,date,text) from public,anon;
grant execute on function public.respond_to_marketplace_offer(uuid,text,numeric,date,date,text) to authenticated;

create function public.get_checkout_reservation(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;
begin
  perform public.operations_require_session();
  select * into v_booking from public.bookings where id=p_booking_id and auth.uid() in (owner_id,renter_id);
  if not found then raise exception 'Booking not found' using errcode='42501'; end if;
  perform public.expire_listing_checkouts(v_booking.listing_id);
  select * into v_booking from public.bookings where id=p_booking_id;
  return jsonb_build_object('status',v_booking.status,'expires_at',v_booking.checkout_expires_at,
    'expired_at',v_booking.checkout_expired_at,'server_now',clock_timestamp());
end;
$$;
revoke all on function public.get_checkout_reservation(uuid) from public,anon;
grant execute on function public.get_checkout_reservation(uuid) to authenticated;

create function public.bind_checkout_session(p_booking_id uuid,p_session_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found or v_booking.status<>'pending_payment' or v_booking.checkout_expires_at<=clock_timestamp() then
    raise exception 'Checkout reservation has expired' using errcode='55000';
  end if;
  if coalesce(p_session_id,'') not like 'cs_%' or
    (v_booking.checkout_session_id is not null and v_booking.checkout_session_id<>p_session_id) then
    raise exception 'Conflicting checkout session' using errcode='23514';
  end if;
  update public.bookings set checkout_session_id=p_session_id where id=p_booking_id;
end;
$$;
revoke all on function public.bind_checkout_session(uuid,text) from public,anon,authenticated;
grant execute on function public.bind_checkout_session(uuid,text) to service_role;

create table public.checkout_payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  checkout_session_id text not null unique,
  payment_intent_id text not null unique,
  amount numeric(10,2) not null,
  currency text not null default 'usd',
  reason text not null,
  status text not null default 'needs_review' check(status in ('needs_review','resolved')),
  created_at timestamptz not null default now()
);
alter table public.checkout_payment_exceptions enable row level security;
revoke all on public.checkout_payment_exceptions from anon,authenticated;
grant select on public.checkout_payment_exceptions to authenticated;
create policy checkout_exception_participants on public.checkout_payment_exceptions for select to authenticated using (
  public.has_active_session() and (public.has_admin_permission('payments.view') or exists(
    select 1 from public.bookings b where b.id=booking_id and auth.uid() in (b.owner_id,b.renter_id))));

alter function public.confirm_booking_payment(uuid,text,text,numeric) rename to confirm_booking_payment_before_reservations;
revoke all on function public.confirm_booking_payment_before_reservations(uuid,text,text,numeric) from public,anon,authenticated,service_role;
create function public.confirm_booking_payment(p_booking_id uuid,p_checkout_session_id text,p_payment_intent_id text,p_amount numeric)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_listing public.listings; v_reason text; v_existing public.checkout_payment_exceptions;
begin
  select l.* into v_listing from public.listings l join public.bookings b on b.listing_id=l.id where b.id=p_booking_id for update of l;
  if not found then raise exception 'Booking not found'; end if;
  perform public.expire_listing_checkouts(v_listing.id);
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if p_amount is null or p_amount<>v_booking.total or p_amount<=0
    or coalesce(p_checkout_session_id,'') not like 'cs_%' or coalesce(p_payment_intent_id,'') not like 'pi_%'
    or (v_booking.checkout_session_id is not null and v_booking.checkout_session_id<>p_checkout_session_id) then
    raise exception 'Payment details do not match the booking' using errcode='23514';
  end if;
  select * into v_existing from public.checkout_payment_exceptions where checkout_session_id=p_checkout_session_id;
  if found then
    if v_existing.booking_id<>p_booking_id or v_existing.payment_intent_id<>p_payment_intent_id or v_existing.amount<>p_amount then
      raise exception 'Payment receipt conflicts with recorded exception' using errcode='23514';
    end if;
    return v_booking;
  end if;
  if exists(select 1 from public.payments where stripe_checkout_session_id=p_checkout_session_id) then
    return public.confirm_booking_payment_before_reservations(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount);
  end if;
  if v_booking.status not in ('pending_payment','cancelled') or
    (v_booking.status='cancelled' and v_booking.checkout_expired_at is null) then
    v_reason:='Payment arrived after this booking stopped awaiting payment.';
  elsif v_listing.status<>'published' then
    v_reason:='Payment arrived after the listing became unavailable.';
  elsif exists(select 1 from public.listing_availability a where a.listing_id=v_listing.id
    and not a.is_available and a.date>=v_booking.start_date and a.date<v_booking.end_date)
    or exists(select 1 from generate_series(v_booking.start_date::timestamp,(v_booking.end_date-1)::timestamp,interval '1 day') day
      where (select coalesce(sum(b.quantity),0) from public.bookings b where b.listing_id=v_listing.id and b.id<>p_booking_id
        and b.status in ('requested','pending_payment','confirmed','active','return_pending')
        and b.start_date<=day::date and b.end_date>day::date)+v_booking.quantity>v_listing.available_quantity) then
    v_reason:='Payment arrived after the reserved inventory was no longer available.';
  end if;
  if v_reason is not null then
    insert into public.checkout_payment_exceptions(booking_id,checkout_session_id,payment_intent_id,amount,reason)
      values(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount,v_reason);
    perform public.create_notification(v_booking.renter_id,'checkout-exception:'||p_checkout_session_id,'payments',
      'Payment requires support review','Your payment was received but could not confirm this booking. Do not pay again; contact support.','/confirmation/'||p_booking_id);
    return v_booking;
  end if;
  if v_booking.status='cancelled' and v_booking.checkout_expired_at is not null then
    -- A verified late payment can reclaim free inventory; it never displaces another reservation.
    if exists(select 1 from public.payments where booking_id=p_booking_id and status='succeeded') then
      raise exception 'Booking already has a successful payment' using errcode='23514';
    end if;
    insert into public.payments(booking_id,stripe_checkout_session_id,stripe_payment_intent_id,amount,status)
      values(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount,'succeeded');
    update public.bookings set status='confirmed' where id=p_booking_id returning * into v_booking;
    return v_booking;
  end if;
  return public.confirm_booking_payment_before_reservations(p_booking_id,p_checkout_session_id,p_payment_intent_id,p_amount);
end;
$$;
revoke all on function public.confirm_booking_payment(uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.confirm_booking_payment(uuid,text,text,numeric) to service_role;

create function public.admin_list_checkout_exceptions(p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_require('payments.view');
  return jsonb_build_object('total',(select count(*) from public.checkout_payment_exceptions),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from (
      select id,booking_id,payment_intent_id,amount,currency,reason,status,created_at from public.checkout_payment_exceptions
      order by created_at desc,id limit least(greatest(coalesce(p_limit,20),1),100) offset greatest(coalesce(p_offset,0),0)
    ) p),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_list_checkout_exceptions(integer,integer) from public,anon;
grant execute on function public.admin_list_checkout_exceptions(integer,integer) to authenticated;

create function public.process_expired_checkout_sessions()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='notification_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='notification_worker_secret';
  if v_url is null or v_secret is null then return null; end if;
  return net.http_post(url:=rtrim(v_url,'/')||'/functions/v1/expire-checkout-sessions',
    headers:=jsonb_build_object('Content-Type','application/json','x-notification-worker-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$$;
revoke all on function public.process_expired_checkout_sessions() from public,anon,authenticated;
grant execute on function public.process_expired_checkout_sessions() to service_role;
select cron.schedule('expire-stripe-checkout-sessions','* * * * *',$$select public.process_expired_checkout_sessions();$$);
revoke all on function public.set_checkout_deadline() from public,anon,authenticated;
commit;
