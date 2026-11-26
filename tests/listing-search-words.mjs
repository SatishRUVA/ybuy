import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createServer } from 'vite';

test('listing search uses word matching with and without location filters', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init });
    const body = url.pathname.endsWith('/rpc/search_available_listings')
      ? { rows: [], total: 0 }
      : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': '*/0' },
    });
  };
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
    const { searchListings } = await server.ssrLoadModule('/src/lib/listings.ts');
    await searchListings({ keyword: 'table' });
    assert.equal(requests[0].url.searchParams.get('listing_search_document'), 'plfts(english).table');
    assert.doesNotMatch(requests[0].url.searchParams.toString(), /description\.ilike/);

    await searchListings({ keyword: 'table', latitude: 32.8, longitude: -96.8 });
    assert.equal(requests[1].url.pathname, '/rest/v1/rpc/search_available_listings');
    assert.equal(JSON.parse(requests[1].init.body).p_keyword, 'table');
  } finally {
    await server.close();
    globalThis.fetch = originalFetch;
  }
});
