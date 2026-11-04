import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { trustedOrigin, withCors } from '../_shared/cors.ts';
import { requireTestSettlement } from '../settle-rental/settlement.ts';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const stripe = new Stripe(stripeSecret);

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    requireTestSettlement(Deno.env.get('STRIPE_SECRET_KEY') ?? '', Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SETTLEMENT_TEST_MODE'));
    const authorization = req.headers.get('Authorization');
    if (!authorization) return json({ error: 'Sign in to set up your deposit payment method.' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await anon.auth.getUser();
    if (authError || !user) return json({ error: 'Sign in to continue.' }, 401);
    const { data: active, error: activeError } = await anon.rpc('has_active_session');
    if (activeError || active !== true) return json({ error: 'Your session expired. Sign in again.' }, 401);
    const body = await req.json();
    if (!body || typeof body.bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.bookingId)) {
      return json({ error: 'A valid booking is required.' }, 400);
    }
    const { data: booking, error: bookingError } = await anon.from('bookings')
      .select('id,renter_id,status,deposit,deposit_collection_model,deposit_hold_consent_at,payment_first')
      .eq('id', body.bookingId).maybeSingle();
    if (bookingError) throw new Error(bookingError.message);
    if (!booking || booking.renter_id !== user.id) return json({ error: 'Booking not found.' }, 404);
    if (booking.deposit_collection_model !== 'authorization' || Number(booking.deposit) <= 0
      || !booking.deposit_hold_consent_at || !['requested','pending_payment','confirmed'].includes(booking.status)) {
      return json({ error: 'This booking is not ready for deposit card setup.' }, 409);
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error: precheckinError } = await admin.rpc('require_booking_precheckin', {
      p_booking_id: booking.id, p_renter_id: user.id,
    });
    if (precheckinError) return json({ error: precheckinError.message }, 409);
    const { data: authorizationRow, error: authorizationError } = await admin.from('booking_deposit_authorizations')
      .select('id,attempt,setup_attempt,status,stripe_checkout_session_id,stripe_customer_id,stripe_payment_method_id')
      .eq('booking_id', booking.id).order('attempt', { ascending: false }).limit(1).maybeSingle();
    if (authorizationError || !authorizationRow) throw new Error(authorizationError?.message ?? 'Deposit authorization record is missing.');
    const { data: savedCustomer, error: customerError } = await admin.from('renter_stripe_customers')
      .select('stripe_customer_id,default_payment_method_id').eq('renter_id', user.id).maybeSingle();
    if (customerError) throw new Error(customerError.message);
    if (savedCustomer?.default_payment_method_id) {
      const { error: authorizationUpdateError } = await admin.from('booking_deposit_authorizations')
        .update({ stripe_customer_id: savedCustomer.stripe_customer_id,
          stripe_payment_method_id: savedCustomer.default_payment_method_id,
          status: authorizationRow.status === 'setup_required' ? 'scheduled' : authorizationRow.status })
        .eq('id', authorizationRow.id);
      if (authorizationUpdateError) throw new Error(authorizationUpdateError.message);
      return json({ setup_complete: true });
    }

    let customerId = savedCustomer?.stripe_customer_id;
    if (!customerId) {
      if (!user.email) return json({ error: 'A verified email is required to save a payment method.' }, 400);
      const customer = await stripe.customers.create({ email: user.email, metadata: { ybuy_renter_id: user.id } },
        { idempotencyKey: `deposit-customer:${user.id}:v1` });
      if (customer.livemode || customer.metadata.ybuy_renter_id !== user.id) throw new Error('Stripe customer did not match the test renter.');
      customerId = customer.id;
      const { error: saveCustomerError } = await admin.from('renter_stripe_customers').upsert({
        renter_id: user.id, stripe_customer_id: customerId, consent_at: booking.deposit_hold_consent_at,
      }, { onConflict: 'renter_id' });
      if (saveCustomerError) throw new Error(saveCustomerError.message);
    }

    if (authorizationRow.stripe_checkout_session_id) {
      const existing = await stripe.checkout.sessions.retrieve(authorizationRow.stripe_checkout_session_id);
      if (existing.status === 'open' && existing.url) return json({ url: existing.url });
      if (existing.status === 'complete' && authorizationRow.stripe_payment_method_id) return json({ setup_complete: true });
      if (existing.status === 'complete') return json({ error: 'Card setup is processing. Refresh this booking shortly.' }, 409);
      if (existing.status === 'expired') {
        const { error: retryError } = await admin.from('booking_deposit_authorizations')
          .update({ setup_attempt: authorizationRow.setup_attempt + 1, stripe_checkout_session_id: null })
          .eq('id', authorizationRow.id).eq('stripe_checkout_session_id', existing.id);
        if (retryError) throw new Error(retryError.message);
      }
    }
    const setupSession = await stripe.checkout.sessions.create({
      mode: 'setup', customer: customerId, payment_method_types: ['card'],
      setup_intent_data: {
        metadata: { purpose: 'security_deposit_setup', booking_id: booking.id, renter_id: user.id },
      },
      metadata: { purpose: 'security_deposit_setup', booking_id: booking.id, renter_id: user.id },
      success_url: `${trustedOrigin(req)}/${booking.payment_first ? 'check-in' : 'confirmation'}/${booking.id}?deposit_setup=complete`,
      cancel_url: `${trustedOrigin(req)}/${booking.payment_first ? 'check-in' : 'confirmation'}/${booking.id}?deposit_setup=cancelled`,
    }, { idempotencyKey: `deposit-setup:${booking.id}:${authorizationRow.setup_attempt}` });
    if (setupSession.livemode || !setupSession.url) throw new Error('Stripe did not return a sandbox card-setup URL.');
    const { error: saveSessionError } = await admin.from('booking_deposit_authorizations')
      .update({ stripe_customer_id: customerId, stripe_checkout_session_id: setupSession.id })
      .eq('id', authorizationRow.id);
    if (saveSessionError) throw new Error(saveSessionError.message);
    return json({ url: setupSession.url });
  } catch (error) {
    console.error('Deposit setup session failed', error instanceof Error ? error.message : 'Unknown failure');
    return json({ error: error instanceof Error ? error.message : 'Could not start secure card setup.' }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
