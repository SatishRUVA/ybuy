import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';
import { requireTestSettlement } from '../settle-rental/settlement.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  try { requireTestSettlement(key, url, Deno.env.get('SETTLEMENT_TEST_MODE')); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Payout status is disabled' }, 503); }

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'An active signed-in session is required' }, 401);
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  const { data: active, error: activeError } = await caller.rpc('has_active_session');
  if (authError || !user || activeError || active !== true) return json({ error: 'An active signed-in session is required' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: connection, error } = await admin.from('owner_connect_accounts')
    .select('stripe_account_id').eq('owner_id', user.id).maybeSingle();
  if (error) return json({ error: 'Could not load your Stripe account. Please retry.' }, 503);
  if (!connection) return json({ connected: false, payouts: [] });

  try {
    const stripe = new Stripe(key);
    const account = await stripe.accounts.retrieve(connection.stripe_account_id);
    if (account.metadata?.ybuy_owner_id !== user.id || account.livemode) throw new Error('Stripe account does not match this test owner.');
    const result = await stripe.payouts.list({ limit: 10 }, { stripeAccount: connection.stripe_account_id });
    if (result.data.some((payout) => payout.livemode)) throw new Error('A live payout was returned in the test environment.');
    return json({
      connected: true,
      payouts: result.data.map((payout) => ({
        id: payout.id, amount: payout.amount / 100, currency: payout.currency,
        status: payout.status, created: payout.created, arrival_date: payout.arrival_date,
        failure_code: payout.failure_code, method: payout.method, type: payout.type,
      })),
    });
  } catch (error) {
    console.error('Owner payout status lookup failed', user.id, error instanceof Error ? error.message : error);
    return json({ error: 'Could not load bank payout status from Stripe. Please retry.' }, 502);
  }
}));
