import { expect, test, type Page, type Route } from '@playwright/test';
import type { Session, User } from '@supabase/supabase-js';
import { mockSupabaseModule } from './mock-supabase';
import { appUrl } from './test-url';

const apiUrl = 'http://localhost:54321';
const renterId = '10000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000002';
const categoryId = '20000000-0000-4000-8000-000000000001';
const listingId = '30000000-0000-4000-8000-000000000001';
const bookingId = '40000000-0000-4000-8000-000000000001';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=';

const listing = {
  id: listingId,
  owner_id: ownerId,
  category_id: categoryId,
  title: 'Mirrorless travel camera',
  description: 'A compact camera with a carrying case.',
  price_per_day: 25,
  price_per_week: null,
  deposit: 50,
  estimated_value: 200,
  location_lat: 32.8,
  location_lng: -96.9,
  location_label: 'Irving, TX',
  instant_booking: false,
  protection_eligible: false,
  delivery_available: false,
  owner_verified: true,
  status: 'published',
  created_at: '2026-10-01T00:00:00Z',
  listing_images: [{ url: image, sort_order: 0 }],
  categories: { name: 'Electronics' },
  owner: { id: ownerId, full_name: 'Camera Owner', avatar_url: null },
};

const booking = {
  id: bookingId,
  listing_id: listingId,
  renter_id: renterId,
  owner_id: ownerId,
  start_date: '2026-11-02',
  end_date: '2026-11-05',
  quantity: 1,
  status: 'confirmed',
  daily_rate: 25,
  days: 3,
  subtotal: 75,
  service_fee_amount: 9,
  deposit: 50,
  total: 134,
  created_at: '2026-10-18T00:00:00Z',
  listing: { id: listingId, title: listing.title, listing_images: listing.listing_images },
  owner: listing.owner,
  renter: { id: renterId, full_name: 'Camera Renter', avatar_url: null },
};

function sessionFor(id: string): Session {
  const name = id === renterId ? 'Camera Renter' : 'Camera Owner';
  const user: User = {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'renter@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: name },
    identities: [],
    email_confirmed_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: id, aud: 'authenticated', role: 'authenticated', exp: expiresAt, iat: expiresAt - 3600,
    })}.test-signature`,
    refresh_token: `test-refresh-${id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  };
}

interface Scenario {
  listingOverrides?: Partial<typeof listing> & { negotiation_enabled?: boolean; offer_maximum_daily?: number; item_condition?: string; availability_start?: string; availability_end?: string };
  bidding?: boolean;
  unavailableDates?: { blocked: string[]; booked: string[] };
  listingImage?: string;
  failCatalog?: boolean;
  failListings?: boolean;
  emptyCatalog?: boolean;
  failReviews?: boolean;
  failFavorites?: boolean;
  failAvailability?: boolean;
  failCheckInOnce?: boolean;
  failReturnOnce?: boolean;
  initialBookingStatus?: 'confirmed' | 'return_pending' | 'completed';
}

