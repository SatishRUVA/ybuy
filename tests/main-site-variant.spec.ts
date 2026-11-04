import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
  if (process.env.TEST_PROTECTION_COOKIE_JAR) {
    const url = process.env.TEST_FRONTEND_URL;
    if (!url) throw new Error('Protected bundle testing requires TEST_FRONTEND_URL.');
    const cookies = readFileSync(process.env.TEST_PROTECTION_COOKIE_JAR, 'utf8').split(/\r?\n/).flatMap(line => {
      if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) return [];
      const fields = line.replace(/^#HttpOnly_/, '').split('\t');
      if (fields.length !== 7) throw new Error('Invalid provider cookie record.');
      return [{ name: fields[5], value: fields[6], url, httpOnly: line.startsWith('#HttpOnly_'), secure: true }];
    });
    if (!cookies.length) throw new Error('Provider protection cookie was not issued.');
    await page.context().addCookies(cookies);
  }
  if (process.env.TEST_COMPILED_ENTRY) {
    const entry = process.env.TEST_COMPILED_ENTRY;
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/assets/${entry}"></script></body></html>` })
      : route.fallback());
  }
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
      return route.fulfill({ json: [
        { key: 'bidding', enabled: true }, { key: 'mock_bidding', enabled: false },
        { key: 'item_requests', enabled: true },
      ] });
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
    if (url.pathname.endsWith('/get_nearby_item_requests')) return route.fulfill({ json: { rows: [], total: 0 } });
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

