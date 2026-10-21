import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

const appUrl = 'http://127.0.0.1:5174';
const categoryId = '20000000-0000-4000-8000-000000000001';
const listingId = '30000000-0000-4000-8000-000000000001';

async function setup(page: Page) {
  await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/src/lib/geo.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(/const key = [^\n]+;/g, 'const key = "test-map-key";') });
  });
  await page.route('**/api.maptiler.com/geocoding/**', (route) => {
    const query = decodeURIComponent(new URL(route.request().url()).pathname);
    const postal = query.includes('75001');
    return route.fulfill({ json: { features: query.includes('Invalid') ? [] : [{
      text: postal ? '75001' : 'Dallas', center: [-96.8, 32.8],
      place_type: [postal ? 'postal_code' : 'municipality'],
      context: [{ id: 'municipality.1', text: 'Dallas' }, { id: 'region.1', text: 'Texas' }, { id: 'country.1', text: 'United States' }],
    }] } });
  });
  await page.route('**/rest/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/search_available_listings')) {
      const params = route.request().postDataJSON();
      const count = params.p_radius_miles === null ? 5 : [5, 10, 25, 50].indexOf(params.p_radius_miles) + 1;
      const rows = Array.from({ length: count }, (_, index) => ({
        id: `${listingId.slice(0, -1)}${index + 1}`, owner_id: '10000000-0000-4000-8000-000000000001',
        category_id: categoryId, title: `Radius camera ${index + 1}`, description: 'Camera for rent',
        price_per_day: 20, deposit: 0, status: 'published', available_quantity: 1,
        location_lat: 32.81, location_lng: -96.8, location_label: 'Dallas, Texas',
        distance_miles: 1.25 + index, owner_verified: true, instant_booking: true,
        created_at: '2026-10-21T00:00:00Z', listing_images: [],
        owner: { id: '10000000-0000-4000-8000-000000000001', full_name: 'Test Owner', avatar_url: null },
        categories: { name: 'Cameras' },
      }));
      return route.fulfill({ json: { rows, total: count } });
    }
    if (url.pathname.endsWith('/categories')) return route.fulfill({ json: [{ id: categoryId, name: 'Cameras', icon: 'Camera' }] });
    return route.fulfill({ json: [], headers: { 'content-range': '0-0/0' } });
  });
}

async function selectLocation(page: Page, query = 'Dallas') {
  await page.getByRole('button', { name: 'Set your location', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search city or ZIP' }).fill(query);
  await page.getByRole('dialog', { name: 'Choose location' }).getByRole('button', { name: /Dallas, Texas/ }).click();
}

test.beforeEach(async ({ page }) => setup(page));

test('hero defaults to 5 miles and every radius reaches the existing backend and changes rendered results', async ({ page }) => {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const radius = page.getByRole('combobox', { name: 'Search radius' });
  await expect(radius).toHaveValue('5');
  await expect(page.getByRole('button', { name: 'Add dates', exact: true })).toBeVisible();
  await selectLocation(page, '75001');
  await expect(page.getByRole('button', { name: 'Dallas, Texas 75001', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search for items to rent', exact: true }).fill('camera');
  const request = page.waitForRequest((req) => req.url().includes('/rpc/search_available_listings'));
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ p_radius_miles: 5, p_latitude: 32.8, p_longitude: -96.8, p_start_date: null, p_end_date: null, p_keyword: 'camera' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('1 item');
  await expect(page.getByText('About 1.3 mi away')).toBeVisible();
  for (const [value, count] of [['10', 2], ['25', 3], ['50', 4], ['any', 5]] as const) {
    const next = page.waitForRequest((req) => req.url().includes('/rpc/search_available_listings') && req.postDataJSON().p_radius_miles === (value === 'any' ? null : Number(value)));
    await radius.selectOption(value);
    await next;
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`${count} items`);
    await expect(page).toHaveURL(new RegExp(`radius=${value}`));
  }
});

test('keywords, radius, dates, location and filters survive listing navigation, back, reload and return to hero', async ({ page }) => {
  await page.goto(`${appUrl}/search?q=camera&lat=32.8&lng=-96.8&loc=Dallas%2C+Texas&radius=25&category=${categoryId}&maxPrice=75&verified=1&instant=1&delivery=1&sort=price-low&start=2026-11-02&end=2026-11-04`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('3 items');
  const searchUrl = page.url();
  await page.getByText('Radius camera 1', { exact: true }).click();
  await expect(page).toHaveURL(/\/listing\//);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('combobox', { name: 'Search radius' })).toHaveValue('25');
  await expect(page.getByRole('textbox', { name: 'Search for items to rent', exact: true })).toHaveValue('camera');
  expect(new URL(page.url()).searchParams).toEqual(new URL(searchUrl).searchParams);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('3 items');
  await page.getByRole('button', { name: 'Filters', exact: false }).first().click();
  await expect(page.getByRole('switch', { name: 'Verified owner' })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Max price per day' })).toHaveValue('75');
  await page.getByRole('button', { name: 'YBuy home' }).click();
  await expect(page.getByRole('combobox', { name: 'Search radius' })).toHaveValue('25');
  await expect(page.getByRole('textbox', { name: 'Search for items to rent', exact: true })).toHaveValue('camera');
  const request = page.waitForRequest((req) => req.url().includes('/rpc/search_available_listings'));
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ p_radius_miles: 25, p_start_date: '2026-11-02', p_end_date: '2026-11-04', p_max_price: 75, p_verified_only: true, p_instant_only: true, p_delivery_only: true, p_category_id: categoryId });
});

test('empty five-mile search offers every wider radius without clearing keywords or location', async ({ page }) => {
  await page.route('**/rpc/search_available_listings', (route) => route.fulfill({ json: { rows: [], total: 0 } }));
  await page.goto(`${appUrl}/search?q=camera&lat=32.8&lng=-96.8&loc=Dallas`, { waitUntil: 'domcontentloaded' });
  for (const name of ['Search 10 miles', 'Search 25 miles', 'Search 50 miles', 'Search Any distance']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Search 25 miles' }).click();
  await expect(page.getByRole('combobox', { name: 'Search radius' })).toHaveValue('25');
  await expect(page).toHaveURL(/radius=25/);
  expect(new URL(page.url()).searchParams.get('q')).toBe('camera');
  expect(new URL(page.url()).searchParams.get('lat')).toBe('32.8');
});

test('invalid location has a recovery message and keyboard dismissal restores focus', async ({ page }) => {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: 'Set your location', exact: true });
  await trigger.click();
  await expect(page.getByRole('textbox', { name: 'Search city or ZIP' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Search city or ZIP' }).fill('Invalid');
  await expect(page.getByRole('status').filter({ hasText: 'No matching location' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('0 items');
});

test('mobile hero and expandable results retain radius and expose optional dates without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('combobox', { name: 'Search radius' })).toHaveValue('5');
  await selectLocation(page);
  await page.getByRole('combobox', { name: 'Search radius' }).selectOption('10');
  await page.getByRole('textbox', { name: 'What do you need?', exact: true }).fill('camera');
  await page.getByRole('button', { name: 'Add dates', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Select dates' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear dates' }).click();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2 items');
  await expect(page.getByRole('button', { name: /camera Dallas, Texas Within 10 miles/ })).toBeVisible();
  await page.getByRole('button', { name: /camera Dallas, Texas Within 10 miles/ }).click();
  await expect(page.getByRole('combobox', { name: 'Search radius' })).toHaveValue('10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const size of [{ width: 812, height: 375 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('combobox', { name: 'Search radius' })).toBeVisible();
  }
});
