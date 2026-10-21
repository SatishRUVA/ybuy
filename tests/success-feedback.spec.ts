import { expect, test, type Page } from '@playwright/test';
import type { Session, User } from '@supabase/supabase-js';
import { mockSupabaseModule } from './mock-supabase';

const appUrl = 'http://127.0.0.1:5174';
const apiUrl = 'http://127.0.0.1:54321';
const renterId = '10000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000002';
const listingId = '30000000-0000-4000-8000-000000000001';
const bookingId = '40000000-0000-4000-8000-000000000001';
const categoryId = '20000000-0000-4000-8000-000000000001';
test.setTimeout(60000);
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=';
const listing = {
  id: listingId, owner_id: ownerId, category_id: categoryId, title: 'Mirrorless travel camera',
  description: 'A camera with a lens and carrying case.', price_per_day: 25, deposit: 50,
  status: 'published', created_at: '2026-10-01T00:00:00Z',
  listing_images: [{ url: image, sort_order: 0 }], categories: { name: 'Electronics' },
  owner: { id: ownerId, full_name: 'Camera Owner', avatar_url: null },
};
const booking = {
  id: bookingId, listing_id: listingId, renter_id: renterId, owner_id: ownerId,
  start_date: '2026-11-02', end_date: '2026-11-05', quantity: 1, status: 'confirmed',
  daily_rate: 25, days: 3, subtotal: 75, service_fee_amount: 9, deposit: 50, total: 134,
  created_at: '2026-10-18T00:00:00Z', listing,
  owner: listing.owner, renter: { id: renterId, full_name: 'Camera Renter', avatar_url: null },
};