test('main-site skip link moves keyboard focus past navigation', async ({ page }) => {
  await prepare(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'What do you need to rent?', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to content', exact: true });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  await expect(skipLink).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

for (const width of [320, 390, 640, 768, 1024, 1280, 1440]) {
  test(`main-site authenticated header has no clipped or overlapping controls at ${width}px`, async ({ page }) => {
    await prepare(page, true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const header = page.getByRole('banner');
    await expect(header.getByRole('button', { name: 'Saved items', exact: true })).toBeVisible();
    const menu = header.getByRole('button', { name: 'Open menu', exact: true });
    if (width < 1280) await expect(menu).toBeVisible();
    else await expect(menu).toBeHidden();

    const controls = await header.getByRole('button').evaluateAll(buttons => buttons
      .filter(button => button.getClientRects().length > 0)
      .map(button => {
        const rect = button.getBoundingClientRect();
        return { label: button.getAttribute('aria-label') ?? button.textContent, left: rect.left, right: rect.right };
      }));
    for (const [index, control] of controls.entries()) {
      expect(control.left, control.label ?? '').toBeGreaterThanOrEqual(0);
      expect(control.right, control.label ?? '').toBeLessThanOrEqual(width);
      if (index > 0) expect(control.left, control.label ?? '').toBeGreaterThanOrEqual(controls[index - 1].right);
    }
  });
}

test('main-site menu scrolls within a short viewport and preserves keyboard navigation', async ({ page }, testInfo) => {
  await prepare(page, true);
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('banner').getByRole('button', { name: 'Saved items', exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
  const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(menu.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
  expect(await menu.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const signOut = menu.getByRole('button', { name: 'Sign out', exact: true });
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
  await signOut.focus();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Home', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('main-site-menu-short-viewport.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');

  await trigger.click();
  await menu.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(menu).toBeHidden();
  await trigger.click();
  await menu.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page).toHaveURL(/\/search(?:\?|$)/);
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(menu).toBeHidden();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

for (const authenticated of [false, true]) {
  test(`main-site menu hands focus to sign-in when authenticated=${authenticated}`, async ({ page }) => {
    await prepare(page, authenticated);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const header = page.getByRole('banner');
    if (authenticated) await expect(header.getByRole('button', { name: 'Saved items', exact: true })).toBeVisible();
    else await expect(header.getByRole('button', { name: 'Sign in / Join', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await menu.getByRole('button', { name: authenticated ? 'Switch account' : 'Sign in / Join', exact: true }).click();
    await expect(menu).toBeHidden();
    const signIn = page.getByRole('dialog', { name: authenticated ? 'Use another account' : 'Welcome to YBuy', exact: true });
    await expect(signIn).toBeVisible();
    await expect.poll(() => signIn.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect.poll(() => signIn.evaluate(element => element.contains(document.activeElement))).toBe(true);
  });
}

test.describe('main-site touch controls', () => {
  test.use({ hasTouch: true, viewport: { width: 768, height: 900 } });

  test('small shared buttons retain 44px touch targets on tablets', async ({ page }) => {
    await prepare(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const signIn = page.getByRole('banner').getByRole('button', { name: 'Sign in / Join', exact: true });
    await expect(signIn).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const bounds = await signIn.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  });
});

test('main-site request form supports long text without a competing floating action', async ({ page }) => {
  await prepareJourney(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/need-something', { waitUntil: 'domcontentloaded' });
  const description = page.getByLabel('Description', { exact: false });
  await expect(description).toBeVisible();
  await expect(description).toHaveCSS('resize', 'vertical');
  const bounds = await description.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.height).toBeGreaterThanOrEqual(112);
  await description.fill('A long description of the item I need for a community gathering.');
  await expect(description).toHaveValue('A long description of the item I need for a community gathering.');
  await expect(page.getByRole('button', { name: 'List an item', exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('main-site lazy routes show an announced skeleton instead of a blank page', async ({ page }) => {
  await prepare(page);
  let releaseChunk!: () => void;
  const heldChunk = new Promise<void>(resolve => { releaseChunk = resolve; });
  await page.route(/\/assets\/guidelines-[^/]+\.js$/, async route => {
    await heldChunk;
    await route.continue();
  });
  try {
    await page.goto('/guidelines', { waitUntil: 'domcontentloaded' });
    const loading = page.getByRole('status').filter({ hasText: 'Loading page...' });
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('aria-busy', 'true');
  } finally {
    releaseChunk();
  }
  await expect(page.getByRole('heading', { name: 'Community guidelines', exact: true })).toBeVisible();
  await expect(page.getByText('Loading page...', { exact: true })).toBeHidden();
});

for (const width of [390, 1280, 1440]) {
  test(`workspace navigation organizes customer page families at ${width}px`, async ({ page }, testInfo) => {
    await prepare(page, true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Welcome back, Main', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What do you need to rent?', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Find your next rental', exact: true })).toBeVisible();
    const sidebar = page.getByRole('complementary', { name: 'Your workspace', exact: true });
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    if (width >= 1280) await expect(sidebar).toBeVisible();
    else await expect(sidebar).toBeHidden();

    for (const [label, url, heading] of [
      ['My rentals', '/dashboard?tab=renting', 'My rentals'],
      ['Lending activity', '/dashboard?tab=lending', 'Lending activity'],
      ['My listings', '/dashboard/listings', 'My listings'],
      ['Earnings & payouts', '/payouts', 'Earnings & payouts'],
      ['Messages', '/messages', 'Messages'],
      ['Notifications', '/notifications', 'Notifications'],
      ['Saved items', '/favorites', 'Saved items'],
      ['Profile & settings', '/profile', 'Your profile'],
    ]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
      const rentalPage = url.startsWith('/dashboard') || url === '/payouts';
      if (rentalPage) {
        await expect(sidebar).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Rental workspace' }).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      } else if (width >= 1280) {
        await expect(sidebar.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
        const content = await page.getByRole('main').boundingBox();
        const rail = await sidebar.boundingBox();
        expect(content).not.toBeNull();
        expect(rail).not.toBeNull();
        expect(content!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width);
      } else {
        await expect(drawer).toBeHidden();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (url === '/dashboard/listings') {
        await expect(page.getByRole('heading', { name: 'Incoming requests', exact: true })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Earnings', exact: true })).toHaveCount(0);
      }
      if (url === '/payouts') {
        await expect(page.getByRole('heading', { name: 'Earnings', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'My listings', exact: true })).toHaveCount(0);
      }
    }
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`workspace-profile-${width}.png`), animations: 'disabled' });
  });
}

for (const width of [390, 768, 1440]) {
  test(`rental workspace keeps navigation and activity compact at ${width}px`, async ({ page }, testInfo) => {
    await prepare(page, true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard?tab=lending', { waitUntil: 'domcontentloaded' });
    const navigation = page.getByRole('navigation', { name: 'Rental workspace', exact: true });
    await expect(page.getByRole('heading', { name: 'Lending activity', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Your workspace' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Incoming requests', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rental activity', exact: true })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'List an item', exact: true })).toBeHidden();
    await expect(page.locator('button.fixed[aria-label="List an item"]')).toBeHidden();
    const activity = page.locator('.rental-history');
    await activity.getByRole('button', { name: /^Active/ }).click();
    await expect(activity).toContainText('Nothing is out on rental right now.');
    await activity.getByRole('button', { name: /^Past/ }).click();
    await expect(activity).toContainText('kept here for your records');
    const firstPanel = await page.locator('.rental-panel').first().boundingBox();
    expect(firstPanel!.y).toBeLessThan(500);
    if (width === 1440) {
      const frame = await page.locator('.rental-workspace').boundingBox();
      expect(Math.abs(frame!.x - (width - frame!.x - frame!.width))).toBeLessThanOrEqual(1);
      const panels = await page.locator('.rental-panel').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y));
      expect(panels[0]).toBe(panels[1]);
    }
    await page.screenshot({ path: testInfo.outputPath(`lending-${width}.png`), animations: 'disabled' });
    await navigation.getByRole('button', { name: 'My rentals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My rentals', exact: true })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'My rentals', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: testInfo.outputPath(`renting-${width}.png`), animations: 'disabled' });
    await navigation.getByRole('button', { name: 'My listings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
    await navigation.getByRole('button', { name: 'Earnings & payouts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Earnings', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('rental workspace preserves populated booking actions and disclosed inventory tools', async ({ page }, testInfo) => {
  await prepare(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/rest/v1/bookings?*', route => {
    const owner = new URL(route.request().url()).searchParams.has('owner_id');
    return route.fulfill({ json: [{
      id: '80000000-0000-4000-8000-000000000001', booking_reference: 'YBUY-TEST',
      listing_id: listingId, owner_id: owner ? userId : listing.owner_id, renter_id: owner ? listing.owner_id : userId,
      start_date: futureDate(2), end_date: futureDate(4), quantity: 1, status: 'requested',
      daily_rate: 25, days: 3, subtotal: 75, service_fee_amount: 0, insurance_amount: 0, deposit: 0, total: 75,
      created_at: new Date().toISOString(),
      listing: { id: listingId, title: listing.title, listing_images: [] },
      renter: { id: userId, full_name: 'Maya Patel', avatar_url: null },
      owner: { id: listing.owner_id, full_name: 'Noah Anderson', avatar_url: null },
    }] });
  });
  await page.route('**/rest/v1/listings?*', route => route.fulfill({ json: [{
    ...listing, owner_id: userId, availability_start: futureDate(1), availability_end: futureDate(25),
  }] }));
  await page.goto('/dashboard?tab=lending', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Accept request', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('lending-populated.png'), animations: 'disabled' });
  const navigation = page.getByRole('navigation', { name: 'Rental workspace' });
  await navigation.getByRole('button', { name: 'My rentals', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View rental', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('renting-populated.png'), animations: 'disabled' });
  await navigation.getByRole('button', { name: 'My listings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit listing', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove listing', exact: true })).toBeHidden();
  await page.locator('.rental-listing-tools summary').click();
  await expect(page.getByRole('button', { name: 'Remove listing', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage dates', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select listings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `Select ${listing.title}`, exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: `Select ${listing.title}`, exact: true }).check();
  await expect(page.getByRole('button', { name: 'Remove selected (1)', exact: true })).toBeEnabled();
});

test('workspace keeps creation and checkout flows free of competing navigation', async ({ page }) => {
  await prepareJourney(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const url of ['/create-listing', '/need-something', `/checkout/${listingId}`]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Back to bookings', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Your workspace', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toHaveCount(0);
    await expect(page.locator('.workspace-focused')).toBeVisible();
  }
});

for (const owner of [false, true]) {
  test(`pre-check-in ${owner ? 'owner approves' : 'renter proposes'} a separate handoff slot`, async ({ page }, testInfo) => {
    await prepare(page, true);
    const bookingId = '80000000-0000-4000-8000-000000000010';
    const startsAt = `${futureDate(2)}T12:00:00.000Z`;
    let slot: { starts_at: string; ends_at: string; time_zone: string; status: string } | null = owner
      ? { starts_at: startsAt, ends_at: `${futureDate(2)}T12:30:00.000Z`, time_zone: 'UTC', status: 'proposed' } : null;
    let mutation: Record<string, unknown> | null = null;
    let canAuthorize = false;
    let authorizationStatus = 'setup_required';
    await page.route('**/rest/v1/bookings?*', route => route.fulfill({ json: {
      id: bookingId, booking_reference: 'YB-TEST', payment_first: true,
      listing_id: listingId, owner_id: owner ? userId : listing.owner_id, renter_id: owner ? listing.owner_id : userId,
      start_date: futureDate(2), end_date: futureDate(4), quantity: 1, status: 'confirmed',
      daily_rate: 25, days: 2, subtotal: 50, service_fee_amount: 5, insurance_amount: 0,
      deposit: 24, total: 58.85, deposit_collection_model: 'authorization', created_at: new Date().toISOString(),
      listing: { id: listingId, title: listing.title, listing_images: [] },
      renter: { id: owner ? listing.owner_id : userId, full_name: 'Test renter' },
      owner: { id: owner ? userId : listing.owner_id, full_name: 'Test owner' },
    } }));
    await page.route('**/rest/v1/rpc/get_booking_handoff', route => route.fulfill({ json: {
      booking_id: bookingId, booking_status: 'confirmed', start_date: futureDate(2), end_date: futureDate(4),
      is_owner: owner, status: null, pickup_arrived_at: null, actual_pickup_at: null,
      actual_return_at: null, return_initiated_at: null, pickup: null, return: null, events: [], cases: [],
    } }));
    await page.route('**/rest/v1/rpc/get_booking_precheckin', route => route.fulfill({ json: {
      payment_first: true, slot, server_now: new Date().toISOString(), can_authorize: canAuthorize,
      handoff_ready: false, deposit_ready: false, consented: false, delivery_mode: 'pickup',
    } }));
    await page.route('**/rest/v1/booking_deposit_authorizations?*', route => route.fulfill({ json: [{
      id: '80000000-0000-4000-8000-000000000011', booking_id: bookingId, status: authorizationStatus,
      authorized_amount: 24, captured_amount: 0, attempt: 1,
    }] }));
    await page.route('**/rest/v1/rpc/propose_booking_pickup_slot', route => {
      mutation = route.request().postDataJSON();
      slot = { starts_at: String(mutation!.p_starts_at), ends_at: startsAt, time_zone: String(mutation!.p_time_zone), status: 'proposed' };
      return route.fulfill({ json: null });
    });
    await page.route('**/rest/v1/rpc/respond_to_booking_pickup_slot', route => {
      mutation = route.request().postDataJSON();
      slot = { ...slot!, status: 'approved' };
      return route.fulfill({ json: null });
    });
    await page.goto(`/check-in/${bookingId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Pre-check-in for pickup', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set up payment method', exact: true })).toBeHidden();
    if (owner) {
      await page.getByRole('button', { name: 'Approve slot', exact: true }).click();
      await expect(page.getByText('Deposit authorization opens 24 hours before the agreed slot.', { exact: false })).toBeVisible();
      expect(mutation).toMatchObject({ p_booking_id: bookingId, p_starts_at: startsAt, p_approve: true });
    } else {
      await page.getByLabel('Proposed pickup time', { exact: true }).fill(`${futureDate(2)}T12:00`);
      await page.getByRole('button', { name: 'Propose slot', exact: true }).click();
      await expect(page.getByText('Waiting for the owner to approve this time.', { exact: true })).toBeVisible();
      const timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
      const expectedTime = await page.evaluate(value => new Date(value).toISOString(), `${futureDate(2)}T12:00`);
      expect(mutation).toMatchObject({ p_booking_id: bookingId, p_time_zone: timeZone });
      expect(Date.parse(String(mutation!.p_starts_at))).toBe(Date.parse(expectedTime));
      slot = { ...slot!, status: 'approved' };
      canAuthorize = true;
      authorizationStatus = 'scheduled';
      await page.route('**/rest/v1/rpc/record_deposit_hold_consent', route => route.fulfill({ json: null }));
      await page.route('**/functions/v1/create-deposit-authorization-session', route => route.fulfill({
        status: 400, json: { error: 'Test bank declined the authorization' },
      }));
      await page.reload({ waitUntil: 'networkidle' });
      const authorize = page.getByRole('button', { name: 'Authorize deposit', exact: true });
      await expect(authorize).toBeDisabled();
      await page.getByRole('checkbox', { name: /I agree to the separate temporary security hold/ }).check();
      await expect(authorize).toBeEnabled();
      await authorize.click();
      await expect(page.getByText('Test bank declined the authorization', { exact: false })).toBeVisible();
      await expect(page.getByRole('button', { name: /Start Pickup/ })).toBeDisabled();
    }

    await page.screenshot({ path: testInfo.outputPath('precheckin-desktop.png'), animations: 'disabled', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('precheckin-mobile.png'), animations: 'disabled', fullPage: true });
  });
}

test('preview customer checkout keeps the backend rental total and separate security hold', async ({ page }) => {
  test.skip(process.env.TEST_CUSTOMER_VARIANT !== 'default', 'Requires the compiled second customer interface.');
  await prepare(page, true);
  await page.route('**/rest/v1/rpc/get_listing_unavailable_dates', route => route.fulfill({ json: { blocked: [], booked: [] } }));
  await page.route('**/rest/v1/listings?*', route => route.fulfill({ json: {
    ...listing, instant_booking: true, available_quantity: 1, item_condition: 'good', estimated_value: 200,
    availability_start: futureDate(1), availability_end: futureDate(25),
  } }));
  await page.route('**/rest/v1/rpc/create_booking_request', route => route.fulfill({ json: {
    id: '80000000-0000-4000-8000-000000000010', status: 'pending_payment',
    total: 58.85, deposit: 50, tax_amount: 3.85, sandbox_tax: false,
    payment_first: true, deposit_collection_model: 'authorization',
  } }));
  await page.route('**/functions/v1/create-checkout-session', route => route.fulfill({
    status: 503, json: { error: 'Test payment service unavailable' },
  }));
  await page.goto(`/checkout/${listingId}?start=${futureDate(2)}&end=${futureDate(4)}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Make time for a good plan.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('checkbox', { name: /I agree to the item/ }).check();
  await page.getByRole('button', { name: 'Continue to secure payment', exact: true }).click();
  await expect(page.getByText('Test payment service unavailable', { exact: false })).toBeVisible();
  const summary = page.getByRole('complementary');
  await expect(summary.getByText('Rental total', { exact: true }).locator('..')).toContainText('$58.85');
  await expect(summary.getByRole('region', { name: 'Separate security hold' })).toContainText('$50');
  await expect(summary).not.toContainText('including deposit');
});

test('workspace owner activity does not fetch hidden renter or Stripe panels', async ({ page }) => {
  await prepare(page, true);
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/dashboard?tab=lending', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Incoming requests', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage listings', exact: true })).toBeVisible();
  expect(requests.some(url => url.includes('/functions/v1/'))).toBe(false);
  expect(requests.some(url => url.includes('/listings?'))).toBe(false);
  await expect(page.getByRole('heading', { name: 'My listings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage listings', exact: true }).click();
  await expect(page).toHaveURL('/dashboard/listings');
  await expect(page.getByRole('heading', { name: 'My listings', exact: true, level: 1 })).toBeVisible();
});

test('main-site date range stays clear on desktop and mobile', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-10T18:00:00.000Z') });
  await prepare(page);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
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
    await expect(pickup).toHaveCSS('background-color', 'rgb(17, 17, 17)');
    await expect(middle).toHaveCSS('background-color', 'rgb(245, 245, 245)');
    await expect(returnDate).toHaveCSS('background-color', 'rgb(17, 17, 17)');

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
      ['/search', "Couldn't find what you need?"],
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
      ['/dashboard', 'My rentals'],
      ['/dashboard?tab=lending', 'Lending activity'],
      ['/create-listing', 'Create a listing'],
      ['/notifications', 'Notifications'],
      ['/bidding', 'Live bidding'],
      ['/favorites', 'Saved items'],
      ['/messages', 'Messages'],
      ['/requests', 'Item requests'],
      ['/need-something', 'Request an item'],
      ['/profile', 'Your profile'],
      ['/guidelines', 'Community guidelines'],
    ]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toHaveAttribute('href', '#main-content');
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
