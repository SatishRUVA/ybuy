import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'An active signed-in session is required' }, 401);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key || !anonKey || !serviceKey) return json({ error: 'Refund processing is not configured' }, 503);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  const { data: active, error: activeError } = await caller.rpc('has_active_session');
  if (authError || !user || activeError || active !== true) {
    return json({ error: 'An active signed-in session is required' }, 401);
  }

  let input: { refundCaseId?: unknown };
  try { input = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (typeof input?.refundCaseId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.refundCaseId)) {
    return json({ error: 'A valid refund case ID is required' }, 400);
  }

  try {
    const { data: claim, error: claimError } = await caller.rpc('begin_cancellation_refund_processing', {
      p_refund_case_id: input.refundCaseId,
    });
    if (claimError) throw new Error(claimError.message);
    if (!claim || typeof claim.payment_intent_id !== 'string' || typeof claim.booking_id !== 'string'
      || typeof claim.case_id !== 'string' || typeof claim.amount !== 'number'
      || typeof claim.currency !== 'string' || typeof claim.attempt !== 'number') {
      throw new Error('The approved refund case is missing verified payment details');
    }

    const stripe = new Stripe(key);
    const admin = createClient(url, serviceKey);
    const recordProviderFailure = async (code: string, details: Record<string, unknown>) => {
      const { error } = await admin.rpc('record_cancellation_refund_provider_error', {
        p_refund_case_id: claim.case_id,
        p_attempt: claim.attempt,
        p_error_code: code.slice(0, 100),
        p_provider_response: details,
      });
      if (error) throw new Error(error.message);
    };
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.retrieve(claim.payment_intent_id);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError
        && typeof error.statusCode === 'number'
        && error.statusCode >= 400 && error.statusCode < 500
        && ![409, 429].includes(error.statusCode)) {
        await recordProviderFailure(error.code ?? error.type ?? 'stripe_payment_lookup_rejected', {
          type: error.type,
          code: error.code,
          message: error.message.slice(0, 500),
          request_id: error.requestId,
          status_code: error.statusCode,
        });
      }
      throw error;
    }
    const testKey = /^(sk|rk)_test_/.test(key);
    if (intent.status !== 'succeeded' || intent.currency !== claim.currency
      || intent.amount_received - intent.amount_refunded < Math.round(claim.amount * 100)
      || intent.livemode === testKey) {
      await recordProviderFailure('payment_verification_failed', {
        payment_intent_id: intent.id,
        status: intent.status,
        currency: intent.currency,
        amount_received: intent.amount_received,
        amount_refunded: intent.amount_refunded,
        livemode: intent.livemode,
      });
      throw new Error('The original payment does not match the approved refund case');
    }

    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.create({
        payment_intent: intent.id,
        amount: Math.round(claim.amount * 100),
        metadata: {
          purpose: 'booking_cancellation',
          booking_id: claim.booking_id,
          refund_case_id: claim.case_id,
          refund_attempt: String(claim.attempt),
        },
      }, { idempotencyKey: `booking-cancellation-refund:${claim.case_id}:${claim.attempt}` });
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError
        && typeof error.statusCode === 'number'
        && error.statusCode >= 400 && error.statusCode < 500
        && ![409, 429].includes(error.statusCode)) {
        await recordProviderFailure(error.code ?? error.type ?? 'stripe_request_rejected', {
          type: error.type,
          code: error.code,
          message: error.message.slice(0, 500),
          request_id: error.requestId,
          status_code: error.statusCode,
        });
      }
      throw error;
    }

    const providerStatus = refund.status === 'succeeded' ? 'succeeded'
      : refund.status === 'failed' ? 'failed'
        : refund.status === 'canceled' ? 'canceled' : 'pending';
    const { data: result, error: recordError } = await admin.rpc('record_cancellation_refund_provider_result', {
      p_refund_case_id: claim.case_id,
      p_provider_refund_id: refund.id,
      p_provider_status: providerStatus,
      p_amount: refund.amount / 100,
      p_currency: refund.currency.toLowerCase(),
      p_payment_intent_id: typeof refund.payment_intent === 'string' ? refund.payment_intent : intent.id,
      p_attempt: claim.attempt,
      p_provider_response: {
        id: refund.id,
        status: refund.status,
        amount: refund.amount,
        currency: refund.currency,
        livemode: refund.livemode,
      },
    });
    if (recordError) throw new Error(recordError.message);
    return json({ refundCase: result });
  } catch (error) {
    console.error('Cancellation refund processing failed', input.refundCaseId,
      error instanceof Error ? error.message : error);
    return json({
      error: 'Refund processing could not be confirmed. The case remains available for safe reconciliation or retry.',
    }, 502);
  }
}));
