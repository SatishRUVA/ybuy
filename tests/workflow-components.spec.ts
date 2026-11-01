import { expect, test } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';
import { appUrl } from './test-url';

const ownerId = '10000000-0000-4000-8000-000000000001';
test.setTimeout(60_000);
const listingId = '30000000-0000-4000-8000-000000000001';
const listing = {
  id: listingId, owner_id: ownerId, category_id: '20000000-0000-4000-8000-000000000001',
  title: 'Workflow camera', description: 'Camera and carrying case', price_per_day: 20, deposit: 0,
  status: 'published', available_quantity: 1, owner_verified: false, instant_booking: true,
  created_at: '2026-10-01T00:00:00Z', listing_images: [], location_label: 'Dallas, TX',
  location_lat: 32.8, location_lng: -96.8, distance_miles: 1.4,
  owner: { id: ownerId, full_name: 'Camera Owner', avatar_url: null }, categories: { name: 'Cameras' },
};

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/src/lib/geo.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(/const key = [^\n]+;/g, 'const key = "test-map-key";') });
  });
  await page.route('**/api.maptiler.com/geocoding/**', (route) => route.fulfill({ json: { features: [{
    text: 'Dallas', center: [-96.8, 32.8], place_type: ['municipality'],
    context: [{ id: 'region.1', text: 'Texas' }, { id: 'country.1', text: 'United States' }],
  }] } }));
  await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/app_settings')) return route.fulfill({ json: { value: ['US'] } });
    if (path.endsWith('/reference_countries')) return route.fulfill({ json: [{ code: 'US', name: 'United States' }] });
    if (path.endsWith('/search_available_listings')) return route.fulfill({ json: { rows: [listing], total: 1 } });
    if (path.endsWith('/listings')) return route.fulfill({ json: [listing], headers: { 'content-range': '0-0/1' } });
    if (path.endsWith('/categories')) return route.fulfill({ json: [{ id: listing.category_id, name: 'Cameras', icon: 'Camera', active: true }] });
    if (path.endsWith('/reviews')) return route.fulfill({ json: [{ reviewee_id: ownerId, rating: 5 }] });
    return route.fulfill({ json: [] });
  });
});

test('search sorting and radius use keyboard menus; real reviews do not grant verification', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${appUrl}/access`);
  await page.goto(`${appUrl}/search?q=camera&lat=32.8&lng=-96.8&loc=Dallas&radius=5`, { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('article').filter({ hasText: 'Workflow camera' }).first();
  await expect(card.getByText('By Camera Owner')).toBeVisible();
  await expect(card.getByLabel('About 1.4 mi away')).toBeVisible();
  await expect(card.getByText('5.0', { exact: true })).toBeVisible();
  await expect(card.getByText('Verified owner', { exact: true })).toHaveCount(0);
  const sort = page.getByRole('combobox', { name: 'Sort results' });
  await sort.click();
  await page.screenshot({ path: test.info().outputPath('search-sort-1440.png') });
  await expect(page.getByRole('option', { name: 'Recommended', exact: true })).toHaveAttribute('data-state', 'checked');
  await page.keyboard.press('l');
  await page.keyboard.press('Enter');
  await expect(sort).toContainText('Lowest price');
  await expect(sort).toBeFocused();
  await expect(page).toHaveURL(/sort=price-low/);
  const radius = page.getByRole('combobox', { name: /^Search radius:/ }).first();
  await radius.click();
  await page.getByRole('option', { name: 'Within 25 miles', exact: true }).click();
  await expect(radius).toContainText('25 mi');
  await expect(page).toHaveURL(/radius=25/);
  await page.setViewportSize({ width: 390, height: 844 });
  await sort.click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('search-sort-390.png') });
  await page.keyboard.press('Escape');
});

test('named admin dropdown preserves FormData, selected state and focus return', async ({ page }) => {
  await page.goto(`${appUrl}/access`);
  await page.evaluate(async () => {
    const { mountComponent, createElement } = await import('/tests/component-mount.tsx');
    const { ChoiceField } = await import('/src/pages/admin/operation-form.tsx');
    mountComponent('form', { id: 'operation-test', children:
      createElement(ChoiceField, { name: 'status', label: 'Moderation status', value: 'pending', options: ['pending', 'approved', 'rejected'] }) });
  });
  const status = page.getByRole('combobox', { name: 'Moderation status' });
  await expect(status).toContainText('pending');
  await status.click();
  await page.getByRole('option', { name: 'approved', exact: true }).click();
  await expect(status).toBeFocused();
  const selected = await page.locator('form').evaluate((form) => new FormData(form as HTMLFormElement).get('status'));
  expect(selected).toBe('approved');
  await status.click();
  await page.keyboard.press('Escape');
  await expect(status).toBeFocused();
  await expect(status).toContainText('approved');
});

test('owner blocked days persist via existing API; booked and out-of-window dates stay disabled', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const date = (offset: number) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  const blocked = new Set<string>();
  const writes: { listing_id: string; date: string; is_available: boolean }[] = [];
  await page.route('**/rpc/get_listing_unavailable_dates', (route) => route.fulfill({ json: { blocked: [...blocked], booked: [date(2)] } }));
  await page.route('**/rest/v1/listing_availability*', (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    if (body.is_available) blocked.delete(body.date); else blocked.add(body.date);
    return route.fulfill({ status: 201, json: null });
  });
  await page.goto(`${appUrl}/access`);
  await page.evaluate(async ({ listingId, start, end }) => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    const { OwnerBlockedDates } = await import('/src/components/owner-blocked-dates.tsx');
    mountComponent(OwnerBlockedDates, { listingId, start, end });
  }, { listingId, start: date(1), end: date(5) });
  await expect(page.getByRole('button', { name: /, booked$/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /outside availability window/ }).first()).toBeDisabled();
  const available = page.getByRole('button', { name: /, available$/ }).first();
  await available.click();
  await expect(page.getByRole('button', { name: /, blocked$/ })).toHaveAttribute('aria-pressed', 'true');
  expect(writes[0]).toMatchObject({ listing_id: listingId, is_available: false });
  await page.getByRole('button', { name: /, blocked$/ }).click();
  await expect(page.getByRole('button', { name: /, blocked$/ })).toHaveCount(0);
  expect(writes[1]).toEqual({ ...writes[0], is_available: true });
  await page.route('**/rest/v1/listing_availability*', (route) => route.fulfill({ status: 403, json: { message: 'This date is protected by a booking.' } }));
  await page.getByRole('button', { name: /, available$/ }).first().click();
  await expect(page.getByText('This date is protected by a booking.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload dates' })).toBeVisible();
  await expect(page.getByRole('button', { name: /, available$/ })).toHaveCount(0);
});
