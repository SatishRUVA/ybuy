import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('checkout points use a labeled switch and retain the simulation disclosure', async () => {
  const server = await createServer({
    configFile: false, envFile: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': resolve('src') } },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-key'),
    },
  });
  try {
    const { AuthProvider } = await server.ssrLoadModule('/src/auth-context.tsx');
    const { CheckoutPointsPicker } = await server.ssrLoadModule('/src/main-site/components/rewards.tsx');
    const render = (selected, applied = false) => renderToStaticMarkup(createElement(AuthProvider, null,
      createElement(CheckoutPointsPicker, {
        selected, applied, rentalSubtotal: 14, total: 16.48, disabled: false, onSelectionChange() {},
      })));
    const off = render(false);
    const on = render(true);
    assert.match(off, /Apply YBuy Points/);
    assert.match(off, /role="switch"[^>]*aria-checked="false"/);
    assert.match(off, /role="switch"[^>]*disabled/);
    assert.doesNotMatch(off, /type="range"/);
    assert.match(on, /role="switch"[^>]*aria-checked="true"/);
    assert.match(on, /Points discount \(simulation\)/);
    assert.match(on, /No discount is applied to Stripe/);
    assert.match(render(true, true), /role="switch"[^>]*disabled/);
  } finally {
    await server.close();
  }
});
