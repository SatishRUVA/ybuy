// Verifies Stripe webhook signatures and is the ONLY writer of payment/booking-confirmation
// status (§11) - a frontend "success" redirect is never trusted on its own.
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing stripe-signature header', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingId = session.metadata?.booking_id;
    if (!bookingId) {
      console.error('checkout.session.completed missing booking_id metadata', session.id);
      return new Response('ok', { status: 200 });
    }

    const { error } = await supabaseAdmin.rpc('confirm_booking_payment', {
      p_booking_id: bookingId,
      p_checkout_session_id: session.id,
      p_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      p_amount: (session.amount_total ?? 0) / 100,
    });

    if (error) {
      // Already-confirmed/duplicate deliveries land here too (Stripe retries webhooks) - log and
      // still return 200 so Stripe doesn't keep retrying a booking that's already settled.
      console.error('confirm_booking_payment failed', bookingId, error.message);
    }
  }

  return new Response('ok', { status: 200 });
});
