import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('checkout links preserve delivery selection across a reload', async () => {
  const server = await createServer({
    configFile: false,
    resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { RouterProvider, RouteLink, useRouter } = await server.ssrLoadModule('/src/router.tsx');
    const route = { name: 'checkout', id: 'item', startDate: '2026-12-10', endDate: '2026-12-13', deliveryMode: 'delivery' };
    globalThis.window = { location: { pathname: '/', search: '' } };
    const link = renderToStaticMarkup(createElement(RouterProvider, null, createElement(RouteLink, { route }, 'Checkout')));
    const href = /href="([^"]+)"/.exec(link)[1].replaceAll('&amp;', '&');
    const url = new URL(href, 'https://example.test');
    globalThis.window.location = { pathname: url.pathname, search: url.search };
    function CurrentRoute() { return createElement('output', null, JSON.stringify(useRouter().route)); }
    const markup = renderToStaticMarkup(createElement(RouterProvider, null, createElement(CurrentRoute)));
    assert.match(markup, /&quot;deliveryMode&quot;:&quot;delivery&quot;/);
    globalThis.window.location.search = '?delivery=invalid';
    const invalid = renderToStaticMarkup(createElement(RouterProvider, null, createElement(CurrentRoute)));
    assert.doesNotMatch(invalid, /deliveryMode/);
  } finally {
    delete globalThis.window;
    await server.close();
  }
});
