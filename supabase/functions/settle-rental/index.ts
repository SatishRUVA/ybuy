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
  if (attemptError) throw new Error(attemptError.message);
  try {
    await settleDepositAuthorization(admin,stripe,bookingId);
    await settleRental(bookingId, {
      async claim(step) {
        const { data, error } = await admin.rpc('claim_rental_settlement', { p_booking_id: bookingId, p_step: step });
        if (error) throw new Error(error.message);
        return data as Settlement;
      },
      async record(step, id, status) {
        const { error } = await admin.rpc('record_rental_settlement', {
          p_booking_id: bookingId, p_step: step, p_provider_id: id, p_status: status,
        });
        if (error) throw new Error(error.message);
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

async function settleDepositAuthorization(admin: ReturnType<typeof createClient>, stripe: Stripe, bookingId: string) {
  const { data: booking, error: bookingError } = await admin.from('bookings')
    .select('id,renter_id,deposit,deposit_collection_model,status,return_confirmed_at').eq('id',bookingId).single();
  if (bookingError) throw new Error(bookingError.message);
  if (booking.deposit_collection_model !== 'authorization' || Number(booking.deposit) <= 0) return;
  if (booking.status !== 'completed' || !booking.return_confirmed_at) throw new Error('Owner-confirmed return is required before settling a deposit hold.');
  const { data: claim, error: claimError } = await admin.from('booking_deposit_claims')
    .select('id,status,approved_amount,authorization_id').eq('booking_id',bookingId).maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (claim && ['submitted','approved','capturing'].includes(claim.status)) {
    if (claim.status !== 'approved') return;
  }
  const { data: authorization, error: authorizationError } = await admin.from('booking_deposit_authorizations')
    .select('id,attempt,status,authorized_amount,captured_amount,stripe_payment_intent_id,capture_before')
    .eq('booking_id',bookingId).order('attempt',{ascending:false}).limit(1).maybeSingle();
  if (authorizationError) throw new Error(authorizationError.message);
  if (!authorization) throw new Error('Deposit authorization record is missing.');
  if (authorization.status === 'captured' || authorization.status === 'released' || authorization.status === 'superseded') return;
  if (!authorization.stripe_payment_intent_id) {
    if (claim?.status === 'approved') {
      await admin.from('booking_deposit_claims').update({ status:'payment_required',failure_reason:'No live authorization is available; a separate renter payment is required.' }).eq('id',claim.id);
      return;
    }
    throw new Error('No deposit PaymentIntent exists to release.');
  }
  const intent = await stripe.paymentIntents.retrieve(authorization.stripe_payment_intent_id);
  if (intent.livemode || intent.currency !== 'usd' || intent.capture_method !== 'manual') {
    throw new Error('Deposit PaymentIntent does not match the test-mode authorization record.');
  }
  if (claim?.status === 'approved') {
    const amount = Math.round(Number(claim.approved_amount ?? 0)*100);
    const authorized = Math.round(Number(authorization.authorized_amount)*100);
    if (!Number.isSafeInteger(amount) || amount<=0 || amount>authorized) throw new Error('Approved claim amount exceeds the deposit authorization.');
    if (authorization.status !== 'authorized' || intent.status !== 'requires_capture'
      || !authorization.capture_before || Date.parse(authorization.capture_before)<=Date.now()
      || intent.amount_capturable<amount) {
      await admin.from('booking_deposit_claims').update({ status:'payment_required',failure_reason:'The deposit authorization expired before the approved deduction could be captured. A separate renter payment is required.' }).eq('id',claim.id);
      await admin.rpc('create_notification',{
        p_user_id:booking.renter_id,
        p_event_key:`deposit-claim-payment-required:${claim.id}`,
        p_category:'payments',p_title:'Deposit authorization expired',
        p_body:'An approved damage deduction could not use the expired hold. Please arrange the separately authorized claim payment.',
        p_destination:`/confirmation/${bookingId}`,
      });
      return;
    }
    const { error: claimStateError } = await admin.from('booking_deposit_claims')
      .update({ status:'capturing',failure_reason:null }).eq('id',claim.id).eq('status','approved');
    if (claimStateError) throw new Error(claimStateError.message);
    const captured = await stripe.paymentIntents.capture(intent.id,{amount_to_capture:amount},{idempotencyKey:`deposit-claim:${claim.id}:v1`});
    if (captured.status!=='succeeded' || captured.amount_received!==amount || captured.currency!=='usd' || captured.livemode) {
      throw new Error('Stripe did not confirm the approved deposit deduction capture.');
    }
    const { error: authUpdateError } = await admin.from('booking_deposit_authorizations').update({
      status:'captured',captured_amount:amount/100,captured_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }).eq('id',authorization.id).eq('status','authorized');
    if (authUpdateError) throw new Error(authUpdateError.message);
    const { error: claimUpdateError } = await admin.from('booking_deposit_claims').update({
      status:'captured',captured_at:new Date().toISOString(),failure_reason:null,
    }).eq('id',claim.id).eq('status','approved');
    if (claimUpdateError) throw new Error(claimUpdateError.message);
    const { error: eventError } = await admin.from('booking_deposit_authorization_events').insert({
      authorization_id:authorization.id,event_type:'deposit_claim_capture',status:'captured',amount:amount/100,
      operation_key:`deposit-claim:${claim.id}:v1`,detail:{claim_id:claim.id,amount_to_capture:amount/100},
    });
    if (eventError && eventError.code!=='23505') throw new Error(eventError.message);
    return;
  }
  if (intent.status === 'requires_capture' && authorization.status === 'authorized') {
    const released = await stripe.paymentIntents.cancel(intent.id,{}, {idempotencyKey:`deposit-release:${bookingId}:${authorization.attempt}`});
    if (released.status!=='canceled' || released.livemode) throw new Error('Stripe did not confirm release of the deposit hold.');
    const { error: updateError } = await admin.from('booking_deposit_authorizations').update({
      status:'released',released_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }).eq('id',authorization.id).eq('status','authorized');
    if (updateError) throw new Error(updateError.message);
    const { error: eventError } = await admin.from('booking_deposit_authorization_events').insert({
      authorization_id:authorization.id,event_type:'deposit_hold_released',status:'released',amount:0,
      operation_key:`deposit-release:${bookingId}:${authorization.attempt}`,detail:{stripe_payment_intent_id:intent.id},
    });
    if (eventError && eventError.code!=='23505') throw new Error(eventError.message);
    const { error: notificationError } = await admin.rpc('create_notification',{
      p_user_id:booking.renter_id,
      p_event_key:`deposit-released:${bookingId}:${authorization.attempt}`,
      p_category:'payments',p_title:'Security deposit hold released',
      p_body:'The rental was returned without an approved deduction. Your uncaptured security-deposit hold has been released.',
      p_destination:`/confirmation/${bookingId}`,
    });
    if (notificationError) throw new Error(notificationError.message);
  } else if (['requires_capture','processing'].includes(intent.status)) {
    throw new Error('Deposit PaymentIntent is still processing; release will be retried.');
  }
}
