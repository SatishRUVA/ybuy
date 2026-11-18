import { createClient } from 'npm:@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';
import { renderNotificationEmail } from '../_shared/notification-email.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  const workerSecret = Deno.env.get('NOTIFICATION_WORKER_SECRET');
  const workerHeader = req.headers.get('x-notification-worker-secret');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Email processing is not configured.' }, 503);
  }

  let userId: string | null = null;
  const scheduledWorker = workerHeader !== null;
  if (scheduledWorker) {
    if (!workerSecret || !constantTimeEqual(workerHeader, workerSecret)) {
      return json({ error: 'Not authorized to process the notification queue.' }, 401);
    }
  } else {
    if (!authorization) return json({ error: 'Sign in to process your email notifications.' }, 401);
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Sign in to process your email notifications.' }, 401);
    userId = user.id;
  }

  if (Deno.env.get('NOTIFICATION_DELIVERY_DISABLED') === 'true') {
    return json({ error: 'Notification email delivery is disabled for this environment.' }, 503);
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  const appUrl = Deno.env.get('PUBLIC_APP_URL');
  const liveDelivery = Deno.env.get('NOTIFICATION_LIVE_DELIVERY') === 'true';
  const testRecipient = Deno.env.get('NOTIFICATION_TEST_RECIPIENT')?.trim();
  const isolatedTest = supabaseUrl === 'https://jzyjmsixfuwzfnntewqn.supabase.co';
  if (isolatedTest && (liveDelivery || testRecipient !== 'satish.babu1777@gmail.com')) {
    return json({ error: 'Isolated test mail must be redirected only to the approved test inbox.' }, 503);
  }
  if (!apiKey || !from || !appUrl || (!liveDelivery && !testRecipient)) {
    return json({ error: 'Email delivery is disabled or missing its server-side configuration.' }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: jobs, error: claimError } = scheduledWorker
    ? await admin.rpc('claim_next_notification_email_jobs', { p_limit: 10 })
    : await admin.rpc('claim_notification_email_jobs', { p_user_id: userId, p_limit: 10 });
  if (claimError) {
    console.error('Could not claim notification email jobs', claimError.message);
    return json({ error: 'Could not load pending email notifications.' }, 503);
  }

  let sent = 0;
  let retrying = 0;
  let failed = 0;
  let unknown = 0;
  for (const job of jobs ?? []) {
    let status: 'sent' | 'retrying' | 'failed' | 'unknown' = 'retrying';
    let providerId: string | null = null;
    let errorMessage = 'Email provider request failed.';
    try {
      const { data: stored, error: storedError } = await admin.from('notification_email_jobs')
        .select('rendered_email').eq('id', job.job_id).single();
      if (storedError) throw storedError;
      let payload = stored.rendered_email;
      if (!payload) {
        const { data: details, error: detailsError } = await admin.rpc('notification_email_details', { p_job_id: job.job_id });
        if (detailsError) throw detailsError;
        if (!Array.isArray(details) || details.some((entry) => !entry || typeof entry.label !== 'string' || typeof entry.value !== 'string')) {
          throw new Error('Invalid notification email details');
        }
        const rendered = renderNotificationEmail({
          ...job, details, ...(!liveDelivery ? { testActor: job.recipient_email } : {}),
        }, appUrl);
        payload = { from, to: liveDelivery ? job.recipient_email : testRecipient,
          subject: rendered.subject, text: rendered.text, html: rendered.html };
        const { error: saveError } = await admin.from('notification_email_jobs')
          .update({ rendered_email: payload, rendered_at: new Date().toISOString() }).eq('id', job.job_id);
        if (saveError) throw saveError;
      }
      if (isolatedTest && payload.to !== 'satish.babu1777@gmail.com') throw new Error('Stored test email recipient is not allowed');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': job.job_id,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const result = await response.json().catch(() => null) as { id?: string } | null;
        if (result?.id) {
          status = 'sent';
          providerId = result.id;
          sent += 1;
        } else {
          status = 'unknown';
          errorMessage = 'Resend accepted the request without returning a message identifier.';
          unknown += 1;
        }
      } else if (response.status === 408 || response.status === 429 || response.status >= 500) {
        errorMessage = `Resend returned a retryable HTTP ${response.status} response.`;
        retrying += 1;
      } else {
        status = 'failed';
        errorMessage = `Resend rejected the message with HTTP ${response.status}.`;
        failed += 1;
      }
    } catch (error) {
      console.error('Notification email processing failed', job.job_id, error instanceof Error ? error.message : error);
      errorMessage = error instanceof Error && error.name === 'TimeoutError'
        ? 'Resend request timed out; the same idempotency key will be used on retry.'
        : 'Resend request failed before a response was received.';
      retrying += 1;
    }

    const { error: finishError } = await admin.rpc('finish_notification_email_job', {
      p_job_id: job.job_id,
      p_status: status,
      p_provider_message_id: providerId,
      p_error: status === 'sent' ? null : errorMessage,
    });
    if (finishError) {
      console.error('Could not persist notification email result', job.job_id, finishError.message);
      return json({ error: 'Email result could not be saved; queued work will be recovered after its lease expires.' }, 503);
    }
  }

  return json({ processed: jobs?.length ?? 0, sent, retrying, failed, unknown });
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}
