import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { trustedOrigin, withCors } from '../_shared/cors.ts';
import { requireTestSettlement } from '../settle-rental/settlement.ts';
import { requirePendingAuthorizationReceipt } from './receipt.ts';

const secret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const stripe = new Stripe(secret);

Deno.serve(withCors(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let recovery: { bookingId: string; renterId: string } | undefined;
  try {
    requireTestSettlement(Deno.env.get('STRIPE_SECRET_KEY') ?? '', Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SETTLEMENT_TEST_MODE'));
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Sign in to authorize the deposit.' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await anon.auth.getUser();
    if (authError || !user) return json({ error: 'Sign in to continue.' }, 401);
    const { data: active, error: activeError } = await anon.rpc('has_active_session');
    if (activeError || active !== true) return json({ error: 'Your session expired. Sign in again.' }, 401);
    const body = await request.json();
    if (!body || typeof body.bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.bookingId)) {
      return json({ error: 'A valid booking is required.' }, 400);
    }
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    recovery = { bookingId: body.bookingId, renterId: user.id };
    const { error: precheckinError } = await admin.rpc('require_booking_precheckin', {
      p_booking_id: body.bookingId, p_renter_id: user.id,
    });
    if (precheckinError) return json({ error: precheckinError.message }, 409);
    let prepared = await admin.rpc('prepare_booking_deposit_authorization', {
      p_booking_id: body.bookingId, p_renter_id: user.id,
    });
    if (prepared.error) throw new Error(prepared.error.message);
    let row = prepared.data as Record<string, unknown>;
    if (row.ready === true) return json({ authorized: true, capture_before: row.capture_before });
    if (typeof row.id !== 'string' || typeof row.idempotency_key !== 'string'
      || typeof row.stripe_customer_id !== 'string' || typeof row.stripe_payment_method_id !== 'string'
      || typeof row.authorized_amount !== 'number' || typeof row.booking_id !== 'string') {
      throw new Error('Deposit authorization attempt is incomplete.');
    }
    if (typeof row.authorization_checkout_session_id === 'string') {
      const existing = await stripe.checkout.sessions.retrieve(row.authorization_checkout_session_id);
      if (existing.livemode || existing.metadata?.booking_id !== body.bookingId
        || existing.metadata?.deposit_authorization_id !== row.id) throw new Error('Authorization session does not match the booking.');
      if (existing.status === 'open' && existing.url) return json({ url: existing.url });
      if (existing.status === 'complete') {
        const intentId = typeof existing.payment_intent === 'string'
          ? existing.payment_intent : existing.payment_intent?.id;
        if (!intentId) throw new Error('Completed authorization has no provider receipt; contact support.');
        const intent = await stripe.paymentIntents.retrieve(intentId);
        requirePendingAuthorizationReceipt(intent, body.bookingId, row.id, row.authorized_amount);
        const { error } = await admin.rpc('flag_deposit_recovery_support', {
          p_booking_id: body.bookingId, p_renter_id: user.id,
        });
        if (error) throw new Error(`Could not flag pending recovery for support: ${error.message}`);
        return json({ pending: true });
      }
      if (existing.status !== 'expired') throw new Error('Authorization session outcome is uncertain; contact support.');
      const { error: clearError } = await admin.from('booking_deposit_authorizations')
        .update({ status: 'failed', failure_reason: 'Authorization session expired.' })
        .eq('id', row.id).eq('authorization_checkout_session_id', existing.id).in('status',['scheduled','authorizing']);
      if (clearError) throw new Error(clearError.message);
      prepared = await admin.rpc('prepare_booking_deposit_authorization', {
        p_booking_id: body.bookingId, p_renter_id: user.id,
      });
      if (prepared.error) throw new Error(prepared.error.message);
      row = prepared.data as Record<string, unknown>;
      if (typeof row.id !== 'string' || typeof row.idempotency_key !== 'string'
        || typeof row.stripe_customer_id !== 'string' || typeof row.stripe_payment_method_id !== 'string'
        || typeof row.authorized_amount !== 'number' || typeof row.booking_id !== 'string') {
        throw new Error('Replacement deposit authorization attempt is incomplete.');
      }
    }
    const { data: booking, error: bookingError } = await admin.from('bookings')
      .select('payment_first,listing:listings(title)').eq('id', body.bookingId).single();
    if (bookingError) throw new Error(bookingError.message);
    if (!booking) throw new Error('Booking not found.');
    const title = (booking.listing as { title?: string } | null)?.title ?? 'Rental';
    const amount = Math.round(row.authorized_amount * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Deposit amount is invalid.');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', customer: row.stripe_customer_id, payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'usd', unit_amount: amount,
        product_data: { name: `${title} security-deposit authorization` } }, quantity: 1 }],
      metadata: { purpose: 'security_deposit_authorization', booking_id: body.bookingId, deposit_authorization_id: row.id },
      payment_intent_data: {
        capture_method: 'manual',
        setup_future_usage: 'off_session',
        metadata: { purpose: 'security_deposit_authorization', booking_id: body.bookingId, deposit_authorization_id: row.id },
      },
      success_url: `${trustedOrigin(request)}/${booking.payment_first ? 'check-in' : 'confirmation'}/${body.bookingId}?deposit_authorization=complete`,
      cancel_url: `${trustedOrigin(request)}/${booking.payment_first ? 'check-in' : 'confirmation'}/${body.bookingId}?deposit_authorization=cancelled`,
    }, { idempotencyKey: row.idempotency_key });
    if (session.livemode || !session.url) throw new Error('Stripe did not return a sandbox authorization URL.');
    const bound = await admin.rpc('bind_deposit_authorization_checkout_session', {
      p_authorization_id: row.id, p_session_id: session.id,
    });
    if (bound.error) {
      throw new Error(`Authorization session requires reconciliation; contact support: ${bound.error.message}`);
    }
    return json({ url: session.url });
  } catch (error) {
    console.error('Deposit authorization session failed', error instanceof Error ? error.message : 'Unknown failure');
    if (recovery) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { error: supportError } = await admin.rpc('flag_deposit_recovery_support', {
        p_booking_id: recovery.bookingId, p_renter_id: recovery.renterId,
      });
      if (supportError) console.error('Could not flag deposit recovery for support', supportError.message);
    }
    return json({ error: error instanceof Error ? error.message : 'Could not start deposit authorization.' }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
