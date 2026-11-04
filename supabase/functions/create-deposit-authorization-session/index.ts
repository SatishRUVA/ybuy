import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { trustedOrigin, withCors } from '../_shared/cors.ts';
import { requireTestSettlement } from '../settle-rental/settlement.ts';

const secret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const stripe = new Stripe(secret);

Deno.serve(withCors(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
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
    const { error: precheckinError } = await admin.rpc('require_booking_precheckin', {
      p_booking_id: body.bookingId, p_renter_id: user.id,
    });
    if (precheckinError) return json({ error: precheckinError.message }, 409);
    let prepared = await admin.rpc('prepare_booking_deposit_authorization', {
      p_booking_id: body.bookingId, p_renter_id: user.id,
    });
    if (prepared.error) return json({ error: prepared.error.message }, 409);
    let row = prepared.data as Record<string, unknown>;
    if (row.ready === true) return json({ authorized: true, capture_before: row.capture_before });
    if (typeof row.id !== 'string' || typeof row.idempotency_key !== 'string'
      || typeof row.stripe_customer_id !== 'string' || typeof row.stripe_payment_method_id !== 'string'
      || typeof row.authorized_amount !== 'number' || typeof row.booking_id !== 'string') {
      throw new Error('Deposit authorization attempt is incomplete.');
    }
    if (typeof row.authorization_checkout_session_id === 'string') {
      const existing = await stripe.checkout.sessions.retrieve(row.authorization_checkout_session_id);
      if (existing.status === 'open' && existing.url) return json({ url: existing.url });
      if (existing.status === 'complete') {
        const paymentIntentId = typeof existing.payment_intent === 'string' ? existing.payment_intent : null;
        if (!paymentIntentId) throw new Error('Completed authorization session has no PaymentIntent.');
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (intent.status === 'requires_capture' || intent.status === 'processing') return json({ pending: true });
        const failedStatus = intent.status === 'requires_action' ? 'requires_action'
          : intent.status === 'canceled' ? 'released' : 'failed';
        const { error: recoveryError } = await admin.from('booking_deposit_authorizations')
          .update({ authorization_checkout_session_id: null, status: failedStatus,
            failure_reason: intent.last_payment_error?.message ?? 'Authorization did not complete.' })
          .eq('id', row.id).eq('authorization_checkout_session_id', existing.id);
        if (recoveryError) throw new Error(recoveryError.message);
        prepared = await admin.rpc('prepare_booking_deposit_authorization', {
          p_booking_id: body.bookingId, p_renter_id: user.id,
        });
        if (prepared.error) throw new Error(prepared.error.message);
        row = prepared.data as Record<string, unknown>;
        if (typeof row.id !== 'string' || typeof row.idempotency_key !== 'string'
          || typeof row.stripe_customer_id !== 'string' || typeof row.stripe_payment_method_id !== 'string'
          || typeof row.authorized_amount !== 'number' || typeof row.booking_id !== 'string') {
          throw new Error('Retry deposit authorization attempt is incomplete.');
        }
      }
      const { error: clearError } = await admin.from('booking_deposit_authorizations')
        .update({ authorization_checkout_session_id: null, status: 'failed' })
        .eq('id', row.id).eq('authorization_checkout_session_id', existing.id);
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
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
      throw new Error(bound.error.message);
    }
    return json({ url: session.url });
  } catch (error) {
    console.error('Deposit authorization session failed', error instanceof Error ? error.message : 'Unknown failure');
    return json({ error: error instanceof Error ? error.message : 'Could not start deposit authorization.' }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
