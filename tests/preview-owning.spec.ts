import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';
import { appUrl } from './test-url';
test.setTimeout(90_000);

const ownerId = '10000000-0000-4000-8000-000000000001';
const renterId = '10000000-0000-4000-8000-000000000002';
const listingId = '30000000-0000-4000-8000-000000000001';
const categoryId = '20000000-0000-4000-8000-000000000001';
const bookingId = '40000000-0000-4000-8000-000000000001';
const listing = {
  id: listingId, owner_id: ownerId, category_id: categoryId, revision: 1, status: 'published',
  title: 'Real owner camera', description: 'Camera with a carrying case and charger.',
  price_per_day: 25, deposit: 50, estimated_value: 200, item_condition: 'good',
  available_quantity: 1, instant_booking: false, delivery_available: false, delivery_fee: 0,
  availability_start: '2026-11-01', availability_end: '2026-11-30',
  location_label: 'Dallas, TX', location_lat: 32.8, location_lng: -96.8,
  created_at: '2026-10-01T00:00:00Z', listing_images: [],
  owner: { id: ownerId, full_name: 'Real Owner', avatar_url: null }, categories: { name: 'Electronics' },
};
const booking = {
  id: bookingId, listing_id: listingId, owner_id: ownerId, renter_id: renterId,
  start_date: '2026-11-02', end_date: '2026-11-05', status: 'requested', quantity: 1,
  days: 3, daily_rate: 25, subtotal: 75, deposit: 50, total: 132.5,
  service_fee_amount: 7.5, insurance_amount: 0, created_at: '2026-11-01T00:00:00Z',
  owner: listing.owner, renter: { id: renterId, full_name: 'Real Renter', avatar_url: null },
  listing: { id: listingId, title: listing.title, listing_images: [] },
};

