# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\location.spec.ts >> a denied GPS request keeps the IP estimate and does not retry automatically
- Location: tests\location.spec.ts:64:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Near Irving, Texas' }).first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: 'Near Irving, Texas' }).first() with timeout 5000ms
  - waiting for getByRole('button', { name: 'Near Irving, Texas' }).first()

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | 
  3   | const appUrl = 'http://127.0.0.1:5175/';
  4   | 
  5   | test.beforeEach(async ({ page }) => {
  6   |   await page.route('**/api.maptiler.com/geolocation/ip.json?**', (route) => route.fulfill({
  7   |     contentType: 'application/json',
  8   |     body: JSON.stringify({ city: 'Irving', region: 'Texas', country: 'United States', latitude: 32.8, longitude: -96.9 }),
  9   |   }));
  10  |   await page.route('**/api.maptiler.com/geocoding/**', (route) => {
  11  |     const path = decodeURIComponent(new URL(route.request().url()).pathname);
  12  |     const city = path.includes('Austin') ? 'Austin' : 'Dallas';
  13  |     return route.fulfill({
  14  |       contentType: 'application/json',
  15  |       body: JSON.stringify({ features: [{ text: city, center: [-96.8, 32.8], place_type: ['municipality'], context: [
  16  |         { id: 'region.1', text: 'Texas' }, { id: 'country.1', text: 'United States' },
  17  |       ] }] }),
  18  |     });
  19  |   });
  20  |   await page.addInitScript(() => {
  21  |     (window as Window & { geoCalls: number }).geoCalls = 0;
  22  |     Object.defineProperty(navigator, 'geolocation', {
  23  |       configurable: true,
  24  |       value: {
  25  |         getCurrentPosition(success: (position: unknown) => void) {
  26  |           (window as Window & { geoCalls: number }).geoCalls += 1;
  27  |           success({ coords: { latitude: 32.8, longitude: -96.8 } });
  28  |         },
  29  |       },
  30  |     });
  31  |   });
  32  | });
  33  | 
  34  | test('IP is approximate and never requests GPS on Home or Browse', async ({ page }) => {
  35  |   await page.goto(appUrl);
  36  |   await expect(page.getByRole('button', { name: 'Near Irving, Texas' }).first()).toBeVisible();
  37  |   await page.goto(`${appUrl}search`);
  38  |   await expect(page.getByText(/Showing items near Irving, Texas \(approximate\)/)).toBeVisible();
  39  |   expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  40  |   expect(await page.getByText(/\d+(\.\d+)? mi away/).count()).toBe(0);
  41  | });
  42  | 
  43  | test('a selected city persists and is not replaced by IP or GPS', async ({ page }) => {
  44  |   await page.goto(appUrl);
  45  |   await page.getByRole('button', { name: 'Near Irving, Texas' }).first().click();
  46  |   await page.locator('input[aria-label="Search city or ZIP"]:visible').fill('Dallas');
  47  |   await page.locator('[role="dialog"]:visible').getByRole('button', { name: /Dallas, Texas/ }).click();
  48  |   await expect(page.getByRole('button', { name: 'Dallas, Texas' }).first()).toBeVisible();
  49  |   await page.reload();
  50  |   await expect(page.getByRole('button', { name: 'Dallas, Texas' }).first()).toBeVisible();
  51  |   expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ybuy-marketplace-location') || '{}').source)).toBe('USER_SELECTED');
  52  |   expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  53  | });
  54  | 
  55  | test('GPS only runs after Use my location is clicked', async ({ page }) => {
  56  |   await page.goto(appUrl);
  57  |   expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  58  |   await page.getByRole('button', { name: 'Near Irving, Texas' }).first().click();
  59  |   await page.locator('[role="dialog"]:visible').getByRole('button', { name: 'Use my location' }).click();
  60  |   expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(1);
  61  |   await expect(page.getByRole('button', { name: 'Dallas, Texas' }).first()).toBeVisible();
  62  | });
  63  | 
  64  | test('a denied GPS request keeps the IP estimate and does not retry automatically', async ({ page }) => {
  65  |   await page.goto(appUrl);
> 66  |   await expect(page.getByRole('button', { name: 'Near Irving, Texas' }).first()).toBeVisible();
      |                                                                                  ^ Error: expect(locator).toBeVisible() failed
  67  |   await page.evaluate(() => {
  68  |     Object.defineProperty(navigator, 'geolocation', {
  69  |       configurable: true,
  70  |       value: { getCurrentPosition(_success: unknown, error: (reason: unknown) => void) {
  71  |         (window as Window & { geoCalls: number }).geoCalls += 1;
  72  |         error({ code: 1 });
  73  |       } },
  74  |     });
  75  |   });
  76  |   await page.getByRole('button', { name: 'Near Irving, Texas' }).first().click();
  77  |   await page.locator('[role="dialog"]:visible').getByRole('button', { name: 'Use my location' }).click();
  78  |   await expect(page.getByRole('status').filter({ hasText: 'Enter a city instead' })).toBeVisible();
  79  |   await expect(page.getByRole('button', { name: 'Near Irving, Texas' }).first()).toBeVisible();
  80  |   expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(1);
  81  |   await page.goto(`${appUrl}search`);
  82  |   expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  83  |   await expect(page.getByText(/Showing items near Irving, Texas \(approximate\)/)).toBeVisible();
  84  | });
  85  | 
  86  | test('a new city replaces the earlier selected city', async ({ page }) => {
  87  |   await page.goto(appUrl);
  88  |   await page.getByRole('button', { name: 'Near Irving, Texas' }).first().click();
  89  |   await page.locator('input[aria-label="Search city or ZIP"]:visible').fill('Dallas');
  90  |   await page.locator('[role="dialog"]:visible').getByRole('button', { name: /Dallas, Texas/ }).click();
  91  |   await page.getByRole('button', { name: 'Dallas, Texas' }).first().click();
  92  |   await page.locator('input[aria-label="Search city or ZIP"]:visible').fill('Austin');
  93  |   await page.locator('[role="dialog"]:visible').getByRole('button', { name: /Austin, Texas/ }).click();
  94  |   await expect(page.getByRole('button', { name: 'Austin, Texas' }).first()).toBeVisible();
  95  |   expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ybuy-marketplace-location') || '{}').city)).toBe('Austin');
  96  | });
  97  | 
  98  | test('changing city in Browse updates the URL and survives a reload', async ({ page }) => {
  99  |   await page.goto(`${appUrl}search?loc=Dallas%2C%20Texas`);
  100 |   await expect(page.getByRole('button', { name: 'Dallas, Texas' }).first()).toBeVisible();
  101 |   await page.getByRole('button', { name: 'Dallas, Texas' }).first().click();
  102 |   await page.locator('input[aria-label="Search city or ZIP"]:visible').fill('Austin');
  103 |   await page.locator('[role="dialog"]:visible').getByRole('button', { name: /Austin, Texas/ }).click();
  104 |   await expect(page).toHaveURL(/loc=Austin%2C\+Texas/);
  105 |   await page.reload();
  106 |   await expect(page.getByRole('button', { name: 'Austin, Texas' }).first()).toBeVisible();
  107 |   expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  108 | });
  109 | 
  110 | test('without IP location the marketplace is still browsable', async ({ page }) => {
  111 |   await page.route('**/api.maptiler.com/geolocation/ip.json?**', (route) => route.fulfill({ status: 503 }));
  112 |   await page.goto(appUrl);
  113 |   await expect(page.getByRole('button', { name: 'Set your location' }).first()).toBeVisible();
  114 |   await page.goto(`${appUrl}search`);
  115 |   await expect(page.getByRole('heading', { name: /items|Searching/ })).toBeVisible();
  116 |   expect(await page.evaluate(() => (window as Window & { geoCalls: number }).geoCalls)).toBe(0);
  117 | });
```