async function setup(page: Page, scenario: Scenario = {}, authId?: string) {
  await page.routeWebSocket(`${appUrl.replace(/^http/, 'ws')}/**`, () => {});
  await page.routeWebSocket('**/realtime/v1/websocket**', (socket) => {
    socket.onMessage((message) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === 'phx_join') {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', {
          status: 'ok',
          response: { postgres_changes: payload.config.postgres_changes.map((filter: object) => ({ ...filter, id: 1 })) },
        }]));
      } else if (event === 'heartbeat' || event === 'phx_leave') {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  });
  if (authId) {
    await page.addInitScript((session) => {
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session));
    }, sessionFor(authId));
  }
  let checkInCalls = 0;
  let returnCalls = 0;
  let bookingStatus = scenario.initialBookingStatus ?? booking.status;

  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appUrl) {
      return url.pathname === '/src/lib/supabase.ts' ? mockSupabaseModule(route) : route.continue();
    }
    if (url.origin !== apiUrl) return route.fulfill({ contentType: 'application/json', body: '{}' });

    const headers = {
      'access-control-allow-origin': appUrl,
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'content-range': '0-0/1',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });

    let status = 200;
    let body: unknown = [];
    if (url.pathname === '/auth/v1/user') body = authId ? sessionFor(authId).user : null;
    else if (url.pathname === '/rest/v1/rpc/has_active_session') body = Boolean(authId);
    else if (url.pathname === '/rest/v1/rpc/get_listing_flow_policy') body = {
      listing_duration_days: 30, max_quantity: 5, max_photos: 8,
      max_photo_bytes: 6 * 1024 * 1024, min_photo_dimension: 600,
      max_delivery_fee: 100, max_estimated_value: 5000, high_value_threshold: 1000,
      offer_below_pct: null, offer_above_pct: null, deposit_rules: [],
    };
    else if (url.pathname === '/rest/v1/rpc/get_listing_unavailable_dates') {
      body = scenario.unavailableDates ?? { blocked: [], booked: [] };
      if (scenario.failAvailability) {
        status = 503;
        body = { message: 'Availability service unavailable' };
      }
    }
    else if (url.pathname === '/rest/v1/rpc/get_my_profile') body = authId && {
      id: authId,
      email: 'renter@example.test',
      full_name: 'Camera Renter',
      avatar_url: null,
      phone: null,
      location: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    else if (url.pathname === '/rest/v1/categories') {
      if (scenario.failCatalog) {
        status = 503;
        body = { message: 'Catalog service unavailable' };
      } else if (!scenario.emptyCatalog) {
        body = [{ id: categoryId, name: 'Electronics', icon: 'Camera', active: true, sort_order: 1 }];
      }
    } else if (url.pathname === '/rest/v1/listings') {
      if (scenario.failCatalog || scenario.failListings) {
        status = 503;
        body = { message: 'Catalog service unavailable' };
      } else if (!scenario.emptyCatalog) {
        if (url.searchParams.has('id')) {
          const item = { ...listing, ...scenario.listingOverrides };
          body = request.headers().accept?.includes('vnd.pgrst.object') ? item : [item];
        } else if (url.searchParams.get('select')?.includes('listing_images')) {
          body = [{ ...listing, listing_images: [{ url: scenario.listingImage ?? image, sort_order: 0 }] }];
        } else {
          body = [{ category_id: categoryId }];
        }
      }
    } else if (url.pathname === '/rest/v1/feature_flags') {
      body = [{ key: 'bidding', enabled: scenario.bidding ?? false }];
    } else if (url.pathname === '/rest/v1/app_settings') {
      body = { value: '0.1' };
    } else if (url.pathname === '/rest/v1/reviews') {
      if (scenario.failReviews) {
        status = 503;
        body = { message: 'Reviews service unavailable' };
      } else {
        body = [];
      }
    } else if (url.pathname === '/rest/v1/favorites') {
      if (scenario.failFavorites) {
        status = 503;
        body = { message: 'Favorites service unavailable' };
      }
    } else if (url.pathname === '/rest/v1/listing_availability') {
      if (scenario.failAvailability) {
        status = 503;
        body = { message: 'Availability service unavailable' };
      }
    } else if (url.pathname === '/rest/v1/bookings' && request.method() === 'GET') {
      if (url.searchParams.has('id')) {
        const result = { ...booking, status: bookingStatus };
        body = request.headers().accept?.includes('vnd.pgrst.object') ? result : [result];
      }
    } else if (url.pathname === '/rest/v1/rpc/list_my_cases') {
      body = { rows: [], total: 0 };
    } else if (url.pathname === '/rest/v1/rpc/get_my_credits') {
      body = { available: 0, balance: 0, reserved: 0, history: [] };
    } else if (url.pathname === '/rest/v1/rpc/mark_booking_active') {
      checkInCalls += 1;
      if (scenario.failCheckInOnce && checkInCalls === 1) {
        status = 503;
        body = { message: 'Booking service unavailable' };
      } else {
        bookingStatus = 'active';
        body = { ...booking, status: bookingStatus };
      }
    } else if (url.pathname === '/rest/v1/rpc/complete_booking_return') {
      returnCalls += 1;
      if (scenario.failReturnOnce && returnCalls === 1) {
        status = 503;
        body = { message: 'Return service unavailable' };
      } else {
        bookingStatus = 'completed';
        body = { ...booking, status: bookingStatus };
      }
    }

    return route.fulfill({
      status,
      headers,
      contentType: 'application/json',
      body: body === null ? '' : JSON.stringify(body),
    });
  });
}

test('category artwork stays fixed when a listing photo changes', async ({ page }) => {
  const scenario: Scenario = {};
  await setup(page, scenario);
  await page.route('https://images.pexels.com/**', (route) => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from(image.split(',')[1], 'base64'),
  }));
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' });
  const categoryImage = page.getByRole('region', { name: 'Browse by category' }).getByRole('button', { name: 'Electronics', exact: true }).locator('img');
  const standardImage = 'https://images.pexels.com/photos/19969452/pexels-photo-19969452.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop';
  await expect(categoryImage).toHaveAttribute('src', standardImage);
  const listingImage = page.getByRole('link', { name: 'View listing: Mirrorless travel camera' }).first().locator('img');
  await expect(listingImage).toHaveAttribute('src', image);

  scenario.listingImage = 'https://example.test/new-user-upload.png';
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(listingImage).toHaveAttribute('src', scenario.listingImage);
  await expect(categoryImage).toHaveAttribute('src', standardImage);

  const artwork = await page.evaluate(async () => {
    const { toUiCategory } = await import('/src/lib/listings.ts');
    return ['Tools & Equipment', 'Electronics', 'Outdoor & Camping', 'Party & Events',
      'Sports & Fitness', 'Vehicles', 'Home & Garden', 'Other', 'New category'].map((name) =>
      toUiCategory({ id: name, name, icon: 'Package', active: true, sort_order: 1 }, new Map()).image);
  });
  expect(artwork.slice(0, 8).every((url) => url.startsWith('https://images.pexels.com/photos/'))).toBe(true);
  expect(new Set(artwork.slice(0, 8)).size).toBe(8);
  expect(artwork[8]).toBe('');
});

