import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

const categories = [
  'Tools & Equipment', 'Electronics', 'Outdoor & Camping', 'Party & Events',
  'Sports & Fitness', 'Vehicles', 'Home & Garden', 'Other',
].map((name, index) => ({
  id: `20000000-0000-4000-8000-00000000000${index + 1}`,
  name, icon: 'Package', active: true, sort_order: index,
}));
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=', 'base64');
test.setTimeout(60_000);

async function setup(page: Page) {
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:\d+\/(?!realtime)/, () => {});
  await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://images.pexels.com/**', (route) => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/src/lib/geo.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(/const key = [^\n]+;/g, 'const key = "test-map-key";') });
  });
  await page.route('**/api.maptiler.com/geocoding/**', (route) => route.fulfill({ json: { features: [{
    text: 'Dallas', center: [-96.8, 32.8], place_type: ['municipality'],
    context: [{ id: 'region.1', text: 'Texas' }, { id: 'country.1', text: 'United States' }],
  }] } }));
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/app_settings')) return route.fulfill({ json: { value: ['US'] } });
    if (path.endsWith('/reference_countries')) return route.fulfill({ json: [{ code: 'US', name: 'United States' }] });
    if (path.endsWith('/categories')) return route.fulfill({ json: categories });
    if (path.endsWith('/search_available_listings')) return route.fulfill({ json: { rows: [], total: 0 } });
    return route.fulfill({ json: [], headers: { 'content-range': '*/0' } });
  });
}

test.beforeEach(async ({ page }) => setup(page));

for (const category of categories) {
  test(`${category.name} opens its existing filtered marketplace destination`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const section = page.getByRole('region', { name: 'Browse by category' });
    await expect(section.getByRole('button')).toHaveCount(10);
    const request = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return url.pathname.endsWith('/listings') && url.searchParams.get('category_id') === `eq.${category.id}`;
    });
    await section.getByRole('button', { name: category.name, exact: true }).click();
    await request;
    await expect(page).toHaveURL(new RegExp(`/search\\?.*category=${category.id}`));
    await expect(page.getByRole('button', { name: category.name, exact: true }).first()).toBeVisible();
  });
}

test('both discovery actions open full search with the existing category filters', async ({ page }) => {
  for (const name of ['Explore all categories', 'More categories']) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('region', { name: 'Browse by category' }).getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(/\/search(?:\?|$)/);
    expect(new URL(page.url()).searchParams.has('category')).toBe(false);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByRole('button', { name: 'All categories', exact: true }).first()).toBeVisible();
  }
});

