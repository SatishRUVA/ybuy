// Verifies Stripe webhook signatures and is the ONLY writer of payment/booking-confirmation
// status (§11) - a frontend "success" redirect is never trusted on its own.
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { testRefundReceipt } from './refund-event.ts';

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripe = new Stripe(stripeKey);
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

  if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type) && !event.livemode) {
    if (!/^(sk|rk)_test_/.test(stripeKey)) {
      console.error('Test refund receipt rejected: test Stripe credentials required', event.id);
      return new Response('Test credentials required', { status: 503 });
    }
    try {
      const incoming = event.data.object as Stripe.Refund;
      if (incoming.metadata?.purpose === 'deposit') {
        const { data: settlement, error: settlementError } = await supabaseAdmin.from('rental_settlements')
          .select('booking_id,payment_id,deposit_amount').eq('booking_id', incoming.metadata.booking_id ?? '').single();
        if (settlementError) throw new Error(settlementError.message);
        const { data: payment, error: paymentError } = await supabaseAdmin.from('payments')
          .select('stripe_payment_intent_id').eq('id', settlement.payment_id).single();
        if (paymentError) throw new Error(paymentError.message);
        // Retrieve the latest provider state so out-of-order webhooks cannot regress success.
        const current = await stripe.refunds.retrieve(incoming.id);
        if (current.payment_intent !== payment.stripe_payment_intent_id || current.currency !== 'usd'
          || current.amount !== Math.round(Number(settlement.deposit_amount) * 100)) throw new Error('Deposit refund receipt mismatch');
        const status = current.status === 'succeeded' ? 'succeeded'
          : ['failed', 'canceled'].includes(current.status ?? '') ? 'failed' : 'processing';
        const { error } = await supabaseAdmin.rpc('record_rental_settlement', {
          p_booking_id: settlement.booking_id, p_step: 'refund', p_provider_id: current.id, p_status: status,
        });
        if (error) throw new Error(error.message);
        return new Response('ok', { status: 200 });
      }
      const receipt = testRefundReceipt(event);
      if (!receipt) throw new Error('Expected a test refund receipt');
      const { error } = await supabaseAdmin.rpc('reconcile_test_refund_event', receipt);
      if (error) throw new Error(error.message);
    } catch (error) {
      console.error('Refund receipt reconciliation failed', event.id, error instanceof Error ? error.message : error);
      return new Response('Refund receipt not reconciled', { status: 500 });
    }
  }

  if (['transfer.updated', 'transfer.reversed'].includes(event.type) && !event.livemode) {
    try {
      if (!/^(sk|rk)_test_/.test(stripeKey)) throw new Error('Test Stripe credentials required');
      const incoming = event.data.object as Stripe.Transfer;
      if (incoming.metadata?.purpose === 'owner_earnings') {
        const current = await stripe.transfers.retrieve(incoming.id);
        const { data: settlement, error: settlementError } = await supabaseAdmin.from('rental_settlements')
          .select('booking_id,owner_amount,destination_account').eq('transfer_id', current.id).single();
        if (settlementError) throw new Error(settlementError.message);
        if (current.livemode || current.destination !== settlement.destination_account || current.currency !== 'usd'
          || current.amount !== Math.round(Number(settlement.owner_amount) * 100)) throw new Error('Owner transfer receipt mismatch');
        const { error } = await supabaseAdmin.rpc('record_rental_settlement', {
          p_booking_id: settlement.booking_id, p_step: 'transfer', p_provider_id: current.id,
          p_status: current.reversed || current.amount_reversed > 0 ? 'reversed' : 'succeeded',
        });
        if (error) throw new Error(error.message);
      }
    } catch (error) {
      console.error('Transfer receipt reconciliation failed', event.id, error instanceof Error ? error.message : error);
      return new Response('Transfer receipt not reconciled', { status: 500 });
    }
  }

  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== 'paid') return new Response('Payment not yet settled', { status: 200 });
    const bookingId = session.metadata?.booking_id;
    if (!bookingId || session.currency !== 'usd' || typeof session.payment_intent !== 'string') {
      console.error('Checkout payment receipt is incomplete', session.id);
      return new Response('Incomplete payment receipt', { status: 400 });
    }
    try {
      const intent = await stripe.paymentIntents.retrieve(session.payment_intent);
      if (intent.status !== 'succeeded' || intent.amount_received !== session.amount_total
        || intent.currency !== session.currency || intent.livemode !== event.livemode) {
        throw new Error('Checkout and payment intent do not match');
      }
    } catch (error) {
      console.error('Payment intent verification failed', session.id, error instanceof Error ? error.message : error);
      return new Response('Payment not verified', { status: 500 });
    }

    const { error } = await supabaseAdmin.rpc('confirm_booking_payment', {
      p_booking_id: bookingId,
      p_checkout_session_id: session.id,
      p_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      p_amount: (session.amount_total ?? 0) / 100,
    });

    if (error) {
      console.error('confirm_booking_payment failed', bookingId, error.message);
      return new Response('Payment not reconciled', { status: 500 });
    }
  }

  return new Response('ok', { status: 200 });
});
