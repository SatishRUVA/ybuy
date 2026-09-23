-- YBuy Part 1 payments (§11): booking payment status is driven ONLY by a verified Stripe webhook
-- event, never by a client "success" callback. This function is callable only by the service
-- role (the stripe-webhook Edge Function) — no grant to `authenticated`.
create or replace function public.confirm_booking_payment(
  p_booking_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount numeric
) returns public.bookings
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
  if v_booking.status <> 'pending_payment' then
    raise exception 'booking is not awaiting payment';
  end if;

  insert into public.payments (booking_id, stripe_checkout_session_id, stripe_payment_intent_id, amount, status)
  values (p_booking_id, p_checkout_session_id, p_payment_intent_id, p_amount, 'succeeded')
  on conflict do nothing;

  update public.bookings set status = 'confirmed' where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

grant execute on function public.confirm_booking_payment(uuid, text, text, numeric) to service_role;
