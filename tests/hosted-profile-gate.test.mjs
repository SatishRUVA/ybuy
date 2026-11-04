import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/test-profiles.js';
import { signAccessSession } from '../api/_lib/access-session.js';

test('customer picker fails closed and excludes every administrator fixture', async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const origin = 'https://ybuy-redesign-v1.vercel.app';
  const e2eOrigin = 'https://ybuy-e2e-test.vercel.app';
  const request = (options = {}, host = origin) => new Request(`${host}/api/test-profiles`, options);
  const id = '10000000-0000-4000-8000-000000000001';
  const adminId = '10000000-0000-4000-8000-000000000002';
  const testAdminId = '10000000-0000-4000-8000-000000000003';
  const superAdminId = '10000000-0000-4000-8000-000000000004';
  const adminRows = [
    { user_id: adminId, role: 'admin', active: true },
    { user_id: testAdminId, role: 'admin', active: true },
    { user_id: superAdminId, role: 'super_admin', active: true },
  ];
  let calls = 0;
  try {
    process.env.YBUY_TEST_PROFILE_LOGIN = 'false';
    assert.equal((await handler(request())).status, 404);
    process.env.YBUY_TEST_PROFILE_LOGIN = 'true';
    assert.equal((await handler(request({}, 'https://another.vercel.app'))).status, 404);
    delete process.env.YBUY_TOTP_SECRET;
    assert.equal((await handler(request())).status, 503);
    process.env.YBUY_TOTP_SECRET = 'TEST-ONLY';
    process.env.YBUY_ACCESS_SESSION_SECRET = 'test-only-session-secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key';
    process.env.VITE_SUPABASE_URL = 'https://jzyjmsixfuwzfnntewqn.supabase.co';
    assert.equal((await handler(request())).status, 401);
    assert.equal((await handler(request({}, e2eOrigin))).status, 401);
    const { token } = await signAccessSession(process.env.YBUY_ACCESS_SESSION_SECRET);
    const headers = { cookie: `ybuy_access=${token}`, origin };
    assert.equal((await handler(request({ headers: { cookie: `ybuy_access=${token}tampered` } }))).status, 401);
    const expired = await signAccessSession(process.env.YBUY_ACCESS_SESSION_SECRET, Date.now() - 3 * 3600000);
    assert.equal((await handler(request({ headers: { cookie: `ybuy_access=${expired.token}` } }))).status, 401);
    assert.equal((await handler(request({ method: 'POST', headers: { ...headers, origin: 'https://other.example' } }))).status, 403);
    globalThis.fetch = async (input, options) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, process.env.VITE_SUPABASE_URL);
      if (url.pathname.endsWith('/admin/users')) return Response.json({ users: [
        { id, email: 'owner1@example.test', app_metadata: { local_test_fixture: 'ybuy-local-lifecycle-v1' }, user_metadata: { full_name: 'Test owner' } },
        { id: adminId, email: 'renter1@example.test', app_metadata: { local_test_fixture: 'ybuy-local-lifecycle-v1' }, user_metadata: {} },
        { id: testAdminId, email: 'admin@example.test', app_metadata: { local_test_fixture: 'ybuy-local-lifecycle-v1' }, user_metadata: { full_name: 'Test Admin' } },
        { id: superAdminId, email: 'super-admin@example.test', app_metadata: { local_test_fixture: 'ybuy-local-lifecycle-v1' }, user_metadata: { full_name: 'Test Super Admin' } },
        { id: 'unapproved-admin', email: 'other-admin@example.test', app_metadata: { local_test_fixture: 'ybuy-local-lifecycle-v1' }, user_metadata: {} },
        { id: 'unmarked', email: 'owner2@example.test', app_metadata: {}, user_metadata: {} },
        { id: 'real', email: 'real@example.com', app_metadata: {}, user_metadata: {} },
      ] });
      if (url.pathname.endsWith('/admin_users')) return Response.json(adminRows);
      if (url.pathname.endsWith('/generate_link')) {
        const email = JSON.parse(options.body).email;
        const selectedId = { 'owner1@example.test': id, 'admin@example.test': testAdminId, 'super-admin@example.test': superAdminId }[email];
        assert.ok(selectedId);
        return Response.json({ id: selectedId, email, hashed_token: 'test-only-hash', action_link: 'https://example.test', email_otp: '123456', verification_type: 'magiclink', app_metadata: {}, user_metadata: {} });
      }
      throw new Error(`Unexpected backend request: ${url.pathname}`);
    };
    const expected = [{ id, name: 'Test owner', role: 'Owner' }];
    assert.deepEqual(await (await handler(request({ headers }))).json(), expected);
    assert.deepEqual(await (await handler(request({ headers }, e2eOrigin))).json(), expected);
    const post = chosenId => request({ method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: chosenId }) });
    assert.equal((await handler(post(adminId))).status, 403);
    assert.equal((await handler(post('real'))).status, 403);
    assert.equal((await handler(post('unmarked'))).status, 403);
    assert.equal((await handler(post('unapproved-admin'))).status, 403);
    assert.deepEqual(await (await handler(post(id))).json(), { tokenHash: 'test-only-hash' });
    for (const chosenId of [testAdminId, superAdminId]) {
      assert.equal((await handler(post(chosenId))).status, 403);
    }
    for (const row of adminRows.slice(1)) {
      row.active = false;
      assert.equal((await handler(post(row.user_id))).status, 403);
      assert.equal((await (await handler(request({ headers }))).json()).some(profile => profile.id === row.user_id), false);
      row.active = true;
      const originalRole = row.role;
      row.role = originalRole === 'admin' ? 'super_admin' : 'admin';
      assert.equal((await handler(post(row.user_id))).status, 403);
      row.role = originalRole;
    }
    adminRows.splice(1);
    assert.deepEqual(await (await handler(request({ headers }))).json(), [expected[0]]);
    assert.equal((await handler(post(testAdminId))).status, 403);
    assert.equal((await handler(post(superAdminId))).status, 403);
    assert.ok(calls > 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
});
