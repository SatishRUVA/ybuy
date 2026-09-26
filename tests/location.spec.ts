import { expect, test } from '@playwright/test';

const appUrl = 'http://127.0.0.1:5175/';

test.beforeEach(async ({ page }) => {
  await page.route('**/api.maptiler.com/geolocation/ip.json?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ city: 'Irving', region: 'Texas', country: 'United States', latitude: 32.8, longitude: -96.9 }),
  }));
  await page.route('**/api.maptiler.com/geocoding/**', (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const city = path.includes('Austin') ? 'Austin' : 'Dallas';
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ features: [{ text: city, center: [-96.8, 32.8], place_type: ['municipality'], context: [
        { id: 'region.1', text: 'Texas' }, { id: 'country.1', text: 'United States' },
      ] }] }),
    });
  });
  await page.addInitScript(() => {
    (window as Window & { geoCalls: number }).geoCalls = 0;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success: (position: unknown) => void) {
          (window as Window & { geoCalls: number }).geoCalls += 1;
          success({ coords: { latitude: 32.8, longitude: -96.8 } });
        },
      },
    });
  });
});

test('IP is approximate and never requests GPS on Home or Browse', async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: 'Near Irving, Texas' }).first()).toBeVisible();
  await page.goto(`${appUrl}search`);
  await expect(page.getByText(/Showing items near Irving, Texas \(approximate\)/)).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  expect(await page.getByText(/\d+(\.\d+)? mi away/).count()).toBe(0);
});

test('a selected city persists and is not replaced by IP or GPS', async ({ page }) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Near Irving, Texas' }).first().click();
  await page.locator('input[aria-label="Search city or ZIP"]:visible').fill('Dallas');
  await page.locator('[role="dialog"]:visible').getByRole('button', { name: /Dallas, Texas/ }).click();
  await expect(page.getByRole('button', { name: 'Dallas, Texas' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Dallas, Texas' }).first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ybuy-marketplace-location') || '{}').source)).toBe('USER_SELECTED');
  expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
});

test('GPS only runs after Use my location is clicked', async ({ page }) => {
  await page.goto(appUrl);
  expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  await page.getByRole('button', { name: 'Near Irving, Texas' }).first().click();
  await page.locator('[role="dialog"]:visible').getByRole('button', { name: 'Use my location' }).click();
  expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(1);
  await expect(page.getByRole('button', { name: 'Dallas, Texas' }).first()).toBeVisible();
});

test('a denied GPS request keeps the IP estimate and does not retry automatically', async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: 'Near Irving, Texas' }).first()).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition(_success: unknown, error: (reason: unknown) => void) {
        (window as Window & { geoCalls: number }).geoCalls += 1;
        error({ code: 1 });
      } },
    });
  });
  await page.getByRole('button', { name: 'Near Irving, Texas' }).first().click();
  await page.locator('[role="dialog"]:visible').getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enter a city instead' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Near Irving, Texas' }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(1);
  await page.goto(`${appUrl}search`);
  expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  await expect(page.getByText(/Showing items near Irving, Texas \(approximate\)/)).toBeVisible();
});

test('a new city replaces the earlier selected city', async ({ page }) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Near Irving, Texas' }).first().click();
  await page.locator('input[aria-label="Search city or ZIP"]:visible').fill('Dallas');
  await page.locator('[role="dialog"]:visible').getByRole('button', { name: /Dallas, Texas/ }).click();
  await page.getByRole('button', { name: 'Dallas, Texas' }).first().click();
  await page.locator('input[aria-label="Search city or ZIP"]:visible').fill('Austin');
  await page.locator('[role="dialog"]:visible').getByRole('button', { name: /Austin, Texas/ }).click();
  await expect(page.getByRole('button', { name: 'Austin, Texas' }).first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ybuy-marketplace-location') || '{}').city)).toBe('Austin');
});

test('changing city in Browse updates the URL and survives a reload', async ({ page }) => {
  await page.goto(`${appUrl}search?loc=Dallas%2C%20Texas`);
  await expect(page.getByRole('button', { name: 'Dallas, Texas' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Dallas, Texas' }).first().click();
  await page.locator('input[aria-label="Search city or ZIP"]:visible').fill('Austin');
  await page.locator('[role="dialog"]:visible').getByRole('button', { name: /Austin, Texas/ }).click();
  await expect(page).toHaveURL(/loc=Austin%2C\+Texas/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Austin, Texas' }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
});

test('without IP location the marketplace is still browsable', async ({ page }) => {
  await page.route('**/api.maptiler.com/geolocation/ip.json?**', (route) => route.fulfill({ status: 503 }));
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: 'Set your location' }).first()).toBeVisible();
  await page.goto(`${appUrl}search`);
  await expect(page.getByRole('heading', { name: /items|Searching/ })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
});