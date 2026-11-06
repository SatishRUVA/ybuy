import { expect, test, type Cookie, type Page } from '@playwright/test';
import { computeTotpForTest } from '../../api/_lib/access-session.js';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadTestActors, type TestActor } from './test-accounts';

type Actor = TestActor;
const hosted = process.env.YBUY_E2E_HOSTED === 'true';
const actors = loadTestActors(hosted);
const cliOptions = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
const hostedApiUrl = 'https://jzyjmsixfuwzfnntewqn.supabase.co';
const localApiUrl = 'http://localhost:54321';
const keys = hosted ? JSON.parse(execSync('pnpm exec supabase projects api-keys --project-ref jzyjmsixfuwzfnntewqn --output json', cliOptions)) as { name: string; api_key: string }[] : [];
const localStatus = hosted ? null : JSON.parse(execSync('node dev\\supabase-local.mjs status --output json', cliOptions));
if (localStatus && new URL(localStatus.API_URL).port !== '54321') throw new Error('Only the isolated local backend is allowed.');
const status = hosted ? {
  API_URL: hostedApiUrl,
  ANON_KEY: keys.find((key) => key.name === 'anon')?.api_key,
  SERVICE_ROLE_KEY: keys.find((key) => key.name === 'service_role')?.api_key,
} : { ...localStatus, API_URL: localApiUrl };
if (hosted && status.API_URL !== hostedApiUrl) throw new Error('Only the approved hosted test backend is allowed.');
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let diagnostics: { kind: string; detail: string }[] = [];
let gateCookies: Cookie[] | null = null;

async function unlockTestSite(page: Page) {
  if (!hosted || process.env.YBUY_E2E_LOCAL_APP === 'true') return;
  const app = 'https://ybuy-e2e-test.vercel.app';
  if ((await page.context().cookies(app)).some((cookie) => cookie.name === 'ybuy_access')) return;
  if (gateCookies) {
    await page.context().addCookies(gateCookies);
    return;
  }
  const secret = process.env.YBUY_E2E_GATE_SECRET;
  if (!secret) throw new Error('Set private YBUY_E2E_GATE_SECRET to obtain a real test-site authenticator session.');
  const response = await page.request.post(`${app}/api/access/verify`, {
    data: { code: await computeTotpForTest(secret) },
  });
  expect(response.status(), 'Real test-site authenticator verification').toBe(200);
  gateCookies = (await page.context().cookies(app)).filter((cookie) => cookie.name === 'ybuy_access');
  expect(gateCookies).toHaveLength(1);
}

