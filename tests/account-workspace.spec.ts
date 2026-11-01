import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const appUrl = `http://localhost:${process.env.YBUY_TEST_PORT ?? '5174'}`;
test.setTimeout(90_000);
const source = (file: string) => readFileSync(path.join(process.cwd(), ...file.split('/')), 'utf8');
const userId = '10000000-0000-4000-8000-000000000001';
const listingId = '30000000-0000-4000-8000-000000000001';
const bookingId = '40000000-0000-4000-8000-000000000001';
const image = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect width="400" height="300" fill="%230e7c66"/%3E%3C/svg%3E';
const listing = {
  id: listingId, title: 'Account workflow camera', images: [image], category: 'Cameras',
  pricePerDay: 25, deposit: 50, declaredValue: 200, rating: 0, reviewCount: 0,
  owner: { id: 'owner', name: 'Camera Owner', avatar: '' }, instantBooking: false,
  listingStatus: 'published', pickup: 'Local pickup by arrangement', cancellation: 'Return on the agreed date.',
};
const booking = {
  id: bookingId, listingId, listingTitle: listing.title, listingImage: image,
  counterpartId: 'owner', counterpartName: 'Camera Owner', counterpartAvatar: '',
  startDate: '2026-11-02', endDate: '2026-11-05', days: 3, subtotal: 75,
  serviceFeeAmount: 9, total: 134, deposit: 50, status: 'pending_payment', isOwner: false,
};

async function moduleFixture(page: Page, module: string, code: string) {
  await page.route(`**/src/${module}*`, route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('account-workspace-original')) return route.continue();
    url.searchParams.set('account-workspace-original', 'true');
    // Preserve transitive imports; explicit scenario exports override the real module's export star.
    return route.fulfill({
      contentType: 'application/javascript',
      body: `export * from ${JSON.stringify(`${url.pathname}${url.search}`)};\n${code}`,
    });
  });
}

async function prepare(page: Page) {
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await page.route('**/functions/v1/**', route => route.fulfill({ json: {} }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await moduleFixture(page, 'auth-context.tsx', `
    export const AuthProvider = ({ children }) => children;
    // Stable identity like the real provider; a fresh user per render re-runs [user] effects forever.
    const auth = {
      user: { id: '${userId}', app_metadata: { provider: 'google' } },
      profile: { id: '${userId}', full_name: 'Renter Example', email: 'renter@example.test', created_at: '2026-01-01' },
      openSignIn() {}, signOut() {}, authBusy: null
    };
    export const useAuth = () => auth;`);
  await moduleFixture(page, 'router.tsx', `
    export const RouterProvider = ({ children }) => children;
    export const useRouter = () => ({
      route: { name: 'access' },
      navigate: route => (window.__workspaceRoutes ??= []).push(route),
      back() {}
    });`);
  await moduleFixture(page, 'lib/use-feature-flags.ts', `
    export const useFeatureFlag = () => ({ enabled: false, loading: false, error: null });
    export const useFeatureFlags = () => ({ data: [{ key: 'item_requests', enabled: true }], loading: false, error: null, reload() {} });`);
  await moduleFixture(page, 'lib/settings.ts', `
    export const usePlatformFeePct = () => .12;
    export const fetchAppSettings = async () => ({});
    export const getNumericSetting = async () => 0;`);
}

const fixturePath = '/__account-workspace-fixture';
// Minimal document: React Refresh preamble + global CSS only, so App/security-gate side effects never navigate mid-mount.
const fixtureHtml = `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">import '/src/index.css';</script>
</head><body></body></html>`;

async function mount(page: Page, file: string, component: string, props: object = {}) {
  await page.route(`${appUrl}${fixturePath}`, route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }));
  await page.goto(`${appUrl}${fixturePath}`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as unknown as { __vite_plugin_react_preamble_installed__?: boolean }).__vite_plugin_react_preamble_installed__ === true);
  await page.evaluate(async ({ file, component, props }) => {
    const { mountComponent } = await import('/tests/component-mount.tsx');
    const module = await import(`/src/pages/${file}.tsx`);
    mountComponent(module[component], props);
  }, { file, component, props });
}

test('checkout advances through real review steps before creating a request', async ({ page }) => {
  await prepare(page);
  await moduleFixture(page, 'lib/listings.ts', `export const fetchListingById = async () => (${JSON.stringify(listing)}); export const toUiListing = value => value;`);
  await moduleFixture(page, 'lib/bookings.ts', `
    export const createBookingRequest = async input => {
      (window.__bookingInputs ??= []).push(input);
      return { id: '${bookingId}', status: 'requested' };
    };
    export const fetchBookingById = async () => null;
    export const fetchBookingPickup = async () => ({ address: 'Fixture pickup address' });`);
  await mount(page, 'checkout', 'CheckoutPage', { id: listingId, startDate: '2026-11-02', endDate: '2026-11-05' });
  await expect(page.getByRole('heading', { name: 'Make time for a good plan.' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Rental order summary' })).toContainText(listing.title);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How will you get your gear?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const submit = page.getByRole('button', { name: 'Send booking request', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I have reviewed the dates, estimated cost, and rental terms.' }).check();
  await submit.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bookingInputs?: unknown[] }).__bookingInputs)).toEqual([{
    listingId, startDate: '2026-11-02', endDate: '2026-11-05',
    deliveryMode: 'pickup', renterNote: '',
  }]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __workspaceRoutes?: unknown[] }).__workspaceRoutes)).toContainEqual({ name: 'confirmation', id: bookingId });
});

