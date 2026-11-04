import { verifyTotp } from '../_lib/access-session.js';
import {
  ADMIN_ROLES, adminConfigured, adminCookie, adminDb, adminEnabled, adminJson,
  readAdminRole, signAdminAccess,
} from '../_lib/admin-access.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (!adminEnabled(request)) return adminJson(404, { error: 'Not found.' });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return adminJson(405, { error: 'Method not allowed.' });
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) {
    return adminJson(403, { error: 'Same-origin administrator verification required.' });
  }
  if (!adminConfigured()) return adminJson(503, { error: 'Administrator access is not configured. Contact the site administrator.' });
  if (request.method === 'DELETE') return adminJson(200, { ok: true }, { 'set-cookie': adminCookie() });
  if (request.method === 'GET') {
    const role = await readAdminRole(request);
    return role ? adminJson(200, { role }) : adminJson(401, { error: 'Enter your administrator authenticator code.' });
  }
  try {
    // The persistent counter is shared across instances and both roles.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const { data: permitted, error: limitError } = await adminDb().rpc('consume_admin_login_attempt', { p_key: key });
    if (limitError) throw limitError;
    if (permitted !== true) return adminJson(429, { error: 'Too many attempts. Try again in five minutes.' }, { 'retry-after': '300' });
    let body;
    try { body = await request.json(); } catch { return adminJson(400, { error: 'Enter a role and a six-digit authenticator code.' }); }
    if (!ADMIN_ROLES.includes(body?.role) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
      return adminJson(400, { error: 'Enter a role and a six-digit authenticator code.' });
    }
    const secret = body.role === 'admin' ? process.env.YBUY_ADMIN_TOTP_SECRET : process.env.YBUY_SUPER_ADMIN_TOTP_SECRET;
    if (!await verifyTotp(secret, body.code)) {
      console.log(JSON.stringify({ event: 'admin_totp_failed', role: body.role }));
      return adminJson(401, { error: 'Invalid authenticator code for this role.' });
    }
    const { token, expiresAt } = await signAdminAccess(body.role);
    console.log(JSON.stringify({ event: 'admin_totp_verified', role: body.role }));
    return adminJson(200, { role: body.role, expiresAt }, { 'set-cookie': adminCookie(token) });
  } catch (error) {
    console.error('Administrator verification failed:', error instanceof Error ? error.message : 'Backend verification error');
    return adminJson(503, { error: 'Could not verify administrator access. Please retry.' });
  }
}
