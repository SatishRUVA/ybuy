import { expect, test, type Page } from '@playwright/test';
import type { Session, User } from '@supabase/supabase-js';
import { mockSupabaseModule } from './mock-supabase';
import { appUrl as defaultAppUrl } from './test-url';
import type { ListingPickupLocation } from '../src/lib/listings';
import type { ListingAuction } from '../src/lib/listing-auctions';

const appUrl = process.env.YBUY_TEST_PORT ? `http://localhost:${process.env.YBUY_TEST_PORT}` : defaultAppUrl;
const appWebSocketUrl = appUrl.replace(/^http:/, 'ws:');
const apiUrl = 'http://localhost:54321';
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

for (const width of [375, 768, 1440]) {
  test(`main uses the actual Preview 1 wizard template at ${width}px`, async ({ page, context }) => {
    test.slow();
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Put your good gear to work.' })).toBeVisible();
    await expect(page.locator('.main-workspace-sidebar')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Give it a useful title' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'What should renters know?' })).toBeVisible();

    const preview = await context.newPage();
    await preview.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await preview.setViewportSize({ width, height: 1000 });
    await preview.goto(`${appUrl}/preview-1/#/create`, { waitUntil: 'domcontentloaded' });
    await expect(preview.getByRole('heading', { name: 'Put your good gear to work.' })).toBeVisible();
    const metrics = async (target: Page) => target.evaluate(() => {
      const properties = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) throw new Error(`Missing template element: ${selector}`);
        const style = getComputedStyle(node);
        return {
          width: node.getBoundingClientRect().width,
          fontFamily: style.fontFamily, fontSize: style.fontSize,
          fontWeight: style.fontWeight, lineHeight: style.lineHeight,
          color: style.color, background: style.backgroundColor,
          columns: style.gridTemplateColumns, gap: style.gap,
        };
      };
      return {
        heading: properties('.p1-page-head h1'),
        wizard: properties('.p1-wizard-layout'),
        header: properties('.p1-header-inner'),
        primary: properties('.p1-wizard-content .p1-button-primary'),
      };
    });
    const expected = await metrics(preview);
    const actual = await metrics(page);
    for (const key of ['heading', 'wizard', 'header', 'primary'] as const) {
      expect(actual[key], key).toEqual(expected[key]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`main-preview-one-${width}.png`), fullPage: true });
    await preview.close();

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Good', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A few details need your attention' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Show its best side.' })).toHaveCount(0);
  });
}

function sessionFor(id: string, now = Date.now()): Session {
  const user: User = {
    id, aud: 'authenticated', role: 'authenticated', email: 'renter@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Camera Renter' }, identities: [],
    email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  };
  const expiresAt = Math.floor(now / 1000) + 3600;
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
  blockedDates?: string[];
  bookedDates?: string[];
  dashboardBookings?: boolean;
  userId?: string;
  reviewFails?: boolean;
  reviewDelay?: Promise<void>;
  returnFails?: boolean;
  aiSuccess?: boolean;
  aiDelay?: Promise<void>;
  aiQualityWarning?: boolean;
  aiGuidelineWarning?: boolean;
  aiError?: string;
  aiHttpStatus?: number;
  aiMalformed?: boolean;
  pendingApproval?: boolean;
  offersFail?: boolean;
  offersConfigured?: boolean;
  listingStart?: string;
  listingEnd?: string;
  uploadFailsOnce?: boolean;
  resumedDetails?: { title: string; description: string; categoryId: string; brand?: string; model?: string };
  aiIdentityUnknown?: boolean;
  pickupFails?: boolean;
  rejectAuctionPreferences?: boolean;
  auctionSupported?: boolean;
  readyDraft?: boolean;
}

