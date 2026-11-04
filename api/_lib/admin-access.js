import { createClient } from '@supabase/supabase-js';
import { signAccessSession, verifyAccessSession } from './access-session.js';

export const ADMIN_HOST = 'ybuy-admin.vercel.app';
export const TEST_BACKEND = 'https://jzyjmsixfuwzfnntewqn.supabase.co';
export const ADMIN_COOKIE = '__Host-ybuy_admin_access';
export const ADMIN_ROLES = ['admin', 'super_admin'];
export const ADMIN_FIXTURES = new Map([
  ['admin@example.test', 'admin'],
  ['super-admin@example.test', 'super_admin'],
]);

export function adminJson(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function adminEnabled(request) {
  return process.env.YBUY_ADMIN_PORTAL === 'true' && new URL(request.url).hostname === ADMIN_HOST;
}

export function adminConfigured() {
  const { YBUY_ADMIN_TOTP_SECRET: admin, YBUY_SUPER_ADMIN_TOTP_SECRET: superAdmin,
    YBUY_ADMIN_ACCESS_SESSION_SECRET: session } = process.env;
  return /^[A-Z2-7]{32,}$/i.test(admin ?? '') && /^[A-Z2-7]{32,}$/i.test(superAdmin ?? '')
    && admin.toUpperCase() !== superAdmin.toUpperCase()
    && admin !== process.env.YBUY_TOTP_SECRET && superAdmin !== process.env.YBUY_TOTP_SECRET
    && typeof session === 'string' && session.length >= 32
    && session !== process.env.YBUY_ACCESS_SESSION_SECRET
    && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && process.env.VITE_SUPABASE_URL === TEST_BACKEND;
}

export function adminDb() {
  return createClient(TEST_BACKEND, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function adminCookie(token = '') {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${token ? '' : '; Max-Age=0'}`;
}

export function signAdminAccess(role, now = Date.now()) {
  if (!ADMIN_ROLES.includes(role)) throw new Error('Invalid administrator role.');
  return signAccessSession(`${process.env.YBUY_ADMIN_ACCESS_SESSION_SECRET}:${ADMIN_HOST}:${role}`, now);
}

export async function readAdminRole(request, now = Date.now()) {
  const token = request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
  for (const role of ADMIN_ROLES) {
    if (await verifyAccessSession(`${process.env.YBUY_ADMIN_ACCESS_SESSION_SECRET}:${ADMIN_HOST}:${role}`, token, now)) return role;
  }
  return null;
}
