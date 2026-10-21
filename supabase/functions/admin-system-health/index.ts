// Reports credential *status* (set / not set) and database reachability to administrators.
// Never returns secret values. Authorization is the admin_require('integrations.view') check in
// the database, evaluated with the caller's own JWT.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';

const INTEGRATIONS: { name: string; env: string[] }[] = [
  { name: 'Stripe payments', env: ['STRIPE_SECRET_KEY'] },
  { name: 'Stripe webhook signing', env: ['STRIPE_WEBHOOK_SECRET'] },
  { name: 'Supabase service role', env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  { name: 'Photo analysis (OpenRouter)', env: ['OPENROUTER_API_KEY'] },
  { name: 'Allowed app origins (CORS)', env: ['APP_ORIGIN'] },
];

Deno.serve(withCors(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Not signed in' }, 401);

  const { data: allowed, error: permError } = await supabase.rpc('has_admin_permission', { p_permission: 'integrations.view' });
  if (permError) return json({ error: 'Could not verify permissions' }, 503);
  if (allowed !== true) return json({ error: 'Not authorized' }, 403);

  const started = performance.now();
  const { error: dbError } = await supabase.rpc('has_active_session');
  const latency = Math.round(performance.now() - started);

  return json({
    checked_at: new Date().toISOString(),
    database: { ok: !dbError, latency_ms: latency },
    integrations: INTEGRATIONS.map((i) => ({ name: i.name, configured: i.env.every((k) => Boolean(Deno.env.get(k))) })),
  });
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
