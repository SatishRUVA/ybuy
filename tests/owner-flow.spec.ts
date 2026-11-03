import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function helper(file: string, name: string, context: object) {
  const source = readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(`${compiled}\n${name}`, context);
}

const components = [
  ['street_number', '123'], ['route', 'Test Street'], ['locality', 'Irving'],
  ['administrative_area_level_1', 'TX'], ['postal_code', '75039'], ['country', 'US'],
].map(([type, value]) => ({ types: [type], long_name: value, short_name: value }));

function location(options: { denied?: boolean; latitude?: number; empty?: boolean; country?: string; failure?: boolean } = {}) {
  const requests: object[] = [];
  const current = helper('src\\lib\\pickup-location.ts', 'currentPickupLocation', {
    navigator: { geolocation: { getCurrentPosition: (resolve: (value: object) => void, reject: (value: object) => void, settings: object) => {
      requests.push(settings);
      if (options.denied) reject({ code: 1 });
      else resolve({ coords: { latitude: options.latitude ?? 32.8, longitude: -96.9 } });
    } } },
    loadGooglePlaces: async () => {},
    fetchMarketplaceCountries: async () => [{ code: 'US', name: 'United States' }],
    countryIsAllowed: (country: string) => country === 'US',
    window: { google: { maps: { importLibrary: async (library: string) => {
      expect(library).toBe('geocoding');
      return { Geocoder: class {
        async geocode() {
          if (options.failure) throw new Error('Geocoder unavailable');
          return { results: options.empty ? [] : [{
            formatted_address: '123 Test Street, Irving, TX 75039, US', place_id: 'gps-place',
            address_components: components.map(part => part.types[0] === 'country'
              ? { ...part, short_name: options.country ?? 'US' } : part),
          }] };
        }
      } };
    } } } },
  }) as () => Promise<Record<string, unknown>>;
  return { current, requests };
}

test('current location resolves a complete pickup address and the browser coordinates', async () => {
  const { current, requests } = location();
  expect(await current()).toMatchObject({
    streetAddress: '123 Test Street', city: 'Irving', state: 'TX', postalCode: '75039',
    country: 'US', latitude: 32.8, longitude: -96.9, placeId: 'gps-place',
  });
  expect(requests).toEqual([{ timeout: 15000, maximumAge: 60000 }]);
});

test('current location rejects denied, invalid, unsupported and failed lookups explicitly', async () => {
  await expect(Promise.resolve(location({ denied: true }).current())).rejects.toThrow('Location permission denied');
  await expect(Promise.resolve(location({ latitude: 91 }).current())).rejects.toThrow('invalid location');
  await expect(Promise.resolve(location({ empty: true }).current())).rejects.toThrow('No complete pickup address');
  await expect(Promise.resolve(location({ country: 'CA' }).current())).rejects.toThrow('enabled marketplace country');
  await expect(Promise.resolve(location({ failure: true }).current())).rejects.toThrow('Geocoder unavailable');
});

test('bidding confirmation distinguishes scheduled and open auctions and rejects missing times', () => {
  const message = helper('src\\lib\\listing-auctions.ts', 'auctionPublicationMessage', {}) as (auction: object) => string;
  const schedule = { starts_at: '2026-11-02T10:00:00Z', ends_at: '2026-11-04T22:00:00Z' };
  expect(message({ ...schedule, status: 'scheduled' })).toContain('scheduled for bidding. Bidding opens');
  expect(message({ ...schedule, status: 'open' })).toContain('open for bidding. Bidding closes');
  expect(() => message({ status: 'open', ends_at: null })).toThrow('Could not verify');
});

test('discovery day refreshes at UTC midnight and after a sleeping tab returns', () => {
  let now = Date.parse('2026-11-02T23:59:58Z');
  const updates: string[] = [];
  let timer = () => {};
  let visible = () => {};
  let cleanup = () => {};
  let removed = false;
  let cleared = false;
  const day = helper('src\\lib\\use-utc-day.ts', 'useUtcDay', {
    Date: class extends Date { constructor() { super(now); } static now() { return now; } },
    useState: (initial: () => string) => [initial(), (value: string) => updates.push(value)],
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
    window: {
      setTimeout: (callback: () => void, delay: number) => { expect(delay).toBe(2000); timer = callback; return 1; },
      clearTimeout: (id: number) => { cleared = id === 1; },
    },
    document: {
      visibilityState: 'visible',
      addEventListener: (_event: string, callback: () => void) => { visible = callback; },
      removeEventListener: (_event: string, callback: () => void) => { removed = callback === visible; },
    },
  }) as () => string;
  expect(day()).toBe('2026-11-02');
  now += 2000; timer();
  now += 86400000; visible();
  expect(updates).toEqual(['2026-11-03', '2026-11-04']);
  cleanup();
  expect(cleared && removed).toBe(true);
});

