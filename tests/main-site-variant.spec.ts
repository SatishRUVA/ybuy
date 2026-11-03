import { expect, test, type Page } from '@playwright/test';
import type { ListingAuction } from '../src/lib/listing-auctions';

test.skip(process.env.VITE_SITE_VARIANT !== 'main', 'Run with playwright.main-site.config.ts and VITE_SITE_VARIANT=main.');
test.setTimeout(300_000);

const mainPalette = {
  '--accent': '#111111',
  '--accent-hover': '#404040',
  '--accent-deep': '#262626',
  '--accent-soft': '#F5F5F5',
  '--bg-subtle': '#F5F5F5',
  '--highlight': '#D4D4D4',
  '--secondary-accent': '#737373',
  '--bg': '#FFFFFF',
  '--bg-card': '#FFFFFF',
  '--text': '#171717',
  '--text-secondary': '#525252',
  '--border': '#E5E5E5',
  '--success': '#404040',
  '--warning': '#525252',
  '--error': '#262626',
};

const userId = '10000000-0000-4000-8000-000000000001';
const listingId = '30000000-0000-4000-8000-000000000001';
const listing = {
  id: listingId, owner_id: '10000000-0000-4000-8000-000000000002',
  title: 'Restored main-site camera', description: 'Camera for the main-site UI regression.',
  price_per_day: 25, deposit: 50, status: 'published', created_at: '2026-01-01T00:00:00Z',
  listing_images: [], categories: { name: 'Cameras' },
  owner: { id: '10000000-0000-4000-8000-000000000002', full_name: 'Camera Owner', avatar_url: null },
};

const requestId = '50000000-0000-4000-8000-000000000001';
const categoryId = '60000000-0000-4000-8000-000000000001';
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const renterRequest = {
  id: requestId, renter_id: userId, category_id: categoryId, title: 'Need a camera for an event',
  description: 'Two cameras for a small community event.', intended_use: 'Community event',
  preferred_start_date: futureDate(10), preferred_end_date: futureDate(12),
  location_label: 'Dallas, TX', location_lat: 32.78, location_lng: -96.8, radius_miles: 5,
  max_daily_budget: 30, requested_quantity: 2, status: 'open', visibility: 'public',
  expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), created_at: new Date().toISOString(),
  open_for_offers: false, notify_matches_in_app: true, main_site_flow: true,
  reference_image_paths: [], categories: { name: 'Cameras' }, distance_miles: 1.2,
};

async function prepareJourney(page: Page, owner = false) {
  await prepare(page, true);
  const request = { ...renterRequest, renter_id: owner ? listing.owner_id : userId };
  const item = { ...listing, owner_id: owner ? userId : listing.owner_id,
    category_id: categoryId, available_quantity: 2, revision: 1,
    item_condition: 'good', estimated_value: 200, instant_booking: false,
    availability_start: futureDate(1), availability_end: futureDate(25) };
  await page.route('https://api.maptiler.com/**', route => route.fulfill({ json: {
    features: [{ text: 'Dallas', center: [-96.8, 32.78], place_type: ['municipality'],
      context: [{ id: 'region.tx', text: 'TX' }, { id: 'country.us', text: 'United States' }] }],
  } }));
  await page.route('**/storage/v1/**', route => route.fulfill({ json: {
    signedURL: '/object/sign/listing-images/test.png?token=ui-test',
  } }));
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/feature_flags')) return route.fulfill({ json: [
      { key: 'item_requests', enabled: true }, { key: 'bidding', enabled: true },
      { key: 'mock_bidding', enabled: false },
    ] });
    if (path.endsWith('/reference_countries')) return route.fulfill({ json: [{ code: 'US', name: 'United States' }] });
    if (path.endsWith('/categories')) return route.fulfill({ json: [{ id: categoryId, name: 'Cameras' }] });
    if (path.endsWith('/item_requests')) return route.fulfill({ json: request });
    if (path.endsWith('/get_nearby_item_requests')) return route.fulfill({ json: { rows: [request], total: 1 } });
    if (path.endsWith('/get_request_listing_matches')) return route.fulfill({ json: { [requestId]: [item] } });
    if (path.endsWith('/get_main_request_matches')) return route.fulfill({ json: {
      items: [{ listing_id: listingId, distance_miles: 1.2 }], total: 1,
    } });
    if (path.endsWith('/link_main_request_listing')) return route.fulfill({ json: {
      linked: true, in_app_notified: route.request().postDataJSON().p_notify,
    } });
    if (path.endsWith('/update_request_match_preference')) return route.fulfill({ json: null });
    if (path.endsWith('/listings')) return route.fulfill({ json: item });
    if (path.endsWith('/listing_pickup_locations')) return route.fulfill({ json: {
      address: '123 Test Street, Dallas, TX 75201', street_address: '123 Test Street',
      city: 'Dallas', state: 'TX', postal_code: '75201', country: 'US',
      latitude: 32.78, longitude: -96.8, place_id: 'test-pickup',
    } });
    if (path.endsWith('/get_listing_unavailable_dates')) return route.fulfill({ json: { booked: [], blocked: [] } });
    if (path.endsWith('/owner_save_listing_flow')) return route.fulfill({ json: { revision: 2, status: 'draft', deposit: 0 } });
    if (path.endsWith('/notifications')) return route.fulfill({ json: [{
      id: '70000000-0000-4000-8000-000000000001', event_key: `request-match:${requestId}:listing:${listingId}`,
      category: 'requests', title: 'An owner has an item for your request', body: 'Review the matching rental.',
      destination: `/requests/${requestId}/matches`, created_at: new Date().toISOString(), read_at: null,
    }], headers: { 'content-range': '0-0/1' } });
    return route.fallback();
  });
  return request;
}

