import assert from 'node:assert/strict';
import test from 'node:test';
import access from '../api/admin/access.js';
import profiles from '../api/admin/profiles.js';
import { ADMIN_COOKIE, signAdminAccess, TEST_BACKEND } from '../api/_lib/admin-access.js';
import { computeTotpForTest, signAccessSession } from '../api/_lib/access-session.js';
import middleware from '../middleware.js';

test('admin portal enforces distinct TOTP, host, role, fixture, expiry and rate-limit boundaries', async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const origin = 'https://ybuy-admin.vercel.app';
  const adminSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const superSecret = 'KRUGS4ZANFZSAYJAORSXG5BAN5XW45DF';
  const request = (endpoint, method = 'GET', body, token, host = origin) => new Request(`${host}/api/admin/${endpoint}`, {
    method, headers: { origin: host, ...(token ? { cookie: `${ADMIN_COOKIE}=${token}` } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
    assert.equal((await access(request('access'))).status, 404);
    assert.equal((await profiles(request('profiles'))).status, 404);
    Object.assign(process.env, {
      YBUY_ADMIN_PORTAL: 'true', YBUY_ADMIN_TOTP_SECRET: adminSecret, YBUY_SUPER_ADMIN_TOTP_SECRET: superSecret,
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
    for (const handler of [access, profiles]) {
      assert.equal((await handler(request('access', 'GET', undefined, undefined, 'https://ybuy-e2e-test.vercel.app'))).status, 404);
      assert.equal((await handler(request('access', 'PUT'))).status, 405);
      assert.equal((await handler(new Request(`${origin}/api/admin/access`, { method: 'POST' }))).status, 403);
      assert.equal((await handler(request('access'))).status, 401);
    }
    process.env.YBUY_SUPER_ADMIN_TOTP_SECRET = adminSecret;
    assert.equal((await access(request('access'))).status, 503);
    process.env.YBUY_SUPER_ADMIN_TOTP_SECRET = superSecret;
    const customer = await signAccessSession(process.env.YBUY_ACCESS_SESSION_SECRET);
    assert.equal((await access(request('access', 'GET', undefined, customer.token))).status, 401);
    assert.equal((await access(request('access', 'POST', { role: 'owner', code: '123456' }))).status, 400);
    assert.equal((await access(request('access', 'POST', { role: 'admin', code: '123' }))).status, 400);

    for (const [role, secret, id, label] of [
      ['admin', adminSecret, 'admin-id', 'Admin'], ['super_admin', superSecret, 'super-id', 'Super Admin'],
    ]) {
      const code = await computeTotpForTest(secret);
      const wrongRole = role === 'admin' ? 'super_admin' : 'admin';
      assert.equal((await access(request('access', 'POST', { role: wrongRole, code }))).status, 401);
      const verified = await access(request('access', 'POST', { role, code }));
      assert.equal(verified.status, 200);
      const cookie = verified.headers.get('set-cookie');
      assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
      assert.ok(!cookie.includes('Domain='));
      const token = cookie.split(';')[0].slice(ADMIN_COOKIE.length + 1);
      assert.deepEqual(await (await access(request('access', 'GET', undefined, token))).json(), { role });
      assert.equal((await access(request('access', 'GET', undefined, `${token}tampered`))).status, 401);
      const expired = await signAdminAccess(role, Date.now() - 3 * 3600000);
      assert.equal((await profiles(request('profiles', 'GET', undefined, expired.token))).status, 401);
      const response = await profiles(request('profiles', 'GET', undefined, token));
      assert.deepEqual(await response.json(), [{ id, name: `Test ${label}`, role: label }]);
      assert.deepEqual(await (await profiles(request('profiles', 'POST', { id }, token))).json(), { tokenHash: 'test-hash' });
      for (const deniedId of [role === 'admin' ? 'super-id' : 'admin-id', 'owner-id', 'real-id', 'unknown']) {
        assert.equal((await profiles(request('profiles', 'POST', { id: deniedId }, token))).status, 403);
      }
      const row = rows.find(row => row.user_id === id);
      row.active = false;
      assert.equal((await profiles(request('profiles', 'POST', { id }, token))).status, 503);
      row.active = true;
      row.role = wrongRole;
      assert.equal((await profiles(request('profiles', 'POST', { id }, token))).status, 503);
      row.role = role;
      const user = users.find(user => user.id === id);
      user.app_metadata = {};
      assert.equal((await profiles(request('profiles', 'POST', { id }, token))).status, 503);
      user.app_metadata = { local_test_fixture: 'ybuy-local-lifecycle-v1' };
      mintMismatch = true;
      assert.equal((await profiles(request('profiles', 'POST', { id }, token))).status, 502);
      mintMismatch = false;
    }
    permitted = false;
    assert.equal((await access(request('access', 'POST', { role: 'admin', code: '123456' }))).status, 429);
    backendError = true;
    assert.equal((await access(request('access', 'POST', { role: 'admin', code: '123456' }))).status, 503);
    backendError = false;
    const logout = await access(request('access', 'DELETE'));
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
