// Creates a Stripe Checkout Session for a booking that's awaiting payment (§11). Runs with the
// service role so it can read/write across users, but every check below is still explicit —
// never trust the caller's claimed booking ownership.
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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
    if (booking.status !== 'pending_payment') return json({ error: 'Booking is not awaiting payment' }, 409);

    const appOrigin = Deno.env.get('APP_ORIGIN') ?? req.headers.get('origin') ?? '';
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
      success_url: `${appOrigin}/confirmation/${booking.id}`,
      cancel_url: `${appOrigin}/confirmation/${booking.id}`,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error', err);
    return json({ error: 'Could not create checkout session' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
