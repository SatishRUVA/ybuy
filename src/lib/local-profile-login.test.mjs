import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

async function loadProfileModule(variant, pathname, { hostname = 'test.example', port = '', local = false } = {}) {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SITE_VARIANT': JSON.stringify(variant),
      'import.meta.env.VITE_TEST_ENVIRONMENT': '"true"',
      'import.meta.env.VITE_TEST_PROFILE_LOGIN': '"true"',
      'import.meta.env.VITE_TEST_PROFILE_HOSTS': '"test.example"',
      'import.meta.env.DEV': JSON.stringify(local),
      'import.meta.env.VITE_LOCAL_PROFILE_LOGIN': JSON.stringify(local),
    },
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
    build: { ssr: fileURLToPath(new URL('./local-profile-login.ts', import.meta.url)), write: false },
  });
  globalThis.window = { location: { hostname, port, pathname } };
  const code = result.output.find(item => item.type === 'chunk').code;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${hostname}:${port}`);
}

test('local profile login works on loopback hosts at different ports', async () => {
  const previousWindow = globalThis.window;
  try {
    for (const hostname of ['localhost', '127.0.0.1']) {
      for (const port of ['5189', '5300']) {
        const module = await loadProfileModule('main', '/', { hostname, port, local: true });
        assert.equal(module.LOCAL_PROFILE_LOGIN, true);
        assert.equal(module.PROFILE_ENDPOINT, '/api/local-profiles');
      }
    }
    const remote = await loadProfileModule('main', '/', { hostname: 'dev.example.test', port: '5189', local: true });
    assert.equal(remote.LOCAL_PROFILE_LOGIN, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('combined admin and super-admin use the shared tester profile endpoint', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(url);
    return Response.json([
      { id: 'admin', name: 'Admin', role: 'Admin' },
      { id: 'super', name: 'Super Admin', role: 'Super Admin' },
    ]);
  };
  try {
    for (const pathname of ['/admin', '/super-admin']) {
      const module = await loadProfileModule('combined', pathname);
      assert.equal((await module.loadLocalProfiles()).length, 2);
    }
    assert.deepEqual(requests, ['/api/test-profiles', '/api/test-profiles']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('dedicated admin portal retains role-specific profile endpoint', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, '/api/super-admin/profiles');
    return Response.json([{ id: 'super', name: 'Super Admin', role: 'Super Admin' }]);
  };
  try {
    const module = await loadProfileModule('admin', '/super-admin');
    assert.equal((await module.loadLocalProfiles())[0].role, 'Super Admin');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