function sessionFor(id: string): Session {
  const user: User = {
    id, aud: 'authenticated', role: 'authenticated', email: 'renter@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Camera Renter' }, identities: [],
    email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, aud: 'authenticated', role: 'authenticated', exp: expiresAt })}.test`,
    refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user,
  };
}

interface Scenario {
  status?: string;
  paymentStatus?: string;
  paymentError?: boolean;
  bookingError?: boolean;
  publishFails?: boolean;
  publishDraft?: boolean;
  publishDelay?: Promise<void>;
  availabilityFails?: boolean;
  dashboardBookings?: boolean;
  userId?: string;
  reviewFails?: boolean;
  reviewDelay?: Promise<void>;
  returnFails?: boolean;
  aiSuccess?: boolean;
}

async function setup(page: Page, scenario: Scenario = {}) {
  // Ignore dev-server HMR while a fixture-driven workflow is in progress.
  await page.routeWebSocket('ws://127.0.0.1:5174/**', () => {});
  const session = sessionFor(scenario.userId ?? renterId);
  await page.addInitScript((value) => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), session);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === appUrl) {
      if (url.pathname === '/src/lib/supabase.ts') return mockSupabaseModule(route);
      if (url.pathname === '/src/components/pickup-location.tsx' || url.pathname === '/src/lib/google-maps.ts') {
        const response = await route.fetch();
        const body = (await response.text()).replace(/const (googleKey|key) = [^\n]+;/, 'const $1 = "test-google-key";');
        expect(body).toContain('"test-google-key"');
        return route.fulfill({ response, body });
      }
      return route.continue();
    }
    if (url.hostname === 'maps.googleapis.com') return route.fulfill({
      contentType: 'application/javascript',
      body: `
        class TestPlace extends HTMLElement {
          connectedCallback() {
            this.textContent = 'Select test pickup address';
            this.addEventListener('click', () => {
              const e = new Event('gmp-select');
              e.placePrediction = { toPlace: () => ({
                id: 'test-place', formattedAddress: '123 Test Street, Irving, TX 75039, US',
                location: { lat: () => 32.8, lng: () => -96.9 },
                addressComponents: [
                  { longText: '123', types: ['street_number'] },
                  { longText: 'Test Street', types: ['route'] },
                  { longText: 'Irving', types: ['locality'] },
                  { shortText: 'TX', types: ['administrative_area_level_1'] },
                  { longText: '75039', types: ['postal_code'] },
                  { shortText: 'US', types: ['country'] }
                ], fetchFields: async () => {}
              }) };
              this.dispatchEvent(e);
            });
          }
        }
        if (!customElements.get('test-place-autocomplete')) customElements.define('test-place-autocomplete', TestPlace);
        window.google.maps.importLibrary = async () => ({ PlaceAutocompleteElement: TestPlace });
        window.google.maps.__ybuyGoogleMapsReady();
      `,
    });
    if (url.origin !== apiUrl) return route.fulfill({ contentType: 'application/json', body: '{}' });
    let body: unknown = [];
    let status = 200;
    if (url.pathname === '/auth/v1/user') body = session.user;
    if (url.pathname === '/rest/v1/rpc/has_active_session') body = true;
    if (url.pathname === '/rest/v1/rpc/get_rental_agreement') body = null;
    if (url.pathname === '/rest/v1/rpc/get_listing_unavailable_dates') body = { blocked: [], booked: [] };
    if (url.pathname === '/rest/v1/rpc/get_checkout_reservation') body = {
      status: scenario.status ?? 'confirmed',
      server_now: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
    if (url.pathname === '/rest/v1/checkout_payment_exceptions') body = null;
    if (url.pathname === '/rest/v1/rpc/get_my_profile') body = {
      id: session.user.id, email: session.user.email, full_name: 'Camera Renter', avatar_url: null,
      phone: null, location: null, created_at: session.user.created_at,
    };
    if (url.pathname === '/rest/v1/categories') body = [{ id: categoryId, name: 'Electronics', slug: 'electronics', icon: 'Camera' }];
      if (url.pathname.startsWith('/storage/v1/object/sign/listing-images/')) {
        body = { signedURL: `${url.pathname}?token=test-signed-photo` };
      }
      if (url.pathname.startsWith('/storage/v1/object/listing-images/')) body = { Key: url.pathname.split('/storage/v1/object/')[1] };
    if (url.pathname === '/rest/v1/listings') {
      if (req.method() === 'POST') body = { id: listingId };
      else if (req.method() === 'PATCH') {
        const publishing = req.postDataJSON().status === 'published';
        if (publishing) await scenario.publishDelay;
        body = publishing ? { id: listingId, status: scenario.publishDraft ? 'draft' : 'published' } : null;
        if (publishing && scenario.publishFails) { status = 403; body = { message: 'Publication denied' }; }
      } else body = url.searchParams.has('id') ? listing : [{ ...listing, owner_id: renterId }];
    }
    if (url.pathname === '/rest/v1/listing_images' && req.method() === 'PATCH' && req.headers().prefer?.includes('return=representation')) {
      body = [{ url: 'https://example.test/listing-images/replaced.png' }];
    }
    if (url.pathname === '/functions/v1/analyze-listing-photo') body = scenario.aiSuccess
      ? {
        ok: true,
        masked: { title: '', description: '', changed: false },
        suggestion: { title: 'Visible camera item', description: 'A camera visible in the supplied photo.', categoryId },
        flags: [],
        photoQualitySuggestions: [{ photoIndex: 0, reason: 'The photo looks dim.', recommendation: 'Retake it in brighter light.' }],
      }
      : { ok: false };
    if (url.pathname === '/rest/v1/bookings') {
      const row = { ...booking, status: scenario.status ?? 'confirmed' };
      body = url.searchParams.has('id') ? row : scenario.dashboardBookings ? [row] : [];
      if (scenario.bookingError) { status = 403; body = { message: 'Booking lookup failed' }; }
    }
    if (url.pathname === '/rest/v1/payments') {
      body = { amount: 84.25, currency: 'usd', status: scenario.paymentStatus ?? 'succeeded' };
      if (scenario.paymentError) { status = 403; body = { message: 'Payment lookup failed' }; }
    }
    if (url.pathname === '/rest/v1/rpc/create_booking_request') body = { ...booking, status: 'requested' };
    if (url.pathname === '/rest/v1/reviews' && req.method() === 'POST') {
      await scenario.reviewDelay;
      body = null;
      if (scenario.reviewFails) { status = 403; body = { message: 'Review save denied' }; }
    }
    if (url.pathname === '/rest/v1/rpc/complete_booking_return') {
      body = { ...booking, status: 'completed' };
      if (scenario.returnFails) { status = 403; body = { message: 'Return denied' }; }
      else scenario.status = 'completed';
    }
    if (url.pathname === '/rest/v1/listing_availability' && req.method() === 'POST' && scenario.availabilityFails) {
      status = 403; body = { message: 'Availability save denied' };
    }
    return route.fulfill({ status, contentType: 'application/json', body: body === null ? '' : JSON.stringify(body) });
  });
}

test('verified payment shows actual amount, image, reference and dates, then deduplicates reloads', async ({ page }, testInfo) => {
  await setup(page);
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  const dialog = page.getByRole('region', { name: 'Payment confirmed', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
  await expect(dialog).toContainText('$84.25');
  await expect(dialog).not.toContainText('$134');
  await expect(dialog).toContainText(bookingId);
  await expect(dialog).toContainText('Nov 2, 2026');
  await expect(dialog).toContainText('Nov 5, 2026');
  await expect(dialog.locator('img')).toHaveAttribute('src', image);
  await expect(dialog).toContainText('Receipt delivery status is not available');
  await expect(dialog.locator('.success-confetti span')).toHaveCount(24);
  await expect(dialog.locator('.success-confetti')).toHaveCSS('pointer-events', 'none');
  await expect(dialog).toHaveCSS('animation-name', 'successEnter');
  await expect(dialog.locator('.success-check')).toHaveCSS('animation-name', 'successCheck');
  await page.screenshot({ path: testInfo.outputPath('payment-inline-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'View Booking Details' }).click();
  await expect(page.locator('#booking-summary')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(dialog.locator('.success-confetti')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name: 'Bookings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bookings', exact: true })).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.success-confetti')).toHaveCount(0);
  await page.reload({ waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Your booking' })).toBeVisible({ timeout: 20000 });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.success-confetti')).toHaveCount(0);
});

test('confirmed booking without a payment record shows booking confirmation only', async ({ page }) => {
  await setup(page);
  await page.route('**/rest/v1/payments?**', (route) => route.fulfill({ contentType: 'application/json', body: 'null' }));
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.getByRole('region', { name: 'Booking confirmed', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Booking confirmed', exact: true })).not.toContainText('Confirmed payment');
  await page.getByRole('button', { name: 'View Booking Details' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#booking-summary')).toBeFocused();
});

test('contained icon burst draws its check, varies particles, and keeps actions immediately usable', async ({ page }, testInfo) => {
  await setup(page);
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  const panel = page.getByRole('region', { name: 'Payment confirmed', exact: true });
  await expect(panel.locator('.success-confetti span')).toHaveCount(24);
  const motion = await panel.evaluate((element) => {
    const indicator = element.querySelector('.success-indicator')!;
    const particles = [...indicator.querySelectorAll<HTMLElement>('.success-confetti span')];
    const animations = indicator.getAnimations({ subtree: true });
    animations.forEach((animation) => { animation.pause(); animation.currentTime = 0; });
    const center = indicator.getBoundingClientRect();
    const origin = particles[0].getBoundingClientRect();
    const check = indicator.querySelector('path')!;
    const initialStroke = getComputedStyle(check).strokeDashoffset;
    animations.forEach((animation) => { animation.currentTime = 500; });
    return {
      originX: origin.x - (center.x + center.width / 2),
      originY: origin.y - (center.y + center.height / 2),
      sizes: [...new Set(particles.map((particle) => getComputedStyle(particle).width))],
      colors: [...new Set(particles.map((particle) => getComputedStyle(particle.firstElementChild!).backgroundColor))],
      initialStroke,
      revealedStroke: getComputedStyle(check).strokeDashoffset,
      duration: getComputedStyle(particles[0]).animationDuration,
      bounds: particles.map((particle) => {
        const rect = particle.firstElementChild!.getBoundingClientRect();
        return { x: rect.x - (center.x + center.width / 2), y: rect.y - (center.y + center.height / 2) };
      }),
    };
  });
  expect(Math.abs(motion.originX)).toBeLessThan(1);
  expect(Math.abs(motion.originY)).toBeLessThan(1);
  expect(motion.sizes).toHaveLength(4);
  expect(motion.colors).toHaveLength(5);
  expect(motion.colors).not.toContain('rgba(0, 0, 0, 0)');
  expect(motion.initialStroke).toBe('32px');
  expect(motion.revealedStroke).toBe('0px');
  expect(motion.duration).toBe('1.3s');
  expect(motion.bounds.some(({ x }) => x < -20)).toBe(true);
  expect(motion.bounds.some(({ x }) => x > 20)).toBe(true);
  expect(motion.bounds.some(({ y }) => y < -15)).toBe(true);
  expect(motion.bounds.some(({ y }) => y > 10)).toBe(true);
  expect(motion.bounds.every(({ x, y }) => Math.abs(x) < 55 && y > -45 && y < 60)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('payment-burst-midflight.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('payment-burst-mobile.png'), fullPage: true });
  await panel.getByRole('button', { name: 'View Booking Details' }).click();
  await expect(page.locator('#booking-summary')).toBeFocused();
  await expect(panel.locator('.success-confetti')).toHaveCount(0, { timeout: 2000 });
});

test('changing to reduced motion stops an active burst without replaying it', async ({ page }) => {
  await setup(page);
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.locator('.success-confetti span')).toHaveCount(24);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  await expect(page.locator('.success-checkmark path')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.success-content').first()).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View Booking Details' })).toBeEnabled();
});

for (const tab of ['renting', 'lending']) {
  test(`${tab} review celebrates only after a successful save and preserves failures`, async ({ page }) => {
    let release!: () => void;
    const scenario: Scenario = {
      dashboardBookings: true, status: 'completed', userId: tab === 'renting' ? renterId : ownerId,
      reviewFails: true,
    };
    await setup(page, scenario);
    await page.goto(`${appUrl}/dashboard?tab=${tab}`);
    await page.getByRole('button', { name: tab === 'renting' ? 'Review' : 'Review Camera', exact: true }).click();
    await page.getByRole('button', { name: '5 stars', exact: true }).click();
    await page.getByRole('button', { name: 'Submit review', exact: true }).click();
    await expect(page.getByText('Could not submit your review.', { exact: true })).toBeVisible();
    await expect(page.locator('.success-notice')).toHaveCount(0);
    await expect(page.locator('.success-confetti')).toHaveCount(0);
    scenario.reviewFails = false;
    scenario.reviewDelay = new Promise<void>((resolve) => { release = resolve; });
    await page.getByRole('button', { name: 'Submit review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeVisible();
    await expect(page.locator('.success-confetti')).toHaveCount(0);
    release();
    await expect(page.getByText('Your review was saved.', { exact: true })).toBeVisible();
    await expect(page.locator('.success-confetti span')).toHaveCount(14);
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(page.locator('.success-notice')).toHaveCount(0);
    await expect(page.locator('.success-confetti')).toHaveCount(0);
  });
}

test('owner dashboard return celebrates only after the server completes it', async ({ page }) => {
  const scenario: Scenario = { dashboardBookings: true, userId: ownerId, status: 'return_pending', returnFails: true };
  await setup(page, scenario);
  await page.goto(`${appUrl}/dashboard?tab=lending`);
  await page.getByRole('button', { name: 'Mark returned', exact: true }).first().click();
  await expect(page.getByText('Return denied', { exact: true })).toBeVisible();
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  scenario.returnFails = false;
  await page.getByRole('button', { name: 'Mark returned', exact: true }).first().click();
  await expect(page.getByText('Return complete.', { exact: true })).toBeVisible();
  await expect(page.locator('.success-confetti span')).toHaveCount(14);
});

for (const status of ['requested', 'pending_payment', 'cancelled', 'rejected', 'active', 'completed']) {
  test(`${status} never celebrates a success redirect`, async ({ page }) => {
    await setup(page, { status });
    const paymentCalls: string[] = [];
    page.on('request', (req) => { if (req.url().includes('/payments?')) paymentCalls.push(req.url()); });
    await page.goto(`${appUrl}/confirmation/${bookingId}?success=true&amount=999`);
    await expect(page.getByRole('heading', { name: status === 'requested' ? 'Request sent' : 'Your booking' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.success-card')).toHaveCount(0);
    await expect(page.locator('.success-confetti')).toHaveCount(0);
    expect(paymentCalls).toHaveLength(0);
  });
}

test('pending webhook is rechecked and celebrates only once it confirms', async ({ page }) => {
  const scenario: Scenario = { status: 'pending_payment' };
  await setup(page, scenario);
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.getByText('Payment is not confirmed yet')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.success-card')).toHaveCount(0);
  scenario.status = 'confirmed';
  await expect(page.getByRole('region', { name: 'Payment confirmed', exact: true })).toBeVisible();
});

for (const error of ['bookingError', 'paymentError'] as const) {
  test(`${error} preserves an error and does not celebrate`, async ({ page }) => {
    const scenario: Scenario = { [error]: true };
    await setup(page, scenario);
    await page.goto(`${appUrl}/confirmation/${bookingId}`);
    await expect(page.getByText(error === 'bookingError' ? 'Booking lookup failed' : 'Payment lookup failed')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.success-card')).toHaveCount(0);
    scenario[error] = false;
    await page.getByRole('button', { name: 'Check status again' }).click();
    await expect(page.getByRole('region', { name: 'Payment confirmed', exact: true })).toBeVisible();
  });
}

for (const paymentStatus of ['pending', 'failed', 'refunded']) {
  test(`${paymentStatus} payment cannot display a celebration`, async ({ page }) => {
    await setup(page, { paymentStatus });
    await page.goto(`${appUrl}/confirmation/${bookingId}`);
    await expect(page.getByText('Payment is not confirmed. Check your booking status again before continuing.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.success-card')).toHaveCount(0);
  });
}

for (const availabilityFails of [false, true]) {
  test(`routine availability ${availabilityFails ? 'failure keeps the error without success feedback' : 'save uses a dismissible inline notice, not confetti'}`, async ({ page }) => {
    await setup(page, { availabilityFails });
    await page.goto(`${appUrl}/dashboard?tab=lending`);
    await page.getByRole('button', { name: 'Manage dates' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^\d+$/, disabled: false }).last().click();
    if (availabilityFails) {
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByText('Could not update availability for that date.')).toBeVisible();
      await expect(page.getByText('Availability saved.', { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText('Availability saved.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Dismiss notification' }).click();
      await expect(page.getByText('Availability saved.', { exact: true })).toHaveCount(0);
    }
    await expect(page.locator('.success-confetti')).toHaveCount(0);
  });
}

test('reduced motion has a static success state and mobile keyboard controls remain usable', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 667 });
  await setup(page);
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  const dialog = page.getByRole('region', { name: 'Payment confirmed', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.success-confetti')).toHaveCount(0);
  await expect(dialog).toHaveCSS('animation-name', 'none');
  await expect(dialog.locator('.success-check')).toHaveCSS('animation-name', 'none');
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath('payment-inline-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'View Booking Details' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#booking-summary')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('new booking requests stay non-celebratory until approved and paid', async ({ page }) => {
  await setup(page, { status: 'requested' });
  await page.goto(`${appUrl}/checkout/${listingId}?start=2026-11-02&end=2026-11-05`);
  await page.getByRole('button', { name: 'Send booking request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible();
  await expect(page).toHaveURL(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.success-card')).toHaveCount(0);
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Booking confirmed', exact: true })).toHaveCount(0);
});

async function fillListing(page: Page) {
  await page.goto(`${appUrl}/create-listing`);
  const photoBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#1b8d7a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(photoBase64, 'base64') });
  await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Generate listing details with AI' }).click();
  await expect(page.getByText('AI details are unavailable right now. You can enter everything manually.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Category', exact: true }).getByRole('button', { name: 'Electronics', exact: true })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill(listing.title);
  await page.getByLabel('Estimated replacement value (USD)', { exact: true }).fill('1000');
  await page.getByLabel('Item condition', { exact: true }).selectOption('good');
  await page.getByLabel('Description', { exact: false }).fill(listing.description);
  await page.getByLabel('Description', { exact: false }).press('Tab');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('test-place-autocomplete').click();
  await page.getByRole('button', { name: 'Confirm Location' }).click();
  await page.getByLabel('Price per day').fill('25');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

test('bulk photo selection validates files and supports replacement and reorder', async ({ page }) => {
  await setup(page);
  await page.goto(`${appUrl}/create-listing`);
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    canvas.getContext('2d')!.fillRect(0, 0, 400, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const buffer = Buffer.from(photo, 'base64');
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    { name: 'camera-front.png', mimeType: 'image/png', buffer },
    { name: 'camera-back.png', mimeType: 'image/png', buffer },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') },
  ]);
  await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove photo 2' })).toBeVisible();
  await expect(page.getByText('notes.txt: Choose a JPEG, PNG, or WebP image.')).toBeVisible();
  await expect(page.getByText(/This image is a little small/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Replace photo 2' }).click();
  await input.setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('button', { name: 'Remove photo 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move photo 2 earlier' })).toBeEnabled();
  await page.getByRole('button', { name: 'Move photo 2 earlier' }).click();
  await expect(page.getByText('Cover', { exact: true })).toHaveCount(1);
});

test('AI suggestions require acceptance and preserve later owner edits; draft save keeps state', async ({ page }) => {
  await setup(page, { aiSuccess: true });
  await page.goto(`${appUrl}/create-listing`);
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    canvas.getContext('2d')!.fillRect(0, 0, 400, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Generate listing details with AI' }).click();
  await expect(page.getByText('Visible camera item')).toBeVisible();
  await expect(page.getByText('The photo looks dim. Retake it in brighter light.')).toBeVisible();
  await page.getByRole('button', { name: 'Use title' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const title = page.getByLabel('Title', { exact: true });
  await expect(title).toHaveValue('Visible camera item');
  await title.fill('Owner-edited title');
  await page.getByRole('button', { name: /2 AI details/ }).click();
  await page.getByRole('button', { name: 'Regenerate details' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Owner-edited title');
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click();
  await expect(page.getByText('Draft saved. Resume it from My listings.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Owner-edited title');
});

test('publication waits for the server and offers view, manage and share actions', async ({ page }, testInfo) => {
  let release!: () => void;
  const publishDelay = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, { publishDelay });
  await fillListing(page);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publishing…', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  const dialog = page.getByRole('region', { name: 'Your listing is live!', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Your listing is live!' })).toBeVisible();
  await expect(dialog).toContainText(listing.title);
  await expect(dialog.getByRole('button', { name: 'View listing', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Manage listing', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Share listing', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Your listing is live!' })).toBeFocused();
  await expect(dialog.locator('.success-confetti span')).toHaveCount(14);
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('listing-inline-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Manage listing' }).click();
  await expect(page).toHaveURL(`${appUrl}/edit-listing/${listingId}`);
});

for (const scenario of [{ publishFails: true }, { publishDraft: true }]) {
  test(`publication ${scenario.publishFails ? 'failure' : 'draft response'} never celebrates`, async ({ page }) => {
    await setup(page, scenario);
    await fillListing(page);
    await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
    await expect(page.getByText(scenario.publishFails ? 'Publication denied' : 'The listing has not been published. Please try again.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.success-card')).toHaveCount(0);
    await expect(page.locator('.success-confetti')).toHaveCount(0);
  });
}
