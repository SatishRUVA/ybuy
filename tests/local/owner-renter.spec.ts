import { expect, test, type Cookie, type Page } from '@playwright/test';
import { computeTotpForTest } from '../../api/_lib/access-session.js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

interface Actor { email: string; password: string; id: string; name: string }
const hosted = process.env.YBUY_E2E_HOSTED === 'true';
const actors: Actor[] = JSON.parse(readFileSync(hosted ? 'ybuy-hosted-test-accounts.local' : 'ybuy-test-accounts.local', 'utf8')).accounts;
const cliOptions = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
const keys = hosted ? JSON.parse(execSync('npx supabase projects api-keys --project-ref jzyjmsixfuwzfnntewqn --output json', cliOptions)) as { name: string; api_key: string }[] : [];
const status = hosted ? {
  API_URL: 'https://jzyjmsixfuwzfnntewqn.supabase.co',
  ANON_KEY: keys.find((key) => key.name === 'anon')?.api_key,
  SERVICE_ROLE_KEY: keys.find((key) => key.name === 'service_role')?.api_key,
} : JSON.parse(execSync('npx supabase status --output json', cliOptions));
if (!['http://127.0.0.1:54321', 'https://jzyjmsixfuwzfnntewqn.supabase.co'].includes(status.API_URL)) throw new Error('Only isolated test backends are allowed.');
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let diagnostics: { kind: string; detail: string }[] = [];
let gateCookies: Cookie[] | null = null;

async function unlockTestSite(page: Page) {
  if (!hosted) return;
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

for (const actor of actors) {
  test(`${actor.email}: real UI sign-in, persisted session and sign-out`, async ({ page }) => {
    await signIn(page, actor);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: /^Renting(?: \d+)?$/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('signed-in.png') });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  });
}

for (let pair = 1; pair <= 5; pair++) {
test(`pair ${pair}: publication API fixture → UI request → UI approval → payment-pending`, async ({ browser }) => {
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
  const listing = await ownerApi.from('listings').insert({
    owner_id: owner.id, category_id: category.data!.id, title: 'Local E2E camera fixture',
    description: 'Isolated lifecycle fixture, no real payment.', price_per_day: 10, deposit: 0,
    location_label: 'Dallas, TX', location_lat: 32.78, location_lng: -96.8, status: 'draft',
    estimated_value:200,item_condition:'good',
  }).select('id').single();
  expect(listing.error).toBeNull();
  const listingId = listing.data!.id;
  const ownerContext = await browser.newContext();
  const renterContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const renterPage = await renterContext.newPage();
  try {
    const publication = await ownerApi.from('listings').update({ status: 'published' }).eq('id', listingId).select('status').single();
    expect(publication.error).toBeNull();
    expect(publication.data!.status).toBe('published');
    await signIn(ownerPage, owner);
    await signIn(renterPage, renter);
    await renterPage.goto(`/search?q=Local%20E2E%20camera%20fixture`, { waitUntil: 'domcontentloaded' });
    await expect(renterPage.locator(`a[href="/listing/${listingId}"]`)).toBeVisible({ timeout: 20_000 });
    const start = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    await renterPage.goto(`/checkout/${listingId}?start=${start}&end=${end}`, { waitUntil: 'domcontentloaded' });
    await renterPage.getByRole('button', { name: 'Send booking request', exact: true }).filter({ visible: true }).click();
    await expect(renterPage.getByRole('heading', { name: 'Request sent', exact: true })).toBeVisible();
    const bookingId = new URL(renterPage.url()).pathname.split('/').pop()!;
    const booking = await renterApi.from('bookings').select('*').eq('id', bookingId).single();
    expect(booking.error).toBeNull();
    expect(booking.data).toMatchObject({ owner_id: owner.id, renter_id: renter.id, status: 'requested', subtotal: 20, deposit: 0 });
    const ownerNotification = await ownerApi.from('notifications').select('id,title').eq('event_key', `booking:${bookingId}:requested:${owner.id}`).single();
    expect(ownerNotification.error).toBeNull();
    expect(ownerNotification.data!.title).toBe('New booking request');
    const invalidDates = await renterApi.rpc('create_booking_request', { p_listing_id: listingId, p_start_date: end, p_end_date: start });
    expect(invalidDates.error).not.toBeNull();
    const duplicate = await renterApi.rpc('create_booking_request', { p_listing_id: listingId, p_start_date: start, p_end_date: end });
    expect(duplicate.error).not.toBeNull();
    await renterPage.screenshot({ path: test.info().outputPath('renter-request.png') });
    const unauthorized = await renterApi.rpc('respond_to_booking_request', { p_booking_id: bookingId, p_approve: true });
    expect(unauthorized.error).not.toBeNull();
    await ownerPage.goto('/dashboard?tab=lending', { waitUntil: 'domcontentloaded' });
    await ownerPage.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect.poll(async () => {
      const result = await renterApi.from('bookings').select('status').eq('id', bookingId).single();
      if (result.error) throw result.error;
      return result.data.status;
    }).toBe('pending_payment');
    await renterPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(renterPage.getByText('Payment is not confirmed yet', { exact: true })).toBeVisible();
    await renterPage.screenshot({ path: test.info().outputPath('renter-approved-awaiting-payment.png') });
    const renterNotification = await renterApi.from('notifications').select('id,title').eq('event_key', `booking:${bookingId}:pending_payment:${renter.id}`).single();
    expect(renterNotification.error).toBeNull();
    expect(renterNotification.data!.title).toBe('Complete your booking payment');
    const prematureHandoff = await ownerApi.rpc('mark_booking_active', { p_booking_id: bookingId });
    expect(prematureHandoff.error).not.toBeNull();
    const cancellation = await renterApi.rpc('cancel_booking', { p_booking_id: bookingId });
    expect(cancellation.error).toBeNull();
    expect(cancellation.data.status).toBe('cancelled');
    const releasedDates = await renterApi.rpc('create_booking_request', { p_listing_id: listingId, p_start_date: start, p_end_date: end });
    expect(releasedDates.error).toBeNull();
    const decline = await ownerApi.rpc('respond_to_booking_request', { p_booking_id: releasedDates.data.id, p_approve: false });
    expect(decline.error).toBeNull();
    expect(decline.data.status).toBe('rejected');
    test.info().annotations.push({ type: 'blocked', description: 'Real Stripe sandbox payment/webhook not configured; pickup, return and completed-review lifecycle not claimed.' });
  } finally {
    const fixtureBookings = await admin.from('bookings').select('id').eq('listing_id', listingId);
    expect(fixtureBookings.error).toBeNull();
    const agreements=await admin.from('rental_agreements').select('id').in('booking_id',(fixtureBookings.data??[]).map(booking=>booking.id));
    expect(agreements.error).toBeNull();
    if(agreements.data?.length){
      for(const booking of fixtureBookings.data??[]){
        const state=await renterApi.from('bookings').select('status').eq('id',booking.id).single();
        expect(state.error).toBeNull();
        if(['requested','pending_payment'].includes(state.data!.status)){
          expect((await renterApi.rpc('cancel_booking',{p_booking_id:booking.id})).error).toBeNull();
        }
      }
      expect((await ownerApi.from('listings').update({status:'draft'}).eq('id',listingId)).error).toBeNull();
      await test.info().attach('retained-immutable-fixture',{
        body:JSON.stringify({listingId,bookings:fixtureBookings.data,agreementIds:agreements.data.map(agreement=>agreement.id)}),
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
