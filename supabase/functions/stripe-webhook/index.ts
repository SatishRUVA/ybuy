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

  if (event.type === 'checkout.session.completed') {
    const setupSession = event.data.object as Stripe.Checkout.Session;
    if (setupSession.mode === 'setup' && setupSession.metadata?.purpose === 'security_deposit_setup') {
      const setupIntentId = typeof setupSession.setup_intent === 'string' ? setupSession.setup_intent : null;
      const customerId = typeof setupSession.customer === 'string' ? setupSession.customer : setupSession.customer?.id ?? null;
      if (setupSession.status !== 'complete' || !setupSession.metadata.booking_id || !setupIntentId || !customerId) {
        return new Response('Incomplete deposit setup receipt', { status: 400 });
      }
      try {
        const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
        const paymentMethodId = typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method : setupIntent.payment_method?.id ?? null;
        if (setupIntent.status !== 'succeeded' || setupIntent.livemode !== event.livemode
          || setupIntent.customer !== customerId || !paymentMethodId
          || setupIntent.metadata.booking_id !== setupSession.metadata.booking_id
          || setupIntent.metadata.purpose !== 'security_deposit_setup') {
          throw new Error('SetupIntent does not match the Checkout Session');
        }
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        }, { idempotencyKey: `deposit-default-pm:${setupSession.metadata.booking_id}:${paymentMethodId}` });
        const { error } = await supabaseAdmin.rpc('complete_booking_deposit_setup', {
          p_booking_id: setupSession.metadata.booking_id,
          p_setup_intent_id: setupIntent.id,
          p_checkout_session_id: setupSession.id,
          p_customer_id: customerId,
          p_payment_method_id: paymentMethodId,
        });
        if (error) throw new Error(error.message);
      } catch (error) {
        console.error('Deposit SetupIntent reconciliation failed', setupSession.id, error instanceof Error ? error.message : error);
        return new Response('Deposit setup not reconciled', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    }
  }

  if (['payment_intent.amount_capturable_updated','payment_intent.succeeded','payment_intent.canceled',
    'payment_intent.payment_failed','payment_intent.requires_action'].includes(event.type)) {
    const incoming = event.data.object as Stripe.PaymentIntent;
    if (incoming.metadata?.purpose === 'security_deposit_authorization') {
      try {
        const intent = await stripe.paymentIntents.retrieve(incoming.id, { expand: ['latest_charge'] });
        if (intent.livemode !== event.livemode || !intent.metadata.booking_id || !intent.metadata.deposit_authorization_id
          || intent.capture_method !== 'manual') throw new Error('Deposit PaymentIntent metadata or capture mode is invalid');
        const latestCharge = typeof intent.latest_charge === 'string' ? null : intent.latest_charge;
        const paymentMethodId = typeof intent.payment_method === 'string'
          ? intent.payment_method : intent.payment_method?.id ?? null;
        const cardDetails = latestCharge?.payment_method_details?.card;
        const captureBefore = cardDetails && 'capture_before' in cardDetails
          ? Number(cardDetails.capture_before) : null;
        const { error } = await supabaseAdmin.rpc('record_deposit_authorization_event', {
          p_event_id: event.id,
          p_event_type: event.type,
          p_authorization_id: intent.metadata.deposit_authorization_id,
          p_booking_id: intent.metadata.booking_id,
          p_payment_intent_id: intent.id,
          p_payment_intent_status: intent.status,
          p_payment_method_id: paymentMethodId,
          p_amount: intent.amount / 100,
          p_captured_amount: intent.amount_received / 100,
          p_amount_capturable: intent.amount_capturable / 100,
          p_capture_before: captureBefore && Number.isFinite(captureBefore) ? new Date(captureBefore * 1000).toISOString() : null,
          p_failure_reason: intent.last_payment_error?.message ?? null,
        });
        if (error) throw new Error(error.message);
        if (event.type === 'payment_intent.amount_capturable_updated') {
          const { data: authorizationRow, error: authorizationRowError } = await supabaseAdmin
            .from('booking_deposit_authorizations').select('supersedes_authorization_id,is_claim_authorization')
            .eq('id', intent.metadata.deposit_authorization_id).single();
          if (authorizationRowError) throw new Error(authorizationRowError.message);
          if (authorizationRow.is_claim_authorization) {
            const { data: claim, error: claimError } = await supabaseAdmin.from('booking_deposit_claims')
              .select('id,status,approved_amount').eq('authorization_id',intent.metadata.deposit_authorization_id).maybeSingle();
            if (claimError) throw new Error(claimError.message);
            if (claim && ['approved','payment_required'].includes(claim.status) && Number(claim.approved_amount)>0) {
              const captureCents=Math.round(Number(claim.approved_amount)*100);
              if (!Number.isSafeInteger(captureCents) || captureCents>intent.amount_capturable) {
                throw new Error('Approved deposit deduction exceeds the live authorization amount');
              }
              const { error: claimStateError }=await supabaseAdmin.from('booking_deposit_claims')
                .update({status:'capturing',failure_reason:null}).eq('id',claim.id).in('status',['approved','payment_required']);
              if (claimStateError) throw new Error(claimStateError.message);
              const captured=await stripe.paymentIntents.capture(intent.id,{amount_to_capture:captureCents},
                {idempotencyKey:`deposit-claim:${claim.id}:v1`});
              if (captured.status!=='succeeded' || captured.amount_received!==captureCents || captured.livemode!==event.livemode) {
                throw new Error('Stripe did not confirm the approved deposit deduction');
              }
            }
          }
          if (authorizationRow.supersedes_authorization_id) {
            const { data: previous } = await supabaseAdmin.from('booking_deposit_authorizations')
              .select('stripe_payment_intent_id,status').eq('id', authorizationRow.supersedes_authorization_id).maybeSingle();
            if (previous?.status === 'authorized' && previous.stripe_payment_intent_id) {
              const oldIntent = await stripe.paymentIntents.retrieve(previous.stripe_payment_intent_id);
              if (oldIntent.status === 'requires_capture') await stripe.paymentIntents.cancel(oldIntent.id);
            }
          }
        }
      } catch (error) {
        console.error('Deposit PaymentIntent reconciliation failed', event.id, error instanceof Error ? error.message : error);
        return new Response('Deposit authorization not reconciled', { status: 500 });
      }
      return new Response('ok', { status: 200 });
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
