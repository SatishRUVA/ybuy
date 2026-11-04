import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_TEST_PROFILE_LOGIN': '"true"',
    'import.meta.env.VITE_TEST_ENVIRONMENT': '"true"',
    'window.location.hostname': '"ybuy-redesign-v1.vercel.app"',
  },
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
after(() => server.close());
const { HOSTED_PROFILE_LOGIN, loadLocalProfiles } = await server.ssrLoadModule('/src/lib/local-profile-login.ts');

test('customer profile loader accepts 10 customer profiles and rejects administrator roles', async () => {
  assert.equal(HOSTED_PROFILE_LOGIN, true);
  const originalFetch = globalThis.fetch;
  const profiles = [
    ...['Owner', 'Renter'].flatMap(role => Array.from({ length: 5 }, (_, index) => ({
      id: `${role}${index}`, name: `Test ${role} ${index}`, role,
    }))),
  ];
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/test-profiles');
      assert.equal(options.cache, 'no-store');
      return Response.json(profiles);
    };
    assert.deepEqual(await loadLocalProfiles(), profiles);
    for (const invalid of [[], [...profiles, profiles[0]], ...['Unknown', 'Admin', 'Super Admin'].map(role => [{ ...profiles[0], role }])]) {
      globalThis.fetch = async () => Response.json(invalid);
      await assert.rejects(loadLocalProfiles(), /Test profile list is invalid/);
    }
    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(loadLocalProfiles(), /Verify your tester security code/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