test.beforeEach(async ({ page }) => {
  diagnostics = [];
  await unlockTestSite(page);
});
test.afterEach(async () => {
  await test.info().attach('browser-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
});

async function signIn(page: Page, actor: Actor) {
  await unlockTestSite(page);
  await page.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|images\.pexels\.com)\//, (route) => route.abort());
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', detail: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push({ kind: 'console', detail: message.text() });
  });
  page.on('requestfailed', (request) => diagnostics.push({
    kind: 'network', detail: `${request.method()} ${new URL(request.url()).origin}${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
  }));
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(actor.email);
  await dialog.getByLabel('Password', { exact: true }).fill(actor.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toHaveCount(0);
}

async function establishSession(page: Page, session: { access_token: string; refresh_token: string }) {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Sign in or create an account' })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async (tokens) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const { error } = await supabase.auth.setSession(tokens);
    if (error) throw error;
  }, session);
  await expect(page.getByRole('tab', { name: /^Renting(?: \d+)?$/ })).toBeVisible();
}

for (const actor of actors) {
  test(`${actor.email}: real UI sign-in, persisted session and sign-out`, async ({ page }) => {
    await signIn(page, actor);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: /^Renting(?: \d+)?$/ })).toBeVisible();
    await expect(page.locator('main .skeleton')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toContainText('Explore');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toContainText('Live bidding');
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'My rentals' })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: test.info().outputPath('signed-in.png') });
    await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Owner overview' }).click();
    await expect(page.locator('.workspace-owner-metrics > .workspace-metric')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'The next handoffs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gear with a second job' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('owner-dashboard.png') });
    await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'My listings' }).click();
    await expect(page).toHaveURL(/\/dashboard\/listings$/);
    await expect(page.getByRole('heading', { name: 'Your gear, working for you.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your inventory' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The next handoffs' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit listing' }).first()).toBeVisible();
    await expect(page.locator('.workspace-owner-metrics')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'My listings' })).toHaveAttribute('aria-current', 'page');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Your gear, working for you.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit listing' }).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('owner-listings.png') });
    await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Owner overview' }).click();
    await expect(page.locator('.workspace-owner-metrics > .workspace-metric')).toHaveCount(3);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('owner-dashboard-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'My rentals' }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('button', { name: 'Owner workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'My listings' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  });
}

for (let pair = 1; pair <= 5; pair++) {
test(`pair ${pair}: ${pair === 5 ? 'instant booking' : 'owner approval'} flow reaches payment-pending`, async ({ browser }) => {
  test.slow(true,'This scenario runs two independent authenticated browsers and checks every persisted booking transition.');
  const owner = actors.find((actor) => actor.email === `owner${pair}@example.test`)!;
  const renter = actors.find((actor) => actor.email === `renter${pair}@example.test`)!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const ownerApi = createClient(status.API_URL, status.ANON_KEY, options);
  const renterApi = createClient(status.API_URL, status.ANON_KEY, options);
  const ownerLogin = await ownerApi.auth.signInWithPassword(owner);
  const renterLogin = await renterApi.auth.signInWithPassword(renter);
  expect(ownerLogin.error).toBeNull();
  expect(renterLogin.error).toBeNull();
  const category = await ownerApi.from('categories').select('id').limit(1).single();
  expect(category.error).toBeNull();
  const availabilityStart = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const availabilityEnd = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const listingTitle = `Local E2E camera fixture ${pair} ${crypto.randomUUID()}`;
  const listing = await ownerApi.from('listings').insert({
    owner_id: owner.id, category_id: category.data!.id, title: listingTitle,
    description: 'Isolated lifecycle fixture, no real payment.', price_per_day: 10, deposit: 0,
    location_label: 'Dallas, TX', location_lat: 32.78, location_lng: -96.8, status: 'draft',
    availability_start: availabilityStart, availability_end: availabilityEnd,
    estimated_value:200,item_condition:'good',
    instant_booking: pair === 5,
  }).select('id,deposit,instant_booking').single();
  expect(listing.error).toBeNull();
  expect(listing.data!.instant_booking).toBe(pair === 5);
  const listingId = listing.data!.id;
  const ownerContext = await browser.newContext();
  const renterContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const renterPage = await renterContext.newPage();
  const imagePath = `${listingId}/synthetic-camera.png`;
  try {
    const image = await readFile(new URL('../../src/assets/offer-demo-camera.png', import.meta.url));
    expect((await ownerApi.storage.from('listing-images').upload(imagePath, image, { contentType: 'image/png' })).error).toBeNull();
    const imageUrl = ownerApi.storage.from('listing-images').getPublicUrl(imagePath).data.publicUrl;
    expect((await ownerApi.from('listing_images').insert({
      listing_id: listingId, url: imageUrl, sort_order: 0,
    })).error).toBeNull();
    expect((await ownerApi.from('listing_pickup_locations').insert({
      listing_id: listingId, owner_id: owner.id, address: 'Private test pickup', city: 'Dallas',
      state: 'TX', postal_code: '75201', country: 'US', latitude: 32.78, longitude: -96.8,
    })).error).toBeNull();
    const publication = await ownerApi.from('listings').update({ status: 'published' }).eq('id', listingId).select('status').single();
    expect(publication.error).toBeNull();
    expect(publication.data!.status).toBe('published');
    await establishSession(ownerPage, ownerLogin.data.session!);
    await establishSession(renterPage, renterLogin.data.session!);
    await renterPage.goto(`/search?q=${encodeURIComponent(listingTitle)}`, { waitUntil: 'domcontentloaded' });
    await expect(renterPage.locator(`a[href="/listing/${listingId}"]`)).toBeVisible({ timeout: 20_000 });
    const start = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    if (pair === 5) {
      await renterContext.route('**/functions/v1/**', async (route) => {
        if (!new URL(route.request().url()).pathname.endsWith('/create-checkout-session')) {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'http://localhost:5174/test-checkout' }),
        });
      });
    }
    await renterPage.goto(`/checkout/${listingId}?start=${start}&end=${end}`, { waitUntil: 'domcontentloaded' });
    await renterPage.getByRole('button', { name: 'Continue', exact: true }).click();
    await renterPage.getByRole('button', { name: 'Continue', exact: true }).click();
    await renterPage.getByRole('checkbox', { name: 'I have reviewed the dates, estimated cost, and rental terms.' }).check();
    const submitLabel = pair === 5 ? 'Continue to payment' : 'Send booking request';
    await renterPage.getByRole('button', { name: submitLabel, exact: true }).filter({ visible: true }).first().click();
    if (pair !== 5) await expect(renterPage.getByRole('heading', { name: 'Good plans are on their way.', exact: true })).toBeVisible();
    let instantBookingId: string | undefined;
    if (pair === 5) {
      await expect.poll(async () => {
        const result = await admin.from('bookings').select('id').eq('listing_id', listingId).maybeSingle();
        if (result.error) throw result.error;
        instantBookingId = result.data?.id;
        return Boolean(instantBookingId);
      }, { timeout: 20_000, message: 'Instant booking must persist before checkout redirects' }).toBe(true);
    }
    const bookingId = pair === 5 ? instantBookingId : new URL(renterPage.url()).pathname.split('/').pop()!;
    expect(bookingId).toBeTruthy();
    const booking = await renterApi.from('bookings').select('*').eq('id', bookingId).single();
    expect(booking.error).toBeNull();
    const initialStatus = pair === 5 ? 'pending_payment' : 'requested';
    expect(booking.data).toMatchObject({ owner_id: owner.id, renter_id: renter.id, status: initialStatus,
      booking_mode: pair === 5 ? 'instant' : 'owner_approval', subtotal: 20, deposit: listing.data!.deposit });
    const ownerNotification = await ownerApi.from('notifications').select('id,title').eq('event_key',
      pair === 5 ? `booking:${bookingId}:instant:${owner.id}` : `booking:${bookingId}:requested:${owner.id}`).single();
    expect(ownerNotification.error).toBeNull();
    expect(ownerNotification.data!.title).toBe(pair === 5 ? 'Instant booking received' : 'New booking request');
    const invalidDates = await renterApi.rpc('create_booking_request', { p_listing_id: listingId, p_start_date: end, p_end_date: start });
    expect(invalidDates.error).not.toBeNull();
    const duplicate = await renterApi.rpc('create_booking_request', { p_listing_id: listingId, p_start_date: start, p_end_date: end });
    expect(duplicate.error).not.toBeNull();
    await renterPage.screenshot({ path: test.info().outputPath('renter-request.png') });
    const unauthorized = await renterApi.rpc('respond_to_booking_request', { p_booking_id: bookingId, p_approve: true });
    expect(unauthorized.error).not.toBeNull();
    if (pair !== 5) {
      await ownerPage.goto('/dashboard?tab=lending', { waitUntil: 'domcontentloaded' });
      const queue = ownerPage.getByRole('region', { name: /^Waiting on you/ });
      const card = queue.locator('div.p-4').filter({ hasText: listingTitle })
        .filter({ has: ownerPage.getByRole('button', { name: 'Accept request', exact: true }) });
      await expect(card).toHaveCount(1);
      await card.getByRole('button', { name: 'Accept request', exact: true }).click();
      await expect(card).toHaveCount(0);
    }
    await expect.poll(async () => {
      const result = await renterApi.from('bookings').select('status').eq('id', bookingId).single();
      if (result.error) throw result.error;
      return result.data.status;
    }).toBe('pending_payment');
    if (pair !== 5) {
      await renterPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(renterPage.getByRole('heading', { name: 'Your booking', exact: true })).toBeVisible();
      await expect(renterPage.getByText('Booking confirmed', { exact: true })).toHaveCount(0);
    }
    await renterPage.screenshot({ path: test.info().outputPath('renter-approved-awaiting-payment.png') });
    const renterNotification = await renterApi.from('notifications').select('id,title').eq('event_key', `booking:${bookingId}:pending_payment:${renter.id}`).single();
    expect(renterNotification.error).toBeNull();
    expect(renterNotification.data!.title).toBe(pair === 5 ? 'Instant booking - payment needed' : 'Complete your booking payment');
    const prematureHandoff = await ownerApi.rpc('mark_booking_active', { p_booking_id: bookingId });
    expect(prematureHandoff.error).not.toBeNull();
    const cancellation = await renterApi.rpc('cancel_booking', { p_booking_id: bookingId });
    expect(cancellation.error).toBeNull();
    expect(cancellation.data.status).toBe('cancelled');
    const releasedDates = await renterApi.rpc('create_booking_request', { p_listing_id: listingId, p_start_date: start, p_end_date: end });
    expect(releasedDates.error).toBeNull();
    if (pair === 5) {
      expect(releasedDates.data.status).toBe('pending_payment');
      expect((await renterApi.rpc('cancel_booking', { p_booking_id: releasedDates.data.id })).error).toBeNull();
    } else {
      const decline = await ownerApi.rpc('respond_to_booking_request', { p_booking_id: releasedDates.data.id, p_approve: false });
      expect(decline.error).toBeNull();
      expect(decline.data.status).toBe('rejected');
    }
    test.info().annotations.push({ type: 'coverage', description: 'Checkout session is mocked in this test. Real Stripe payment/webhook, pickup, return and completed-review lifecycle are not covered.' });
  } finally {
    const fixtureBookings = await admin.from('bookings').select('id').eq('listing_id', listingId);
    expect(fixtureBookings.error).toBeNull();
    const agreementRows = [];
    for (const booking of fixtureBookings.data ?? []) {
      const agreement = await admin.from('rental_agreements').select('id,booking_id').eq('booking_id', booking.id).maybeSingle();
      expect(agreement.error).toBeNull();
      if (agreement.data) agreementRows.push(agreement.data);
    }
    if (agreementRows.length) {
      for(const booking of fixtureBookings.data??[]){
        const state=await renterApi.from('bookings').select('status').eq('id',booking.id).single();
        expect(state.error).toBeNull();
        if(['requested','pending_payment'].includes(state.data!.status)){
          expect((await renterApi.rpc('cancel_booking',{p_booking_id:booking.id})).error).toBeNull();
        }
      }
      expect((await ownerApi.from('listings').update({status:'draft'}).eq('id',listingId)).error).toBeNull();
      await test.info().attach('retained-immutable-fixture',{
        body:JSON.stringify({listingId,bookings:fixtureBookings.data,agreementIds:agreementRows.map(agreement=>agreement.id)}),
        contentType:'application/json',
      });
    }else{
      for(const booking of fixtureBookings.data??[]){
        for(const table of ['notifications','notification_email_jobs']){
          const deleted=await admin.from(table).delete().like('event_key',`booking:${booking.id}:%`);
          expect(deleted.error,`${table} fixture cleanup`).toBeNull();
        }
      }
      const bookings = await admin.from('bookings').delete().eq('listing_id', listingId);
      expect(bookings.error, 'Lifecycle booking fixture cleanup').toBeNull();
      const removed = await admin.from('listings').delete().eq('id', listingId);
      expect(removed.error, 'Lifecycle listing fixture cleanup').toBeNull();
      expect((await admin.storage.from('listing-images').remove([imagePath])).error).toBeNull();
    }
    await ownerApi.auth.signOut({ scope: 'local' });
    await renterApi.auth.signOut({ scope: 'local' });
    await ownerContext.close();
    await renterContext.close();
  }
});
}

test('invalid password is rejected in the real sign-in UI', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(actors[0].email);
  await dialog.getByLabel('Password', { exact: true }).fill('not-the-valid-password');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not sign in');
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveValue('');
});

for (const persona of ['Owner', 'Renter']) {
  test(`E2E-00${persona === 'Owner' ? 1 : 2}: register a new ${persona} through local UI`, async ({ page }) => {
    test.skip(hosted, 'Hosted signup is verified separately using real Resend confirmation links; local auto-confirm assertions do not apply.');
    const email = `registration-${persona.toLowerCase()}-${crypto.randomUUID()}@example.test`;
    try {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Sign in or create an account' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'New to YBuy? Create an account' }).click();
      await dialog.getByLabel('Full name', { exact: true }).fill(`Registration Test ${persona}`);
      await dialog.getByLabel('Email', { exact: true }).fill(email);
      await dialog.getByLabel('Password', { exact: true }).fill(`Yb!${crypto.randomUUID()}`);
      await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const registered = await admin.from('profiles').select('id,full_name').eq('email', email).single();
      expect(registered.error).toBeNull();
      expect(registered.data!.full_name).toBe(`Registration Test ${persona}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'Sign in or create an account' })).toHaveCount(0);
    } finally {
      const profile = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
      expect(profile.error).toBeNull();
      if (profile.data) {
        const deletion = await admin.auth.admin.deleteUser(profile.data.id);
        expect(deletion.error, 'Temporary registration account cleanup').toBeNull();
      }
    }
  });
}
