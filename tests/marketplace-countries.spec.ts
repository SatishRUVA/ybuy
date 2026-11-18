import { expect, test } from '@playwright/test';
import { appUrl } from './test-url';

const countries = [{ code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' }];
const features = [
  { text: 'Dallas', center: [-96.8, 32.8], place_type: ['municipality'], context: [{ id: 'country.us', text: 'United States' }] },
  { text: 'Toronto', center: [-79.38, 43.65], place_type: ['municipality'], context: [{ id: 'country.ca', text: 'Canada' }] },
];

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/app_settings') ? { value: ['US'] }
      : url.pathname.endsWith('/reference_countries') ? [countries[0]] : [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/src/lib/geo.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(/const key = [^\n]+;/g, 'const key = "test-map-key";') });
  });
  await page.route('**/api.maptiler.com/geocoding/**', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features }) }));
});

test('city and postal-code searches restrict provider requests and results to enabled countries', async ({ page }) => {
  const requestedCountries: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/geocoding/')) requestedCountries.push(new URL(request.url()).searchParams.get('country') ?? '');
  });
  await page.goto(appUrl);
  const results = await page.evaluate(async () => {
    const { findCities } = await import('/src/lib/geo.ts');
    return [await findCities('Dallas'), await findCities('75063')];
  });
  expect(results.map(rows => rows.map(row => row.country))).toEqual([['United States'], ['United States']]);
  expect(requestedCountries).toEqual(['us', 'us']);
});

test('adding a country takes effect without a frontend deployment', async ({ page }) => {
  await page.goto(appUrl);
  await page.route('**/rest/v1/app_settings?**', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ value: ['US', 'CA'] }) }));
  await page.route('**/rest/v1/reference_countries?**', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(countries) }));
  const query = page.waitForRequest(request => request.url().includes('/geocoding/'));
  const results = await page.evaluate(async () => (await import('/src/lib/geo.ts')).findCities('Toronto'));
  expect(new URL((await query).url()).searchParams.get('country')).toBe('us,ca');
  expect(results.map(row => row.country)).toEqual(['United States', 'Canada']);
});

test('GPS outside enabled countries cannot fall back to unverified coordinates', async ({ page }) => {
  await page.route('**/api.maptiler.com/geocoding/**', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [features[1]] }) }));
  await page.goto(appUrl);
  const error = await page.evaluate(async () => {
    try { await (await import('/src/lib/geo.ts')).cityForCoordinates(43.65, -79.38); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  expect(error).toContain('outside the enabled marketplace countries');
});

test('IP location outside enabled countries is not selected', async ({ page }) => {
  await page.route('**/api.maptiler.com/geolocation/ip.json?**', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ city: 'Toronto', country: 'Canada' }) }));
  await page.goto(appUrl);
  const city = await page.evaluate(async () => (await import('/src/lib/geo.ts')).estimateCityFromIp());
  expect(city).toBeNull();
});

test('saved locations in disabled countries are cleared visibly', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ybuy-marketplace-location', JSON.stringify({
    city: 'Toronto', state: 'Ontario', country: 'Canada', source: 'USER_SELECTED', latitude: 43.65, longitude: -79.38,
  })));
  await page.goto(appUrl);
  await expect(page.getByRole('status').filter({ hasText: 'Location unavailable' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ybuy-marketplace-location'))).toBeNull();
});

test('missing policy fails explicitly instead of searching every country', async ({ page }) => {
  await page.route('**/rest/v1/app_settings?**', route =>
    route.fulfill({ contentType: 'application/json', body: 'null' }));
  await page.goto(appUrl);
  const error = await page.evaluate(async () => {
    try { await (await import('/src/lib/geo.ts')).findCities('Dallas'); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  expect(error).toContain('Marketplace countries are not configured');
});
