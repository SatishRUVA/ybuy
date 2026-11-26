import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('checkout protection displays its optional price and selection state', async () => {
  const server = await createServer({
    configFile: false, envFile: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': resolve('src') } },
  });
  try {
    const { InsuranceAmount } = await server.ssrLoadModule('/src/main-site/components/insurance-amount.tsx');
    const render = (selected, disabled = false) => renderToStaticMarkup(createElement(InsuranceAmount, {
      days: 2, replacementValue: 50, quantity: 3, selected, disabled, onSelectionChange() {},
    }));
    const off = render(false);
    const on = render(true);
    assert.match(off, /Add rental protection/);
    assert.match(off, /Accidental damage and theft/);
    assert.match(off, /href="\/protection"/);
    assert.match(off, /\+\$3\.00/);
    assert.match(off, /role="switch"[^>]*aria-checked="false"/);
    assert.match(on, /role="switch"[^>]*aria-checked="true"/);
    assert.match(render(false, true), /disabled=""/);
  } finally {
    await server.close();
  }
});
