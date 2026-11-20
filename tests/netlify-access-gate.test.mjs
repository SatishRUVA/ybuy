import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCESS_COOKIE_NAME, signAccessSession } from '../api/_lib/access-session.js';
import accessGate from '../netlify/edge-functions/access-gate.js';

test('combined Netlify site gate protects both role routes before their separate TOTP checks', async () => {
  const originalNetlify = globalThis.Netlify;
  const sessionSecret = 'test-only-site-session-secret-with-more-than-32-characters';
  const env = {
    YBUY_ADMIN_PORTAL: 'true',
    YBUY_ADMIN_HOST: 'ybuys.netlify.app',
    YBUY_TEMP_ACCESS_ENABLED: 'true',
    YBUY_ACCESS_SESSION_SECRET: sessionSecret,
  };
  globalThis.Netlify = { env: { get: name => env[name] } };
  try {
    for (const path of ['/admin', '/super-admin']) {
      const request = new Request(`https://ybuys.netlify.app${path}`);
      const denied = await accessGate(request, { next: () => new Response('next') });
      assert.equal(denied.status, 307);
      assert.equal(new URL(denied.headers.get('location')).pathname, '/access');
      const session = await signAccessSession(sessionSecret);
      const allowed = await accessGate(new Request(request, {
        headers: { cookie: `${ACCESS_COOKIE_NAME}=${session.token}` },
      }), { next: () => new Response('next') });
      assert.equal(await allowed.text(), 'next');
    }
    const wrongHost = await accessGate(new Request('https://other.netlify.app/admin'), {
      next: () => new Response('next'),
    });
    assert.equal(wrongHost.status, 404);
  } finally {
    if (originalNetlify === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = originalNetlify;
  }
});
