// Creates a Stripe Checkout Session for a booking that's awaiting payment (§11). Runs with the
// service role so it can read/write across users, but every check below is still explicit -
// never trust the caller's claimed booking ownership.
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { trustedOrigin, withCors } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

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
      .select('id, renter_id, status, total, listing:listings(title)')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) return json({ error: 'Booking not found' }, 404);
    if (booking.renter_id !== userData.user.id) return json({ error: 'Only the renter can pay for this booking' }, 403);
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
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(Number(booking.total) * 100),
          product_data: { name: listingTitle },
        },
        quantity: 1,
      }],
      metadata: { booking_id: booking.id },
      payment_intent_data: { metadata: { booking_id: booking.id } },
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
