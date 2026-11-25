import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createServer } from 'vite';

test('case evidence displays original filenames without storage identifiers', async () => {
  const server = await createServer({
    configFile: false, envFile: false, appType: 'custom',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-key'),
    },
    server: { middlewareMode: true },
    resolve: { alias: { '@': resolve('src') } },
  });
  try {
    const { supabase } = await server.ssrLoadModule('/src/lib/supabase.ts');
    const { getCase } = await server.ssrLoadModule('/src/lib/operations.ts');
    const paths = [
      'case/user/12345678-1234-1234-1234-123456789abc-photo.jpg',
      'case/user/legacy-photo.jpg',
      'case/user/12345678-1234-1234-1234-123456789abc-',
    ];
    supabase.rpc = async () => ({
      data: {
        case: {}, replies: [], events: [], booking: null, deadline_policy_unresolved: false,
        evidence: paths.map((object_path) => ({ object_path })),
      },
      error: null,
    });

    const detail = await getCase('internal-case-id');
    assert.deepEqual(detail.evidence.map((item) => item.file_name), ['photo.jpg', 'legacy-photo.jpg', 'Evidence']);
    assert.deepEqual(detail.evidence.map((item) => item.path), paths);
  } finally {
    await server.close();
  }
});