test('catalog errors do not render a successful empty state, and retry recovers', async ({ page }) => {
  const scenario: Scenario = { failCatalog: true };
  await setup(page, scenario);
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status').filter({ hasText: "We couldn't load listings" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Nothing listed yet' })).toHaveCount(0);
  scenario.failCatalog = false;
  scenario.emptyCatalog = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing listed yet' })).toBeVisible();
});

test('successful empty search is distinct from failed search', async ({ page }) => {
  const scenario: Scenario = { failListings: true };
  await setup(page, scenario);
  await page.goto(`${appUrl}/search`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status').filter({ hasText: "We couldn't load these items" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Nothing matches those filters' })).toHaveCount(0);
  scenario.failListings = false;
  scenario.emptyCatalog = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing matches those filters' })).toBeVisible();
});

test('listing cards are keyboard links and favorites do not navigate', async ({ page }) => {
  await setup(page);
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('link', { name: 'View listing: Mirrorless travel camera' }).first();
  await expect(card).toBeVisible();
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/listing/${listingId}$`));
  await page.goBack();
  await expect(page.getByRole('link', { name: 'View listing: Mirrorless travel camera' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save to favorites' }).first().click();
  await expect(page).toHaveURL(new RegExp(`${appUrl}/$`));
  await page.goto(`${appUrl}/search`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Map view' }).click();
  const wideCard = page.getByRole('link', { name: 'View listing: Mirrorless travel camera' }).first();
  await expect(wideCard).toBeVisible();
  await wideCard.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/listing/${listingId}$`));
  await page.goBack();
  await page.getByRole('button', { name: 'Save to favorites' }).first().click();
  await expect(page).toHaveURL(new RegExp(`${appUrl}/search$`));
});

test('mobile filter dialog traps focus, closes on Escape, and preserves filters at responsive sizes', async ({ page }) => {
  await setup(page, { emptyCatalog: true });
  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto(`${appUrl}/search`, { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: /^Filters(?: \d+)?$/ });
  const slider = page.getByRole('slider', { name: 'Max price per day' });
  await trigger.click();
  let dialog = page.getByRole('dialog', { name: 'Filters' });
  await expect(dialog).toBeVisible();
  await slider.focus();
  await slider.press('ArrowLeft');
  const selectedPrice = await slider.inputValue();
  await dialog.getByRole('button', { name: 'All categories' }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.locator(':focus').count()).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  dialog = page.getByRole('dialog', { name: 'Filters' });
  await expect(dialog.getByRole('slider', { name: 'Max price per day' })).toHaveValue(selectedPrice);

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  }
  await page.keyboard.press('Escape');
});

test('calendar controls expose full dates and selected range state', async ({ page }) => {
  await setup(page, { emptyCatalog: true });
  await page.goto(`${appUrl}/search`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add dates', exact: true }).click();
  const todayLabel = await page.evaluate(() => new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }));
  const today = page.getByRole('button', { name: new RegExp(todayLabel) });
  await expect(today).toHaveAttribute('aria-pressed', 'false');
  await today.click();
  await expect(today).toHaveAccessibleName(new RegExp(`${todayLabel}, start date of selected range`));
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(today).toHaveAttribute('aria-current', 'date');
});

test('availability errors disable booking until retry verifies availability', async ({ page }) => {
  const scenario: Scenario = { failAvailability: true };
  await setup(page, scenario);
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status').filter({ hasText: "We couldn't verify date availability. Booking is disabled until it can be checked." })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Request to book' }).first()).toBeDisabled();
  scenario.failAvailability = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("We couldn't verify date availability. Booking is disabled until it can be checked.")).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request to book' }).first()).toBeEnabled();
});

