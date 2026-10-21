import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { trustedOrigin, withCors } from '../_shared/cors.ts';
import { requireTestSettlement, sameWorkerSecret, settleRental, type Settlement } from './settlement.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  try { requireTestSettlement(key, url, Deno.env.get('SETTLEMENT_TEST_MODE')); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Settlement disabled' }, 503); }
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const stripe = new Stripe(key);
  const workerSecret = req.headers.get('x-settlement-worker-secret');
  if (workerSecret !== null) {
    if (!await sameWorkerSecret(workerSecret, Deno.env.get('SETTLEMENT_WORKER_SECRET'))) return json({ error: 'Invalid worker authorization' }, 401);
    const { data: jobs, error } = await admin.from('rental_settlements')
      .select('booking_id').not('refund_status', 'eq', 'failed').not('transfer_status', 'in', '(succeeded,reversed)')
      .or(`last_attempt_at.is.null,last_attempt_at.lt.${new Date(Date.now() - 60000).toISOString()}`)
      .order('last_attempt_at', { ascending: true, nullsFirst: true }).limit(5);
    if (error) { console.error('Settlement queue unavailable', error.message); return json({ error: 'Settlement queue unavailable' }, 503); }
    let succeeded = 0;
    let failed = 0;
    for (const job of jobs ?? []) {
      try {
        const { data: booking, error: bookingError } = await admin.from('bookings').select('owner_id').eq('id', job.booking_id).single();
        if (bookingError) throw bookingError;
        await processBooking(admin, stripe, job.booking_id, booking.owner_id);
        succeeded++;
      } catch (error) {
        console.error('Queued rental settlement failed', job.booking_id, error instanceof Error ? error.message : error);
        failed++;
      }
    }
    return json({ succeeded, failed });
  }
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  const { data: active, error: activeError } = await caller.rpc('has_active_session');
  if (authError || !user || activeError || active !== true) return json({ error: 'An active signed-in session is required' }, 401);
  let input: { action?: string; bookingId?: string };
  try { input = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!input || !['onboard', 'settle'].includes(input.action ?? '')) return json({ error: 'Invalid action' }, 400);
  async function connectRequest(path: string, body: unknown, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const response = await fetch(`https://api.stripe.com/v2/core/${path}`, {
      method: 'POST', headers: {
        Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Stripe-Version': '2026-09-30.endive',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Stripe Connect response');
    if (!response.ok) {
      const error = 'error' in payload ? payload.error : null;
      throw new Error(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'Stripe Connect request failed');
    }
    if (!('livemode' in payload) || payload.livemode !== false) throw new Error('Expected a Stripe test-mode Connect response');
    return payload as Record<string, unknown>;
  }
  try {
    if (input.action === 'onboard') {
      const origin = trustedOrigin(req);
      if (!Deno.env.get('APP_ORIGIN') || !/^https?:\/\//.test(origin)) throw new Error('Trusted application origin is not configured');
      const { data: existing, error } = await admin.from('owner_connect_accounts')
        .select('stripe_account_id').eq('owner_id', user.id).maybeSingle();
      if (error) throw error;
      let accountId = existing?.stripe_account_id;
      if (!accountId) {
        if (!user.email) throw new Error('A verified account email is required for Stripe Connect');
        const account = await connectRequest('accounts', {
          contact_email: user.email,
          dashboard: 'express', identity: { country: 'us' },
          configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
          defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
          metadata: { ybuy_owner_id: user.id },
        }, `connect:${user.id}:v2`);
        if (typeof account.id !== 'string' || !account.id.startsWith('acct_')) throw new Error('Invalid Stripe Connect account ID');
        accountId = account.id;
        const { error: insertError } = await admin.from('owner_connect_accounts')
          .upsert({ owner_id: user.id, stripe_account_id: accountId }, { onConflict: 'owner_id', ignoreDuplicates: true });
        if (insertError) throw insertError;
        const { data: bound, error: boundError } = await admin.from('owner_connect_accounts')
          .select('stripe_account_id').eq('owner_id', user.id).single();
        if (boundError || bound.stripe_account_id !== accountId) throw new Error('Connect account binding conflict; contact support');
      }
      const account = await stripe.accounts.retrieve(accountId);
      if (account.metadata?.ybuy_owner_id !== user.id) throw new Error('Connect account owner does not match');
      const link = await connectRequest('account_links', {
        account: accountId, use_case: { type: 'account_onboarding', account_onboarding: {
          refresh_url: `${origin}/dashboard`, return_url: `${origin}/dashboard`,
        } },
      });
      if (typeof link.url !== 'string') throw new Error('Missing Stripe Connect onboarding URL');
      return json({ url: link.url });
    }
    if (typeof input.bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.bookingId)) return json({ error: 'Valid bookingId required' }, 400);
    const bookingId = input.bookingId;
    const { data: booking, error: bookingError } = await caller.from('bookings')
      .select('owner_id,renter_id').eq('id', bookingId).maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking || ![booking.owner_id, booking.renter_id].includes(user.id)) return json({ error: 'Booking not found' }, 404);
    await processBooking(admin, stripe, bookingId, booking.owner_id);
    return json({ settled: true });
  } catch (error) {
    console.error('Rental settlement failed', error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : 'Settlement failed. Please retry or contact support.' }, 409);
  }
}));

