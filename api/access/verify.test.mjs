import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import handler from './verify.js';
import { signAccessSession, verifyAccessSession } from '../_lib/access-session.js';

test('security sessions expire exactly four hours after they are issued', async () => {
  const now = 1_700_000_000_000;
  const session = await signAccessSession('test-session-secret', now);
  assert.equal(session.expiresAt, now + 4 * 60 * 60 * 1000);
  assert.equal(await verifyAccessSession('test-session-secret', session.token, session.expiresAt - 1), true);
  assert.equal(await verifyAccessSession('test-session-secret', session.token, session.expiresAt), false);
});

test('checking tester access requires an unexpired signed cookie', async () => {
  const previousEnabled = process.env.YBUY_TEST_PROFILE_LOGIN;
  const previousSecret = process.env.YBUY_ACCESS_SESSION_SECRET;
  process.env.YBUY_TEST_PROFILE_LOGIN = 'true';
  process.env.YBUY_ACCESS_SESSION_SECRET = 'test-session-secret';
  try {
    const url = 'https://test.example/api/access/verify';
    const request = token => handler(new Request(url, {
      headers: token ? { cookie: `ybuy_access=${token}` } : {},
    }));
    assert.equal((await request()).status, 401);
    assert.equal((await request('invalid')).status, 401);
    const expired = await signAccessSession(process.env.YBUY_ACCESS_SESSION_SECRET, Date.now() - 5 * 60 * 60 * 1000);
    assert.equal((await request(expired.token)).status, 401);
    const valid = await signAccessSession(process.env.YBUY_ACCESS_SESSION_SECRET);
    const response = await request(valid.token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    delete process.env.YBUY_ACCESS_SESSION_SECRET;
    assert.equal((await request(valid.token)).status, 503);
  } finally {
    if (previousEnabled === undefined) delete process.env.YBUY_TEST_PROFILE_LOGIN;
    else process.env.YBUY_TEST_PROFILE_LOGIN = previousEnabled;
    if (previousSecret === undefined) delete process.env.YBUY_ACCESS_SESSION_SECRET;
    else process.env.YBUY_ACCESS_SESSION_SECRET = previousSecret;
  }
});

test('locking a tester session clears its cookie only for same-origin requests', async () => {
  const previous = process.env.YBUY_TEST_PROFILE_LOGIN;
  process.env.YBUY_TEST_PROFILE_LOGIN = 'true';
  try {
    const sameOrigin = await handler(new Request('https://test.example/api/access/verify', {
      method: 'DELETE', headers: { origin: 'https://test.example' },
    }));
    assert.equal(sameOrigin.status, 200);
    assert.match(sameOrigin.headers.get('set-cookie'), /^ybuy_access=;.*Max-Age=0/i);

    const crossOrigin = await handler(new Request('https://test.example/api/access/verify', {
      method: 'DELETE', headers: { origin: 'https://other.example' },
    }));
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get('set-cookie'), null);
  } finally {
    if (previous === undefined) delete process.env.YBUY_TEST_PROFILE_LOGIN;
    else process.env.YBUY_TEST_PROFILE_LOGIN = previous;
  }
});
