// Creates a Stripe Checkout Session for a booking that's awaiting payment (§11). Runs with the
// service role so it can read/write across users, but every check below is still explicit -
// never trust the caller's claimed booking ownership.
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { trustedOrigin, withCors } from '../_shared/cors.ts';
import { moneyToCents } from '../_shared/checkout-pricing.ts';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripe = new Stripe(stripeSecret);

export function checkoutAmountCents(booking: { total: unknown; sandbox_tax?: boolean; tax_amount?: unknown; tax_rate?: unknown }, secret: string): number {
  if (booking.sandbox_tax === true
    && !/^(sk_test_|rk_test_)/.test(secret)) {
    throw new Error('Sandbox tax bookings require a Stripe test-mode key');
  }
  if (typeof booking.total !== 'string' && typeof booking.total !== 'number') {
    throw new Error('Booking total must be a positive safe integer amount in cents');
  }
  const cents = moneyToCents(booking.total);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error('Booking total must be a positive safe integer amount in cents');
  }
  return cents;
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Not signed in' }, 401);

    const { data: activeSession, error: sessionError } = await supabase.rpc('has_active_session');
    // PGRST202 = migration 20261018000001 is not applied yet; getUser() above already rejects revoked tokens.
    if (sessionError && sessionError.code !== 'PGRST202') {
      console.error('Session verification failed', sessionError.message);
      return json({ error: 'Could not verify your session. Please try again.' }, 503);
    }
    if (!sessionError && activeSession !== true) return json({ error: 'Your session has expired. Please sign in again.' }, 401);

    const { bookingId } = await req.json();
    if (!bookingId || typeof bookingId !== 'string') return json({ error: 'bookingId is required' }, 400);

    // RLS on `bookings` already restricts this select to participants, but we still explicitly
    // re-check renter_id + status server-side before ever creating a charge.
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*, listing:listings(title)')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) return json({ error: 'Booking not found' }, 404);
    if (booking.renter_id !== userData.user.id) return json({ error: 'Only the renter can pay for this booking' }, 403);
    const amountCents = checkoutAmountCents(booking, stripeSecret);
    let stripeCustomerId: string | undefined;
    if (!booking.payment_first && booking.deposit_collection_model === 'authorization' && Number(booking.deposit) > 0) {
      if (!booking.deposit_hold_consent_at) return json({ error: 'Security-deposit consent is required before payment.' }, 409);
      const { data: savedCustomer, error: savedCustomerError } = await supabase.from('renter_stripe_customers')
        .select('stripe_customer_id,default_payment_method_id').eq('renter_id', userData.user.id).maybeSingle();
      const { data: depositAuthorization, error: authorizationError } = await supabase.from('booking_deposit_authorizations')
        .select('status,stripe_payment_method_id,authorized_amount,capture_before,is_claim_authorization')
        .eq('booking_id', bookingId).order('attempt', { ascending: false }).limit(1).maybeSingle();
      if (savedCustomerError || authorizationError) {
        console.error('Deposit setup verification failed', savedCustomerError?.message ?? authorizationError?.message);
        return json({ error: 'Could not verify saved deposit payment details. Retry setup before paying.' }, 503);
      }
      if (!savedCustomer?.default_payment_method_id || !depositAuthorization?.stripe_payment_method_id
        || depositAuthorization.status !== 'authorized' || depositAuthorization.is_claim_authorization
        || Number(depositAuthorization.authorized_amount) < Number(booking.deposit)
        || !depositAuthorization.capture_before || Date.parse(depositAuthorization.capture_before) <= Date.now()) {
        return json({ error: 'Authorize the security deposit before paying the rental total.' }, 409);
      }
      stripeCustomerId = savedCustomer.stripe_customer_id;
    }
    const { data: reservation,error: reservationError } = await supabase.rpc('get_checkout_reservation', { p_booking_id: bookingId });
    if (reservationError) {
      console.error('Checkout reservation check failed',reservationError.message);
      return json({ error: 'Could not verify the checkout reservation. Please retry.' },503);
    }
    if (reservation.status !== 'pending_payment' || !reservation.expires_at
      || Date.parse(reservation.expires_at)<=Date.parse(reservation.server_now)) {
      return json({ error: 'This checkout reservation has expired. Request the item again before paying.' },409);
    }

    // Stripe's return URLs must come from the allowlist, never from an arbitrary request origin.
    const appOrigin = trustedOrigin(req);
    const listingTitle = (booking.listing as unknown as { title: string } | null)?.title ?? 'Rental';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: { name: listingTitle },
        },
        quantity: 1,
      }],
      metadata: { booking_id: booking.id, purpose: 'booking_payment' },
      payment_intent_data: { metadata: { booking_id: booking.id, purpose: 'booking_payment' } },
      success_url: `${appOrigin}/confirmation/${booking.id}`,
      cancel_url: `${appOrigin}/confirmation/${booking.id}`,
    }, { idempotencyKey: `checkout:${booking.id}:v1` });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const bound = await admin.rpc('bind_checkout_session', { p_booking_id: bookingId,p_session_id: session.id });
    if (bound.error) {
      if (session.status==='open') await stripe.checkout.sessions.expire(session.id);
      console.error('Checkout session binding failed',bound.error.message);
      return json({ error: 'Your checkout reservation changed or expired. Refresh your booking before paying.' },409);
    }
    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error', err);
    return json({ error: 'Could not create checkout session' }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
