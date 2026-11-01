import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Session, User } from '@supabase/supabase-js';
import { mockSupabaseModule } from './mock-supabase';
import { appUrl } from './test-url';

test.setTimeout(60_000);

const apiUrl = 'http://localhost:54321';
const renterId = '10000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000002';
const categoryId = '20000000-0000-4000-8000-000000000001';
const listingId = '30000000-0000-4000-8000-000000000001';
const bookingId = '40000000-0000-4000-8000-000000000001';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=';
const profile = { id: renterId, full_name: 'Camera Renter', avatar_url: null };
const owner = { id: ownerId, full_name: 'Camera Owner', avatar_url: null };
const listing = {
  id: listingId, owner_id: ownerId, category_id: categoryId, title: 'Mirrorless travel camera',
  description: 'A compact camera with a carrying case.', price_per_day: 25, price_per_week: null,
  deposit: 50, estimated_value: 200, location_lat: 32.8, location_lng: -96.9,
  location_label: 'Irving, TX', instant_booking: false, protection_eligible: false,
  delivery_available: true, delivery_fee: 15, owner_verified: true, status: 'published',
  availability_start: '2026-11-01', availability_end: '2026-11-30',
  created_at: '2026-10-01T00:00:00Z', listing_images: [{ url: image, sort_order: 0 }],
  categories: { name: 'Electronics' }, owner,
};
const booking = {
  id: bookingId, listing_id: listingId, renter_id: renterId, owner_id: ownerId,
  start_date: '2026-11-02', end_date: '2026-11-05', quantity: 1, status: 'requested',
  daily_rate: 25, days: 3, subtotal: 75, service_fee_amount: 7.5, insurance_amount: 0,
  deposit: 50, total: 132.5, created_at: '2026-11-01T00:00:00Z',
  listing: { id: listingId, title: listing.title, listing_images: listing.listing_images },
  owner, renter: profile,
};