test('renter posts fixed daily budget and in-app preference with a complete success summary', async ({ page }) => {
  await prepareJourney(page);
  let creation: Record<string, unknown> | undefined;
  await page.route('**/rpc/create_main_item_request', route => {
    creation = route.request().postDataJSON();
    return route.fulfill({ json: renterRequest });
  });
  await page.goto('/need-something', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Item name', { exact: false }).fill('Camera for an event');
  await page.getByLabel('Category', { exact: false }).selectOption(categoryId);
  await page.getByLabel('Description', { exact: false }).fill('Two cameras for a small community event.');
  await page.getByLabel('Preferred area', { exact: false }).fill('Dallas');
  await page.getByRole('button', { name: 'Find area', exact: true }).click();
  await page.getByRole('group', { name: 'Choose request area' }).getByRole('button', { name: 'Dallas, TX' }).click();
  await page.getByRole('radio', { name: 'No, I have a fixed daily budget' }).check();
  await expect(page.getByLabel('Maximum daily budget', { exact: false })).toHaveAttribute('required', '');
  await page.getByLabel('Maximum daily budget', { exact: false }).fill('30');
  await page.getByRole('checkbox', { name: 'Notify me in-app when an owner lists a matching item' }).uncheck();
  await page.getByRole('checkbox', { name: /I understand this request is visible/ }).check();
  await page.getByRole('button', { name: 'Post request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your request is posted' })).toBeVisible();
  expect(creation).toMatchObject({ p_open_for_offers: false, p_notify_matches_in_app: false,
    p_request: { p_max_daily_budget: 30, p_country_code: 'US' } });
  await expect(page.getByText('$30/day maximum')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible();
});

for (const notify of [true, false]) {
  test(`owner links existing inventory with notify=${notify} and sends verified geographic filters`, async ({ page }) => {
    await prepareJourney(page, true);
    await page.goto('/requests', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Near city or ZIP code').fill('Dallas');
    await page.getByRole('button', { name: 'Find area', exact: true }).click();
    const filtered = page.waitForRequest('**/rpc/get_nearby_item_requests');
    await page.getByRole('group', { name: 'Choose nearby request area' }).getByRole('button', { name: 'Dallas, TX' }).click();
    expect((await filtered).postDataJSON()).toMatchObject({ p_latitude: 32.78, p_longitude: -96.8, p_radius_miles: 5 });
    await expect(page.getByText('1.2 miles away')).toBeVisible();
    await page.getByRole('button', { name: 'View request and list your item' }).click();
    await page.getByLabel('Use an existing listing').selectOption(listingId);
    const linked = page.waitForRequest('**/rpc/link_main_request_listing');
    await page.getByRole('button', { name: notify ? 'Link rental and notify renter' : 'Link rental · skip notification', exact: true }).click();
    expect((await linked).postDataJSON()).toEqual({ p_request_id: requestId, p_listing_id: listingId, p_notify: notify });
    await expect(page.getByText(notify ? 'Rental linked. The renter’s in-app match notification is available.' : 'Rental linked without a new in-app notification.', { exact: true })).toBeVisible();
  });
}

test('request-linked listing creation preserves prefilled details through photo analysis', async ({ page }) => {
  await prepareJourney(page, true);
  await page.goto(`/create-listing?request=${requestId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(`Listing for: ${renterRequest.title}`, { exact: true })).toBeVisible();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 700;
    canvas.getContext('2d')!.fillRect(0, 0, 700, 700);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review and edit item details' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(renterRequest.title);
  await expect(page.getByLabel('Description', { exact: false })).toHaveValue(renterRequest.description);
  expect(await page.evaluate(({ userId, listingId }) => localStorage.getItem(`ybuy-listing-request:${userId}:${listingId}`), { userId, listingId })).toBe(requestId);
});

test('approved request-linked listing exposes notify step but pending approval never does', async ({ page }) => {
  await prepareJourney(page, true);
  await page.goto(`/edit-listing/${listingId}?request=${requestId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Notify the renter', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link rental and notify renter' })).toBeEnabled();
  await page.getByRole('button', { name: 'Link rental · skip notification', exact: true }).click();
  await expect(page.getByText('Rental linked without a new in-app notification.', { exact: true })).toBeVisible();
  await page.route('**/rest/v1/listings?**', route => route.fulfill({ json: {
    ...listing, owner_id: userId, category_id: categoryId, status: 'pending_approval', revision: 1,
    available_quantity: 2, listing_images: [],
  } }));
  await page.goto(`/edit-listing/${listingId}?request=${requestId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Review and edit item details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notify the renter', exact: true })).toHaveCount(0);
});

test('failed preference save restores the prior state and explicitly reports the failure', async ({ page }) => {
  await prepareJourney(page);
  await page.route('**/rpc/update_request_match_preference', route => route.fulfill({
    status: 403, json: { message: 'Your main-site request was not found' },
  }));
  await page.goto(`/requests/${requestId}/matches`, { waitUntil: 'domcontentloaded' });
  const checkbox = page.getByRole('checkbox', { name: 'Notify me in-app when a matching item is listed' });
  await checkbox.click();
  await expect(page.getByText('Your main-site request was not found', { exact: false })).toBeVisible();
  await expect(checkbox).toBeChecked();
});

test('category suggestion comes from published inventory and allows a manual override', async ({ page }) => {
  await prepareJourney(page);
  const otherCategory = '60000000-0000-4000-8000-000000000002';
  await page.route('**/rest/v1/categories?**', route => route.fulfill({ json: [
    { id: categoryId, name: 'Cameras' }, { id: otherCategory, name: 'Outdoor' },
  ] }));
  await page.route('**/rest/v1/listings?**', route => route.fulfill({
    json: [{ ...listing, category_id: categoryId }], headers: { 'content-range': '0-0/1' },
  }));
  await page.goto('/need-something', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Item name', { exact: false }).fill('Camera');
  await expect(page.getByText(/Suggested category: Cameras/)).toBeVisible();
  await expect(page.getByLabel('Category', { exact: false })).toHaveValue(categoryId);
  await page.getByLabel('Category', { exact: false }).selectOption(otherCategory);
  await page.getByLabel('Item name', { exact: false }).fill('Camping camera');
  await expect(page.getByLabel('Category', { exact: false })).toHaveValue(otherCategory);
  await expect(page.getByText(/Suggested category:/)).toHaveCount(0);
});

for (const status of ['published', 'pending_approval'] as const) {
  test(`request-linked publication waits for authoritative ${status} status before notification`, async ({ page }) => {
    await prepareJourney(page, true);
    await page.route('**/rest/v1/listings?**', route => route.fulfill({ json: {
      ...listing, owner_id: userId, category_id: categoryId, status: 'draft', revision: 1,
      available_quantity: 2, item_condition: 'good', estimated_value: 200,
      availability_start: renterRequest.preferred_start_date, availability_end: renterRequest.preferred_end_date,
      listing_images: [{ url: 'https://example.test/photo.png', sort_order: 0 }],
    } }));
    await page.route('**/functions/v1/analyze-listing-photo', route => route.fulfill({ json: {
      ok: true, masked: { title: listing.title, description: listing.description, changed: false },
      suggestion: null, flags: [],
    } }));
    await page.route('**/rpc/owner_save_listing_flow', route => route.fulfill({ json: {
      revision: 2, status: route.request().postDataJSON().p_publish ? status : 'draft', deposit: 0,
    } }));
    await page.goto(`/edit-listing/${listingId}?request=${requestId}`, { waitUntil: 'domcontentloaded' });
    for (const heading of ['Set rental settings', 'Set availability', 'Set location and handoff options', 'Review and publish']) {
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    const publication = page.waitForRequest(request => request.url().endsWith('/rpc/owner_save_listing_flow') && request.postDataJSON().p_publish);
    await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
    expect((await publication).postDataJSON()).toMatchObject({ p_publish: true, p_details: {
      category_id: categoryId, available_quantity: 2,
      availability_start: renterRequest.preferred_start_date, availability_end: renterRequest.preferred_end_date,
    } });
    if (status === 'published') {
      await expect(page.getByRole('heading', { name: 'Notify the renter', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Link rental and notify renter', exact: true }).click();
      await expect(page.getByText('Rental linked. The renter’s in-app match notification is available.', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Review this listing and request' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Notify the renter', exact: true })).toHaveCount(0);
    }
  });
}

test('checkout cannot present a default fee or submit a booking when pricing settings fail', async ({ page }) => {
  await prepareJourney(page);
  await page.route('**/rest/v1/app_settings*', route => {
    const url = new URL(route.request().url());
    return url.searchParams.get('key') === 'eq.platform_fee_pct'
      ? route.fulfill({ status: 503, json: { message: 'Pricing settings temporarily unavailable' } })
      : route.fallback();
  });
  let bookingCalls = 0;
  await page.route('**/rpc/create_booking_request', route => {
    bookingCalls++;
    return route.fulfill({ json: null });
  });
  await page.goto(`/checkout/${listingId}?start=${renterRequest.preferred_start_date}&end=${renterRequest.preferred_end_date}&qty=2`);
  await expect(page.getByRole('status').filter({ hasText: 'Could not verify the service fee' }))
    .toContainText('Pricing settings temporarily unavailable');
  await expect(page.getByRole('button', { name: /Continue to payment|Send booking request|Send request/ })).toHaveCount(0);
  expect(bookingCalls).toBe(0);
});

for (const width of [390, 1440]) {
  test(`checkout reviews authoritative multi-unit pricing before Stripe at ${width}px`, async ({ page }, testInfo) => {
    await prepareJourney(page);
    await page.setViewportSize({ width, height: 900 });
    const insured = width === 1440;
    await page.route('**/rest/v1/feature_flags*', route => route.fulfill({ json: [
      { key: 'insurance', enabled: insured }, { key: 'bidding', enabled: true },
    ] }));
    await page.route('**/rest/v1/app_settings*', route => route.fulfill({ json: { value: 0.2 } }));
    await page.route('**/rest/v1/listings?*', route => route.fulfill({ json: {
      ...listing, category_id: categoryId, estimated_value: 200, instant_booking: true,
      available_quantity: 2, availability_start: futureDate(1), availability_end: futureDate(25),
    } }));
    const bookingId = '80000000-0000-4000-8000-000000000001';
    const total = insured ? 187.47 : 179.47;
    let bookingCalls = 0;
    let stripeCalls = 0;
    await page.route('**/rpc/create_booking_request', route => {
      bookingCalls++;
      return route.fulfill({ json: {
        id: bookingId, status: 'pending_payment', quantity: 2,
        subtotal: 100, service_fee_amount: 21, insurance_amount: insured ? 8 : 0,
        deposit: 50, total, tax_amount: 8.47, tax_rate: 0.07, sandbox_tax: false,
      } });
    });
    await page.route('**/functions/v1/create-checkout-session', route => {
      stripeCalls++;
      return route.fulfill({ status: 503, json: { error: 'Sandbox temporarily unavailable' } });
    });
    await page.goto(`/listing/${listingId}?request=${requestId}`);
    const listingInsurance = page.getByText('Insurance', { exact: true }).locator('..');
    await expect(listingInsurance).toContainText(insured ? '$8.00' : 'Not included');
    const listingFee = page.getByText('Service fee', { exact: true }).locator('..');
    await expect(listingFee).toContainText('$20.00');
    await expect(page.getByText('Tax (7%)', { exact: true }).locator('..')).toContainText('$8.40');
    await page.getByRole('button', { name: 'Book instantly', exact: true }).filter({ visible: true }).first().click();
    const insurance = page.locator('main div.flex').filter({ has: page.locator(':scope > span', { hasText: /^Insurance$/ }) }).last();
    await expect(insurance).toContainText(insured ? '$8.00' : 'Not included');
    await expect(page.getByText('Service fee', { exact: true }).locator('..')).toContainText('$20.00');
    await expect(page.getByText('Rental quantity: 2 units')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to payment', exact: true }).filter({ visible: true }).click();
    await expect(page.getByText('Backend-confirmed total', { exact: true })).toBeVisible();
    await expect(page.getByText('Tax (7%)', { exact: true }).locator('..')).toContainText('$8.47');
    await expect(page.getByRole('button', { name: `Confirm $${total.toFixed(2)} and pay`, exact: true }).filter({ visible: true })).toBeVisible();
    expect(stripeCalls).toBe(0);
    expect(bookingCalls).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`final-price-review-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: `Confirm $${total.toFixed(2)} and pay`, exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Could not open payment' })).toContainText('Sandbox temporarily unavailable');
    expect(stripeCalls).toBe(1);
    expect(bookingCalls).toBe(1);
  });

  test(`renter notification opens exact matches, preserves quantity and dates at ${width}px`, async ({ page }, testInfo) => {
    await prepareJourney(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'View update', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/requests/${requestId}/matches$`));
    await expect(page.getByRole('heading', { name: 'Items matching your request' })).toBeVisible();
    await expect(page.getByText('Matches your request · available for requested dates')).toBeVisible();
    const preference = page.waitForRequest('**/rpc/update_request_match_preference');
    await page.getByRole('checkbox', { name: 'Notify me in-app when a matching item is listed' }).uncheck();
    expect((await preference).postDataJSON()).toEqual({ p_request_id: requestId, p_enabled: false });
    await expect(page.getByRole('checkbox', { name: 'Notify me in-app when a matching item is listed' })).not.toBeChecked();
    expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
    const card = await page.locator('main article').last().boundingBox();
    const note = await page.getByText(/^Matches do not reserve stock/).boundingBox();
    expect(card).not.toBeNull();
    expect(note).not.toBeNull();
    expect(note!.y).toBeGreaterThanOrEqual(card!.y + card!.height);
    const saved = page.waitForRequest(request => request.url().includes('/rest/v1/favorites') && request.method() === 'POST');
    await page.getByRole('button', { name: 'Save to favorites', exact: true }).click();
    expect((await saved).postDataJSON()).toMatchObject({ listing_id: listingId, user_id: userId });
    await expect(page.getByRole('button', { name: 'Remove from favorites', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`request-matches-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: `View listing: ${listing.title}` }).click();
    await expect(page).toHaveURL(new RegExp(`/listing/${listingId}\\?request=${requestId}$`));
    await expect(page.getByText('2 units', { exact: true }).filter({ visible: true })).toBeVisible();
    const checkout = page.getByRole('button', { name: /Request to book|Book instantly/ }).first();
    await expect(checkout).toBeEnabled();
    await checkout.click();
    await expect(page).toHaveURL(new RegExp(`start=${renterRequest.preferred_start_date}.*end=${renterRequest.preferred_end_date}.*qty=2`));
    await expect(page.getByText('Rental quantity: 2 units')).toBeVisible();
    await page.route('**/rpc/create_booking_request', route => route.fulfill({
      status: 409, json: { message: 'Listing is no longer available for those dates and quantity' },
    }));
    const booking = page.waitForRequest('**/rpc/create_booking_request');
    await page.getByRole('button', { name: width < 768 ? 'Send request' : 'Send booking request', exact: true }).click();
    expect((await booking).postDataJSON()).toMatchObject({
      p_listing_id: listingId, p_start_date: renterRequest.preferred_start_date,
      p_end_date: renterRequest.preferred_end_date, p_quantity: 2,
    });
    await expect(page.getByRole('status').filter({ hasText: 'Booking not created' }))
      .toContainText('Listing is no longer available for those dates and quantity');
    await expect(page).toHaveURL(/\/checkout\//);
  });
}

async function prepare(page: Page, authenticated = false) {
  await page.addInitScript(() => localStorage.setItem('rental-theme', 'preview-one'));
  await page.route('**/*', route => route.request().resourceType() === 'image'
    ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#D8F0E8"/></svg>' })
    : route.fallback());
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/functions/v1/**', route => route.fulfill({ json: { connected: false, payouts: [] } }));
  await page.routeWebSocket('**/realtime/v1/websocket**', socket => {
    socket.onMessage(message => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (['phx_join', 'phx_leave', 'heartbeat'].includes(event)) {
        socket.send(JSON.stringify([
          joinRef, ref, topic, 'phx_reply', { status: 'ok', response: event === 'phx_join'
            ? { postgres_changes: (payload.config?.postgres_changes ?? []).map((filter: object, id: number) => ({ ...filter, id })) } : {} },
        ]));
      }
    });
  });
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/feature_flags')) {
      return route.fulfill({ json: [{ key: 'bidding', enabled: true }, { key: 'mock_bidding', enabled: false }] });
    }
    if (url.pathname.endsWith('/app_settings')) return route.fulfill({
      json: { value: url.searchParams.get('key') === 'eq.platform_fee_pct' ? 0.1 : ['US'] },
    });
    if (url.pathname.endsWith('/get_listing_flow_policy')) return route.fulfill({ json: {
      listing_duration_days: 30, max_quantity: 5, max_photos: 8,
      max_photo_bytes: 6 * 1024 * 1024, min_photo_dimension: 600,
      max_delivery_fee: 100, max_estimated_value: 5000, high_value_threshold: 1000,
      offer_below_pct: null, offer_above_pct: null, deposit_rules: [],
    } });
    if (url.pathname.endsWith('/get_listing_auction_feed')) {
      return route.fulfill({ json: { items: [], categories: [], total: 0 } });
    }
    if (url.pathname.endsWith('/has_active_session')) return route.fulfill({ json: authenticated });
    if (url.pathname.endsWith('/get_my_profile')) return route.fulfill({ json: {
      id: userId, full_name: 'Main Site Renter', email: 'renter@example.test', avatar_url: null,
      phone: null, location: null, created_at: '2026-01-01T00:00:00Z',
    } });
    if (url.pathname.endsWith('/listings') && url.searchParams.has('id')) {
      return route.fulfill({ json: listing });
    }
    if (url.pathname.endsWith('/search_available_listings')) return route.fulfill({ json: { rows: [], total: 0 } });
    return route.fulfill({ json: [], headers: { 'content-range': '0-0/0' } });
  });
  if (authenticated) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const session = {
      access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        sub: userId, aud: 'authenticated', role: 'authenticated', exp: expiresAt,
      })}.test-signature`,
      refresh_token: 'ui-test-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
      user: {
        id: userId, aud: 'authenticated', role: 'authenticated', email: 'renter@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { full_name: 'Main Site Renter' }, created_at: '2026-01-01T00:00:00Z',
      },
    };
    await page.addInitScript(value => {
      for (const project of ['localhost', 'jzyjmsixfuwzfnntewqn']) {
        localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(value));
      }
    }, session);
    await page.route('**/auth/v1/user', route => route.fulfill({ json: session.user }));
  }
}

test('main-site date range stays clear on desktop and mobile', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-10T18:00:00.000Z') });
  await prepare(page);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    if (width < 640) await page.getByRole('button', { name: /Search rentals/ }).click();

    const trigger = page.locator('button.p1-date-trigger:visible, button.calendar-trigger:visible').first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const calendar = page.getByRole('dialog', { name: 'Choose rental dates' });
    await expect(calendar).toBeVisible();
    await expect.poll(() => calendar.locator('.calendar-months > div:visible').count())
      .toBe(width < 768 ? 1 : 2);

    const pickup = calendar.locator('[data-date="2026-11-12"]');
    const middle = calendar.locator('[data-date="2026-11-13"]');
    const returnDate = calendar.locator('[data-date="2026-11-14"]');
    await pickup.click();
    await returnDate.click();

    await expect(pickup).toHaveAttribute('data-range-start', '');
    await expect(middle).toHaveAttribute('aria-pressed', 'true');
    await expect(returnDate).toHaveAttribute('data-range-end', '');
    await expect(pickup).toHaveCSS('background-color', 'rgb(14, 124, 102)');
    await expect(middle).toHaveCSS('background-color', 'rgb(216, 240, 232)');
    await expect(returnDate).toHaveCSS('background-color', 'rgb(14, 124, 102)');

    await calendar.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(calendar).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('main-site build keeps the original homepage and routes to real bidding', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', error => crashes.push(error.message));
  await prepare(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'What do you need to rent?' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'main');
  const palette = await page.locator('html').evaluate((root, keys) => {
    const styles = getComputedStyle(root);
    return Object.fromEntries(keys.map(key => [key, styles.getPropertyValue(key).trim()]));
  }, Object.keys(mainPalette));
  expect(palette).toEqual(mainPalette);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('button', { name: 'List an item', exact: true }).first())
    .toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await page.getByRole('button', { name: 'List an item', exact: true }).first().hover();
  await expect(page.getByRole('button', { name: 'List an item', exact: true }).first())
    .toHaveCSS('background-color', 'rgb(64, 64, 64)');
  await expect(page.getByRole('heading', { name: 'Great gear. No need to buy.' })).toHaveCount(0);
  await expect(page.locator('header').first()).toHaveClass(/glass-nav-top/);
  expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily)).toContain('Inter');
  await expect(page.locator('.p1')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('button', { name: 'Bidding', exact: true }).click();
  await expect(page).toHaveURL(/\/bidding$/);
  await expect(page.getByRole('heading', { name: 'Live bidding', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sample bidding only' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No open auctions right now' })).toBeVisible();
  expect(await page.locator('html').evaluate(root => getComputedStyle(root).getPropertyValue('--p1-blue').trim()))
    .toBe('#111111');
  expect(await page.locator('html').evaluate(root => getComputedStyle(root).getPropertyValue('--p1-lime').trim()))
    .toBe('#E5E5E5');
  expect(crashes).toEqual([]);
});

for (const width of [390, 768, 1440]) {
  test(`original main-site screens and sign-in stay isolated at ${width}px`, async ({ page }, testInfo) => {
    const crashes: string[] = [];
    page.on('pageerror', error => crashes.push(error.message));
    await prepare(page);
    await page.setViewportSize({ width, height: 900 });
    for (const [url, heading] of [
      ['/', 'What do you need to rent?'],
      ['/search', 'Nothing matches those filters'],
      [`/listing/${listingId}`, listing.title],
      ['/bidding', 'Live bidding'],
    ]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.locator('[class~="p1"], [class~="p1-button"], [class~="p1-tag"]')).toHaveCount(0);
      await expect(page.locator('header').first()).toHaveClass(/glass-nav-top/);
      expect(await page.locator('html').evaluate(root => {
        const styles = getComputedStyle(root);
        return [styles.getPropertyValue('--radius-lg').trim(), styles.getPropertyValue('--radius-xl').trim()];
      })).toEqual(['0.875rem', '1.25rem']);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (url === '/' || url.startsWith('/listing/')) {
        await page.screenshot({ path: testInfo.outputPath(`${url === '/' ? 'home' : 'listing'}-${width}.png`), animations: 'disabled' });
      }

    }
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign in or create an account' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Welcome to YBuy' })).toBeVisible();
    await expect(dialog.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Password', { exact: true })).toBeVisible();
    await dialog.getByLabel('Show password').check();
    await expect(dialog.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(dialog).toHaveCSS('border-radius', '20px');
    await dialog.getByRole('button', { name: 'Close sign-in' }).click();
    await expect(dialog).not.toBeVisible();
    expect(crashes).toEqual([]);
  });

  test(`authenticated original dashboards and forms render at ${width}px`, async ({ page }, testInfo) => {
    const crashes: string[] = [];
    page.on('pageerror', error => crashes.push(error.message));
    await prepare(page, true);
    await page.setViewportSize({ width, height: 900 });
    for (const [url, heading] of [
      ['/dashboard', 'Bookings'],
      ['/dashboard?tab=lending', 'Bookings'],
      ['/create-listing', 'Create a listing'],
      ['/notifications', 'Notifications'],
      ['/bidding', 'Live bidding'],
    ]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      if (url === '/bidding') {
        await page.getByRole('button', { name: 'My auctions', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Owner — Bidding', exact: true })).toBeVisible();
      }
      await expect(page.locator('[class~="p1"], [class~="p1-button"], [class~="p1-tag"]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (url.includes('lending') || url === '/create-listing') {
        await page.screenshot({ path: testInfo.outputPath(`${url.includes('lending') ? 'owner-dashboard' : 'create-listing'}-${width}.png`), animations: 'disabled' });
      }
    }
    expect(crashes).toEqual([]);
  });
}

test('owner can select any eligible bidder before close and review full profiles beyond the top three', async ({ page }) => {
  await prepare(page, true);
  const now = Date.now();
  const auction: ListingAuction = {
    id: '40000000-0000-4000-8000-000000000001', listing_id: listingId, status: 'open',
    start_date: '2027-01-15', end_date: '2027-01-17', server_now: new Date(now).toISOString(),
    ends_at: new Date(now + 3_600_000).toISOString(), selection_deadline: null, payment_deadline: null,
    minimum_increment: 5, minimum_next_bid: 55, top_bids: [], my_bid_count: 0,
    my_daily_rate: null, my_rank: null, my_bids: [], my_booking_id: null, selected_bid_id: null,
    selected_payment_status: null, owner_decision_missed_at: null, is_owner: true,
    owner_bids: Array.from({ length: 4 }, (_, index) => ({
      id: `50000000-0000-4000-8000-00000000000${index + 1}`,
      daily_rate: 50 - index * 5, submitted_at: new Date(now - 60_000).toISOString(),
      bid_count: 1, passed: false, is_current: true, rank: index + 1, selected: false, eligible: true,
      renter: {
        id: `60000000-0000-4000-8000-00000000000${index + 1}`,
        full_name: `Bidder ${index + 1}`, avatar_url: null, rating: 4.5, review_count: 2,
      },
    })),
  };
  await page.route('**/rest/v1/listings?**', route => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has('owner_id')) return route.fallback();
    return route.fulfill({ json: [{ ...listing, owner_id: userId, auction_enabled: true }] });
  });
  await page.route('**/rest/v1/rpc/get_listing_auction', route => route.fulfill({ json: auction }));
  const selections: { p_listing_id: string; p_bid_id: string }[] = [];
  await page.route('**/rest/v1/rpc/select_listing_auction_winner', route => {
    selections.push(route.request().postDataJSON());
    auction.status = 'awaiting_payment';
    auction.selected_bid_id = selections[0].p_bid_id;
    auction.selected_payment_status = 'pending';
    auction.payment_deadline = new Date(Date.now() + 3_600_000).toISOString();
    return route.fulfill({ json: auction });
  });
  await page.goto('/bidding', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Owner — Bidding', exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(5);
  await expect(page.getByRole('cell', { name: '4.5 (2)', exact: true })).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Select winner', exact: true })).toHaveCount(4);
  auction.status = 'owner_selection';
  auction.ends_at = new Date(Date.now() - 60_000).toISOString();
  auction.selection_deadline = new Date(Date.now() + 3_600_000).toISOString();
  await page.getByRole('button', { name: 'Refresh auctions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select winner', exact: true })).toHaveCount(4);
  await page.getByRole('row').filter({ hasText: 'Bidder 4' })
    .getByRole('button', { name: 'Select winner', exact: true }).click();
  await expect(page.getByText('Selected renter payment: pending.', { exact: true })).toBeVisible();
  expect(selections).toEqual([{ p_listing_id: listingId, p_bid_id: '50000000-0000-4000-8000-000000000004' }]);
  await expect(page.getByRole('button', { name: 'Select winner', exact: true })).toHaveCount(0);
});
