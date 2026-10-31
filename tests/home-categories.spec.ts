import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

const categories = [
  'Tools & Equipment', 'Electronics', 'Outdoor & Camping', 'Party & Events',
  'Sports & Fitness', 'Vehicles', 'Home & Garden', 'Other',
].map((name, index) => ({
  id: `20000000-0000-4000-8000-00000000000${index + 1}`,
  name, icon: 'Package', active: true, sort_order: index,
}));
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ddd"/></svg>';

async function setup(page: Page) {
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:\d+\/(?!realtime)/, () => {});
  await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://images.pexels.com/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: image }));
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/categories')) return route.fulfill({ json: categories });
    if (path.endsWith('/search_available_listings')) return route.fulfill({ json: { rows: [], total: 0 } });
    if (path.endsWith('/app_settings')) return route.fulfill({ json: { value: ['US'] } });
    if (path.endsWith('/reference_countries')) return route.fulfill({ json: [{ code: 'US', name: 'United States' }] });
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

for (const [width, height] of [[375, 812], [812, 375], [768, 1024], [1440, 1000]]) {
  test(`aisle tiles are consistent without page overflow at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const section = page.getByRole('region', { name: 'Browse by category' });
    await expect(section.getByRole('button')).toHaveCount(10);
    const cards = section.getByRole('button').filter({ hasNotText: 'Explore all categories' });
    await expect(cards).toHaveCount(9);
    const bounds = await cards.evaluateAll((elements) => elements.map((element) => {
      const { width } = element.getBoundingClientRect();
      return { width, mediaHeight: element.firstElementChild!.getBoundingClientRect().height };
    }));
    for (const card of bounds) {
      expect(card.width).toBeGreaterThan(120);
      expect(Math.abs(card.width - bounds[0].width)).toBeLessThan(1);
      expect(Math.abs(card.mediaHeight - bounds[0].mediaHeight)).toBeLessThan(1);
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
    await expect(card).toHaveCSS('outline-width', '2px');
  }
  await page.keyboard.press('Tab');
  await expect(section.getByRole('button', { name: 'More categories' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`category=${categories[7].id}`));
});

test('hover lifts the door and zooms the image; reduced motion disables movement', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Browse by category' }).getByRole('button', { name: 'Electronics', exact: true });
  await card.hover();
  await expect.poll(() => card.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m42)).toBeLessThan(-7);
  await expect(card.locator('img')).toHaveCSS('transform', 'matrix(1.02, 0, 0, 1.02, 0, 0)');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const calm = page.getByRole('region', { name: 'Browse by category' }).getByRole('button', { name: 'Electronics', exact: true });
  await calm.hover();
  await expect(calm).toHaveCSS('transform', 'none');
  await expect(calm.locator('img')).toHaveCSS('transform', 'none');
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