test('checkout rejects malformed or reversed URL dates before submission', async ({ page }) => {
  await prepare(page);
  await moduleFixture(page, 'lib/listings.ts', `export const fetchListingById = async () => (${JSON.stringify(listing)}); export const toUiListing = value => value;`);
  await moduleFixture(page, 'lib/bookings.ts', `
    export const createBookingRequest = async () => { throw new Error('Must not submit invalid dates'); };
    export const fetchBookingById = async () => null;
    export const fetchBookingPickup = async () => ({ address: 'Fixture pickup address' });`);
  await mount(page, 'checkout', 'CheckoutPage', { id: listingId, startDate: '2026-02-30', endDate: '2026-03-03' });
  await expect(page.getByRole('heading', { name: 'Choose your dates first' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send booking request' })).toHaveCount(0);
  await mount(page, 'checkout', 'CheckoutPage', { id: listingId, startDate: '2026-11-05', endDate: '2026-11-02' });
  await expect(page.getByRole('heading', { name: 'Choose your dates first' })).toBeVisible();
});

test('renter status filters retain approved-payment routing and real rental states on mobile', async ({ page }) => {
  await prepare(page);
  await moduleFixture(page, 'lib/bookings.ts', `
    export const fetchBookingsAsRenter = async () => [${JSON.stringify(booking)}];
    export const fetchBookingsAsOwner = async () => [];
    export const respondToBookingRequest = async () => {};
    export const cancelBooking = async () => {};
    export const startBookingReturn = async () => {};
    export const completeBookingReturn = async () => {};
    export const fetchBookingPickup = async () => ({ address: 'Fixture pickup address' });`);
  await moduleFixture(page, 'lib/reviews.ts', `
    export const fetchReviewedBookingIds = async () => new Set();
    export const createReview = async () => {};
    export const REVIEW_MAX_LENGTH = 1200;`);
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, 'dashboards', 'RenterDashboard');
  const approvedTab = page.getByRole('button', { name: /Approved/ });
  await expect(approvedTab).toContainText('1');
  await approvedTab.click();
  await expect(page.getByText('Awaiting payment', { exact: true }).and(page.locator('span'))).toBeVisible();
  await page.getByRole('button', { name: 'Pay now', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __workspaceRoutes?: unknown[] }).__workspaceRoutes)).toContainEqual({ name: 'confirmation', id: bookingId });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('owner overview puts approvals beside inventory and preserves approval-before-payment', async ({ page }) => {
  await prepare(page);
  const incoming = { ...booking, status: 'requested', isOwner: true, counterpartName: 'Renter Example' };
  await moduleFixture(page, 'lib/bookings.ts', `
    let incoming = ${JSON.stringify(incoming)};
    export const fetchBookingsAsOwner = async () => [incoming];
    export const fetchBookingsAsRenter = async () => [];
    export const respondToBookingRequest = async (id, approve) => {
      (window.__bookingResponses ??= []).push({ id, approve });
      incoming = { ...incoming, status: approve ? 'pending_payment' : 'rejected' };
    };
    export const cancelBooking = async () => {};
    export const startBookingReturn = async () => {};
    export const completeBookingReturn = async () => {};
    export const fetchBookingPickup = async () => ({ address: 'Fixture pickup address' });`);
  await moduleFixture(page, 'lib/listings.ts', `
    export const fetchListingsByOwner = async () => [${JSON.stringify(listing)}];
    export const toUiListing = value => value;
    export const fetchListingById = async () => (${JSON.stringify(listing)});
    export const deleteOwnerListing = async () => 'archived';`);
  await moduleFixture(page, 'lib/reviews.ts', `
    export const fetchReviewedBookingIds = async () => new Set();
    export const fetchReviewsForUser = async () => ({ rating: 0, reviewCount: 0 });
    export const createReview = async () => {};
    export const REVIEW_MAX_LENGTH = 1200;`);
  await moduleFixture(page, 'lib/payouts.ts', `
    export const fetchPayoutsByOwner = async () => new Map();
    export const fetchBankPayoutStatus = async () => ({ connected: false, payouts: [] });
    export const startConnectOnboarding = async () => '';`);
  await mount(page, 'dashboards', 'OwnerDashboard');
  await expect(page.getByText('Waiting on you', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The next handoffs (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gear with a second job' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The next handoffs' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bookingResponses?: unknown[] }).__bookingResponses)).toEqual([{ id: bookingId, approve: true }]);
  await expect(page.getByText('Awaiting payment', { exact: true }).and(page.locator('span'))).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

test('workspace source retains authoritative financial and participant workflows without private pricing', () => {
  const checkout = source('src/pages/checkout.tsx');
  expect(checkout).toContain('await createCheckoutSession(paymentBookingId)');
  expect(checkout).toContain('await fetchConfirmedPayment(id)');
  expect(checkout).toContain("next?.status === 'confirmed'");
  const dashboard = source('src/pages/dashboards.tsx');
  for (const api of ['respondToBookingRequest', 'cancelBooking', 'startBookingReturn', 'completeBookingReturn', 'setDateAvailability', 'deleteOwnerListing', 'fetchBankPayoutStatus']) {
    expect(dashboard).toContain(`await ${api}(`);
  }
  expect(dashboard).not.toContain('claims.map(');
  const requests = source('src/pages/requests.tsx');
  expect(requests).toContain('fetchRequestListingMatches');
  expect(requests).toContain('createItemRequest');
  expect(requests).toContain('updateItemRequest');
  expect(requests).toContain('closeItemRequest');
  expect(requests).not.toMatch(/createMarketplaceOffer|respondToMarketplaceOffer|linkRequestOfferListing/);
  expect(source('src/pages/claims.tsx')).toContain('staff={false}');
  expect(source('src/pages/support.tsx')).toContain('staff={false}');
  expect(source('src/pages/wallet.tsx')).toContain('Test wallet only');
});
