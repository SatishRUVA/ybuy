-- YBuy Part 1 booking state machine (§3.9): all writes to public.bookings go through these
-- SECURITY DEFINER functions so availability/pricing are validated/recomputed server-side inside
-- a single transaction (row lock on the listing prevents double-booking), and invalid state
-- transitions are rejected. Clients never UPDATE bookings directly.

-- Direct client updates would let a participant set status to anything (e.g. jump straight to
-- 'completed'), bypassing the state machine. Only the functions below may mutate booking rows.
drop policy if exists "bookings_update_participant" on public.bookings;

create or replace function public.create_booking_request(
  p_listing_id uuid,
  p_start_date date,
  p_end_date date,
  p_quantity int default 1
) returns public.bookings
language plpgsql
security definer set search_path = public
as $$
declare
  v_listing public.listings;
  v_days int;
  v_service_fee_pct constant numeric(5,4) := 0.10; -- Part 1: fixed 10% platform fee
  v_subtotal numeric(10,2);
  v_service_fee numeric(10,2);
  v_total numeric(10,2);
  v_booking public.bookings;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  if p_quantity < 1 then
    raise exception 'quantity must be at least 1';
  end if;

  if p_end_date <= p_start_date then
    raise exception 'end date must be after start date';
  end if;

  -- Row lock serializes concurrent booking attempts against the same listing.
  select * into v_listing from public.listings where id = p_listing_id and status = 'published' for update;
  if not found then
    raise exception 'listing not found or not published';
  end if;

  if v_listing.owner_id = auth.uid() then
    raise exception 'cannot book your own listing';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.listing_id = p_listing_id
      and b.status in ('requested', 'pending_payment', 'confirmed', 'active', 'return_pending')
      and b.start_date < p_end_date
      and b.end_date > p_start_date
  ) then
    raise exception 'listing is not available for the selected dates';
  end if;

  if exists (
    select 1 from public.listing_availability a
    where a.listing_id = p_listing_id
      and a.date >= p_start_date and a.date < p_end_date
      and a.is_available = false
  ) then
    raise exception 'listing is not available for the selected dates';
  end if;

  v_days := p_end_date - p_start_date;
  v_subtotal := v_listing.price_per_day * v_days * p_quantity;
  v_service_fee := round(v_subtotal * v_service_fee_pct, 2);
  v_total := v_subtotal + v_service_fee + v_listing.deposit;

  insert into public.bookings (
    listing_id, renter_id, owner_id, start_date, end_date, quantity,
    status, daily_rate, days, subtotal, service_fee_pct, service_fee_amount, deposit, total
  ) values (
    p_listing_id, auth.uid(), v_listing.owner_id, p_start_date, p_end_date, p_quantity,
    'requested', v_listing.price_per_day, v_days, v_subtotal, v_service_fee_pct, v_service_fee, v_listing.deposit, v_total
  ) returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function public.create_booking_request(uuid, date, date, int) to authenticated;

create or replace function public.respond_to_booking_request(p_booking_id uuid, p_approve boolean)
returns public.bookings
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if v_booking.owner_id <> auth.uid() then
    raise exception 'only the listing owner can respond to this request';
  end if;
  if v_booking.status <> 'requested' then
    raise exception 'booking is not awaiting a response';
  end if;

  update public.bookings
    set status = case when p_approve then 'pending_payment' else 'rejected' end
    where id = p_booking_id
    returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function public.respond_to_booking_request(uuid, boolean) to authenticated;

create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if v_booking.renter_id <> auth.uid() and v_booking.owner_id <> auth.uid() then
    raise exception 'not a participant in this booking';
  end if;
  if v_booking.status not in ('requested', 'pending_payment', 'confirmed') then
    raise exception 'booking can no longer be cancelled';
  end if;

  update public.bookings set status = 'cancelled' where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

grant execute on function public.cancel_booking(uuid) to authenticated;

-- Handoff/return steps are single-tap by whichever participant is physically present (Part 1 has
-- no separate two-sided confirmation flow) — either the renter or the owner may call these.
create or replace function public.mark_booking_active(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking not found'; end if;
  if v_booking.renter_id <> auth.uid() and v_booking.owner_id <> auth.uid() then
    raise exception 'not a participant in this booking';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'booking must be confirmed before check-in';
  end if;

  update public.bookings set status = 'active' where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

grant execute on function public.mark_booking_active(uuid) to authenticated;

create or replace function public.start_booking_return(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking not found'; end if;
  if v_booking.renter_id <> auth.uid() and v_booking.owner_id <> auth.uid() then
    raise exception 'not a participant in this booking';
  end if;
  if v_booking.status <> 'active' then
    raise exception 'booking must be active to start a return';
  end if;

  update public.bookings set status = 'return_pending' where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

grant execute on function public.start_booking_return(uuid) to authenticated;

create or replace function public.complete_booking_return(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking not found'; end if;
  if v_booking.renter_id <> auth.uid() and v_booking.owner_id <> auth.uid() then
    raise exception 'not a participant in this booking';
  end if;
  if v_booking.status <> 'return_pending' then
    raise exception 'booking must be in return_pending to complete';
  end if;

  update public.bookings set status = 'completed' where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

grant execute on function public.complete_booking_return(uuid) to authenticated;