test('listing restores valid search dates through real checkout navigation and rejects unpublished booking', async ({ page }) => {
  test.slow();
  const scenario: Scenario = { listingOverrides: { availability_start: '2026-11-01', availability_end: '2026-11-30' } };
  await setup(page, scenario, renterId);
  await page.addInitScript(() => sessionStorage.setItem('ybuy-search-state', 'start=2026-11-02&end=2026-11-05&radius=25'));
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Choose a date range, Nov 2 – Nov 5/ })).toBeVisible();
  await page.getByRole('button', { name: 'Request to book', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${listingId}\\?start=2026-11-02&end=2026-11-05`));
  scenario.listingOverrides = { ...scenario.listingOverrides, status: 'draft' };
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Request to book', exact: true })).toBeDisabled();
});

test('listing redesign keeps a single cost-first booking panel and photo-first responsive gallery', async ({ page }) => {
  test.slow();
  const secondImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#137d70"/></svg>');
  await setup(page, { listingOverrides: {
    owner_verified: false,
    listing_images: [{ url: image, sort_order: 0 }, { url: secondImage, sort_order: 1 }],
    item_condition: 'good',
  } });
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Book this item' });
  const request = panel.getByRole('button', { name: 'Request to book', exact: true });
  await expect(request).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Request to book', exact: true })).toHaveCount(1);
  await expect(panel.getByLabel('Price breakdown')).toContainText('$27.50');
  await expect(panel.getByText('Estimated total', { exact: true }).locator('..')).toContainText('$79.25');
  await expect(panel.getByText('Tax (7% demo)', { exact: true }).locator('..')).toContainText('$1.75');
  await expect(panel.getByText('Insurance', { exact: true })).toBeVisible();
  await expect(panel.getByText('Not included', { exact: true })).toBeVisible();
  await expect(panel.getByText('Placeholder', { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('Insurance simulation')).toHaveCount(0);
  await expect(panel.getByText('In-house demo estimate for this rental.', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('For testing only.', { exact: false })).toHaveCount(0);
  await expect(panel.getByText('Not offered', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('Service fee', { exact: true })).toBeVisible();
  await expect(page.getByText('Service fee', { exact: true })).toHaveCount(1);
  await expect(page.getByText('(10%)', { exact: false })).toHaveCount(0);
  await expect(panel.getByText('Refundable security deposit', { exact: true })).toBeVisible();
  await expect(panel.getByText('Demo tax applies to discounted rental only and is not charged.', { exact: false })).toBeVisible();
  expect((await panel.getByText('Estimated total').boundingBox())!.y).toBeLessThan((await request.boundingBox())!.y);
  await expect(page.getByText('Identity verified', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Joined 2026/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Make an offer', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'All 2 photos', exact: true }).click();
  const photos = page.getByRole('dialog', { name: listing.title });
  await expect(photos.getByRole('img', { name: `${listing.title} - photo 1` })).toBeVisible();
  await photos.getByRole('button', { name: 'Next image', exact: true }).click();
  await expect(photos.getByRole('img', { name: `${listing.title} - photo 2` })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'All 2 photos' })).toBeFocused();
  const sections = page.getByRole('navigation', { name: 'Listing sections' });
  await expect(sections.getByRole('link', { name: 'Specifications' })).toHaveAttribute('href', '#listing-specifications');
  await sections.getByRole('link', { name: 'Reviews', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reviews', exact: true })).toBeInViewport();
  for (const [width, height] of [[1440, 1000], [1024, 900], [768, 1024], [375, 812], [812, 375]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const gallery = await page.locator('.p1-gallery').boundingBox();
    const bookingBox = await panel.boundingBox();
    expect(gallery!.width).toBeGreaterThan(200);
    if (width >= 1024) {
      expect(bookingBox!.y).toBeGreaterThanOrEqual(gallery!.y + gallery!.height);
      const heading = await page.locator('.listing-heading').boundingBox();
      expect(bookingBox!.x).toBeGreaterThan(heading!.x + heading!.width);
      await expect(page.locator('.p1-gallery-side')).toBeVisible();
    }
    else {
      expect(bookingBox!.y).toBeGreaterThan(gallery!.y);
      await page.getByRole('link', { name: 'Review booking', exact: true }).click();
      await expect(panel.getByText('Choose your dates')).toBeInViewport();
      await request.focus();
      await expect.poll(async () => {
        const button = await request.boundingBox();
        const bar = await page.locator('.listing-booking-bar').boundingBox();
        return button!.y + button!.height <= bar!.y + 1;
      }).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath(`listing-redesign-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.listing-detail')).toHaveCSS('animation-name', 'none');
});

