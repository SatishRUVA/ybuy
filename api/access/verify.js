// Vercel Edge Function — the only endpoint allowed to verify a TOTP code and mint the
// temporary access session cookie. Runs same-origin so the cookie is scoped to YBuy's own domain.
import { verifyTotp, signAccessSession, ACCESS_COOKIE_NAME } from '../_lib/access-session.js';

export const config = { runtime: 'edge' };

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

// ponytail: per-instance in-memory rate limit only (resets on cold start, not shared across
// concurrent edge instances). Upgrade to Upstash/Vercel KV if distributed limiting is needed.
const attempts = new Map();

function tooManyAttempts(ip, now) {
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS;
}

function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

// Never log the code or secret — only a safe event name, timestamp and requesting IP.
function auditLog(event, ip) {
  console.log(JSON.stringify({ event, ip, at: new Date().toISOString() }));
}

export default async function handler(request) {
  if (process.env.YBUY_TEMP_ACCESS_ENABLED !== 'true' && process.env.YBUY_TEST_PROFILE_LOGIN !== 'true') return json(404, { error: 'Not found' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (request.headers.get('origin') !== new URL(request.url).origin) return json(403, { error: 'Same-origin verification required.' });

  const totpSecret = process.env.YBUY_TOTP_SECRET;
  const sessionSecret = process.env.YBUY_ACCESS_SESSION_SECRET;
  if (!totpSecret || !sessionSecret) return json(503, { error: 'Service temporarily unavailable' });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  if (tooManyAttempts(ip, now)) return json(429, { error: 'Too many attempts. Try again later.' });

  let code;
  try {
    const body = await request.json();
    code = body?.code;
  } catch {
    return json(400, { error: 'Invalid verification code.' });
  }

  const valid = typeof code === 'string' && (await verifyTotp(totpSecret, code, now));
  if (!valid) {
    auditLog('totp_verification_failed', ip);
    return json(401, { error: 'Invalid verification code.' });
  }

  auditLog('totp_verification_succeeded', ip);
  const { token, expiresAt } = await signAccessSession(sessionSecret, now);
  // No Max-Age: session cookie so closing the browser/tab drops it and re-triggers auth.
  // The signed token's own expiresAt still caps the session server-side to 2 hours.
  const cookie = `${ACCESS_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return json(200, { ok: true, expiresAt }, { 'set-cookie': cookie });
}
