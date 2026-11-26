import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';
import { processDeliveryRefund, type Claim, type Refund } from './refund.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'An active signed-in session is required' }, 401);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service || !/^(sk|rk)_(test|live)_/.test(key)) {
    return json({ error: 'Refund processing is not configured' }, 503);
  }
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  const { data: active, error: activeError } = await caller.rpc('has_active_session');
  if (authError || !user || activeError || active !== true) return json({ error: 'An active signed-in session is required' }, 401);
  let input: { claimId?: unknown };
  try { input = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (typeof input?.claimId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.claimId)) {
    return json({ error: 'A valid claim ID is required' }, 400);
  }
  const { data: claim, error } = await caller.rpc('begin_delivery_handoff_refund', { p_claim_id: input.claimId });
  if (error) return json({ error: 'Claim is not authorized or requires support reconciliation' }, 409);
  if (claim?.status === 'refunded') return json({ status: 'refunded' });
  if (claim?.status !== 'processing') return json({ status: 'reconciliation' }, 409);
  const stripe = new Stripe(key);
  const admin = createClient(url, service);
  const normalize = (refund: Stripe.Refund): Refund => ({
    id: refund.id, payment_intent: typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null,
    amount: refund.amount, currency: refund.currency, status: refund.status, livemode: refund.livemode, metadata: refund.metadata ?? {},
  });
  const flagReconciliation = async (reason: string) => {
    const { error: flagError } = await admin.rpc('flag_delivery_handoff_refund_reconciliation', {
      p_claim_id: claim.case_id, p_reason: reason,
    });
    if (flagError) throw new Error(flagError.message);
  };
  let outcome = 'processing';
  try {
    await processDeliveryRefund(claim as Claim, {
      async intent(id) {
        const intent = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] });
        const charge = intent.latest_charge;
        return { ...intent, latest_charge: charge && typeof charge !== 'string'
          ? { id: charge.id, amount_refunded: charge.amount_refunded, disputed: charge.disputed } : null };
      },
      async refunds(id) {
        const result = await stripe.refunds.list({ payment_intent: id, limit: 100 });
        if (result.has_more) throw new Error('Refund list requires reconciliation');
        return result.data.map(normalize);
      },
      async noTransfer(charge, bookingId) {
        let startingAfter: string | undefined;
        for (let page = 0; page < 10; page++) {
          const result = await stripe.transfers.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
          if (result.data.some((transfer) =>
            (typeof transfer.source_transaction === 'string' ? transfer.source_transaction : transfer.source_transaction?.id) === charge
            || transfer.metadata?.booking_id === bookingId)) return false;
          if (!result.has_more) return true;
          startingAfter = result.data.at(-1)?.id;
          if (!startingAfter) break;
        }
        await flagReconciliation('Transfer history is too large to verify automatically');
        throw new Error('Transfer history requires support reconciliation');
      },
      flag: flagReconciliation,
      async create(id, amount, idempotencyKey) {
        return normalize(await stripe.refunds.create({ payment_intent: id, amount, metadata: {
          purpose: 'delivery_handoff', booking_id: claim.booking_id, claim_id: claim.case_id,
        } }, { idempotencyKey }));
      },
      async record(refund) {
        const status = refund.status === 'succeeded' ? 'succeeded'
          : refund.status === 'failed' ? 'failed' : refund.status === 'canceled' ? 'canceled' : 'pending';
        const { error: recordError } = await admin.rpc('record_delivery_handoff_refund', {
          p_claim_id: claim.case_id, p_refund_id: refund.id, p_status: status, p_amount: refund.amount / 100,
          p_currency: refund.currency, p_payment_intent_id: refund.payment_intent,
        });
        if (recordError) throw new Error(recordError.message);
        outcome = status === 'succeeded' ? 'refunded' : status === 'pending' ? 'processing' : 'reconciliation';
      },
    }, /^(sk|rk)_live_/.test(key));
    return json({ status: outcome }, outcome === 'refunded' ? 200 : 202);
  } catch (error) {
    console.error('Delivery refund requires reconciliation or retry', input.claimId, error instanceof Error ? error.message : error);
    return json({ error: 'Refund could not be confirmed; retry safely or contact support for reconciliation.' }, 502);
  }
}));
