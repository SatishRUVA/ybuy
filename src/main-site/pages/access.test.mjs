import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('security code has six visual slots and one autofillable input', async () => {
  const server = await createServer({
    configFile: false,
    resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { AccessPage } = await server.ssrLoadModule('/src/main-site/pages/access.tsx');
    const html = renderToStaticMarkup(React.createElement(AccessPage));
    assert.equal((html.match(/data-code-slot/g) ?? []).length, 6);
    assert.equal((html.match(/<input\b/g) ?? []).length, 1);
    assert.match(html, /autocomplete="one-time-code"/i);
  } finally {
    await server.close();
  }
});