async function processBooking(admin: ReturnType<typeof createClient>, stripe: Stripe, bookingId: string, ownerId: string) {
  const { error: attemptError } = await admin.from('rental_settlements')
    .update({ last_attempt_at: new Date().toISOString() }).eq('booking_id', bookingId);
  if (attemptError) throw attemptError;
  try {
    await settleRental(bookingId, {
      async claim(step) {
        const { data, error } = await admin.rpc('claim_rental_settlement', { p_booking_id: bookingId, p_step: step });
        if (error) throw error;
        return data as Settlement;
      },
      async record(step, id, status) {
        const { error } = await admin.rpc('record_rental_settlement', {
          p_booking_id: bookingId, p_step: step, p_provider_id: id, p_status: status,
        });
        if (error) throw error;
      },
      async intent(id) {
        const payment = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] });
        const charge = payment.latest_charge;
        return { ...payment, latest_charge: charge && typeof charge !== 'string'
          ? { id: charge.id, amount_refunded: charge.amount_refunded, disputed: charge.disputed } : null };
      },
      async refund(id) {
        const refund = await stripe.refunds.retrieve(id);
        return { ...refund, payment_intent: typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null };
      },
      async findDepositRefund(intent) {
        const refunds = await stripe.refunds.list({ payment_intent: intent, limit: 100 });
        const matches = refunds.data.filter((refund) =>
          refund.metadata?.booking_id === bookingId && refund.metadata?.purpose === 'deposit');
        if (refunds.has_more || refunds.data.length > 1 || (refunds.data.length > 0 && matches.length !== 1)) {
          throw new Error('Existing refunds require manual reconciliation');
        }
        if (matches.length === 0) return null;
        const refund = matches[0];
        return { ...refund, payment_intent: typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null };
      },
      async createRefund(intent, amount, idempotencyKey) {
        const refund = await stripe.refunds.create({
          payment_intent: intent, amount, metadata: { booking_id: bookingId, purpose: 'deposit' },
        }, { idempotencyKey });
        return { ...refund, payment_intent: typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null };
      },
      async accountReady(id) {
        const account = await stripe.accounts.retrieve(id);
        return account.metadata?.ybuy_owner_id === ownerId && account.capabilities?.transfers === 'active';
      },
      async transfer(id) {
        const transfer = await stripe.transfers.retrieve(id);
        return { ...transfer, destination: typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id ?? null,
          source_transaction: typeof transfer.source_transaction === 'string' ? transfer.source_transaction : transfer.source_transaction?.id ?? null };
      },
      async createTransfer(destination, charge, amount, idempotencyKey) {
        const transfer = await stripe.transfers.create({
          amount, currency: 'usd', destination, source_transaction: charge,
          metadata: { booking_id: bookingId, purpose: 'owner_earnings' },
        }, { idempotencyKey });
        return { ...transfer, destination: typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id ?? null,
          source_transaction: typeof transfer.source_transaction === 'string' ? transfer.source_transaction : transfer.source_transaction?.id ?? null };
      },
    });
    const { error } = await admin.from('rental_settlements').update({ last_error: null }).eq('booking_id', bookingId);
    if (error) throw error;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider settlement failed';
    const { error: saveError } = await admin.from('rental_settlements').update({ last_error: message.slice(0, 500) }).eq('booking_id', bookingId);
    if (saveError) console.error('Could not persist settlement error', bookingId, saveError.message);
    throw new Error(message);
  }
}