function testSession(): Session {
  const user: User = {
    id: renterId, aud: 'authenticated', role: 'authenticated', email: 'renter@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: profile.full_name }, identities: [],
    email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  };
  const expiresAt = Math.floor(Date.parse('2026-11-01T13:00:00Z') / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: renterId, aud: 'authenticated', role: 'authenticated', exp: expiresAt,
    })}.test-signature`,
    refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user,
  };
}

interface Scenario {
  authenticated?: boolean;
  empty?: boolean;
  instant?: boolean;
  failSearch?: boolean;
  failFavorite?: boolean;
  failPaymentOnce?: boolean;
  bookingStatus?: string;
  paymentAmount?: number;
  paymentCurrency?: string;
  unavailable?: string[];
  legacyWindow?: boolean;
  failCancellation?: boolean;
  failReturn?: boolean;
}

async function setup(page: Page, scenario: Scenario = {}) {
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
  if (scenario.authenticated) await page.addInitScript((session) => {
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session));
  }, testSession());
  await page.routeWebSocket('**/realtime/v1/websocket**', (socket) => {
    socket.onMessage((message) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === 'phx_join' || event === 'heartbeat' || event === 'phx_leave') {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok',
          response: event === 'phx_join' ? { postgres_changes: payload.config.postgres_changes.map((filter: object, index: number) => ({ ...filter, id: index + 1 })) } : {},
        }]));
      }
    });
  });
  const creates: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const searches: Record<string, unknown>[] = [];
  const actions: { name: string; args: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  let status = scenario.bookingStatus ?? booking.status;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appUrl) return url.pathname === '/src/lib/supabase.ts' ? mockSupabaseModule(route) : route.continue();
    if (url.origin !== apiUrl) {
      if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/png', body: Buffer.from(image.split(',')[1], 'base64') });
      return route.continue();
    }
    const headers = { 'access-control-allow-origin': appUrl, 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS,HEAD', 'content-range': '0-0/0' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let body: unknown = [];
    let responseStatus = 200;
    const rpc = url.pathname.replace('/rest/v1/rpc/', '');
    if (url.pathname === '/auth/v1/user') body = scenario.authenticated ? testSession().user : null;
    else if (rpc === 'has_active_session') body = Boolean(scenario.authenticated);
    else if (rpc === 'get_my_profile') body = { ...profile, email: 'renter@example.test', phone: null, location: null, created_at: '2026-01-01T00:00:00Z' };
    else if (rpc === 'get_my_admin_access') body = null;
    else if (rpc === 'get_listing_unavailable_dates') body = { blocked: [], booked: scenario.unavailable ?? [] };
    else if (rpc === 'cancel_booking' || rpc === 'start_booking_return') {
      actions.push({ name: rpc, args: request.postDataJSON() });
      const failed = rpc === 'cancel_booking' ? scenario.failCancellation : scenario.failReturn;
      if (failed) { responseStatus = 503; body = { message: 'Booking service unavailable' }; }
      else { status = rpc === 'cancel_booking' ? 'cancelled' : 'return_pending'; body = { ...booking, status }; }
    }
    else if (rpc === 'search_available_listings') {
      searches.push(request.postDataJSON());
      body = scenario.failSearch ? { message: 'Search unavailable' } : { rows: scenario.empty ? [] : [listing], total: scenario.empty ? 0 : 1 };
      responseStatus = scenario.failSearch ? 503 : 200;
    } else if (rpc === 'create_booking_request') {
      const payload = request.postDataJSON();
      creates.push(payload);
      status = scenario.instant ? 'pending_payment' : 'requested';
      body = { ...booking, status, start_date: payload.p_start_date, end_date: payload.p_end_date,
        delivery_mode: payload.p_delivery_mode, renter_note: payload.p_renter_note };
    } else if (url.pathname === '/functions/v1/create-checkout-session') {
      payments.push(request.postDataJSON());
      responseStatus = scenario.failPaymentOnce && payments.length === 1 ? 503 : 200;
      body = responseStatus === 503 ? { message: 'Stripe unavailable' } : { url: `${appUrl}/confirmation/${bookingId}` };
    } else if (url.pathname === '/rest/v1/categories') body = [{ id: categoryId, name: 'Electronics', icon: 'Camera', active: true, sort_order: 1 }];
    else if (url.pathname === '/rest/v1/listings') {
      const row = { ...listing, instant_booking: scenario.instant ?? false,
        ...(scenario.legacyWindow ? { availability_start: null, availability_end: null } : {}) };
      body = request.headers().accept?.includes('vnd.pgrst.object') ? row : [row];
    } else if (url.pathname === '/rest/v1/bookings') {
      const row = { ...booking, status };
      body = request.headers().accept?.includes('vnd.pgrst.object') ? row : [row];
    } else if (url.pathname === '/rest/v1/payments') {
      body = { amount: scenario.paymentAmount ?? 13250, currency: scenario.paymentCurrency ?? 'usd', status: 'succeeded' };
    } else if (url.pathname === '/rest/v1/feature_flags') body = [];
    else if (url.pathname === '/rest/v1/app_settings') body = { value: '0.1' };
    else if (url.pathname === '/rest/v1/favorites') {
      if (request.method() === 'POST' && scenario.failFavorite) { responseStatus = 503; body = { message: 'Could not save rental' }; }
    } else if (!['/rest/v1/reviews', '/rest/v1/notifications'].includes(url.pathname)) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      responseStatus = 500; body = { message: 'Unexpected test backend request' };
    }
    return route.fulfill({ status: responseStatus, headers, contentType: 'application/json', body: body === null ? '' : JSON.stringify(body) });
  });
  return { creates, payments, searches, actions, unexpected };
}

async function markup(locator: Locator) {
  return locator.evaluate((element) => [element, ...element.querySelectorAll('*')]
    .map((node) => `${node.tagName}:${node.getAttribute('class') ?? ''}`));
}

for (const width of [375, 768, 1440]) {
  test(`main uses Preview hero markup and identical hero-copy pixels at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const calls = await setup(page, { empty: true });
    await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Great gear. No need to buy.' })).toBeVisible({ timeout: 20_000 });
    const preview = await context.newPage();
    await preview.setViewportSize({ width, height: 1000 });
    await preview.goto(`${appUrl}/preview-1`, { waitUntil: 'domcontentloaded' });
    await expect(preview.getByRole('heading', { name: 'Great gear. No need to buy.' })).toBeVisible({ timeout: 20_000 });
    for (const selector of ['.p1-hero-layout', '.p1-search-bar', '.p1-how', '.p1-owner-promo']) {
      expect(await markup(page.locator(selector))).toEqual(await markup(preview.locator(selector)));
    }
    await Promise.all([page.evaluate(() => document.fonts.ready.then(() => undefined)), preview.evaluate(() => document.fonts.ready.then(() => undefined))]);
    const actual = await page.locator('.p1-hero-copy').screenshot({ path: testInfo.outputPath('main-hero.png'), animations: 'disabled' });
    const expected = await preview.locator('.p1-hero-copy').screenshot({ path: testInfo.outputPath('preview-hero.png'), animations: 'disabled' });
    expect(actual.equals(expected), 'shared hero copy must be pixel-identical').toBe(true);
    await expect(page.locator('#p1-nearby a[href^="/listing/"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(calls.unexpected).toEqual([]);
  });
}