async function setup(page: Page, options: { failDecision?: boolean; failMessageOnce?: boolean; failAvailability?: boolean; failDatesOnce?: boolean; paid?: boolean; draft?: boolean; complete?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  let listingStatus = options.draft ? 'draft' : 'published';
  let bookingStatus = options.paid ? 'completed' : 'requested';
  let messageAttempts = 0;
  let dateReads = 0;
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
  await page.route(`${appUrl}/owner-surface-test`, route => route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/src/index.css"><link rel="stylesheet" href="/src/styles/preview-one.css"></head><body></body></html>' }));
  await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
  await page.route('**/src/auth-context.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `const auth={user:{id:"${ownerId}"},profile:{id:"${ownerId}",full_name:"Real Owner"},openSignIn(){}}; export function useAuth(){return auth} export const AuthProvider=({children})=>children;` }));
  await page.route('**/src/router.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function useRouter(){return {route:{name:"owner-dashboard"},navigate(){}}} export const RouterProvider=({children})=>children;' }));
  await page.route('**/src/location-context.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: 'const location={city:"Dallas",state:"TX",country:"US",source:"USER_SELECTED",latitude:32.8,longitude:-96.8}; export function useMarketplaceLocation(){return {location,requestBrowserLocation:async()=>location}}' }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('http://localhost:54321/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': appUrl, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let body: unknown = [];
    let status = 200;
    if (path.endsWith('/listings')) {
      const query = new URL(request.url()).searchParams;
      if (request.method() === 'PATCH') { writes.push(request.postDataJSON()); listingStatus = request.postDataJSON().status; }
      const row = { ...listing, status: listingStatus, listing_images: options.complete ? [{ url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"></svg>', sort_order: 0 }] : [] };
      body = query.get('select') === 'id' ? listingStatus === 'archived' ? [{ id: listingId }] : []
        : query.get('status') === 'neq.archived' && listingStatus === 'archived' ? []
          : request.headers().accept?.includes('vnd.pgrst.object') ? row : [row];
    }
    else if (path.endsWith('/bookings')) body = [{ ...booking, subtotal: options.paid ? 75.25 : 75, status: bookingStatus }];
    else if (path.endsWith('/categories')) body = [{ id: categoryId, name: 'Electronics', icon: 'Camera', active: true }];
    else if (path.endsWith('/get_listing_unavailable_dates')) {
      dateReads += 1;
      status = options.failDatesOnce && dateReads === 1 ? 503 : 200;
      body = status === 503 ? { message: 'Availability verification unavailable' } : { booked: ['2026-11-02'], blocked: [] };
    }
    else if (path.endsWith('/app_settings')) body = { value: ['US'] };
    else if (path.endsWith('/reference_countries')) body = [{ code: 'US', name: 'United States' }];
    else if (path.endsWith('/respond_to_booking_request')) {
      writes.push(request.postDataJSON());
      status = options.failDecision ? 503 : 200;
      if (!options.failDecision) bookingStatus = request.postDataJSON().p_approve ? 'pending_payment' : 'rejected';
      body = options.failDecision ? { message: 'Approval backend unavailable' } : { ...booking, status: bookingStatus };
    } else if (path.endsWith('/rental_settlements')) body = [{ booking_id: bookingId, owner_amount: options.paid ? 75.25 : 75, transfer_status: 'succeeded', transfer_confirmed_at: '2026-11-01T12:00:00Z' }];
    else if (path.endsWith('/owner-payout-status')) body = { connected: true, payouts: [{ id: 'po_verified', amount: 7500, currency: 'usd', status: 'paid', arrival_date: 1793534400, created: 1793534400, failure_code: null, method: 'standard', type: 'bank_account' }] };
    else if (path.endsWith('/get_listing_flow_policy')) body = { listing_duration_days: 30, max_quantity: 10, max_photos: 6, max_photo_bytes: 5242880, min_photo_dimension: 500, max_delivery_fee: 99, max_estimated_value: 100000, deposit_rules: [] };
    else if (path.endsWith('/listing_pickup_locations')) body = options.complete ? [{ address: '123 Main Street, Dallas, TX 75201, US', street_address: '123 Main Street', city: 'Dallas', state: 'TX', postal_code: '75201', country: 'US', latitude: 32.8, longitude: -96.8, place_id: '' }] : null;
    else if (path.endsWith('/owner_save_listing_availability')) {
      writes.push(request.postDataJSON());
      status = options.failAvailability ? 409 : 200;
      body = options.failAvailability ? { message: 'Reserved rental day cannot be blocked' }
        : { revision: 2, status: listingStatus, deposit: 50, blocked: request.postDataJSON().p_blocked };
    }
    else if (path.endsWith('/conversations')) body = [{ id: '50000000-0000-4000-8000-000000000001' }];
    else if (path.endsWith('/messages') && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      messageAttempts += 1;
      status = options.failMessageOnce && messageAttempts === 1 ? 503 : 200;
      body = status === 503 ? { message: 'Message delivery unavailable' }
        : { ...request.postDataJSON(), id: '60000000-0000-4000-8000-000000000001', created_at: '2026-11-01T12:00:00Z' };
    }
    else if (path.endsWith('/owner_save_listing_flow')) {
      writes.push(request.postDataJSON());
      body = { revision: 2, status: options.draft ? 'draft' : 'published', deposit: 50 };
    }
    return route.fulfill({ status, headers, json: body });
  });
  await page.goto(`${appUrl}/owner-surface-test`);
  return writes;
}

async function mount(page: Page, name: string, props: Record<string, unknown> = {}) {
  await page.evaluate(async ({ name, props }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const { mountComponent, createElement } = await import('/tests/component-mount.tsx');
    const surfaces = await import('/src/components/preview-owning.tsx');
    mountComponent('div', { className: 'p1', children: createElement(surfaces[name], props) });
  }, { name, props });
}

test('actual owner template reads owned backend rows and never approves a failed request', async ({ page }) => {
  const writes = await setup(page, { failDecision: true });
  await mount(page, 'PreviewOwner');
  const main = page.locator('main.p1-work-page');
  await expect(main.locator(':scope > .p1-page-head')).toBeVisible();
  await expect(main.locator(':scope > .p1-owner-metrics > div')).toHaveCount(3);
  await expect(main.locator('.p1-request-queue > article')).toContainText('Real Renter');
  await expect(main.locator('.p1-owner-listings > article.p1-owner-item > .p1-owner-item-body')).toContainText('Real owner camera');
  await expect(main.locator('.p1-owner-metrics')).toContainText('$0');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Approval backend unavailable');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(page.getByText('Approved · payment next', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([{ p_booking_id: bookingId, p_approve: true }]);
  await expect(page.locator('.p1-owner-item img')).toHaveCount(0);
});

test('native payout table uses owner share, verified transfer and bank statuses', async ({ page }) => {
  await setup(page, { paid: true });
  await mount(page, 'PreviewPayouts');
  const main = page.locator('main.p1-work-page');
  await expect(main.locator(':scope > .p1-owner-metrics > div')).toHaveCount(3);
  await expect(main.locator(':scope > .p1-data-list > article')).toContainText('Real owner camera');
  await expect(main.locator(':scope > .p1-data-list > article > strong')).toHaveText('$75.25');
  await expect(main.locator('.p1-owner-metrics')).not.toContainText('132');
  await expect(main.getByText('Transferred to Stripe', { exact: true })).toHaveCount(2);
  await expect(main.locator('section')).toContainText('paid');
  await expect(main.getByText('No money moves in this preview')).toHaveCount(0);
});

test('paused inventory remains visible and resumes only after backend confirmation', async ({ page }) => {
  const writes = await setup(page);
  await mount(page, 'PreviewOwner', { listingView: true });
  const item = page.locator('.p1-owner-item').filter({ hasText: listing.title });
  await item.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Paused', exact: true }).click();
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  expect(writes).toEqual([{ status: 'archived' }, { status: 'published' }]);
});

test('native listing wizard shell saves through revision-aware flow and retains full controls', async ({ page }) => {
  const writes = await setup(page, { draft: true });
  await mount(page, 'PreviewListingWizard', { editId: listingId });
  const main = page.locator('main.p1-container.p1-page');
  await expect(main.getByRole('list', { name: 'Listing progress' }).getByRole('listitem')).toHaveCount(5);
  await expect(main.getByRole('heading', { name: 'Tell us about your item.', exact: true })).toBeVisible();
  await expect(main.getByRole('complementary', { name: 'Listing preview' }).getByRole('heading', { name: 'Real owner camera' })).toHaveText('Real owner camera');
  await expect(main.getByRole('combobox', { name: 'Category' })).toContainText('Electronics');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved. Resume it from My listings.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ p_listing_id: listingId, p_revision: 1, p_publish: false, p_details: { title: listing.title, category_id: categoryId } });
  await expect(page.getByRole('radio', { name: 'Good', exact: true })).toBeChecked();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a sample photo', exact: true })).toHaveCount(0);
});

test('native wizard rejects missing photos and invalid uploads without publication', async ({ page }) => {
  const writes = await setup(page, { draft: true });
  await mount(page, 'PreviewListingWizard', { editId: listingId });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Show its best side.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText(/photo/i);
  await expect(page.getByRole('heading', { name: 'Show its best side.', exact: true })).toBeVisible();
  await page.getByLabel('Upload listing photos').setInputFiles({ name: 'not-a-photo.txt', mimeType: 'text/plain', buffer: Buffer.from('Not an image') });
  await expect(page.getByRole('status').filter({ hasText: 'not-a-photo.txt' })).toContainText('Choose JPEG, PNG, or WebP.');
  expect(writes).toHaveLength(1);
  expect(writes[0].p_publish).toBe(false);
  await expect(page.locator('.p1-upload-grid img')).toHaveCount(0);
});

test('native photo step matches the supplied upload layout at desktop and mobile widths', async ({ page }, testInfo) => {
  await setup(page, { draft: true });
  await page.setViewportSize({ width: 1248, height: 1000 });
  await mount(page, 'PreviewListingWizard', { editId: listingId });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const region = page.getByRole('region', { name: 'Step 2: Photos' });
  const upload = region.getByRole('button', { name: 'Add your cover photo', exact: true });
  await expect(upload).toHaveClass(/p1-upload/);
  await expect(upload).toContainText('Choose photos');
  await expect(upload).toContainText('JPEG, PNG or WebP · up to 5 MB each');
  await expect(page.getByRole('complementary', { name: 'Listing preview' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add a sample photo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add supporting photo 1', exact: true })).toHaveCount(0);
  const uploadBounds = await upload.boundingBox();
  expect(uploadBounds!.width).toBeGreaterThan(850);
  expect(uploadBounds!.height).toBeGreaterThanOrEqual(150);
  await expect(upload).toHaveCSS('background-color', 'rgb(247, 246, 241)');
  await expect(upload).toHaveCSS('border-top-width', '0px');
  const back = region.getByRole('button', { name: 'Back', exact: true });
  await expect(back).toHaveClass(/p1-button-secondary/);
  await expect(back.locator('svg')).toHaveCount(0);
  await expect(region.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible();
  await expect(region.getByRole('button', { name: 'Continue', exact: true })).toHaveClass(/p1-button-primary/);
  for (const width of [1248, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(upload).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`photo-step-${width}.png`), fullPage: true });
  }
});

test('native owner calendar locks booked days and saves via the listing flow', async ({ page }) => {
  const writes = await setup(page);
  await mount(page, 'PreviewOwner', { listingView: true });
  await page.getByRole('button', { name: 'Availability', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.p1-availability')).toBeVisible();
  await dialog.getByRole('button', { name: 'Block individual days', exact: true }).click();
  await expect(dialog.locator('button[data-day="2026-11-02"]')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Save availability', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ p_listing_id: listingId, p_revision: 1, p_start: '2026-11-01', p_end: '2026-11-30', p_blocked: [] });
});

test('native wizard keeps complete pricing, protected calendars and review terms inline', async ({ page }) => {
  await setup(page, { draft: true, complete: true });
  await mount(page, 'PreviewListingWizard', { editId: listingId });
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await next.click();
  await expect(page.getByRole('heading', { name: 'Show its best side.', exact: true })).toBeVisible();
  await next.click();
  await expect(page.getByLabel('Daily price (USD)')).toHaveValue('25');
  await expect(page.getByLabel('Estimated replacement value (USD)')).toHaveValue('200');
  await expect(page.getByRole('region', { name: 'Pickup and delivery settings' })).toContainText('123 Main Street');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await next.click();
  await expect(page.getByRole('region', { name: 'Listing availability', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Block unavailable days' })).toBeVisible();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator('.owner-listing-review')).toContainText('Refundable deposit');
  await expect(page.locator('.owner-listing-review')).toContainText('$50.00');
  await expect(page.locator('.owner-listing-review')).not.toContainText('123 Main Street');
  await expect(page.getByRole('button', { name: 'Publish listing', exact: true })).toBeVisible();
});

test('native wizard can recover a failed availability lookup without losing navigation', async ({ page }) => {
  await setup(page, { draft: true, complete: true, failDatesOnce: true });
  await mount(page, 'PreviewListingWizard', { editId: listingId });
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  for (const heading of ['Show its best side.', 'Good terms make good rentals.', 'Choose availability']) {
    await next.click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  const blocked = page.getByRole('region', { name: 'Block unavailable days' });
  await expect(blocked).toContainText('Availability verification unavailable');
  await expect(next).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
  await blocked.getByRole('button', { name: 'Reload dates', exact: true }).click();
  await expect(next).toBeEnabled();
  await expect(blocked.getByRole('alert')).toHaveCount(0);
  await next.click();
  await expect(page.getByRole('heading', { name: 'Ready for its second job.', exact: true })).toBeVisible();
});

test('native wizard saves edits before revisiting reached steps', async ({ page }) => {
  const writes = await setup(page, { draft: true, complete: true });
  await mount(page, 'PreviewListingWizard', { editId: listingId });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Show its best side.', exact: true })).toBeVisible();
  const steps = page.getByRole('navigation', { name: 'Listing progress' });
  await steps.getByRole('button', { name: /The item/ }).click();
  await page.getByLabel('Give it a useful title', { exact: true }).fill('Updated owner camera');
  await steps.getByRole('button', { name: /Photos/ }).click();
  await expect(page.getByRole('heading', { name: 'Show its best side.', exact: true })).toBeVisible();
  expect(writes.at(-1)?.p_details).toMatchObject({ title: 'Updated owner camera' });
  await steps.getByRole('button', { name: /The item/ }).click();
  await expect(page.getByLabel('Give it a useful title', { exact: true })).toHaveValue('Updated owner camera');
});

test('native decline reason is validated and persisted to the supported booking conversation', async ({ page }) => {
  const writes = await setup(page);
  await mount(page, 'PreviewOwner');
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await page.getByLabel('Reason for declining').fill('I will be away during these dates.');
  await page.getByRole('button', { name: 'Decline request', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.p1-request-queue > article')).toContainText('rejected');
  expect(writes).toEqual([
    { p_booking_id: bookingId, p_approve: false },
    { conversation_id: '50000000-0000-4000-8000-000000000001', sender_id: ownerId, body: 'I will be away during these dates.' },
  ]);
});

test('native availability failure retains the dialog without claiming a saved update', async ({ page }) => {
  const writes = await setup(page, { failAvailability: true });
  await mount(page, 'PreviewOwner', { listingView: true });
  await page.getByRole('button', { name: 'Availability', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.p1-availability')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save availability', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Reserved rental day cannot be blocked');
  await expect(page.getByText('Availability saved.', { exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ p_listing_id: listingId, p_start: '2026-11-01', p_end: '2026-11-30', p_blocked: [] });
});

test('failed decline reason retries only the message after the confirmed decline', async ({ page }) => {
  const writes = await setup(page, { failMessageOnce: true });
  await mount(page, 'PreviewOwner');
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await page.getByLabel('Reason for declining').fill('I am away during these dates.');
  await page.getByRole('button', { name: 'Decline request', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Request already declined. Only the reason failed to send');
  await expect(page.locator('.p1-request-queue')).toContainText('rejected');
  await dialog.getByRole('button', { name: 'Decline request', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.filter(write => 'p_approve' in write)).toHaveLength(1);
  expect(writes.filter(write => 'conversation_id' in write)).toHaveLength(2);
});
