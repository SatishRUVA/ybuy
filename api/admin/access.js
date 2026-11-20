import { verifyTotp } from '../_lib/access-session.js';
import {
  adminConfigured, adminCookie, adminDb, adminEnabled, adminJson, adminTotpSecret,
  readAdminRole, signAdminAccess,
} from '../_lib/admin-access.js';

export const config = { runtime: 'edge' };

export async function handleAdminAccess(request, expectedRole) {
  if (!adminEnabled(request)) return adminJson(404, { error: 'Not found.' });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return adminJson(405, { error: 'Method not allowed.' });
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) {
    return adminJson(403, { error: 'Same-origin administrator verification required.' });
  }
  if (request.method === 'DELETE') return adminJson(200, { ok: true }, { 'set-cookie': adminCookie() });
  if (request.method === 'GET') {
    const role = await readAdminRole(request);
    if (role === expectedRole) return adminConfigured(expectedRole)
      ? adminJson(200, { role })
      : adminJson(503, { error: 'Administrator access is not configured. Contact the site administrator.' });
    if (!adminConfigured(expectedRole)) return adminJson(503, { error: 'Administrator access is not configured. Contact the site administrator.' });
    return adminJson(401, { error: `Enter your ${expectedRole === 'super_admin' ? 'Super Admin' : 'Admin'} authenticator code.` },
      role ? { 'set-cookie': adminCookie() } : {});
  }
  if (!adminConfigured(expectedRole)) return adminJson(503, { error: 'Administrator access is not configured. Contact the site administrator.' });
  try {
    // The persistent counter is shared across instances and both roles.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const { data: permitted, error: limitError } = await adminDb().rpc('consume_admin_login_attempt', { p_key: key });
    if (limitError) throw limitError;
    if (permitted !== true) return adminJson(429, { error: 'Too many attempts. Try again in five minutes.' }, { 'retry-after': '300' });
    let body;
    try {
      const contentType = request.headers.get('content-type')?.split(';')[0];
      if (contentType === 'application/json') body = await request.json();
      else if (contentType === 'application/x-www-form-urlencoded') body = Object.fromEntries(new URLSearchParams(await request.text()));
      else return adminJson(400, { error: 'Enter a six-digit authenticator code.' });
    } catch { return adminJson(400, { error: 'Enter a six-digit authenticator code.' }); }
    if (body?.role !== expectedRole || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
      return adminJson(400, { error: `Enter a ${expectedRole === 'super_admin' ? 'Super Admin' : 'Admin'} role and a six-digit authenticator code.` });
    }
    const secret = adminTotpSecret(expectedRole);
    if (!await verifyTotp(secret, body.code)) {
      console.log(JSON.stringify({ event: 'admin_totp_failed', role: expectedRole }));
      return adminJson(401, { error: 'Invalid authenticator code for this role.' });
    }
    const { token, expiresAt } = await signAdminAccess(expectedRole);
    console.log(JSON.stringify({ event: 'admin_totp_verified', role: expectedRole }));
    return adminJson(200, { role: expectedRole, expiresAt }, { 'set-cookie': adminCookie(token) });
  } catch (error) {
    console.error('Administrator verification failed:', error instanceof Error ? error.message : 'Backend verification error');
    return adminJson(503, { error: 'Could not verify administrator access. Please retry.' });
  }
}

export default function handler(request) {
  return handleAdminAccess(request, 'admin');
}