async function setup(page: Page, scenario: Scenario = {}) {
  let aiAnalysisCount = 0;
  let scheduledAuction: ListingAuction | null = null;
  let savedPickup: ListingPickupLocation | null = null;
  const blockedDates = new Set(scenario.blockedDates ?? []);
  const bookedDates = new Set(scenario.bookedDates ?? []);
  const uploadedPhotos = new Map<string, Buffer>();
  // Ignore dev-server HMR while a fixture-driven workflow is in progress.
  await page.routeWebSocket(`${appWebSocketUrl}/**`, () => {});
  await page.routeWebSocket('**/realtime/v1/websocket**', socket => {
    socket.onMessage(message => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === 'phx_join') socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', {
        status: 'ok', response: { postgres_changes: payload.config.postgres_changes.map((filter: object) => ({ ...filter, id: 1 })) },
      }]));
      else if (event === 'heartbeat' || event === 'phx_leave') socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
    });
  });
  const session = sessionFor(scenario.userId ?? renterId, await page.evaluate(() => Date.now()));
  const today = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; });
  const exclusiveEnd = new Date(`${today}T12:00:00Z`);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 30);
  let draft = { ...listing, owner_id: session.user.id, status: 'draft', revision: 1, estimated_value: null as number | null,
    brand: '', model: '',
    item_condition: null as string | null, available_quantity: 1, instant_booking: false, delivery_available: false, delivery_fee: 0,
    availability_start: today, availability_end: exclusiveEnd.toISOString().slice(0, 10), negotiation_enabled: false,
    offer_start_date: null as string | null, offer_end_date: null as string | null, offer_expiration_hours: null as number | null,
    listing_images: [] as { url: string; sort_order: number }[] };
  if (scenario.auctionSupported) Object.assign(draft, { auction_enabled: false, auction_start_date: null, auction_end_date: null });
  if (scenario.readyDraft) {
    draft = { ...draft, estimated_value: 100, item_condition: 'good', brand: 'Sony', model: 'FX3',
      listing_images: [{ url: image, sort_order: 0 }] };
    savedPickup = { formattedAddress: '123 Test Street, Irving, TX 75039, US', streetAddress: '123 Test Street',
      city: 'Irving', state: 'TX', postalCode: '75039', country: 'US', latitude: 32.8, longitude: -96.9, placeId: 'test-place' };
    await page.addInitScript(({ userId, id }) => localStorage.setItem(`ybuy-listing-draft:${userId}`, id), { userId: session.user.id, id: listingId });
  }
  if (scenario.resumedDetails) {
    draft = { ...draft, title: scenario.resumedDetails.title, description: scenario.resumedDetails.description,
      brand: scenario.resumedDetails.brand ?? '', model: scenario.resumedDetails.model ?? '',
      category_id: scenario.resumedDetails.categoryId, listing_images: [{ url: image, sort_order: 0 }] };
    await page.addInitScript(({ userId, id }) => localStorage.setItem(`ybuy-listing-draft:${userId}`, id), { userId: session.user.id, id: listingId });
  }
  await page.addInitScript((value) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)), session);
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
              const city = this.dataset.city ?? 'Irving';
              const e = new Event('gmp-select');
              e.placePrediction = { toPlace: () => ({
                id: 'test-place', formattedAddress: '123 Test Street, ' + city + ', TX 75039, US',
                location: { lat: () => 32.8, lng: () => -96.9 },
                addressComponents: [
                  { longText: '123', types: ['street_number'] },
                  { longText: 'Test Street', types: ['route'] },
                  { longText: city, types: ['locality'] },
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
    if (url.pathname === '/rest/v1/feature_flags') body = [{ key: 'bidding', enabled: scenario.auctionSupported === true }];
    if (url.pathname === '/rest/v1/rpc/get_listing_auction') body = scheduledAuction;
    if (url.pathname === '/rest/v1/app_settings') body = { value: ['US'] };
    if (url.pathname === '/rest/v1/reference_countries') body = [{ code: 'US', name: 'United States' }];
    if (url.pathname === '/rest/v1/rpc/get_listing_flow_policy') body = {
      listing_duration_days: 30, max_quantity: 3, max_photos: 6, max_photo_bytes: 10485760,
      min_photo_dimension: 320, max_delivery_fee: 99,
      offer_below_pct: scenario.offersConfigured === false ? null : 0.2, offer_above_pct: scenario.offersConfigured === false ? null : 0.1,
      high_value_threshold: 1000, max_estimated_value: 5000, deposit_rules: [],
    };
    if (url.pathname === '/rest/v1/rpc/owner_save_listing_flow') {
      const input = req.postDataJSON();
      const { offer_preferences: preferences, item_details: itemDetails, auction_preferences: auctionPreferences, ...details } = input.p_details;
      if (input.p_publish) await scenario.publishDelay;
      if (scenario.rejectAuctionPreferences && 'auction_preferences' in input.p_details) { status = 400; body = { message: 'Unsupported listing changes' }; }
      else if (input.p_publish && scenario.publishFails) { status = 403; body = { message: 'Publication denied' }; }
      else if (preferences?.negotiation_enabled && scenario.offersFail) { status = 400; body = { message: 'Offer preferences denied' }; }
      else if (preferences?.negotiation_enabled && (!preferences.offer_start_date || !preferences.offer_end_date
        || preferences.offer_start_date < details.availability_start || preferences.offer_end_date > details.availability_end
        || preferences.offer_end_date <= preferences.offer_start_date
        || preferences.offer_minimum_daily < Math.round(details.price_per_day * 0.8 * 100) / 100
        || preferences.offer_maximum_daily > Math.round(details.price_per_day * 1.1 * 100) / 100
        || !Number.isInteger(preferences.offer_expiration_hours)
        || preferences.offer_expiration_hours < 1 || preferences.offer_expiration_hours > 168)) {
        status = 400; body = { message: 'Offer preferences are outside the approved listing policy' };
      }
      else {
        if (input.p_pickup) savedPickup = input.p_pickup;
        draft = { ...draft, ...details, ...preferences, ...itemDetails,
          ...(auctionPreferences ? { auction_enabled: auctionPreferences.enabled, auction_start_date: auctionPreferences.start_date, auction_end_date: auctionPreferences.end_date } : {}),
          revision: draft.revision + 1,
          status: input.p_publish ? scenario.publishDraft ? 'draft' : scenario.pendingApproval ? 'pending_approval' : 'published' : draft.status };
        body = { revision: draft.revision, status: draft.status, deposit: Number(draft.estimated_value ?? 0) * 0.3 };
      }
    }
    if (url.pathname === '/rest/v1/rpc/owner_reorder_listing_images') {
      const urls: string[] = req.postDataJSON().p_urls;
      draft.listing_images = urls.map((url, sort_order) => ({ url, sort_order }));
      draft.revision += 1;
      body = draft.revision;
    }
    if (url.pathname === '/rest/v1/rpc/owner_configure_listing_negotiation') {
      const { p_offers: preferences, p_auction: auction } = req.postDataJSON();
      if (scenario.offersFail) { status = 403; body = { message: 'Offer preferences denied' }; }
      else {
        draft = { ...draft, ...preferences, revision: draft.revision + 1 };
        Object.assign(draft, { auction_enabled: auction.enabled, auction_start_date: auction.start_date, auction_end_date: auction.end_date,
          auction_bidding_starts_at: auction.bidding_starts_at, auction_bidding_ends_at: auction.bidding_ends_at });
        if (auction.enabled) scheduledAuction = {
          id: '60000000-0000-4000-8000-000000000001', listing_id: listingId, status: 'scheduled',
          start_date: auction.start_date, end_date: auction.end_date, starts_at: auction.bidding_starts_at, ends_at: auction.bidding_ends_at,
          selection_deadline: new Date(Date.parse(auction.bidding_ends_at) + 3600000).toISOString(),
          payment_deadline: null, server_now: new Date().toISOString(), minimum_next_bid: draft.price_per_day,
          top_bids: [], my_bid_count: 0, my_daily_rate: null, my_booking_id: null, selected_bid_id: null, is_owner: true,
        };
        body = { revision: draft.revision, status: draft.status, deposit: 75 };
      }
    }
    if (url.pathname === '/rest/v1/rpc/owner_save_offer_preferences') {
      if (scenario.offersFail) { status = 403; body = { message: 'Offer preferences denied' }; }
      else {
        const preferences = req.postDataJSON().p_preferences;
        if (preferences.negotiation_enabled && (!preferences.offer_start_date || !preferences.offer_end_date
          || preferences.offer_start_date < draft.availability_start || preferences.offer_end_date > draft.availability_end
          || preferences.offer_end_date <= preferences.offer_start_date
          || !Number.isInteger(preferences.offer_expiration_hours)
          || preferences.offer_expiration_hours < 1 || preferences.offer_expiration_hours > 168)) {
          status = 400; body = { message: 'Offer preferences are outside the approved listing policy' };
        } else {
          draft = { ...draft, ...preferences, revision: draft.revision + 1 };
          body = { revision: draft.revision, status: draft.status, deposit: 75 };
        }
      }
    }
    if (url.pathname === '/rest/v1/rpc/get_rental_agreement') body = null;
    if (url.pathname === '/rest/v1/listing_pickup_locations') body = savedPickup ? {
      address: savedPickup.formattedAddress, street_address: savedPickup.streetAddress, city: savedPickup.city,
      state: savedPickup.state, postal_code: savedPickup.postalCode, country: savedPickup.country,
      latitude: savedPickup.latitude, longitude: savedPickup.longitude, place_id: savedPickup.placeId,
    } : null;
    if (url.pathname === '/rest/v1/rpc/get_listing_unavailable_dates') {
      body = { blocked: [...blockedDates], booked: [...bookedDates] };
    }
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
    if (url.pathname === '/rest/v1/rpc/get_booking_pickup') {
      body = { address: '123 Private Lane, Dallas, TX 75247', city: 'Dallas', state: 'TX', postalCode: '75247' };
      if (scenario.pickupFails) { status = 403; body = { message: 'Pickup access denied' }; }
    }
    if (url.pathname === '/rest/v1/categories') body = [
      { id: categoryId, name: 'Electronics', slug: 'electronics', icon: 'Camera' },
      { id: '20000000-0000-4000-8000-000000000002', name: 'Tools', slug: 'tools', icon: 'Wrench' },
    ];
      if (url.pathname.startsWith('/storage/v1/object/sign/listing-images/')) {
        if (req.method() === 'GET') {
          const key = decodeURIComponent(url.pathname.split('/listing-images/')[1]);
          return route.fulfill({ contentType: 'image/png', body: uploadedPhotos.get(key) ?? Buffer.from(image.split(',')[1], 'base64') });
        }
        body = { signedURL: `${url.pathname.replace('/storage/v1', '')}?token=test-signed-photo` };
      }
      if (url.pathname.startsWith('/storage/v1/object/listing-images/')) {
        if (scenario.uploadFailsOnce && req.method() === 'POST') {
          scenario.uploadFailsOnce = false;
          return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Photo upload interrupted' }) });
        }
        let data = req.postDataBuffer();
        const contentType = req.headers()['content-type'];
        if (data && contentType?.includes('multipart/form-data')) {
          const parts = await new Response(data, { headers: { 'content-type': contentType } }).formData();
          const file = [...parts.values()].find((value) => typeof value !== 'string');
          if (file && typeof file !== 'string') data = Buffer.from(await file.arrayBuffer());
        }
        if (data) uploadedPhotos.set(decodeURIComponent(url.pathname.split('/listing-images/')[1]), data);
        body = { Key: url.pathname.split('/storage/v1/object/')[1] };
      }
    if (url.pathname === '/rest/v1/listings') {
      if (req.method() === 'POST') { body = { id: listingId }; draft = { ...draft, status: 'draft' }; }
      else if (req.method() === 'PATCH') {
        const publishing = req.postDataJSON().status === 'published';
        if (publishing) await scenario.publishDelay;
        body = publishing ? { id: listingId, status: scenario.publishDraft ? 'draft' : 'published' } : null;
        if (publishing && scenario.publishFails) { status = 403; body = { message: 'Publication denied' }; }
      } else body = url.searchParams.has('id') ? (page.url().includes('create-listing') || page.url().includes('edit-listing') || page.url().includes('dashboard') ? draft
        : { ...(draft.status === 'published' ? draft : listing), availability_start: scenario.listingStart ?? null, availability_end: scenario.listingEnd ?? null }) : [draft.status === 'published' ? draft : { ...listing, owner_id: renterId }];
    }
    if (url.pathname === '/rest/v1/listing_images' && req.method() === 'POST') {
      const photo = req.postDataJSON();
      draft.listing_images.push({ url: photo.url, sort_order: photo.sort_order });
      draft.revision += 1;
    }
    if (url.pathname === '/rest/v1/listing_images' && req.method() === 'DELETE') {
      draft.listing_images = draft.listing_images.filter((photo) => `eq.${photo.url}` !== url.searchParams.get('url'));
      draft.revision += 1;
    }
    if (url.pathname === '/rest/v1/listing_images' && req.method() === 'PATCH' && req.headers().prefer?.includes('return=representation')) {
      body = [{ url: 'https://example.test/listing-images/replaced.png' }];
    }
    if (url.pathname === '/functions/v1/analyze-listing-photo') {
      aiAnalysisCount += 1;
      await scenario.aiDelay;
      status = scenario.aiHttpStatus ?? 200;
      body = scenario.aiError
        ? status === 200
          ? { ok: true, masked: { title: '', description: '', changed: false }, suggestion: null, flags: [], aiError: scenario.aiError }
          : { ok: false, error: scenario.aiError }
        : scenario.aiMalformed ? { ok: true, suggestion: { title: 123 } } : scenario.aiSuccess
        ? {
        ok: true,
        masked: { title: '', description: '', changed: false },
        suggestion: { title: 'Visible camera item', description: 'A camera visible in the supplied photo.', categoryId,
          brand: scenario.aiIdentityUnknown ? null : 'Sony', model: scenario.aiIdentityUnknown ? null : 'FX3' },
        flags: scenario.aiGuidelineWarning && aiAnalysisCount === 1
          ? [{ type: 'other_guideline', reason: 'This item needs a community-guidelines review.', confidence: 'medium', source: 'photo' }]
          : [],
        photoQualitySuggestions: scenario.aiQualityWarning && aiAnalysisCount === 1
          ? [{ photoIndex: 0, reason: 'The photo looks dim.', recommendation: 'Retake it in brighter light.' }]
          : [],
      }
      : { ok: true, masked: { title: req.postDataJSON().title, description: req.postDataJSON().description, changed: false },
        suggestion: null, flags: [], aiError: 'AI suggestions are unavailable. Continue manually.' };
    }
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
    if (url.pathname === '/rest/v1/listing_availability' && req.method() === 'POST') {
      if (scenario.availabilityFails) { status = 403; body = { message: 'Availability save denied' }; }
      else {
        const { date, is_available: isAvailable } = req.postDataJSON();
        if (isAvailable) blockedDates.delete(date); else blockedDates.add(date);
        body = null;
      }
    }
    return route.fulfill({ status, contentType: 'application/json', body: body === null ? '' : JSON.stringify(body) });
  });
}

test('verified payment shows actual amount, image, reference and dates, then replays confetti on reload', async ({ page }, testInfo) => {
  test.slow();
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
  await expect(dialog.locator('.success-confetti span')).toHaveCount(64);
  await expect(dialog.locator('.success-confetti')).toHaveCSS('pointer-events', 'none');
  await expect(dialog).toHaveCSS('animation-name', 'successEnter');
  await expect(dialog.locator('.listing-achievement')).toHaveCSS('animation-name', 'successCheck');
  await page.screenshot({ path: testInfo.outputPath('payment-inline-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'View Booking Details' }).click();
  await expect(page.locator('#booking-summary')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(dialog.locator('.success-confetti')).toHaveCount(0);
  await page.reload({ waitUntil: 'commit' });
  await expect(dialog).toBeVisible({ timeout: 60000 });
  await expect(dialog.locator('.success-confetti span')).toHaveCount(64);
  await expect(dialog.locator('.success-confetti')).toHaveCount(0, { timeout: 4000 });
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

test('payment achievement hero uses corner confetti and keeps actions immediately usable', async ({ page }, testInfo) => {
  await setup(page);
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  const panel = page.getByRole('region', { name: 'Payment confirmed', exact: true });
  await expect(panel.locator('.success-confetti span')).toHaveCount(64);
  const motion = await panel.evaluate((element) => {
    const indicator = element;
    const particles = [...indicator.querySelectorAll<HTMLElement>('.success-confetti span')];
    const animations = indicator.getAnimations({ subtree: true });
    animations.forEach((animation) => { animation.pause(); animation.currentTime = 0; });
    const center = indicator.getBoundingClientRect();
    const origin = particles[0].getBoundingClientRect();
    const check = indicator.querySelector('.listing-achievement path')!;
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
  expect(Math.abs(motion.originX)).toBeGreaterThan(50);
  expect(motion.sizes).toHaveLength(4);
  expect(motion.colors).toHaveLength(5);
  expect(motion.colors).not.toContain('rgba(0, 0, 0, 0)');
  expect(motion.duration).toBe('2.4s');
  expect(motion.bounds.some(({ x }) => x < -20)).toBe(true);
  expect(motion.bounds.some(({ x }) => x > 20)).toBe(true);
  await expect(panel).toHaveClass(/listing-success-hero/);
  await expect(panel.getByRole('status')).toHaveText('Your dates are confirmed. Arrange pickup with the owner when you are ready.');
  await page.screenshot({ path: testInfo.outputPath('payment-burst-midflight.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('payment-burst-mobile.png'), fullPage: true });
  await panel.getByRole('button', { name: 'View Booking Details' }).click();
  await expect(page.locator('#booking-summary')).toBeFocused();
  await expect(panel.locator('.success-confetti')).toHaveCount(0, { timeout: 4000 });
});

test('changing to reduced motion stops an active burst without replaying it', async ({ page }) => {
  await setup(page);
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.locator('.success-confetti span')).toHaveCount(64);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  await expect(page.locator('.listing-achievement')).toHaveCSS('animation-name', 'none');
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
    await page.goto(`${appUrl}/dashboard?tab=lending`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage dates' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /, (available|blocked)$/, disabled: false }).last().click();
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
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I have reviewed the dates, estimated cost, and rental terms.' }).check();
  await page.getByRole('button', { name: 'Send booking request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good plans are on their way.' })).toBeVisible();
  await expect(page).toHaveURL(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.success-card')).toHaveCount(0);
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Booking confirmed', exact: true })).toHaveCount(0);
});

for (const status of ['requested', 'pending_payment', 'confirmed', 'active', 'return_pending', 'cancelled', 'rejected', 'completed']) {
  test(`pickup address ${['confirmed', 'active', 'return_pending'].includes(status) ? 'is available' : 'stays hidden'} for ${status} booking`, async ({ page }) => {
    await setup(page, { status });
    const requests: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/rpc/get_booking_pickup')) requests.push(request.url()); });
    await page.goto(`${appUrl}/confirmation/${bookingId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`Booking reference: ${bookingId}`)).toBeVisible();
    if (['confirmed', 'active', 'return_pending'].includes(status)) {
      await expect(page.getByRole('region', { name: 'Private pickup address', exact: true })).toContainText('123 Private Lane');
      expect(requests.length).toBeGreaterThan(0);
    } else {
      await expect(page.getByRole('region', { name: 'Private pickup address', exact: true })).toHaveCount(0);
      expect(requests).toHaveLength(0);
    }
  });
}

test('pickup authorization errors never show an address and can be retried', async ({ page }) => {
  const scenario: Scenario = { status: 'confirmed', pickupFails: true };
  await setup(page, scenario);
  await page.goto(`${appUrl}/confirmation/${bookingId}`);
  await expect(page.getByText('Pickup access denied')).toBeVisible();
  await expect(page.getByText('123 Private Lane', { exact: false })).toHaveCount(0);
  scenario.pickupFails = false;
  await page.getByRole('button', { name: 'Retry pickup address', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Private pickup address', exact: true })).toContainText('123 Private Lane');
});

async function waitForItemStep(page: Page) {
  await expect(page.getByRole('region', { name: 'Step 1: The item', exact: true })).toBeVisible({ timeout: 60_000 });
}

async function selectWizardOption(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveText(option);
}

async function openWizardStep(page: Page, label: string) {
  await page.getByRole('navigation', { name: 'Listing progress', exact: true })
    .getByRole('button').filter({ has: page.getByText(label, { exact: true }) }).click();
}

async function fillRequiredItemStep(page: Page) {
  await waitForItemStep(page);
  await selectWizardOption(page, 'Category', 'Electronics');
  await page.getByLabel('Give it a useful title', { exact: true }).fill(listing.title);
  await page.locator('summary').filter({ hasText: 'Brand, included items & optional details' }).click();
  await page.getByRole('radio', { name: 'Good', exact: true }).check();
  await page.getByLabel('What should renters know?', { exact: false }).fill(listing.description);
}

async function fillListing(page: Page, review = true) {
  await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
  await fillRequiredItemStep(page);
  await page.getByLabel('Brand (optional)', { exact: true }).fill('Sony');
  await page.getByLabel('Model (optional)', { exact: true }).fill('FX3');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const photoBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#1b8d7a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(photoBase64, 'base64') });
  await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeVisible();
  await expect(page.getByText('Your declared value is used for security policies', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good terms make good rentals.', exact: true })).toBeVisible();
  await expect(page.getByLabel('Daily price (USD)', { exact: true })).not.toHaveAttribute('placeholder');
  await expect(page.getByLabel('Daily price (USD)', { exact: true })).toBeEditable();
  await expect(page.getByLabel('Daily price (USD)', { exact: true })).not.toHaveAttribute('readonly');
  await expect(page.getByLabel('Estimated replacement value (USD)', { exact: true })).toBeEditable();
  await expect(page.getByLabel('Estimated replacement value (USD)', { exact: true })).not.toHaveAttribute('readonly');
  for (const name of ['Owner approval required', 'Instant booking']) {
    await expect(page.getByRole('radio', { name, exact: false }).locator('..').locator('svg[aria-hidden="true"]')).toHaveCount(1);
  }
  await page.getByLabel('Estimated replacement value (USD)', { exact: true }).fill('1000');
  await page.getByLabel('Daily price (USD)', { exact: true }).fill('25');
  await page.locator('test-place-autocomplete').click();
  await expect(page.getByRole('button', { name: 'Confirm Location', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('State', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('ZIP code', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Pricing period', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pickup and delivery settings', exact: true }))
    .toContainText('Your exact address stays private until an eligible booking is confirmed.');
  await expect(page.getByText('Your security deposit is calculated automatically', { exact: false })).toHaveCount(0);
  if (review) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose availability', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ready for its second job.', exact: true })).toBeVisible();
  }
}

async function reviewReadyDraft(page: Page) {
  await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
  await waitForItemStep(page);
  for (let step = 0; step < 4; step++) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Ready for its second job.', exact: true })).toBeVisible();
}

test.describe('Owner listing flow', () => {
test.setTimeout(120000);

test('owner wizard follows the five-step listing journey and immediately protects booked dates', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
  await setup(page, { readyDraft: true, blockedDates: ['2026-10-26'], bookedDates: ['2026-10-25'] });
  await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
  await waitForItemStep(page);

  const progress = page.getByRole('list', { name: 'Listing progress' });
  await expect(progress.locator('.owner-step-label')).toHaveText([
    'The item', 'Photos', 'Price & pickup', 'Availability', 'Review',
  ]);
  const preview = page.getByRole('complementary', { name: 'Listing preview' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(listing.title);

  for (let step = 1; step < 4; step++) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  const listingCalendar = page.getByRole('region', { name: 'Listing availability', exact: true });
  await expect(listingCalendar).toBeVisible();
  await expect(listingCalendar).toContainText('Choose up to 30 calendar days');
  await listingCalendar.getByRole('button', { name: /Saturday, October 24, 2026/ }).click();
  await listingCalendar.getByRole('button', { name: /^Return by/ }).click();
  await expect(listingCalendar.getByRole('button', { name: /Monday, November 23, 2026/ })).toBeEnabled();
  await expect(listingCalendar.getByRole('button', { name: /Tuesday, November 24, 2026/ })).toBeDisabled();
  await listingCalendar.getByRole('button', { name: /Monday, November 23, 2026/ }).click();
  await expect(listingCalendar.getByRole('status').last()).toContainText('30 rental days');
  await expect(listingCalendar.getByRole('status').last()).toContainText('return day is not charged');

  const blockedCalendar = page.getByRole('region', { name: 'Block unavailable days', exact: true });
  await expect(blockedCalendar.getByRole('button', { name: /Sunday, October 25, 2026, booked$/ })).toBeDisabled();
  await expect(blockedCalendar.getByRole('button', { name: /Monday, October 26, 2026, blocked$/ })).toBeEnabled();
  await blockedCalendar.getByRole('button', { name: /Tuesday, October 27, 2026, available$/ }).click();
  await expect(blockedCalendar.getByRole('button', { name: /Tuesday, October 27, 2026, blocked$/ })).toBeVisible();
  await expect(blockedCalendar.getByText(/blocked\. Saved to your listing\./)).toBeVisible();
  await blockedCalendar.getByRole('button', { name: /Monday, October 26, 2026, blocked$/ }).click();
  await expect(blockedCalendar.getByRole('button', { name: /Monday, October 26, 2026, available$/ })).toBeEnabled();
  await expect(blockedCalendar.getByRole('button', { name: /Sunday, October 25, 2026, booked$/ })).toBeDisabled();
});

test('pickup search uses the marketplace city and derives saved city from the selected address', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ybuy-marketplace-location', JSON.stringify({
    city: 'Irving', state: 'TX', country: 'US', source: 'USER_SELECTED', latitude: 32.8, longitude: -96.9,
  })));
  await setup(page);
  await fillListing(page, false);
  await expect(page.getByLabel('City', { exact: true })).toHaveCount(0);
  await expect(page.locator('test-place-autocomplete')).toHaveAttribute('placeholder', 'Search pickup address in Irving, TX');
  await expect(page.locator('test-place-autocomplete')).toHaveJSProperty('locationBias', { center: { lat: 32.8, lng: -96.9 }, radius: 25000 });
  await page.locator('test-place-autocomplete').evaluate(element => { element.dataset.city = 'Austin'; });
  await page.locator('test-place-autocomplete').click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.owner-listing-review')).toContainText('Austin, TX');
  await expect(page.locator('.owner-listing-review')).not.toContainText('123 Test Street');
  await expect(page.getByRole('region', { name: 'Step 5: Review', exact: true })).toBeVisible();
});

for (const width of [375, 768, 1440]) {
  test(`owner wizard keeps all five steps usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page);
    await fillListing(page);
    const review = page.locator('.owner-listing-review');
    await expect(review.getByText(listing.title, { exact: true })).toBeVisible();
    await expect(review).toContainText('Irving');
    await expect(review).not.toContainText('123 Test Street');
    await expect(review.getByRole('img', { name: `Preview of ${listing.title}` })).toHaveJSProperty('naturalWidth', 1000);
    if (width > 1100) await expect(page.getByRole('complementary', { name: 'Listing preview' })).toBeVisible();
    else await expect(page.getByRole('complementary', { name: 'Listing preview' })).toBeHidden();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    for (const step of [5, 4, 3, 2, 1]) {
      await expect(page.locator('.p1-wizard-content > div > section')).toHaveCount(1);
      await expect(page.getByRole('region', { name: `Step ${step}: ${['The item', 'Photos', 'Price & pickup', 'Availability', 'Review'][step - 1]}`, exact: true })).toBeVisible();
      if (width > 1100 && step !== 2) await expect(page.getByRole('complementary', { name: 'Listing preview' })).toBeVisible();
      else await expect(page.getByRole('complementary', { name: 'Listing preview' })).toBeHidden();
      if (width === 1440 && step < 5) {
        const panel = await page.locator('.p1-wizard-content > div > section').boundingBox();
        if (step === 2) expect(panel!.width).toBeGreaterThan(900);
        else {
          expect(panel!.width).toBeGreaterThan(300);
          expect(panel!.width).toBeLessThan(800);
        }
      }
      await expect(page.getByRole('list', { name: 'Listing progress' }).locator('[aria-current="step"]')).toContainText(['The item', 'Photos', 'Price & pickup', 'Availability', 'Review'][step - 1]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const next = page.getByRole('button', { name: step === 5 ? 'Publish listing' : 'Continue', exact: true });
      await next.scrollIntoViewIfNeeded();
      const bounds = await next.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await next.click({ trial: true });
      await next.focus();
      await expect(next).toBeFocused();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: testInfo.outputPath(`listing-step-${step}-${width}.png`), fullPage: true });
      if (step > 1) await page.getByRole('button', { name: 'Back', exact: true }).click();
    }
    await expect(page.getByLabel('Give it a useful title', { exact: true })).toBeVisible();
    await page.getByLabel('Give it a useful title', { exact: true }).fill('Owner edited camera title');
    await expect(page.getByRole('radio', { name: 'Good', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'Good', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Fair', exact: true })).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: 'Good', exact: true })).toBeChecked();
    await expect(page.getByLabel('What should renters know?', { exact: true })).toHaveValue(listing.description);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('Draft saved. Resume it from My listings.', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('description is required for advancing and publication but incomplete drafts can be saved', async ({ page }) => {
  await setup(page);
  await fillListing(page);
  await openWizardStep(page, 'The item');
  const description = page.getByLabel('What should renters know?', { exact: true });
  await expect(description).toHaveAttribute('required', '');
  await description.fill('   ');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('link', { name: 'Describe what is included and the condition it is in.', exact: true }).click();
  await expect(description).toBeFocused();
  await expect(description).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Describe what is included and the condition it is in.').last()).toBeVisible();
  const draftRequest = page.waitForRequest(request => request.url().includes('/rpc/owner_save_listing_flow'));
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click();
  expect((await draftRequest).postDataJSON().p_details.description).toBe('');
  await expect(description).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Draft saved. Resume it from My listings.', { exact: true })).toBeVisible();
  await description.fill('  Camera  ');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Description must be at least 10 characters.').last()).toBeVisible();
  await expect(description).toHaveValue('  Camera  ');
  await expect(page.getByLabel('Give it a useful title', { exact: true })).toHaveValue(listing.title);
  await description.fill('Camera with a carrying case.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good terms make good rentals.', exact: true })).toBeVisible();
});

test('replacement value blocks above-policy entries and accepts an explicit zero', async ({ page }) => {
  const savedValues: number[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rpc/owner_save_listing_flow')) savedValues.push(request.postDataJSON().p_details.estimated_value);
  });
  await setup(page);
  await fillListing(page);
  await openWizardStep(page, 'Price & pickup');
  const value = page.getByLabel('Estimated replacement value (USD)', { exact: true });
  await value.fill('5000.01');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Estimated replacement value must be between $0 and $5,000.').last()).toBeVisible();
  await expect(value).toHaveValue('5000.01');
  expect(savedValues).not.toContain(5000.01);
  await value.fill('0');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose availability', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your listing is live!' })).toBeVisible();
  expect(savedValues).toContain(0);
});

test('owner calendar enforces the 30-day return limit and resumes saved dates', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00'));
  const saves: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rpc/owner_save_listing_flow')) saves.push(request.postDataJSON().p_details);
  });
  await setup(page, { readyDraft: true });
  await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved. Resume it from My listings.', { exact: true })).toBeVisible();
  expect(saves.at(-1)).toMatchObject({ availability_start: '2026-10-22', availability_end: '2026-11-21' });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const calendar = page.getByRole('region', { name: 'Listing availability', exact: true });
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('.owner-availability-months')).toHaveCSS('opacity', '1');
    await expect(calendar.getByRole('status').first()).toHaveCSS('opacity', '1');
    const bounds = await calendar.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`premium-calendar-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const calendar = page.getByRole('region', { name: 'Listing availability', exact: true });
  await calendar.getByRole('button', { name: /Monday, October 26, 2026/ }).click();
  await calendar.getByRole('button', { name: /^Return by/ }).click();
  await expect(calendar.getByRole('button', { name: /Wednesday, November 25, 2026/ })).toBeEnabled();
  await expect(calendar.getByRole('button', { name: /Thursday, November 26, 2026/ })).toBeDisabled();
  await calendar.getByRole('button', { name: /Wednesday, November 25, 2026/ }).click();
  await expect(calendar.getByRole('status').last()).toContainText('30 rental days');
  await expect(calendar.getByRole('status').last()).toContainText('return day is not charged');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved. Resume it from My listings.', { exact: true })).toBeVisible();
  expect(saves.at(-1)).toMatchObject({ availability_start: '2026-10-26', availability_end: '2026-11-25' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Your saved draft is ready to continue.')).toBeVisible();
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: /Return by Nov 25, 2026/ })).toBeVisible();
});

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
  await expect(page.getByText('notes.txt', { exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole('img', { name: 'Listing photo 1, cover photo' }).evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(400);
  await expect(page.getByRole('status').filter({ hasText: 'notes.txt' })).toContainText('Choose JPEG, PNG, or WebP.');
  await expect(page.getByText(/Try a higher-resolution/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Select photo 2, quality suggestion' }).click();
  await page.getByRole('button', { name: 'Replace photo 2' }).click();
  await input.setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('button', { name: 'Remove photo 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move photo 2 earlier' })).toBeEnabled();
  await page.getByRole('button', { name: 'Move photo 2 earlier' }).click();
  await expect(page.getByText('Cover photo', { exact: true })).toBeVisible();
});

test('photo analysis auto-fills untouched item details and preserves owner edits; draft save keeps state', async ({ page }) => {
  await setup(page, { aiSuccess: true });
  await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    canvas.getContext('2d')!.fillRect(0, 0, 400, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const title = page.getByLabel('Give it a useful title', { exact: true });
  await expect(title).toHaveValue('Visible camera item');
  await expect(page.getByLabel('What should renters know?', { exact: false })).toHaveValue('A camera visible in the supplied photo.');
  await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveValue('Sony');
  await expect(page.getByLabel('Model (optional)', { exact: true })).toHaveValue('FX3');
  await page.getByRole('radio', { name: 'Good', exact: true }).check();
  await title.fill('Owner-edited title');
  await page.getByLabel('Brand (optional)', { exact: true }).fill('Canon');
  await page.getByLabel('Model (optional)', { exact: true }).fill('EOS R6');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'item-side.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const reanalysis = page.waitForResponse((response) => response.url().includes('/functions/v1/analyze-listing-photo'));
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await reanalysis;
  await expect(title).toHaveValue('Owner-edited title');
  await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveValue('Canon');
  await expect(page.getByLabel('Model (optional)', { exact: true })).toHaveValue('EOS R6');
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click();
  await expect(page.getByText('Draft saved. Resume it from My listings.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good terms make good rentals.', exact: true })).toBeVisible();
  await page.getByLabel('Estimated replacement value (USD)', { exact: true }).fill('1000');
});

for (const details of [
  { name: 'empty photo-only draft', title: '', description: '', categoryId: '20000000-0000-4000-8000-000000000002' },
  { name: 'partially completed draft', title: 'Saved owner title', description: '', categoryId: '20000000-0000-4000-8000-000000000002' },
  { name: 'completed owner details', title: 'Saved owner title', description: 'Saved owner description.', categoryId: '20000000-0000-4000-8000-000000000002', brand: 'Canon', model: 'EOS R5' },
]) {
  test(`photo analysis maps suggestions into a resumed ${details.name} without losing saved content`, async ({ page }) => {
    await setup(page, { aiSuccess: true, resumedDetails: details });
    await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status').filter({ hasText: 'Your saved draft is ready to continue.' })).toBeVisible({ timeout: 60000 });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const response = page.waitForResponse((result) => result.url().includes('/functions/v1/analyze-listing-photo'));
    await page.getByRole('button', { name: 'Generate details', exact: true }).click();
    await response;
    await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
    await expect(page.getByLabel('Give it a useful title', { exact: true })).toHaveValue(details.title || 'Visible camera item');
    await expect(page.getByLabel('What should renters know?', { exact: false })).toHaveValue(details.description || 'A camera visible in the supplied photo.');
    await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveText(details.title || details.description ? 'Tools' : 'Electronics');
    await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveValue(details.brand || 'Sony');
    await expect(page.getByLabel('Model (optional)', { exact: true })).toHaveValue(details.model || 'FX3');
  });
}

test('brand and model remain optional when AI cannot identify them', async ({ page }) => {
  const saves: unknown[] = [];
  page.on('request', request => {
    if (request.url().includes('/rpc/owner_save_listing_flow')) saves.push(request.postDataJSON());
  });
  await setup(page, { aiSuccess: true, aiIdentityUnknown: true,
    resumedDetails: { title: listing.title, description: listing.description, categoryId } });
  await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Generate details', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  const brand = page.getByLabel('Brand (optional)', { exact: true });
  const model = page.getByLabel('Model (optional)', { exact: true });
  await expect(brand).toBeEmpty();
  await expect(model).toBeEmpty();
  await expect(brand).not.toHaveAttribute('required');
  await expect(model).not.toHaveAttribute('required');
  await page.getByRole('radio', { name: 'Good', exact: true }).check();
  const savedBefore = saves.length;
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good terms make good rentals.', exact: true })).toBeVisible();
  expect(saves.length).toBeGreaterThan(savedBefore);
});

test('photo analysis does not overwrite item details edited while analysis is in flight', async ({ page }) => {
  let release!: () => void;
  const aiDelay = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, { aiSuccess: true, aiDelay });
  await page.goto(`${appUrl}/create-listing`, { waitUntil: 'domcontentloaded' });
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    canvas.getContext('2d')!.fillRect(0, 0, 1000, 1000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const analysisRequest = page.waitForRequest((request) => request.url().includes('/functions/v1/analyze-listing-photo'));
  await page.locator('input[type="file"]').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await analysisRequest;
  await expect(page.getByRole('status', { name: 'Generating AI suggestions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Generating AI suggestions', exact: true })).toBeVisible();
  await page.getByLabel('Give it a useful title', { exact: true }).fill('Owner-edited while analyzing');
  await page.getByLabel('What should renters know?', { exact: false }).fill('Owner description entered during analysis.');
  await page.getByLabel('Brand (optional)', { exact: true }).fill('Canon');
  await page.getByLabel('Model (optional)', { exact: true }).fill('EOS R5');
  release();
  await expect(page.getByRole('status', { name: 'Generating AI suggestions', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Give it a useful title', { exact: true })).toHaveValue('Owner-edited while analyzing');
  await expect(page.getByLabel('What should renters know?', { exact: false })).toHaveValue('Owner description entered during analysis.');
  await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveValue('Canon');
  await expect(page.getByLabel('Model (optional)', { exact: true })).toHaveValue('EOS R5');
});

test('cancelling AI hides the skeleton and ignores its late suggestions', async ({ page }) => {
  let release!: () => void;
  const aiDelay = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, { aiSuccess: true, aiDelay, resumedDetails: { title: '', description: '', categoryId } });
  await page.goto(`${appUrl}/create-listing`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const request = page.waitForRequest((result) => result.url().includes('/functions/v1/analyze-listing-photo'));
  await page.getByRole('button', { name: 'Generate details', exact: true }).click();
  await request;
  await expect(page.getByRole('status', { name: 'Generating AI suggestions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue manually', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Generating AI suggestions', exact: true })).toHaveCount(0);
  await page.getByLabel('Give it a useful title', { exact: true }).fill('Manual title');
  const response = page.waitForResponse((result) => result.url().includes('/functions/v1/analyze-listing-photo'));
  release();
  await response;
  await expect(page.getByLabel('Give it a useful title', { exact: true })).toHaveValue('Manual title');
  await expect(page.getByLabel('What should renters know?', { exact: false })).toHaveValue('');
});

for (const failure of [
  { name: 'exhausted provider limit', scenario: { aiError: 'AI provider credits or usage limit are exhausted. Please contact support or enter details manually.' } },
  { name: 'expired session', scenario: { aiError: 'Your session has expired. Please sign in again.', aiHttpStatus: 401 } },
  { name: 'malformed response', scenario: { aiMalformed: true } },
]) {
  test(`photo analysis shows ${failure.name}, keeps manual entry and recovers on retry`, async ({ page }) => {
    await setup(page, failure.scenario);
    await page.goto(`${appUrl}/create-listing`);
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 640;
      canvas.getContext('2d')!.fillRect(0, 0, 640, 640);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Manual entry is available' }))
      .toContainText('aiError' in failure.scenario ? failure.scenario.aiError : 'AI returned invalid suggestions. Please retry or enter details manually.');
    await page.getByLabel('Give it a useful title', { exact: true }).fill('Owner title');
    await page.route('**/functions/v1/analyze-listing-photo', (route) => route.fulfill({
      json: { ok: true, masked: { title: '', description: '', changed: false }, suggestion: { title: 'Suggested title', description: 'A camera carrying case.', categoryId }, flags: [], photoQualitySuggestions: [] },
    }));
    await page.getByRole('button', { name: /Generate details|Regenerate/, exact: true }).click();
    await expect(page.getByLabel('What should renters know?', { exact: false })).toHaveValue('A camera carrying case.');
    await expect(page.getByLabel('Give it a useful title', { exact: true })).toHaveValue('Owner title');
  });
}

test('photo quality suggestions are actionable but do not block continuing', async ({ page }) => {
  await setup(page, { aiSuccess: true, aiQualityWarning: true });
  await page.goto(`${appUrl}/create-listing`);
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    canvas.getContext('2d')!.fillRect(0, 0, 1000, 1000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await expect(page.getByText(/The photo looks dim. Retake it in brighter light./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true }).last()).toBeEnabled();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Give it a useful title', { exact: true })).toHaveValue('Visible camera item');
});

test('advisory guideline warnings stay visible without blocking manual editing', async ({ page }) => {
  await setup(page, { aiSuccess: true, aiGuidelineWarning: true });
  await page.goto(`${appUrl}/create-listing`);
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    canvas.getContext('2d')!.fillRect(0, 0, 1000, 1000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('This item needs a community-guidelines review.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true }).last()).toBeEnabled();
});

test('publication waits for the server and offers view, manage and share actions', async ({ page }, testInfo) => {
  let release!: () => void;
  const publishDelay = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, { publishDelay });
  await fillListing(page);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saving...', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  const dialog = page.getByRole('region', { name: 'Your listing is live!', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Your listing is live!' })).toBeVisible();
  await expect(dialog.locator('.success-confetti span')).toHaveCount(64);
  await expect(dialog.locator('.listing-hero-confetti')).toHaveCSS('pointer-events', 'none');
  await expect(dialog.getByRole('heading', { name: 'Your listing is live!' })).toHaveCount(1);
  await expect(dialog.getByRole('status')).toHaveText('People nearby can find your item and request a rental.');
  await expect(dialog.getByRole('img', { name: listing.title })).toBeVisible();
  await expect(dialog).toContainText(listing.title);
  await expect(dialog.getByRole('button', { name: 'View listing', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Manage listing', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Share listing', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'List another item', exact: true })).toBeVisible();
  await expect(page.getByText('Rental offers are off.', { exact: false })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Your listing is live!' })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('listing-inline-desktop.png'), fullPage: true });
  await expect(dialog.locator('.success-confetti')).toHaveCount(0, { timeout: 3500 });
  await dialog.getByRole('button', { name: 'Manage listing' }).click();
  await expect(page).toHaveURL(`${appUrl}/edit-listing/${listingId}`);
});

test('publication achievement stays static on reduced-motion phones and View listing works', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await fillListing(page);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  const hero = page.getByRole('region', { name: 'Your listing is live!', exact: true });
  await expect(hero).toBeVisible();
  await expect(hero.locator('.success-confetti')).toHaveCount(0);
  await expect(hero.locator('.listing-achievement')).toHaveCSS('animation-name', 'none');
  await expect(hero.getByRole('button', { name: 'List another item', exact: true })).toBeVisible();
  await expect(hero.getByRole('heading', { name: 'Your listing is live!' })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('listing-achievement-mobile.png'), fullPage: true });
  await hero.getByRole('button', { name: 'View listing', exact: true }).focus();
  await expect(hero.getByRole('button', { name: 'View listing', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${appUrl}/listing/${listingId}`);
});

test('pending approval does not claim a live listing or offer setup', async ({ page }) => {
  test.slow();
  await setup(page, { pendingApproval: true, readyDraft: true });
  await reviewReadyDraft(page);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Submitted for review' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your listing is live!', exact: true })).toHaveCount(0);
  await expect(page.locator('.success-confetti')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Allow rental offers' })).toHaveCount(0);
});

test('a publication review timeout keeps the draft saved and retries review rather than bypassing it', async ({ page }) => {
  const publications: unknown[] = [];
  page.on('request', request => {
    if (request.url().includes('/rpc/owner_save_listing_flow') && request.postDataJSON().p_publish) publications.push(request.postDataJSON());
  });
  await setup(page);
  await fillListing(page);
  await page.route('**/functions/v1/analyze-listing-photo', route => route.abort('failed'));
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  const error = page.getByRole('alert').filter({ hasText: 'Your listing has not been published' });
  await expect(error).toContainText('Your draft is saved.');
  await expect(error).toContainText('The listing review service could not be reached or took too long.');
  await expect(page.getByText('Your changes have not been saved', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toHaveCount(0);
  expect(publications).toHaveLength(0);
  await page.unroute('**/functions/v1/analyze-listing-photo');
  await page.getByRole('button', { name: 'Retry publication', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your listing is live!' })).toBeVisible();
  expect(publications).toHaveLength(1);
});

test('Share listing copies the URL and reports Copied only after clipboard success', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async (value: string) => { localStorage.setItem('test-copied-listing-url', value); } },
  }));
  await fillListing(page);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your listing is live!', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Share listing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('test-copied-listing-url'))).toBe(`${appUrl}/listing/${listingId}`);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('Clipboard permission denied'); } },
  }));
  await page.getByRole('button', { name: 'Copied!', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Share listing', exact: true })).toBeVisible();
  await expect(page.getByText('Could not copy the listing link. Open the listing to copy its URL.', { exact: true })).toBeVisible();
});

test('negotiation moves after publication and owner management restores the bidding schedule', async ({ page }, testInfo) => {
  test.slow();
  await page.clock.setFixedTime(new Date('2026-11-01T10:00:00Z'));
  const saves: Record<string, unknown>[] = [];
  const negotiationSaves: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.url().includes('/rpc/owner_save_listing_flow')) saves.push(request.postDataJSON().p_details);
    if (request.url().includes('/rpc/owner_configure_listing_negotiation')) negotiationSaves.push(request.postDataJSON());
  });
  await setup(page, { auctionSupported: true, readyDraft: true });
  await reviewReadyDraft(page);
  await openWizardStep(page, 'Price & pickup');
  await expect(page.getByRole('switch', { name: 'Enable competitive bidding' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Allow rental offers' })).toHaveCount(0);
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your listing is live!' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Enable competitive bidding' })).toBeEnabled();
  await page.getByRole('switch', { name: 'Allow rental offers' }).check();
  await page.getByLabel('Offer expires after (hours)', { exact: true }).fill('24');
  await page.getByRole('switch', { name: 'Enable competitive bidding' }).check();
  await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Choose a complete auction rental period inside your listing availability.' })).toBeVisible();
  for (const [label, date] of [['Auction pickup date', 'November 5, 2026'], ['Auction return date', 'November 8, 2026']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: new RegExp(date) }).click();
    await dialog.getByRole('button', { name: 'Apply date', exact: true }).click();
  }
  await page.getByLabel('Bidding opens (UTC)', { exact: true }).fill('2026-11-02T10:00');
  await page.getByLabel('Bidding closes (UTC)', { exact: true }).fill('2026-11-04T23:00');
  await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Close bidding at least 2 hours before rental pickup for owner selection and payment.' })).toBeVisible();
  expect(negotiationSaves).toHaveLength(0);
  await page.getByLabel('Bidding closes (UTC)', { exact: true }).fill('2026-11-04T22:00');
  await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
  await expect(page.getByText('Negotiation settings saved.', { exact: true })).toBeVisible();
  expect(saves.every(value => !('offer_preferences' in value) && !('auction_preferences' in value))).toBe(true);
  expect(negotiationSaves.at(-1)?.p_auction).toEqual({ enabled: true, start_date: '2026-11-05', end_date: '2026-11-08',
    bidding_starts_at: '2026-11-02T10:00:00Z', bidding_ends_at: '2026-11-04T22:00:00Z' });
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`post-publication-negotiation-${width}.png`), fullPage: true });
  }
  await page.goto(`${appUrl}/dashboard?tab=lending`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Negotiation options', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Enable competitive bidding' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Auction pickup date', exact: true })).toContainText('Nov 5, 2026');
  await expect(page.getByLabel('Bidding opens (UTC)', { exact: true })).toHaveValue('2026-11-02T10:00');
  await expect(page.getByRole('button', { name: 'Save negotiation options', exact: true })).toBeDisabled();
});

