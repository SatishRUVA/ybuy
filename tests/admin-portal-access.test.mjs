import assert from 'node:assert/strict';
import test from 'node:test';
import adminAccess from '../api/admin/access.js';
import adminProfiles from '../api/admin/profiles.js';
import superAdminAccess from '../api/super-admin/access.js';
import superAdminProfiles from '../api/super-admin/profiles.js';
import { ADMIN_COOKIE, signAdminAccess, TEST_BACKEND } from '../api/_lib/admin-access.js';
import { computeTotpForTest, signAccessSession } from '../api/_lib/access-session.js';
import middleware from '../middleware.js';

test('role-specific admin portals enforce separate TOTP, fixture, expiry and rate-limit boundaries', async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const origin = 'https://ybuy-admin.vercel.app';
  const adminSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const superAdminSecret = 'KRSXG5DSNFXGOIDBNZXXE3DEKRSXG5DS';
  const requestFor = (role, endpoint, method = 'GET', body, token, host = origin) => new Request(
    `${host}/api/${role === 'super_admin' ? 'super-admin' : 'admin'}/${endpoint}`, {
    method, headers: { origin: host, ...(token ? { cookie: `${ADMIN_COOKIE}=${token}` } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const request = (endpoint, method = 'GET', body, token, host = origin) =>
    requestFor('admin', endpoint, method, body, token, host);
  const superRequest = (endpoint, method = 'GET', body, token, host = origin) =>
    requestFor('super_admin', endpoint, method, body, token, host);
  let permitted = true;
  let backendError = false;
  let mintMismatch = false;
  const users = [
    { id: 'admin-id', email: 'admin@example.test', app_metadata: { local_test_fixture: 'ybuy-local-lifecycle-v1' }, user_metadata: { full_name: 'Test Admin' } },
    { id: 'super-id', email: 'super-admin@example.test', app_metadata: { local_test_fixture: 'ybuy-local-lifecycle-v1' }, user_metadata: { full_name: 'Test Super Admin' } },
    { id: 'owner-id', email: 'owner1@example.test', app_metadata: { local_test_fixture: 'ybuy-local-lifecycle-v1' }, user_metadata: {} },
    { id: 'real-id', email: 'real@example.com', app_metadata: {}, user_metadata: {} },
  ];
  const rows = [
    { user_id: 'admin-id', role: 'admin', active: true },
    { user_id: 'super-id', role: 'super_admin', active: true },
    { user_id: 'real-id', role: 'super_admin', active: true },
  ];
  try {
    process.env.YBUY_ADMIN_PORTAL = 'false';
    assert.equal((await adminAccess(request('access'))).status, 404);
    assert.equal((await adminProfiles(request('profiles'))).status, 404);
    Object.assign(process.env, {
      YBUY_ADMIN_PORTAL: 'true', YBUY_ADMIN_TOTP_SECRET: adminSecret,
      YBUY_SUPER_ADMIN_TOTP_SECRET: superAdminSecret,
      YBUY_ADMIN_ACCESS_SESSION_SECRET: 'test-only-admin-signing-key-at-least-32-characters',
      YBUY_ACCESS_SESSION_SECRET: 'customer-session-secret', YBUY_TOTP_SECRET: 'CUSTOMER',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-key', VITE_SUPABASE_URL: TEST_BACKEND,
    });
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.origin, TEST_BACKEND);
      if (backendError) return Response.json({ message: 'Test backend unavailable' }, { status: 500 });
      if (url.pathname.endsWith('/consume_admin_login_attempt')) {
        assert.match(JSON.parse(options.body).p_key, /^[a-f0-9]{64}$/);
        return Response.json(permitted);
      }
      if (url.pathname.endsWith('/admin/users')) return Response.json({ users });
      if (url.pathname.endsWith('/admin_users')) return Response.json(rows);
      if (url.pathname.endsWith('/generate_link')) {
        const user = users.find(user => user.email === JSON.parse(options.body).email);
        assert.ok(user);
        return Response.json({ ...user, id: mintMismatch ? 'wrong-id' : user.id, hashed_token: 'test-hash', action_link: 'https://example.test', email_otp: '123456', verification_type: 'magiclink' });
      }
      throw new Error(`Unexpected backend request ${url.pathname}`);
    };
    for (const [handler, makeRequest] of [
      [adminAccess, request], [adminProfiles, request],
      [superAdminAccess, superRequest], [superAdminProfiles, superRequest],
    ]) {
      assert.equal((await handler(makeRequest('access', 'GET', undefined, undefined, 'https://ybuy-e2e-test.vercel.app'))).status, 404);
      assert.equal((await handler(makeRequest('access', 'PUT'))).status, 405);
      assert.equal((await handler(new Request(`${origin}/api/admin/access`, { method: 'POST' }))).status, 403);
      assert.equal((await handler(makeRequest('access'))).status, 401);
    }
    const customer = await signAccessSession(process.env.YBUY_ACCESS_SESSION_SECRET);
    assert.equal((await adminAccess(request('access', 'GET', undefined, customer.token))).status, 401);
    assert.equal((await adminAccess(request('access', 'POST', { role: 'super_admin', code: '123456' }))).status, 400);
    assert.equal((await adminAccess(request('access', 'POST', { role: 'owner', code: '123456' }))).status, 400);
    assert.equal((await adminAccess(request('access', 'POST', { role: 'admin', code: '123' }))).status, 400);

    const code = await computeTotpForTest(adminSecret);
    const verified = await adminAccess(request('access', 'POST', { role: 'admin', code }));
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
    assert.ok(!cookie.includes('Domain='));
    const token = cookie.split(';')[0].slice(ADMIN_COOKIE.length + 1);
    assert.deepEqual(await (await adminAccess(request('access', 'GET', undefined, token))).json(), { role: 'admin' });
    delete process.env.YBUY_SUPER_ADMIN_TOTP_SECRET;
    assert.equal((await adminAccess(request('access', 'POST', { role: 'admin', code }))).status, 503);
    process.env.YBUY_SUPER_ADMIN_TOTP_SECRET = superAdminSecret;
    assert.equal((await adminAccess(request('access', 'GET', undefined, `${token}tampered`))).status, 401);
    assert.equal((await superAdminAccess(superRequest('access', 'GET', undefined, token))).status, 401);
    const expired = await signAdminAccess('admin', Date.now() - 3 * 3600000);
    assert.equal((await adminProfiles(request('profiles', 'GET', undefined, expired.token))).status, 401);
    const response = await adminProfiles(request('profiles', 'GET', undefined, token));
    assert.deepEqual(await response.json(), [{ id: 'admin-id', name: 'Test Admin', role: 'Admin' }]);
    assert.deepEqual(await (await adminProfiles(request('profiles', 'POST', { id: 'admin-id' }, token))).json(), { tokenHash: 'test-hash' });
    for (const deniedId of ['super-id', 'owner-id', 'real-id', 'unknown']) {
      assert.equal((await adminProfiles(request('profiles', 'POST', { id: deniedId }, token))).status, 403);
    }
    const superCode = await computeTotpForTest(superAdminSecret);
    assert.equal((await superAdminAccess(superRequest('access', 'POST', { role: 'super_admin', code }))).status, 401);
    const superVerified = await superAdminAccess(superRequest('access', 'POST', { role: 'super_admin', code: superCode }));
    assert.equal(superVerified.status, 200);
    const superToken = superVerified.headers.get('set-cookie').split(';')[0].slice(ADMIN_COOKIE.length + 1);
    assert.deepEqual(await (await superAdminAccess(superRequest('access', 'GET', undefined, superToken))).json(), { role: 'super_admin' });
    assert.equal((await adminAccess(request('access', 'GET', undefined, superToken))).status, 401);
    assert.deepEqual(await (await superAdminProfiles(superRequest('profiles', 'GET', undefined, superToken))).json(),
      [{ id: 'super-id', name: 'Test Super Admin', role: 'Super Admin' }]);
    assert.equal((await superAdminProfiles(superRequest('profiles', 'POST', { id: 'admin-id' }, superToken))).status, 403);
    assert.deepEqual(await (await superAdminProfiles(superRequest('profiles', 'POST', { id: 'super-id' }, superToken))).json(),
      { tokenHash: 'test-hash' });
    const formCode = await computeTotpForTest(superAdminSecret);
    const formRequest = new Request(`${origin}/api/super-admin/access`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ role: 'super_admin', code: formCode }),
    });
    assert.equal((await superAdminAccess(formRequest)).status, 200);

    const adminRow = rows.find(row => row.user_id === 'admin-id');
    adminRow.active = false;
    assert.equal((await adminProfiles(request('profiles', 'POST', { id: 'admin-id' }, token))).status, 503);
    adminRow.active = true;
    adminRow.role = 'super_admin';
    assert.equal((await adminProfiles(request('profiles', 'POST', { id: 'admin-id' }, token))).status, 503);
    adminRow.role = 'admin';
    const adminUser = users.find(user => user.id === 'admin-id');
    adminUser.app_metadata = {};
    assert.equal((await adminProfiles(request('profiles', 'POST', { id: 'admin-id' }, token))).status, 503);
    adminUser.app_metadata = { local_test_fixture: 'ybuy-local-lifecycle-v1' };
    mintMismatch = true;
    assert.equal((await adminProfiles(request('profiles', 'POST', { id: 'admin-id' }, token))).status, 502);
    mintMismatch = false;
    const expiredSuperAdmin = await signAdminAccess('super_admin', Date.now() - 3 * 3600000);
    assert.equal((await superAdminAccess(superRequest('access', 'GET', undefined, expiredSuperAdmin.token))).status, 401);
    assert.equal((await superAdminProfiles(superRequest('profiles', 'GET', undefined, expiredSuperAdmin.token))).status, 401);
    permitted = false;
    assert.equal((await adminAccess(request('access', 'POST', { role: 'admin', code: '123456' }))).status, 429);
    backendError = true;
    assert.equal((await adminAccess(request('access', 'POST', { role: 'admin', code: '123456' }))).status, 503);
    backendError = false;
    const logout = await adminAccess(request('access', 'DELETE'));
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    process.env.YBUY_TEMP_ACCESS_ENABLED = 'true';
    assert.equal((await middleware(new Request(`${origin}/`))).headers.get('x-middleware-next'), '1');
    assert.equal((await middleware(new Request('https://unapproved.vercel.app/'))).status, 404);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
});
