import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
after(() => server.close());
const { fetchConfirmedPayment } = await server.ssrLoadModule('/src/lib/payments.ts');
const { supabase } = await server.ssrLoadModule('/src/lib/supabase.ts');
const bookingId = '516d6fa7-3950-4eb0-99b1-2fc9f2f9fccf';
const cases = [
  { name: 'dollar receipt matches dollar booking total', amount: 14.84, total: 14.84, valid: true },
  { name: 'numeric database string retains dollar units', amount: '14.84', total: 14.84, valid: true },
  { name: 'floating point booking total matches to cents', amount: 0.3, total: 0.1 + 0.2, valid: true },
  { name: 'one cent mismatch is rejected', amount: 14.83, total: 14.84 },
  { name: 'cents interpreted as dollars are rejected', amount: 1484, total: 14.84 },
  { name: 'different currency is rejected', amount: 14.84, total: 14.84, currency: 'eur' },
  { name: 'unsettled payment is rejected', amount: 14.84, total: 14.84, status: 'pending' },
  { name: 'invalid payment is rejected', amount: 'invalid', total: 14.84 },
  { name: 'invalid booking total is rejected', amount: 14.84, total: NaN },
  { name: 'missing receipt stays unverified', missing: true, total: 14.84 },
];

for (const scenario of cases) {
  test(scenario.name, async () => {
    const originalFrom = supabase.from;
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({
        data: scenario.missing ? null : { amount: scenario.amount,
          currency: scenario.currency ?? 'usd', status: scenario.status ?? 'succeeded' },
        error: null,
      }),
    };
    supabase.from = table => {
      assert.equal(table, 'payments');
      return query;
    };
    try {
      if (scenario.valid) {
        assert.deepEqual(await fetchConfirmedPayment(bookingId, scenario.total),
          { amount: Number(scenario.amount), currency: 'USD' });
      } else if (scenario.missing) {
        assert.equal(await fetchConfirmedPayment(bookingId, scenario.total), null);
      } else {
        await assert.rejects(fetchConfirmedPayment(bookingId, scenario.total), /payment/i);
      }
    } finally {
      supabase.from = originalFrom;
    }
  });
}