test('renter auction waits for scheduled opening, shows anonymous ranks and preserves retry keys', async ({ page }) => {
  test.slow();
  await setup(page);
  await page.routeWebSocket('**/realtime/v1/websocket**', socket => {
    socket.onMessage(message => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === 'phx_join') socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', {
        status: 'ok', response: { postgres_changes: payload.config.postgres_changes.map((filter: object) => ({ ...filter, id: 1 })) },
      }]));
      else if (event === 'heartbeat') socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
    });
  });
  await page.route('**/rest/v1/feature_flags*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([{ key: 'bidding', enabled: true }]),
  }));
  await page.route('**/rest/v1/listings*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ ...listing, auction_enabled: true }),
  }));
  const auction = {
    id: '60000000-0000-4000-8000-000000000001', listing_id: listingId, status: 'scheduled',
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    start_date: '2026-11-05', end_date: '2026-11-08', ends_at: new Date(Date.now() + 86400000).toISOString(),
    selection_deadline: new Date(Date.now() + 90000000).toISOString(), payment_deadline: null, server_now: new Date().toISOString(),
    minimum_next_bid: 40, top_bids: [{ id: '60000000-0000-4000-8000-000000000002', rank: 1, daily_rate: 35, bid_count: 1 }],
    my_bid_count: 0, my_daily_rate: null as number | null, my_booking_id: null, selected_bid_id: null, is_owner: false,
  };
  await page.route('**/rest/v1/rpc/get_listing_auction', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(auction) }));
  const attempts: { p_idempotency_key: string; p_daily_rate: number }[] = [];
  await page.route('**/rest/v1/rpc/place_listing_auction_bid', route => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) return route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Bid service unavailable' }),
    });
    auction.my_bid_count = 3; auction.my_daily_rate = 40; auction.minimum_next_bid = 45;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(auction) });
  });
  await page.goto(`${appUrl}/listing/${listingId}`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: 'Competitive bidding', exact: true });
  await expect(panel.getByText('Bidding opens in', { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(panel.getByRole('button', { name: 'Place bid', exact: true })).toHaveCount(0);
  auction.status = 'open'; auction.starts_at = new Date(Date.now() - 1000).toISOString();
  await expect(panel.getByText('Bidding ends in', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(panel.getByRole('list', { name: 'Anonymous top bids' })).toContainText('$35.00');
  const rate = panel.getByLabel('Your competitive bid per day (USD)', { exact: true });
  await rate.fill('40');
  await panel.getByRole('button', { name: 'Place bid', exact: true }).click();
  await expect(panel.getByText('Bid service unavailable', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Refresh bids', exact: true }).click();
  await panel.getByRole('button', { name: 'Place bid', exact: true }).click();
  await expect(panel.getByText('Your bids (3/3 used)', { exact: true })).toBeVisible();
  expect(attempts[0].p_idempotency_key).toBe(attempts[1].p_idempotency_key);
  expect(attempts[1].p_daily_rate).toBe(40);
  await expect(panel.getByRole('button', { name: 'Place bid', exact: true })).toBeDisabled();
});

test('Continue saves only valid current-step fields and typing never triggers a timed save', async ({ page }) => {
  const saves: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.url().includes('/rpc/owner_save_listing_flow')) saves.push(request.postDataJSON().p_details);
  });
  await setup(page);
  await fillListing(page);
  await openWizardStep(page, 'The item');
  const before = saves.length;
  await page.getByLabel('Give it a useful title', { exact: true }).fill('x');
  // Wait beyond the former 1.5-second autosave interval.
  await page.waitForTimeout(1800);
  expect(saves).toHaveLength(before);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review and edit item details', exact: true })).toBeVisible();
  expect(saves).toHaveLength(before);
  await page.getByLabel('Give it a useful title', { exact: true }).fill('Updated travel camera');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good terms make good rentals.', exact: true })).toBeVisible();
  expect(saves).toHaveLength(before + 1);
  expect(saves.at(-1)).toMatchObject({ title: 'Updated travel camera', description: listing.description });
  expect(saves.at(-1)).not.toHaveProperty('price_per_day');
  await page.route('**/rest/v1/rpc/owner_save_listing_flow', route => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Save service unavailable' }),
  }));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Save service unavailable', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Good terms make good rentals.', exact: true })).toBeVisible();
});