for (const [width, height, columns] of [[375, 812, 4], [812, 375, 4], [768, 1024, 4], [1440, 1000, 8]]) {
  test(`consistent cards without horizontal overflow at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const section = page.getByRole('region', { name: 'Browse by category' });
    await expect(section.getByRole('button')).toHaveCount(10);
    const cards = section.locator('.p1-category-grid > button');
    await expect(cards).toHaveCount(8);
    const bounds = await cards.evaluateAll((elements) => elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const media = element.firstElementChild!.getBoundingClientRect();
      const label = element.lastElementChild!.getBoundingClientRect();
      return { x, y, width, height, mediaWidth: media.width, mediaHeight: media.height, mediaTop: media.y - y, labelTop: label.y - y, labelHeight: label.height };
    }));
    expect(bounds.filter((card) => card.y === bounds[0].y)).toHaveLength(columns);
    for (const card of bounds) {
      expect(card.width).toBeGreaterThan(width < 560 ? 70 : 120);
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(width);
      expect(Math.abs(card.width - bounds[0].width)).toBeLessThan(1);
      expect(Math.abs(card.height - bounds[0].height)).toBeLessThan(1);
      expect(Math.abs(card.mediaHeight - bounds[0].mediaHeight)).toBeLessThan(1);
      expect(card.mediaTop).toBe(0);
      expect(Math.abs(card.mediaWidth - card.width)).toBeLessThan(1);
      expect(Math.abs(card.labelTop - bounds[0].labelTop)).toBeLessThan(1);
      expect(Math.abs(card.labelHeight - bounds[0].labelHeight)).toBeLessThan(1);
      expect(card.labelHeight).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const image of await section.locator('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
      await expect(image).toHaveCSS('object-fit', 'cover');
    }
    const sources = await section.locator('img').evaluateAll((images) => images.map((node) => node.getAttribute('src')));
    expect(new Set(sources).size).toBe(8);
  });
}

test('keyboard focus is visible, follows card order and activates category navigation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const section = page.getByRole('region', { name: 'Browse by category' });
  await section.getByRole('button', { name: 'Explore all categories', exact: true }).focus();
  for (const category of categories) {
    await page.keyboard.press('Tab');
    const card = section.getByRole('button', { name: category.name, exact: true });
    await expect(card).toBeFocused();
    await expect(card).toHaveCSS('outline-style', 'solid');
    await expect(card).toHaveCSS('outline-width', '3px');
  }
  await page.keyboard.press('Tab');
  await expect(section.getByRole('button', { name: 'More categories' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`category=${categories[7].id}`));
});

test('Preview 1 hover lifts category cards; reduced motion disables movement', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Browse by category' }).getByRole('button', { name: 'Electronics', exact: true });
  const originalShadow = await card.evaluate((node) => getComputedStyle(node).boxShadow);
  await card.hover();
  await expect(card).toHaveCSS('box-shadow', originalShadow);
  await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -4)');
  await expect(card.locator('img')).toHaveCSS('transform', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card).toHaveCSS('transform', 'none');
  await expect(card.locator('img')).toHaveCSS('transform', 'none');
});

test('failed images and categories without artwork retain labels and navigation', async ({ page }) => {
  await page.route('https://images.pexels.com/**', (route) => route.abort());
  await page.route('**/rest/v1/categories?*', (route) => route.fulfill({ json: [
    categories[0], { ...categories[1], name: 'New community category' },
  ] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const section = page.getByRole('region', { name: 'Browse by category' });
  const tools = section.getByRole('button', { name: categories[0].name, exact: true });
  await tools.scrollIntoViewIfNeeded();
  await expect(tools.getByText('Photo unavailable')).toBeVisible();
  await expect(tools.locator('img')).toHaveCount(0);
  const custom = section.getByRole('button', { name: 'New community category', exact: true });
  await expect(custom.locator('img')).toHaveCount(0);
  await custom.click();
  await expect(page).toHaveURL(new RegExp(`category=${categories[1].id}`));
});

test('loading, empty and failed catalog states stay distinct and retry recovers', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let mode: 'loading' | 'empty' | 'error' | 'ready' = 'loading';
  await page.route('**/rest/v1/categories?*', async (route) => {
    if (mode === 'loading') await pending;
    if (mode === 'error') return route.fulfill({ status: 400, json: { message: 'Catalog unavailable' } });
    return route.fulfill({ json: mode === 'ready' ? categories : [] });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const section = page.getByRole('region', { name: 'Browse by category' });
  await expect(section.getByRole('status')).toHaveText('Loading categories');
  await expect(section.locator('[aria-busy="true"]')).toBeVisible();
  mode = 'empty';
  release();
  await expect(section.getByRole('status')).toContainText('No categories are available yet');
  await expect(section.getByRole('button', { name: 'More categories' })).toBeVisible();
  mode = 'error';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(section.getByRole('status')).toContainText('Categories could not be loaded', { timeout: 15000 });
  await expect(section.getByText('No categories are available yet', { exact: false })).toHaveCount(0);
  mode = 'ready';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(section.getByRole('button')).toHaveCount(10);
  await expect(section.getByRole('status')).toHaveCount(0);
});

test('category discovery retains the selected marketplace location', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ybuy-marketplace-location', JSON.stringify({
    city: 'Dallas', state: 'Texas', country: 'United States', source: 'USER_SELECTED',
    latitude: 32.8, longitude: -96.8,
  })));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const request = page.waitForRequest((req) => req.url().includes('/rpc/search_available_listings') && req.postDataJSON().p_category_id === categories[0].id);
  await page.getByRole('region', { name: 'Browse by category' }).getByRole('button', { name: categories[0].name, exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    p_category_id: categories[0].id, p_latitude: 32.8, p_longitude: -96.8, p_radius_miles: 5,
  });
});
