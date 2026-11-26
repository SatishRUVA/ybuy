import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('listing date trigger shows the rental duration without changing the existing picker', async () => {
  const server = await createServer({
    configFile: false, envFile: false, appType: 'custom',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-key'),
    },
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': resolve('src') } },
  });
  try {
    const { DateRangePicker } = await server.ssrLoadModule('/src/main-site/components/date-range-picker.tsx');
    const render = (endDate, compactTrigger) => renderToStaticMarkup(createElement(DateRangePicker, {
      presentation: 'listing', startDate: '2026-11-25', endDate, compactTrigger, onChange() {},
    }));

    assert.match(render('2026-11-26', true), />1 day<\/span>/);
    assert.match(render('2026-11-28', true), />3 days<\/span>/);
    assert.match(render('2026-11-26', true), /Nov 25 → .*Nov 26<\/span>/);
    assert.match(render('2027-01-02', true), /2026.*→.*2027<\/span>/);
    assert.match(render('2026-11-26', false), />Pickup<\/span>/);
    assert.match(render('2026-11-26', false), />Return<\/span>/);
  } finally {
    await server.close();
  }
});
