import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import handler from './test-profiles.js';

test('hosted test profiles remain unavailable without the tester MFA session', async () => {
  const variables = {
    YBUY_TEST_PROFILE_LOGIN: 'true',
    YBUY_TEST_PROFILE_ALLOWED_HOSTS: 'test.example',
    YBUY_ACCESS_SESSION_SECRET: 'test-session-secret',
    YBUY_TOTP_SECRET: 'TESTSECRET',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    VITE_SUPABASE_URL: 'https://jzyjmsixfuwzfnntewqn.supabase.co',
  };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  Object.assign(process.env, variables);
  try {
    for (const method of ['GET', 'POST']) {
      const response = await handler(new Request('https://test.example/api/test-profiles', {
        method, headers: { origin: 'https://test.example' },
      }));
      assert.equal(response.status, 401);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