test('native search sends real filters and shows backend failure without demo listings', async ({ page }) => {
  const scenario: Scenario = { failSearch: true };
  const calls = await setup(page, scenario);
  await page.goto(`${appUrl}/search?q=camera&verified=1&delivery=1&protection=1`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toContainText('Search unavailable');
  expect(calls.searches[0]).toMatchObject({ p_keyword: 'camera', p_verified_only: true, p_delivery_only: true, p_protection_only: true });
  await expect(page.locator('a[href^="/listing/"]')).toHaveCount(0);
  scenario.failSearch = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('link', { name: listing.title, exact: true })).toBeVisible();
  expect(calls.unexpected).toEqual([]);
});

test('failed native favorite mutation stays unsaved and reports failure', async ({ page }) => {
  await setup(page, { authenticated: true, failFavorite: true });
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  const save = page.getByRole('button', { name: `Save ${listing.title}`, exact: true }).first();
  await expect(save).toBeVisible();
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Could not save this rental');
  await expect(save).toHaveAttribute('aria-pressed', 'false');
});

test('native checkout retains note and step when dates change and sends real delivery data', async ({ page }) => {
  const calls = await setup(page, { authenticated: true, unavailable: ['2026-11-05'] });
  await page.goto(`${appUrl}/checkout/${listingId}?start=2026-11-02&end=2026-11-04`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: /A note/ }).fill('  Deliver to reception  ');
  await page.getByRole('button', { name: /Rental dates/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-day="2026-11-02"]').click();
  await expect(dialog.locator('[data-day="2026-11-05"]')).toBeEnabled();
  await dialog.locator('[data-day="2026-11-05"]').click();
  await dialog.getByRole('button', { name: 'Apply dates' }).click();
  await expect(page.getByRole('textbox', { name: /A note/ })).toHaveValue('  Deliver to reception  ');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Have it delivered/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Send rental request' }).click();
  await expect(page.getByRole('alert')).toContainText('Accept the rental terms');
  expect(calls.creates).toHaveLength(0);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Send rental request' }).click();
  await expect(page).toHaveURL(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible();
  expect(calls.creates).toEqual([{ p_listing_id: listingId, p_start_date: '2026-11-02', p_end_date: '2026-11-05',
    p_quantity: 1, p_delivery_mode: 'delivery', p_renter_note: 'Deliver to reception' }]);
  expect(calls.unexpected).toEqual([]);
});

test('native rental calendar permits exclusive last return but not blocked pickup', async ({ page }) => {
  await setup(page, { authenticated: true, unavailable: ['2026-11-05'] });
  await page.goto(`${appUrl}/checkout/${listingId}?start=2026-11-02&end=2026-11-04`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Rental dates/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-day="2026-11-05"]')).toBeDisabled();
  await dialog.locator('[data-day="2026-11-28"]').click();
  await expect(dialog.locator('[data-day="2026-11-30"]')).toBeEnabled();
  await dialog.locator('[data-day="2026-11-30"]').click();
  await dialog.getByRole('button', { name: 'Apply dates' }).click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});

test('native checkout retries Stripe against the same authoritative booking', async ({ page }) => {
  const calls = await setup(page, { authenticated: true, instant: true, failPaymentOnce: true });
  await page.goto(`${appUrl}/checkout/${listingId}?start=2026-11-02&end=2026-11-05`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Sample card ending 4242')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Continue to secure payment' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry secure payment' }).click();
  await expect(page).toHaveURL(`${appUrl}/confirmation/${bookingId}`);
  expect(calls.creates).toHaveLength(1);
  expect(calls.payments).toEqual([{ bookingId }, { bookingId }]);
  await expect(page.getByText('Payment confirmed', { exact: true })).toHaveCount(0);
  expect(calls.unexpected).toEqual([]);
});

for (const receipt of [
  { amount: 13250, currency: 'usd', verified: true },
  { amount: 100, currency: 'usd', verified: false },
  { amount: 13250, currency: 'eur', verified: false },
]) {
  test(`native confirmation verifies receipt ${receipt.amount} ${receipt.currency}`, async ({ page }) => {
    const calls = await setup(page, { authenticated: true, bookingStatus: 'confirmed', paymentAmount: receipt.amount, paymentCurrency: receipt.currency });
    await page.goto(`${appUrl}/confirmation/${bookingId}?success=1`, { waitUntil: 'domcontentloaded' });
    if (receipt.verified) {
      await expect(page.getByText('Payment confirmed', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Go make something of it.' })).toBeVisible();
      await expect(page.locator('.p1-ticket-total')).toContainText('$82.50');
    } else {
      await expect(page.getByRole('alert')).toContainText('Payment could not be verified');
      await expect(page.getByText('Payment confirmed', { exact: true })).toHaveCount(0);
    }
    expect(calls.unexpected).toEqual([]);
  });
}

test('malformed checkout dates are rejected rather than replaced with a demo range', async ({ page }) => {
  const calls = await setup(page, { authenticated: true });
  await page.goto(`${appUrl}/checkout/${listingId}?start=2026-02-30&end=2026-11-05`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Choose your dates first' })).toBeVisible();
  expect(calls.creates).toHaveLength(0);
});

test('legacy listings retain the scheduling horizon and rental-length validation', async ({ page }) => {
  await setup(page, { authenticated: true, legacyWindow: true });
  await page.goto(`${appUrl}/checkout/${listingId}?start=2026-11-02&end=2026-11-04`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Rental dates/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-day="2026-11-02"]').click();
  await dialog.getByRole('button', { name: 'Next month' }).click();
  await dialog.locator('[data-day="2026-12-03"]').click();
  await expect(dialog.getByRole('alert')).toContainText('30 calendar days or less');
  await expect(dialog.getByRole('button', { name: 'Apply dates' })).toBeDisabled();
});

for (const state of [
  { actual: 'requested', tab: 'Pending', label: 'Awaiting owner approval' },
  { actual: 'pending_payment', tab: 'Approved', label: 'Awaiting payment' },
  { actual: 'confirmed', tab: 'Upcoming', label: 'Confirmed' },
  { actual: 'active', tab: 'Active', label: 'Active' },
  { actual: 'return_pending', tab: 'Active', label: 'Return in progress' },
  { actual: 'completed', tab: 'Past', label: 'Completed' },
  { actual: 'rejected', tab: 'Cancelled', label: 'Declined' },
]) {
  test(`native rentals render authoritative ${state.actual} status in ${state.tab}`, async ({ page }) => {
    const calls = await setup(page, { authenticated: true, bookingStatus: state.actual });
    await page.goto(`${appUrl}/dashboard?tab=renting`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Your next good plans.' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: state.tab, exact: true }).click();
    const row = page.locator('.p1-rental-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(state.label);
    await expect(row.locator('h2')).toHaveText(listing.title);
    await expect(row).toContainText('$82.50 rental total');
    expect(calls.unexpected).toEqual([]);
  });
}

test('native rentals share original row hierarchy and responsive workspace', async ({ page, context }, testInfo) => {
  await setup(page, { authenticated: true, bookingStatus: 'confirmed' });
  await page.goto(`${appUrl}/dashboard?tab=renting`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.p1-rental-row')).toBeVisible({ timeout: 20_000 });
  const preview = await context.newPage();
  await preview.goto(`${appUrl}/preview-1/#/renter`, { waitUntil: 'domcontentloaded' });
  await expect(preview.locator('.p1-rental-row').first()).toBeVisible({ timeout: 20_000 });
  expect(await markup(page.locator('.p1-rental-row'))).toEqual(await markup(preview.locator('.p1-rental-row').first()));
  expect(await markup(page.locator('.p1-tabs'))).toEqual(await markup(preview.locator('.p1-tabs')));
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.p1-rental-row')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`native-rentals-${width}.png`), fullPage: true });
  }
});

test('native rental cancellation failure preserves booking and retries the real RPC', async ({ page }) => {
  const scenario: Scenario = { authenticated: true, bookingStatus: 'requested', failCancellation: true };
  const calls = await setup(page, scenario);
  await page.goto(`${appUrl}/dashboard?tab=renting`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Rental details' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancel rental' }).click();
  await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Booking service unavailable');
  await expect(page.locator('.p1-rental-row')).toContainText('Awaiting owner approval');
  scenario.failCancellation = false;
  await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.locator('.p1-rental-row')).toContainText('Cancelled');
  expect(calls.actions).toEqual([{ name: 'cancel_booking', args: { p_booking_id: bookingId } }, { name: 'cancel_booking', args: { p_booking_id: bookingId } }]);
});

test('native renter starts return without pretending the owner completed it', async ({ page }) => {
  const scenario: Scenario = { authenticated: true, bookingStatus: 'active', failReturn: true };
  const calls = await setup(page, scenario);
  await page.goto(`${appUrl}/dashboard?tab=renting`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Rental details' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Start return' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Booking service unavailable');
  scenario.failReturn = false;
  await dialog.getByRole('button', { name: 'Start return' }).click();
  await expect(page.locator('.p1-rental-row')).toContainText('Return in progress');
  await expect(dialog).toContainText('The owner must confirm receipt');
  expect(calls.actions).toEqual([{ name: 'start_booking_return', args: { p_booking_id: bookingId } }, { name: 'start_booking_return', args: { p_booking_id: bookingId } }]);
});