test('draft saving omits unsupported auction settings on hosted-compatible schemas', async ({ page }) => {
  const saves: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.url().includes('/rpc/owner_save_listing_flow')) saves.push(request.postDataJSON().p_details);
  });
  await setup(page, { rejectAuctionPreferences: true });
  await fillListing(page);
  await openWizardStep(page, 'Price & pickup');
  await expect(page.getByRole('switch', { name: 'Enable competitive bidding' })).toBeDisabled();
  await expect(page.getByText('Competitive bidding is not available on this server yet.', { exact: false })).toBeVisible();
  await page.getByLabel('Daily price (USD)', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  expect(saves.length).toBeGreaterThan(0);
  expect(saves.every(details => !('auction_preferences' in details))).toBe(true);
  expect(saves.at(-1)?.price_per_day).toBe(30);
  await expect(page.getByText('Unsupported listing changes', { exact: true })).toHaveCount(0);
});

test('rental settings keeps progress above the wide form when saving fails', async ({ page }, testInfo) => {
  await setup(page);
  await fillListing(page);
  await openWizardStep(page, 'Price & pickup');
  const form = page.getByRole('region', { name: 'Step 3: Price & pickup', exact: true });
  const progress = page.getByRole('list', { name: 'Listing progress' });
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const formBox = (await form.boundingBox())!;
    const progressBox = (await progress.boundingBox())!;
    expect(formBox.y).toBeGreaterThanOrEqual(progressBox.y + progressBox.height);
    expect(formBox.x).toBe(progressBox.x);
    expect(formBox.width).toBe(progressBox.width);
    const steps = await progress.locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().y));
    expect(new Set(steps).size).toBe(1);
    if (width >= 1024) expect(formBox.width).toBeGreaterThan(900);
  }
  await page.route('**/rest/v1/rpc/owner_save_listing_flow', route => route.fulfill({
    status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Unsupported listing changes' }),
  }));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Your changes have not been saved', { exact: true })).toBeVisible();
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const formBox = (await form.boundingBox())!;
    const errorBox = (await page.locator('.owner-listing-save-error').boundingBox())!;
    expect(formBox.x).toBe(errorBox.x);
    expect(formBox.width).toBe(errorBox.width);
    expect(formBox.y).toBeGreaterThanOrEqual(errorBox.y + errorBox.height);
    const progressBox = (await progress.boundingBox())!;
    expect(errorBox.y).toBeGreaterThanOrEqual(progressBox.y + progressBox.height);
    expect(formBox.x).toBe(progressBox.x);
    expect(formBox.width).toBe(progressBox.width);
    if (width >= 1024) expect(formBox.width).toBeGreaterThan(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`rental-settings-save-error-${width}.png`), fullPage: true });
  }
});