test('listing dates recalculate costs before checkout and clearing dates disables requests', async ({ page }) => {
  test.slow();
  await setup(page, {}, renterId);
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: listing.title, exact: true })).toBeVisible({ timeout: 30000 });
  const panel = page.getByRole('complementary', { name: 'Book this item' });
  await expect(panel.getByRole('button', { name: 'Request to book' })).toBeEnabled({ timeout: 15000 });
  await panel.locator('.relative > button').click();
  const calendar = page.getByRole('dialog', { name: 'Choose rental dates' });
  await expect(calendar).toHaveClass(/listing-calendar-popover/);
  await expect(calendar.getByLabel('Quick date choices')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Choose a date range/ })).toContainText('Pickup');
  await expect(panel.getByRole('button', { name: /Choose a date range/ })).toContainText('Return');
  const labels = await page.evaluate(() => [0, 3].map(offset => {
    const day = new Date(); day.setDate(day.getDate() + offset);
    return day.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }));
  await calendar.getByRole('button', { name: new RegExp(labels[0]) }).first().click();
  await calendar.getByRole('button', { name: new RegExp(labels[1]) }).first().click();
  await calendar.getByRole('button', { name: 'Use these dates', exact: true }).click();
  await expect(panel.getByLabel('Price breakdown')).toContainText('$82.50');
  await expect(panel.getByText('Estimated total', { exact: true }).locator('..')).toContainText('$137.75');
  await expect(panel.getByLabel('Insurance simulation')).toContainText('$1.20');
  await panel.getByRole('button', { name: 'Request to book' }).click();
  await expect(page.getByRole('heading', { name: 'Make time for a good plan.' })).toBeVisible();
  await expect(page.getByText('Service fee', { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Service fee \(/)).toHaveCount(0);
  await expect(page.getByText('Tax (7% demo)', { exact: true }).locator('..')).toContainText('$5.25');
  await expect(page.getByText('Insurance (demo)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Insurance simulation')).toHaveCount(1);
  await expect(page.getByLabel('Insurance simulation')).toContainText('$1.20');
  await expect(page.getByLabel('Insurance simulation')).toContainText('Not charged · No coverage');
  await expect(page.getByText('Not offered', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Security hold', { exact: true })).toBeVisible();
  await expect(page.getByText('No card hold placed', { exact: true })).toBeVisible();
  await expect(page.getByText('Estimated total', { exact: true }).locator('..')).toContainText('$137.75');
  await expect(page.getByText('Payment estimate excluding demo tax:', { exact: false })).toContainText('$132.50');
  expect(new URL(page.url()).searchParams.has('start')).toBe(true);
  await page.goBack();
  await panel.locator('.relative > button').click();
  await page.getByRole('button', { name: 'Clear dates', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Request to book' })).toBeDisabled();
  await expect(panel.getByText('Estimated total')).toHaveCount(0);
});

test('instant checkout opens payment and retries the same booking when Stripe is unavailable', async ({ page }) => {
  test.slow();
  await setup(page, { listingOverrides: { instant_booking: true } }, renterId);
  let bookingCalls = 0;
  let paymentCalls = 0;
  await page.route('**/rest/v1/rpc/create_booking_request', async route => {
    bookingCalls++;
    await route.fulfill({ json: { ...booking, status: 'pending_payment' } });
  });
  await page.route('**/functions/v1/create-checkout-session', async route => {
    paymentCalls++;
    expect(route.request().postDataJSON()).toEqual({ bookingId });
    await route.fulfill({ status: 503, json: { error: 'Stripe unavailable' } });
  });
  await page.goto(`${appUrl}/checkout/${listingId}?start=2026-11-02&end=2026-11-05`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I have reviewed the dates, estimated cost, and rental terms.' }).check();
  await page.getByRole('button', { name: 'Continue to payment', exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Could not open payment', { exact: true })).toBeVisible();
  expect(bookingCalls).toBe(1);
  expect(paymentCalls).toBe(1);
  await page.getByRole('button', { name: /Retry.*payment/ }).filter({ visible: true }).click();
  await expect.poll(() => paymentCalls).toBe(2);
  expect(bookingCalls).toBe(1);
  await expect(page.locator('.p1-checkout-actions').getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
});

test('checkout delivery and note update the estimate and reach the authoritative booking RPC', async ({ page }) => {
  test.slow();
  await setup(page, { listingOverrides: { delivery_available: true, delivery_fee: 15 } }, renterId);
  await page.route('**/rest/v1/rpc/create_booking_request', route => route.fulfill({ json: booking }));
  await page.goto(`${appUrl}/checkout/${listingId}?start=2026-11-02&end=2026-11-05`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const delivery = page.getByRole('button', { name: /Have it delivered/ });
  await delivery.click();
  await expect(delivery).toHaveAttribute('aria-pressed', 'true');
  const note = page.getByLabel('Note for owner (optional)', { exact: true });
  await expect(note).toHaveAttribute('maxlength', '500');
  await note.fill('  Please ring the bell.  ');
  const summary = page.getByRole('complementary', { name: 'Rental order summary' });
  await expect(summary.getByText('Delivery fee', { exact: true }).locator('..')).toContainText('$15.00');
  await expect(summary.getByText('Estimated total', { exact: true }).locator('..')).toContainText('$152.75');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const submit = page.getByRole('button', { name: 'Send booking request', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I have reviewed the dates, estimated cost, and rental terms.' }).check();
  const request = page.waitForRequest(value => value.url().endsWith('/rpc/create_booking_request'));
  await submit.click();
  expect((await request).postDataJSON()).toEqual({
    p_listing_id: listingId, p_start_date: '2026-11-02', p_end_date: '2026-11-05',
    p_quantity: 1, p_delivery_mode: 'delivery', p_renter_note: 'Please ring the bell.',
  });
});

for (const [category, expectedAmount] of [['Electronics', '$1.20'], ['Tools & Equipment', '$0.90'], ['Camping', '$0.60']]) {
  test(`in-house insurance demo appears for ${category} checkout without increasing charges`, async ({ page }) => {
    await setup(page, { listingOverrides: { categories: { name: category }, protection_eligible: false } }, renterId);
    await page.goto(`${appUrl}/checkout/${listingId}?start=2026-11-02&end=2026-11-05`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Make time for a good plan.' })).toBeVisible();
    const insurance = page.getByLabel('Insurance simulation');
    await expect(insurance).toContainText(expectedAmount);
    await expect(insurance).toContainText('Not charged · No coverage');
    await expect(page.getByText('Estimated total', { exact: true }).locator('..')).toContainText('$137.75');
    await expect(page.getByText('Payment estimate excluding demo tax:', { exact: false })).toContainText('$132.50');
    await expect(page.getByText('Insurance (demo)', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Not offered', { exact: true })).toHaveCount(0);
  });
}

test('supplied listing calendar stays within the viewport and Escape restores trigger focus', async ({ page }) => {
  test.slow();
  await setup(page);
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: /Choose a date range/ });
  await expect(trigger).toBeVisible({ timeout: 30000 });
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await trigger.click();
    const calendar = page.getByRole('dialog', { name: 'Choose rental dates' });
    await expect(calendar).toBeVisible();
    await expect(calendar.getByRole('button', { name: 'Use these dates' })).toBeVisible();
    await expect.poll(async () => {
      const box = await calendar.boundingBox();
      return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 813;
    }).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`supplied-calendar-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(calendar).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test('listing excludes private offers and protects unavailable dates regardless of legacy settings', async ({ page }) => {
  test.slow();
  const scenario: Scenario = { bidding: true, listingOverrides: { negotiation_enabled: true, offer_maximum_daily: 27.5 } };
  await setup(page, scenario, renterId);
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Request to book', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Make an offer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Private rental offer' })).toHaveCount(0);
  await expect(page.locator('#rental-offer')).toHaveCount(0);
  scenario.bidding = false;
  await page.reload();
  await expect(page.getByRole('link', { name: 'Make an offer', exact: true })).toHaveCount(0);
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  scenario.unavailableDates = { booked: [today], blocked: [] };
  await page.reload();
  await expect(page.getByRole('button', { name: 'Request to book', exact: true })).toBeDisabled();
  await expect(page.getByText('Those dates are already taken.', { exact: false })).toBeVisible();
});

test('owners see a read-only listing preview without renter controls', async ({ page }) => {
  await setup(page, { bidding: true, listingOverrides: { negotiation_enabled: true } }, ownerId);
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Your listing · view only', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose a date range/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Your listing|Request to book|Book instantly|Save to favorites|Message Camera/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Review booking', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(page.getByLabel('Insurance simulation')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Make an offer', exact: true })).toHaveCount(0);
});

test('listing fetch and gallery errors have honest recoverable states', async ({ page }) => {
  const scenario: Scenario = { failListings: true, listingOverrides: {
    listing_images: [{ url: `${appUrl}/missing-listing-photo.jpg`, sort_order: 0 }],
  } };
  await setup(page, scenario);
  await page.route('**/missing-listing-photo.jpg', route => route.fulfill({ status: 404, body: 'Not found' }));
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText("Couldn't load this listing", { exact: true })).toBeVisible({ timeout: 30000 });
  scenario.failListings = false;
  await page.getByRole('button', { name: 'Retry listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: listing.title, exact: true })).toBeVisible();
  await expect(page.getByText('Photo unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request to book', exact: true })).toBeEnabled();
});

test('review and favorite load failures are recoverable without blocking the listing', async ({ page }) => {
  const scenario: Scenario = { failReviews: true, failFavorites: true };
  await setup(page, scenario, renterId);
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Mirrorless travel camera' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: "Reviews couldn't be loaded. The listing is still available." })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('status').filter({ hasText: "We couldn't confirm whether this item is saved." })).toBeVisible({ timeout: 15000 });
  scenario.failReviews = false;
  scenario.failFavorites = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('status').filter({ hasText: "Reviews couldn't be loaded. The listing is still available." })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: "We couldn't confirm whether this item is saved." })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request to book' }).first()).toBeVisible();
});

test('handoff only confirms after the booking state transition succeeds, and retries safely', async ({ page }) => {
  test.slow();
  await setup(page, { failCheckInOnce: true }, renterId);
  await page.goto(`${appUrl}/check-in/${bookingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Photo capture and evidence storage are not available.')).toBeVisible();
  await expect(page.getByText('Tap to capture')).toHaveCount(0);
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.getByRole('button', { name: 'Confirm handoff' }).click();
  await expect(page.getByRole('button', { name: 'Confirm handoff' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check-in complete' })).toHaveCount(0);
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Booking service unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm handoff' }).click();
  await expect(page.getByRole('heading', { name: 'Check-in complete' })).toBeVisible();
  await expect(page.locator('.success-confetti span')).toHaveCount(64);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Check-in complete' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.success-confetti')).toHaveCount(0);
});

test('return confirmation only completes after the authorized booking transition succeeds', async ({ page }) => {
  test.slow();
  await setup(page, { initialBookingStatus: 'return_pending', failReturnOnce: true }, ownerId);
  await page.goto(`${appUrl}/check-out/${bookingId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Finish the rental, thoughtfully.' })).toBeVisible();
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.getByRole('button', { name: 'Complete return' }).click();
  await expect(page.getByRole('heading', { name: 'Return complete' })).toHaveCount(0);
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Return service unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete return' }).click();
  await expect(page.getByRole('heading', { name: 'Return complete' })).toBeVisible();
  await expect(page.locator('.success-confetti span')).toHaveCount(64);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Return complete' })).toBeVisible();
  await expect(page.locator('.success-confetti')).toHaveCount(0);
});

async function expectPageFits(page: Page) {
  expect(await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('h1, h2, input:not([type=hidden]), textarea, select, main button')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.closest('[role=region][aria-label="Scrollable data table"]')
          && !element.closest('.overflow-x-auto');
      })
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > width + 1;
      }).map((element) => ({ text: element.textContent?.slice(0, 70), tag: element.tagName }));
  })).toEqual([]);
}

async function visit(page: Page, path: string) {
  await page.evaluate((next) => {
    history.pushState(null, '', next);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

for (const width of [375, 768, 1440]) {
  test(`marketplace page families fit ${width}px with consistent Preview 1 controls`, async ({ page }, testInfo) => {
    test.setTimeout(180000);
    page.on('pageerror', (error) => { throw error; });
    await page.setViewportSize({ width, height: 900 });
    await setup(page, {}, renterId);
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Great gear. No need to buy.' })).toBeVisible();
    const routes: [string, string | RegExp][] = [
      ['/', 'Great gear. No need to buy.'],
      ['/search', '1 item'],
      [`/listing/${listingId}`, listing.title],
      [`/checkout/${listingId}?start=2026-11-02&end=2026-11-05`, 'Make time for a good plan.'],
      ['/dashboard?tab=renting', 'Your next good plans.'],
      ['/dashboard?tab=lending', 'A little more from what you own.'],
      ['/create-listing', 'Put your good gear to work.'],
      ['/favorites', 'Keep the good things close.'],
      ['/messages', 'Good rentals start with a hello.'],
      ['/profile', 'A little more about you.'],
      ['/guidelines', 'Community guidelines'],
      ['/requests', 'Item requests are not enabled yet'],
      ['/bidding', 'Competitive bidding'],
      ['/wallet', 'Your wallet, clearly explained.'],
      ['/support', 'Support tickets'],
      ['/claims', 'Disputes & claims'],
      ['/protection', 'Not available in Part 1'],
    ];
    for (const [path, heading] of routes) {
      await visit(page, path);
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expectPageFits(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent-ink').trim())).toBe('#3157E1');
    }
    await visit(page, '/profile');
    await expect(page.getByRole('heading', { name: 'A little more about you.' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`profile-${width}.png`), fullPage: true, animations: 'disabled' });
  });
}

for (const width of [375, 768, 1440]) {
  test(`notifications and long conversations remain usable at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90000);
    const conversationId = '50000000-0000-4000-8000-000000000001';
    const longMessage = 'A-long-unbroken-message-'.repeat(35);
    await page.setViewportSize({ width, height: 900 });
    await setup(page, {}, renterId);
    await page.route('**/rest/v1/conversations*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        id: conversationId, participant_one: renterId, participant_two: ownerId,
        listing_id: listingId, booking_id: bookingId, created_at: booking.created_at, listing,
        participant_one_profile: booking.renter, participant_two_profile: booking.owner,
      }]),
    }));
    await page.route('**/rest/v1/messages*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        id: '60000000-0000-4000-8000-000000000001', conversation_id: conversationId,
        sender_id: ownerId, body: longMessage, created_at: booking.created_at,
      }]),
    }));
    await page.route('**/rest/v1/notification_preferences*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(Object.fromEntries(
        ['bookings', 'messages', 'requests', 'payments', 'cases', 'promotions']
          .flatMap((key) => [[`${key}_in_app`, true], [`${key}_email`, false]]),
      )),
    }));
    await page.route('**/functions/v1/send-notification-emails', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ processed: 0, sent: 0, retrying: 0, failed: 0, unknown: 0 }),
    }));
    await page.goto(`${appUrl}/messages/${conversationId}`, { waitUntil: 'domcontentloaded' });
    const message = page.getByText(longMessage, { exact: true }).last();
    await expect(message).toBeVisible();
    expect(await message.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const composer = page.getByRole('textbox', { name: 'Write a message', exact: true });
    await expect(composer).toBeVisible();
    await composer.focus();
    await expect(composer).toBeFocused();
    expect(await composer.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBe(width < 640 ? 16 : 14);
    await expectPageFits(page);
    if (width < 768) await expect(page.getByRole('button', { name: 'List an item', exact: true })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath(`conversation-${width}.png`), fullPage: true, animations: 'disabled' });
    await visit(page, '/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(12);
    await expectPageFits(page);
    if (width < 768) await expect(page.getByRole('button', { name: 'List an item', exact: true })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath(`notifications-${width}.png`), fullPage: true, animations: 'disabled' });
  });
}

