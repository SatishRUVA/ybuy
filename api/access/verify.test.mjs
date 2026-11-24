import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import handler from './verify.js';

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