test('post-publication private offers validate limits, persist changes and report save failures', async ({ page }, testInfo) => {
  test.slow();
  const saves: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rpc/owner_configure_listing_negotiation')) saves.push(request.postDataJSON());
  });
  await setup(page, { readyDraft: true });
  await reviewReadyDraft(page);
  await expect(page.getByRole('switch', { name: 'Allow rental offers' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your listing is live!' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Allow rental offers' })).not.toBeChecked();
  await page.getByRole('switch', { name: 'Allow rental offers' }).check();
  const minimum = page.getByLabel('Minimum offer (% of daily price)', { exact: true });
  const maximum = page.getByLabel('Maximum offer (% of daily price)', { exact: true });
  await expect(minimum).toHaveValue('80');
  await expect(maximum).toHaveValue('110');
  await minimum.fill('79');
  await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
  await expect(page.getByText(/Keep the offer range between/)).toBeVisible();
  await minimum.fill('84');
  await maximum.fill('120');
  await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
  await expect(page.getByText(/Keep the offer range between/)).toContainText('$27.50');
  await maximum.fill('108');
  const expiration = page.getByLabel('Offer expires after (hours)', { exact: true });
  for (const invalid of ['', '0', '169', '1.5']) {
    await expiration.fill(invalid);
    await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Choose an offer expiry between 1 and 168 whole hours.' })).toBeVisible();
  }
  await expiration.fill('24');
  await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
  await expect(page.getByText('Negotiation settings saved.', { exact: true })).toBeVisible();
  const last = saves.at(-1)!;
  expect(last.p_offers).toMatchObject({ negotiation_enabled: true, offer_minimum_daily: 21, offer_maximum_daily: 27, offer_expiration_hours: 24 });
  await page.screenshot({ path: testInfo.outputPath('published-offers-desktop.png'), fullPage: true });
  for (const hours of [1, 168]) {
    await expiration.fill(String(hours));
    await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
    await expect(page.getByText('Negotiation settings saved.', { exact: true })).toBeVisible();
    expect(saves.at(-1)!.p_offers.offer_expiration_hours).toBe(hours);
  }
  await page.goto(`${appUrl}/dashboard?tab=lending`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Negotiation options', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Allow rental offers' })).toBeChecked();
  await expect(minimum).toHaveValue('84');
  await expect(maximum).toHaveValue('108');
  await expect(expiration).toHaveValue('168');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: testInfo.outputPath('published-offers-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('switch', { name: 'Allow rental offers' }).uncheck();
  await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
  await expect(page.getByText('Negotiation settings saved.', { exact: true })).toBeVisible();
  expect(saves.at(-1)!.p_offers).toMatchObject({ negotiation_enabled: false, offer_expiration_hours: null, offer_start_date: null, offer_end_date: null });
  await page.getByRole('switch', { name: 'Allow rental offers' }).check();
  await page.route('**/rest/v1/rpc/owner_configure_listing_negotiation', route => route.fulfill({ status: 403, json: { message: 'Offer preferences denied' } }));
  await page.getByRole('button', { name: 'Save negotiation options', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Offer preferences denied' })).toBeVisible();
  await expect(minimum).toHaveValue('84');
});

test('unapproved offer policy leaves post-publication private offers unavailable', async ({ page }) => {
  test.slow();
  await setup(page, { offersConfigured: false, readyDraft: true });
  await reviewReadyDraft(page);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your listing is live!' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Allow rental offers' })).toBeDisabled();
  await expect(page.getByText(/Offers are unavailable until an administrator/)).toBeVisible();
});