for (const variant of ['main', 'redesign']) {
  test(`${variant} owner dates store exclusive returns and location failures retain the address`, async ({ page, context }) => {
    test.setTimeout(60_000);
    await page.clock.setFixedTime(new Date('2026-10-22T12:00:00'));
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 32.8, longitude: -96.9 });
    await page.route('**/src/lib/google-maps.ts', async route => {
      const response = await route.fetch();
      return route.fulfill({ response, body: (await response.text()).replace(/const key = [^\n]+;/, 'const key = "test-google-key";') });
    });
    await page.route('**/maps.googleapis.com/**', route => route.fulfill({
      contentType: 'application/javascript',
      body: `class TestAutocomplete extends HTMLElement {}
      customElements.define('owner-address-autocomplete', TestAutocomplete);
      window.google.maps.importLibrary = async name => name === 'places'
        ? { PlaceAutocompleteElement: TestAutocomplete }
        : { Geocoder: class { async geocode() { return {results: [{
          formatted_address: '123 Test Street, Irving, TX 75039, US', place_id: 'gps-place',
          address_components: ${JSON.stringify(components)}
        }]}; } } };
      window.google.maps.__ybuyGoogleMapsReady();`,
    }));
    await page.route('**/rest/v1/app_settings?**', route => route.fulfill({ contentType: 'application/json', body: '{"value":["US"]}' }));
    await page.route('**/rest/v1/reference_countries?**', route => route.fulfill({ contentType: 'application/json', body: '[{"code":"US","name":"United States"}]' }));
    await page.route('**/src/components/pickup-location.tsx', async route => {
      const response = await route.fetch();
      return route.fulfill({ response, body: (await response.text()).replace(/const googleKey = [^\n]+;/, 'const googleKey = "test-google-key";') });
    });
    await page.route('**/src/main-site/components/pickup-location.tsx', async route => {
      const response = await route.fetch();
      return route.fulfill({ response, body: (await response.text()).replace(/const googleKey = [^\n]+;/, 'const googleKey = "test-google-key";') });
    });
    await page.route('**/__owner-flow-fixture?**', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;</script></head><body></body></html>`,
    }));
    await page.goto(`/__owner-flow-fixture?variant=${variant}`);
    await page.waitForFunction(() => window.__vite_plugin_react_preamble_installed__ === true);
    await page.evaluate(async () => {
      const { mountComponent } = await import('/tests/component-mount.tsx');
      const { OwnerFlowHarness } = await import('/tests/owner-flow-harness.tsx');
      mountComponent(OwnerFlowHarness);
    });
    const calendar = page.getByRole('region', { name: 'Listing availability' });
    await calendar.getByRole('button', { name: /^Available from/ }).click();
    await calendar.getByRole('button', { name: /Monday, October 26, 2026/ }).click();
    await calendar.getByRole('button', { name: /^Available through/ }).click();
    await expect(calendar.getByRole('button', { name: /Tuesday, November 24, 2026/ })).toBeEnabled();
    await expect(calendar.getByRole('button', { name: /Wednesday, November 25, 2026/ })).toBeDisabled();
    await calendar.getByRole('button', { name: /Tuesday, November 24, 2026/ }).click();
    await expect(page.getByLabel('Stored availability')).toHaveText('{"start":"2026-10-26","end":"2026-11-25"}');
    await expect(calendar).toContainText('30 available days, including both dates');
    await calendar.getByRole('button', { name: /^Available from/ }).click();
    await calendar.getByRole('button', { name: /Monday, October 26, 2026/ }).click();
    await calendar.getByRole('button', { name: /Monday, October 26, 2026/ }).click();
    await expect(page.getByLabel('Stored availability')).toHaveText('{"start":"2026-10-26","end":"2026-10-27"}');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByLabel('Stored pickup')).toContainText('"placeId":"gps-place"');
    await expect(page.getByLabel('Stored pickup')).toContainText('"streetAddress":"123 Test Street"');
    await page.evaluate(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (_resolve: unknown, reject: (error: { code: number }) => void) => reject({ code: 1 }),
    } }));
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Location permission denied' })).toBeVisible();
    await expect(page.getByLabel('Stored pickup')).toContainText('"placeId":"gps-place"');
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${variant}-owner-${width}.png`), fullPage: true });
    }
  });
}
