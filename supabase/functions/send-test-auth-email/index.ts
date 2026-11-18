import { verifyWebhookSignature } from '../_shared/webhook-signature.ts';
import { renderTestAuthEmails, TEST_BACKEND, TEST_INBOX } from './email.ts';

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  if (Deno.env.get('SUPABASE_URL') !== TEST_BACKEND ||
    Deno.env.get('NOTIFICATION_TEST_RECIPIENT') !== TEST_INBOX ||
    Deno.env.get('NOTIFICATION_LIVE_DELIVERY') === 'true' || !secret || !key || !from) {
    return json({ error: 'Isolated test Auth email configuration is required.' }, 503);
  }
  const eventId = req.headers.get('webhook-id');
  const timestamp = req.headers.get('webhook-timestamp');
  const signature = req.headers.get('webhook-signature');
  const body = await req.text();
  if (!eventId || !timestamp || !signature ||
    !await verifyWebhookSignature(secret, eventId, timestamp, signature, body)) {
    return json({ error: 'Invalid Auth webhook signature.' }, 401);
  }
  try {
    const messages = renderTestAuthEmails(JSON.parse(body));
    for (const [index, message] of messages.entries()) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `auth-${eventId}-${index}` },
        body: JSON.stringify({ from, ...message }), signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`Auth email provider returned HTTP ${response.status}.`);
      const receipt = await response.json();
      if (typeof receipt.id !== 'string') throw new Error('Auth email provider did not return a receipt.');
      console.log('Test Auth email accepted', eventId, receipt.id);
    }
    return json({});
  } catch (error) {
    console.error('Test Auth email delivery failed', eventId, error instanceof Error ? error.message : 'Invalid event');
    return json({ error: { http_code: 503, message: 'Test verification email could not be delivered. Retry later.' } }, 503);
  }
});
