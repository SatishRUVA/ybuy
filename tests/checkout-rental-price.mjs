import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('checkout shows daily rentals as one rental charge and preserves package breakdowns', async () => {
  const server = await createServer({
    configFile: false, envFile: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': resolve('src') } },
  });
  try {
    const { CheckoutRentalPrice } = await server.ssrLoadModule('/src/main-site/components/checkout-rental-price.tsx');
    const daily = renderToStaticMarkup(createElement(CheckoutRentalPrice, {
      quantity: 1, days: 1, dailyRate: 14, rental: 14, createdBooking: false,
      quote: { package_kind: null, package_amount: 0, extra_days: 1, extra_days_amount: 14, discount_amount: 0 },
    }));
    assert.match(daily, /Rental · \$14\.00 × 1 day × 1 unit/);
    assert.match(daily, /\$14\.00<\/span>/);
    assert.doesNotMatch(daily, /extra days|\$0\.00/);
    const weekly = renderToStaticMarkup(createElement(CheckoutRentalPrice, {
      quantity: 1, days: 8, dailyRate: 14, rental: 84, createdBooking: false,
      quote: { package_kind: 'weekly', package_days: 7, package_amount: 80, extra_days: 1, extra_days_amount: 14, discount_amount: 10 },
    }));
    assert.match(weekly, /Weekly package/);
    assert.match(weekly, /Package savings/);
    assert.match(weekly, /1 extra day at the daily rate/);
    assert.match(weekly, /\$80\.00/);
  } finally {
    await server.close();
  }
});