test('long forms stay reachable in a short landscape viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 812, height: 375 });
  await setupAdminStyling(page);
  await page.goto(`${appUrl}/admin/promotions`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New campaign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(367);
  expect(await dialog.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.focus();
  await expect(cancel).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('landscape-dialog.png'), animations: 'disabled' });
  await cancel.click();
  await expect(dialog).toBeHidden();
});

test('semantic feedback text meets normal-text contrast without replacing brand colors', async ({ page }) => {
  await setup(page);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Great gear. No need to buy.' })).toBeVisible();
  const ratios = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    function luminance(color: string) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        .map((value) => value / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    }
    return ['accent', 'warning', 'success', 'error'].map((tone) => {
      const sample = document.createElement('span');
      sample.className = `text-${tone} bg-${tone}-soft`;
      document.body.append(sample);
      const style = getComputedStyle(sample);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      sample.remove();
      return { tone, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
    });
  });
  for (const { tone, ratio } of ratios) expect(ratio, `${tone} feedback contrast`).toBeGreaterThanOrEqual(4.5);
});

async function setupAdminStyling(page: Page) {
  await setup(page, {}, renterId);
  const longKey = 'marketplace_configuration_key_with_a_long_unbroken_identifier_for_layout_verification';
  await page.route('**/rest/v1/feature_flags*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ key: longKey, enabled: false, description: 'A detailed explanation of the marketplace setting that should wrap without squeezing the control.', updated_at: '2026-10-18T12:00:00Z' }]),
  }));
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    let body: unknown;
    if (name === 'get_my_admin_access') body = { role: 'super_admin', permissions: [
      'analytics.view', 'users.manage', 'listings.moderate', 'bookings.view', 'payments.view',
      'payouts.view', 'reviews.moderate', 'categories.manage', 'audit.view', 'integrations.view',
      'config.manage', 'flags.manage', 'admins.manage', 'disputes.manage', 'support.manage',
      'promotions.manage', 'credits.manage', 'refunds.issue', 'refunds.approve', 'refunds.senior',
    ] };
    else if (name === 'admin_overview') body = {
      users_total: 3900, users_new: 39, listings_published: 1022, listings_suspended: 0,
      bookings_by_status: { confirmed: 10, pending_payment: 3 }, gross_rental: 362719,
      platform_fees: 36271.9, refunds: 0, deposit_liability: 6440, payables_outstanding: 358968,
      recent_actions: [],
    };
    else if (name === 'admin_list_settings') body = [{ key: longKey, value: 0.1, value_type: 'number', min_value: 0, max_value: 1, description: 'Service fee for new bookings.', updated_at: '2026-10-18T12:00:00Z' }];
    else if (name === 'admin_get_agreement_terms') body = null;
    else if (name === 'admin_list_categories') body = [{ id: categoryId, name: 'Electronics and professional photography equipment', active: true, icon: 'Camera', sort_order: 1 }];
    else if (name === 'admin_list_admins') body = [];
    else if (name === 'admin_list_users') body = { total: 101, rows: [{
      id: ownerId, full_name: 'A marketplace member with a long full name', email: 'a-long-email-address-for-responsive-testing@example.test',
      phone: null, created_at: '2026-10-18T12:00:00Z', restricted_reason: null, restricted_at: null, listing_count: 12, is_admin: false,
    }] };
    else if (name?.startsWith('admin_list_')) body = { rows: [], total: 0 };
    else return route.fallback();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/functions/v1/admin-system-health', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ checked_at: '2026-10-18T12:00:00Z', database: { ok: true, latency_ms: 12 }, integrations: [{ name: 'Stripe', configured: false }] }),
  }));
}

