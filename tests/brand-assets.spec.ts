import { expect, test } from '@playwright/test';

test('latest supplied logo stays readable in both themes and compact navigation fits on phones', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/rest/v1/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  const home = page.getByRole('button', { name: 'YBuy home', exact: true });
  const logo = home.locator('img[src*="ybuy-logo"]');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1882);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(logo).toBeVisible();
  await expect(logo).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(home.locator('img[src*="ybuy-icon"]')).toBeVisible();
  await expect(logo).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('favicon, touch icons and manifest reference the supplied brand assets', async ({ page, request }) => {
  await page.goto('/access');
  await expect(page.getByRole('img', { name: 'YBuy', exact: true })).toBeVisible();
  const favicon = page.locator('link[rel="icon"]');
  await expect(favicon).toHaveAttribute('href', '/favicon.ico?v=20261026');
  for (const path of ['/favicon.ico', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/ybuy-social.png']) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(response.headers()['content-type'], path).toMatch(/^image\//);
  }
  const manifest = await (await request.get('/site.webmanifest')).json();
  expect(manifest.name).toBe('YBuy');
  expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(['/icon-192.png', '/icon-512.png']);
});
