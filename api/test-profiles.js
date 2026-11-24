import { createClient } from '@supabase/supabase-js';
import { ACCESS_COOKIE_NAME, verifyAccessSession } from './_lib/access-session.js';
import { isAllowedHostname } from './_lib/host-allowlist.js';
import { hostedProfileRole } from './_lib/test-profile-roles.js';

export const config = { runtime: 'edge' };
const backend = 'https://jzyjmsixfuwzfnntewqn.supabase.co';
const defaultAllowedHosts = ['ybuy-redesign-v1.vercel.app', 'ybuy-e2e-test.vercel.app'];
const emails = new Set([
  ...['owner', 'renter'].flatMap(role =>
    Array.from({ length: 5 }, (_, index) => `${role}${index + 1}@example.test`)),
  'admin@example.test',
  'super-admin@example.test',
]);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function handler(request) {
  const url = new URL(request.url);
  if (process.env.YBUY_TEST_PROFILE_LOGIN !== 'true'
    || !isAllowedHostname(url.hostname, process.env.YBUY_TEST_PROFILE_ALLOWED_HOSTS, defaultAllowedHosts)) {
    return json(404, { error: 'Test profile selection is not enabled here.' });
  }
  if (!['GET', 'POST'].includes(request.method)) return json(405, { error: 'Method not allowed.' });
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) {
    return json(403, { error: 'Same-origin profile selection required.' });
  }
  const secret = process.env.YBUY_ACCESS_SESSION_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !process.env.YBUY_TOTP_SECRET || !serviceKey || process.env.VITE_SUPABASE_URL !== backend) {
    return json(503, { error: 'Tester access is not configured. Contact the site administrator.' });
  }
  const token = request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${ACCESS_COOKIE_NAME}=`))?.slice(ACCESS_COOKIE_NAME.length + 1);
  if (!await verifyAccessSession(secret, token)) {
    return json(401, { error: 'Verify your tester security code before selecting a profile.' });
  }
  try {
    const db = createClient(backend, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const users = [];
    for (let page = 1; ; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      users.push(...data.users.filter(user => emails.has(user.email)
        && user.app_metadata.local_test_fixture === 'ybuy-local-lifecycle-v1'));
      if (data.users.length < 1000) break;
    }
    const { data: admins, error: adminError } = await db.from('admin_users').select('user_id, role, active').in('user_id', users.map(user => user.id));
    if (adminError) throw adminError;
    const adminByUser = new Map(admins.map(admin => [admin.user_id, admin]));
    const allowed = users
      .map(user => ({ user, role: hostedProfileRole(user.email, adminByUser.get(user.id)) }))
      .filter(item => item.role);
    if (request.method === 'GET') return json(200, allowed.map(user => ({
      id: user.user.id, name: user.user.user_metadata.full_name || user.user.email,
      role: user.role,
    })));
    let body;
    try { body = await request.json(); } catch { return json(400, { error: 'Choose a valid test profile.' }); }
    const selected = allowed.find(item => item.user.id === body?.id);
    if (!selected) return json(403, { error: 'Only approved test accounts with their configured roles can be selected.' });
    const user = selected.user;
    const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: user.email });
    if (error) throw error;
    if (data.user.id !== user.id || !data.properties.hashed_token) throw new Error('Test account token did not match.');
    console.log(JSON.stringify({ event: 'tester_profile_selected', userId: user.id }));
    return json(200, { tokenHash: data.properties.hashed_token });
  } catch (error) {
    console.error('Test profile selection failed:', error instanceof Error ? error.message : 'Unknown backend error');
    return json(502, { error: 'Could not load or select test profiles. Please retry.' });
  }
}