for (const width of [375, 768, 1440]) {
  test(`admin sections and centered dialogs fit ${width}px without changing data`, async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 900 });
    await setupAdminStyling(page);
    await page.goto(`${appUrl}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    const sections = [
      ['overview', 'Overview'], ['users', 'Users'], ['listings', 'Listings'],
      ['requests', 'Item requests'], ['bookings', 'Bookings'], ['disputes', 'Disputes & claims'],
      ['support', 'Support tickets'], ['promotions', 'Promotions & rewards'], ['reviews', 'Reviews'],
      ['categories', 'Categories'], ['payments', 'Payments'], ['payouts', 'Payouts & deposit refunds'],
      ['refunds', 'Manual refund requests & reconciliation'], ['settings', 'Global settings'],
      ['flags', 'Feature flags'], ['integrations', 'Integrations and system health'],
      ['audit', 'Audit log'], ['admins', 'Administrators'],
      ['insurance', 'Insurance & protection'], ['analytics', 'Analytics & exports'],
    ];
    for (const [section, heading] of sections) {
      await visit(page, `/admin/${section}`);
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
      await expectPageFits(page);
      if (section === 'users') {
        const table = page.getByRole('region', { name: 'Scrollable data table', exact: true });
        await table.focus();
        await expect(table).toBeFocused();
        if (await table.evaluate((element) => element.scrollWidth > element.clientWidth)) {
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        }
      }
      if (section === 'overview') {
        const metrics = page.getByRole('region', { name: 'Marketplace', exact: true });
        await expect(metrics.getByText('$362,719.00', { exact: true })).toBeVisible();
        expect(await metrics.locator('p').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`admin-overview-${width}.png`), fullPage: true, animations: 'disabled' });
      }
    }
    await visit(page, '/admin/flags');
    await page.getByRole('switch').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2);
    expect(Math.abs(box!.y + box!.height / 2 - 450)).toBeLessThan(2);
    await page.getByLabel('Reason (recorded in the audit log)').fill('Layout check only, do not submit');
    await page.screenshot({ path: testInfo.outputPath(`admin-confirmation-${width}.png`), fullPage: true, animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await visit(page, '/admin/promotions');
    await page.getByRole('button', { name: 'New campaign', exact: true }).click();
    const form = page.getByRole('dialog');
    await expect(form).toBeVisible();
    expect(await form.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
}
