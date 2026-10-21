import { createClient } from 'npm:@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';
import { verifyWebhookSignature } from '../_shared/webhook-signature.ts';

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const eventId = req.headers.get('svix-id');
  const timestamp = req.headers.get('svix-timestamp');
  const signature = req.headers.get('svix-signature');
  if (!secret || !eventId || !timestamp || !signature) {
    return json({ error: 'Missing webhook configuration or signature.' }, 400);
  }

  const epoch = Number(timestamp);
  if (!Number.isFinite(epoch) || Math.abs(Date.now() / 1000 - epoch) > 300) {
    return json({ error: 'Webhook timestamp is invalid or expired.' }, 401);
  }

  const rawBody = await req.text();
  if (!await verifyWebhookSignature(secret, eventId, timestamp, signature, rawBody)) {
    return json({ error: 'Invalid webhook signature.' }, 401);
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid webhook payload.' }, 400);
  }
  if (!event.type || !event.data?.email_id) return json({ error: 'Invalid webhook payload.' }, 400);
  if (!['email.sent','email.delivered','email.bounced','email.complained','email.failed'].includes(event.type)) {
    return json({ received: true });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) return json({ error: 'Webhook storage is not configured.' }, 503);

  const admin = createClient(url, serviceRoleKey);
  const { error } = await admin.rpc('record_notification_email_event', {
    p_event_id: eventId,
    p_provider_message_id: event.data.email_id,
    p_event_type: event.type,
  });
  if (error) {
    console.error('Could not persist Resend webhook event', eventId, error.message);
    return json({ error: 'Webhook event could not be saved.' }, 503);
  }
  return json({ received: true });
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