test('required item identity, included tags and delivery radius persist through all five steps and publication', async ({ page }, testInfo) => {
  test.slow();
  const saves: Record<string, unknown>[] = [];
  const reviews: { description: string }[] = [];
  page.on('request', request => {
    if (request.url().includes('/rpc/owner_save_listing_flow')) saves.push(request.postDataJSON().p_details);
    if (request.url().includes('/functions/v1/analyze-listing-photo')) reviews.push(request.postDataJSON());
  });
  await setup(page);
  await fillListing(page);
  await openWizardStep(page, 'Photos');
  const secondPhoto = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1000;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({ name: 'camera-side.png', mimeType: 'image/png', buffer: Buffer.from(secondPhoto, 'base64') });
  await expect(page.getByRole('button', { name: 'Select photo 2', exact: true })).toBeVisible();
  await openWizardStep(page, 'The item');
  await page.getByLabel('Brand (optional)', { exact: true }).fill('Sony');
  await page.getByLabel('Model (optional)', { exact: true }).fill('FX3');
  const included = page.getByLabel('Included item', { exact: true });
  await included.fill('Battery');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await included.fill('battery');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unique included items');
  await included.fill('Carrying case');
  await included.press('Enter');
  await page.getByLabel('Additional details (optional)', { exact: true }).fill('Charge the battery before use.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  expect(saves.at(-1)).toMatchObject({ item_details: { brand: 'Sony', model: 'FX3', included_items: ['Battery', 'Carrying case'], additional_details: 'Charge the battery before use.' } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForItemStep(page);
  await expect(page.getByLabel('Brand (optional)', { exact: true })).toHaveValue('Sony');
  await expect(page.getByLabel('Model (optional)', { exact: true })).toHaveValue('FX3');
  await expect(page.getByRole('list', { name: 'Included items' })).toContainText('Carrying case');
  await page.getByRole('button', { name: 'Remove included item Battery', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const map = page.getByTitle('Approximate pickup city', { exact: true });
  await expect(map).toHaveAttribute('src', /q=Irving%2C%20TX%2C%20US/);
  expect(await map.getAttribute('src')).not.toContain('123');
  await page.getByRole('switch', { name: 'Delivery available' }).check();
  await page.getByLabel('Delivery fee per trip (USD)', { exact: true }).fill('25');
  await selectWizardOption(page, 'Delivery radius (optional)', 'Within 25 miles');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const preview = page.locator('.owner-listing-review');
  for (const text of ['Sony', 'FX3', 'Carrying case', 'Charge the battery before use.', 'within 25 miles (owner-declared)']) await expect(preview).toContainText(text);
  await expect(preview).not.toContainText('123 Test Street');
  await page.getByRole('button', { name: 'Next preview photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview photo 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Previous preview photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview photo 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('six-step-item-details-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your listing is live!' })).toBeVisible();
  expect(saves.at(-1)).toMatchObject({ item_details: { delivery_radius_miles: 25, included_items: ['Carrying case'] } });
  expect(reviews.at(-1)!.description).toContain('Charge the battery before use.');
  await page.getByRole('button', { name: 'View listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: listing.title, exact: true })).toBeVisible({ timeout: 60000 });
  for (const text of ['Sony', 'FX3', 'Carrying case', 'Charge the battery before use.', '25 miles']) await expect(page.getByRole('main')).toContainText(text);
});

test('mobile listing draft resumes details and quantity without a deposit input', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const saves: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rpc/owner_save_listing_flow')) saves.push(request.postDataJSON().p_details);
  });
  await setup(page);
  await fillListing(page);
  await expect(page.getByLabel('Security deposit', { exact: true })).toHaveCount(0);
  await openWizardStep(page, 'Price & pickup');
  await expect(page.getByRole('button', { name: 'Decrease available quantity' })).toBeDisabled();
  await page.getByRole('button', { name: 'Increase available quantity' }).click();
  await page.getByRole('button', { name: 'Increase available quantity' }).click();
  await expect(page.getByRole('button', { name: 'Increase available quantity' })).toBeDisabled();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('switch', { name: 'Delivery available' }).check();
  const deliveryFee = page.getByLabel('Delivery fee per trip (USD)', { exact: true });
  for (const invalid of ['0', '0.99', '99.01', '100']) {
    await deliveryFee.fill(invalid);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('Enter a delivery fee between $1 and $99.').last()).toBeVisible();
  }
  for (const valid of ['1', '25', '99']) {
    await deliveryFee.fill(valid);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  }
  await deliveryFee.fill('25');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved. Resume it from My listings.', { exact: true })).toBeVisible();
  expect(saves.at(-1)).toMatchObject({ available_quantity: 3, delivery_available: true, delivery_fee: 25, estimated_value: 1000 });
  expect(saves.at(-1)).not.toHaveProperty('deposit');
  await page.screenshot({ path: testInfo.outputPath('rental-terms-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByText('Your saved draft is ready to continue.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Give it a useful title', { exact: true })).toHaveValue(listing.title);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Estimated replacement value (USD)', { exact: true })).toHaveValue('1000');
});

test('tablet photo drop retains failed files for retry and supports explicit draft reset', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await setup(page, { uploadFailsOnce: true });
  await page.goto(`${appUrl}/create-listing`);
  await expect(page.getByRole('button', { name: 'Add your cover photo' })).toBeVisible();
  await page.locator('[aria-label="Listing photos"]').evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1000;
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (character) => character.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], 'dropped-item.png', { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  });
  await expect(page.getByText('dropped-item.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry photo', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('photo-editor-tablet.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Reset form', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset form', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, reset', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add your cover photo' })).toBeVisible();
  await expect(page.getByText('Draft discarded. You can start again.')).toBeVisible();
});

test('renter booking calendar honors listing dates and discloses the actual deposit', async ({ page }) => {
  const start = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await setup(page, { listingStart: start, listingEnd: end });
  await page.goto(`${appUrl}/listing/${listingId}`);
  await expect(page.getByText('$50.00 refundable deposit', { exact: true })).toBeVisible();
  const lastAvailable = new Date(`${end}T12:00:00Z`);
  lastAvailable.setUTCDate(lastAvailable.getUTCDate() - 1);
  await expect(page.getByText(`Available ${start} through ${lastAvailable.toISOString().slice(0, 10)}. Return by ${end}. Your rental must fit within this window.`).first()).toBeVisible();
  await page.getByText('Rental dates', { exact: true }).locator('..').getByRole('button').click();
  const calendar = page.getByRole('dialog', { name: 'Choose rental dates' });
  await expect(calendar.getByRole('button', { name: 'Today', exact: true })).toBeDisabled();
  await expect(calendar.getByRole('button', { name: 'Tomorrow', exact: true })).toBeDisabled();
  await expect(calendar.getByRole('button', { name: /start date of selected range/ })).toBeEnabled();
  await expect(calendar.getByRole('button', { name: 'Use these dates', exact: true })).toBeEnabled();
});

for (const scenario of [{ publishFails: true }, { publishDraft: true }]) {
  test(`publication ${scenario.publishFails ? 'failure' : 'draft response'} never celebrates`, async ({ page }) => {
    await setup(page, scenario);
    await fillListing(page);
    await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
    await expect(page.getByText(scenario.publishFails ? 'Publication denied' : /backend has not confirmed publication/)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.success-card')).toHaveCount(0);
    await expect(page.locator('.success-confetti')).toHaveCount(0);
  });
}
});
