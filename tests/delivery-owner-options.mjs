import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createServer } from 'vite';

test('listing delivery options map safely before and after the migration', async () => {
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
    const { toUiListing } = await server.ssrLoadModule('/src/lib/listings.ts');
    const row = {
      id: 'listing', owner_id: 'owner', title: 'Test', price_per_day: 10, deposit: 0,
      created_at: '2026-01-01', listing_images: [], status: 'draft',
    };
    const old = toUiListing(row);
    assert.equal(old.deliveryRoundTripDiscount, 0);
    assert.equal(old.deliverySetupAvailable, false);
    assert.equal(old.deliverySetupFee, 0);
    assert.deepEqual(old.deliveryGuaranteedWindows, []);
    const configured = toUiListing({
      ...row, delivery_round_trip_discount: 12.5, delivery_setup_available: true,
      delivery_setup_fee: 20, delivery_guaranteed_windows: ['morning', 'evening'],
    });
    assert.equal(configured.deliveryRoundTripDiscount, 12.5);
    assert.equal(configured.deliverySetupAvailable, true);
    assert.equal(configured.deliverySetupFee, 20);
    assert.deepEqual(configured.deliveryGuaranteedWindows, ['morning', 'evening']);
  } finally {
    await server.close();
  }
});
