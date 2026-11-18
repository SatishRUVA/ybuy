import { execFileSync } from 'node:child_process';
import { createClient, type Session } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

const status = JSON.parse(execFileSync(process.execPath, [
  'dev\\supabase-local.mjs', 'status', '--output', 'json',
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
if (new URL(status.API_URL).port !== '54321') throw new Error('This test requires isolated local Supabase.');
const apiUrl = 'http://localhost:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(apiUrl, status.SERVICE_ROLE_KEY, options);
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=', 'base64');

async function establishSession(page: Page, session: Session, bookingId: string, kind = 'check-in') {
  await page.addInitScript(value => {
    for (const host of ['localhost', '127']) localStorage.setItem(`sb-${host}-auth-token`, JSON.stringify(value));
  }, session);
  await page.goto(`/${kind}/${bookingId}`, { waitUntil: 'domcontentloaded' });
}

test('real local participants publish, correct, activate and verify a disputed return', async ({ browser, baseURL }) => {
  test.setTimeout(300000);
  if (baseURL !== 'http://localhost:5174' && baseURL !== 'http://localhost:5174/') {
    throw new Error('This journey may run only at http://localhost:5174/.');
  }
  const [owner, renter] = await Promise.all(['owner', 'renter'].map(async role => {
    const email = `handoff-${role}-${crypto.randomUUID()}@example.test`;
    const password = `${crypto.randomUUID()}Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: `Local handoff ${role}` },
    });
    if (error || !data.user) throw new Error(`Local fixture user creation failed: ${error?.message ?? 'Missing user'}`);
    return { id: data.user.id, email, password };
  }));
  const ownerApi = createClient(apiUrl, status.ANON_KEY, options);
  const renterApi = createClient(apiUrl, status.ANON_KEY, options);
  const [ownerLogin, renterLogin] = await Promise.all([
    ownerApi.auth.signInWithPassword({ email: owner.email, password: owner.password }),
    renterApi.auth.signInWithPassword({ email: renter.email, password: renter.password }),
  ]);
  expect(ownerLogin.error).toBeNull();
  expect(renterLogin.error).toBeNull();
  const ownerSession = ownerLogin.data.session;
  const renterSession = renterLogin.data.session;
  if (!ownerSession || !renterSession) throw new Error('Local participant sign-in failed.');
  const category = await admin.from('categories').select('id').limit(1).single();
  expect(category.error).toBeNull();
  const listingId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const endDate = new Date(`${today}T12:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 2);
  const tomorrow = endDate.toISOString().slice(0, 10);
  const listing = await admin.from('listings').insert({
    id: listingId, owner_id: owner.id, category_id: category.data!.id,
    title: `Local handoff workflow fixture ${bookingId}`,
    description: 'Synthetic local-only handoff. No real payment or item exchange.',
    price_per_day: 10, deposit: 0, status: 'draft', estimated_value: 200,
    item_condition: 'good', availability_start: today, availability_end: tomorrow,
  });
  expect(listing.error).toBeNull();
  const photoUrl = 'https://example.test/local-handoff-fixture.png';
  for (const result of await Promise.all([
    admin.from('listing_images').insert({ listing_id: listingId, url: photoUrl, sort_order: 0 }),
    admin.from('listing_photo_reviews').insert({
      listing_id: listingId, photo_url: photoUrl, decision: 'approved',
      reason: 'Synthetic local fixture', review_method: 'system',
    }),
    admin.from('listing_pickup_locations').insert({
      listing_id: listingId, owner_id: owner.id, address: '123 Test Street, Dallas, TX 75201',
      street_address: '123 Test Street', city: 'Dallas', state: 'TX', postal_code: '75201',
      country: 'US', latitude: 32.8, longitude: -96.8, time_zone: 'America/Chicago',
    }),
  ])) expect(result.error).toBeNull();
  expect((await admin.from('listings').update({ status: 'published' }).eq('id', listingId)).error).toBeNull();
  const booking = await admin.from('bookings').insert({
    id: bookingId, listing_id: listingId, owner_id: owner.id, renter_id: renter.id,
    start_date: today, end_date: tomorrow, daily_rate: 10, days: 2, subtotal: 20,
    service_fee_pct: 0.1, service_fee_amount: 2, deposit: 0, total: 22,
    status: 'pending_payment', payment_first: true, deposit_collection_model: 'authorization',
    return_scheduling_required: false,
  }).select('total').single();
  expect(booking.error).toBeNull();
  if (!booking.data) throw new Error('Local booking fixture was not created.');
  const payment = await admin.rpc('confirm_booking_payment', {
    p_booking_id: bookingId, p_checkout_session_id: `cs_local_${bookingId}`,
    p_payment_intent_id: `pi_local_${bookingId}`, p_amount: booking.data.total,
  });
  expect(payment.error).toBeNull();
  const slot = await admin.from('booking_pickup_slots').insert({
    booking_id: bookingId, kind: 'pickup', selected_date: today, slot_window: 'morning',
    starts_at: new Date(Date.now() + 30 * 60000).toISOString(),
    ends_at: new Date(Date.now() + 90 * 60000).toISOString(), time_zone: 'America/Chicago',
    status: 'approved', proposed_by: renter.id, approved_by: owner.id,
  }).select('starts_at').single();
  expect(slot.error).toBeNull();
  if (!slot.data) throw new Error('Local pickup slot fixture was not created.');
  const pickupStartsAt = Date.parse(slot.data.starts_at);

  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const renterContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  const renterPage = await renterContext.newPage();
  try {
    await Promise.all([
      establishSession(ownerPage, ownerSession, bookingId),
      establishSession(renterPage, renterSession, bookingId),
    ]);
    await ownerPage.getByRole('button', { name: 'Begin pickup', exact: true }).click();
    for (const kind of ['pickup', 'return'] as const) {
      await ownerPage.getByLabel(/^Item appearance and condition/).fill('Good condition, tested together with the renter.');
      await ownerPage.getByLabel(/Existing scratches or damage/).fill('None observed');
      await ownerPage.getByLabel(/Included accessories/).fill('Charger\nCase');
      await ownerPage.getByLabel(/Functional condition/).fill('Powered on and tested successfully.');
      if (kind === 'return') {
        await ownerPage.getByRole('button', { name: 'Save draft', exact: true }).click();
        await expect(ownerPage.getByText('Private draft', { exact: true })).toBeVisible();
      }
      await expect(ownerPage.getByRole('button', { name: 'Publish & confirm', exact: true })).toBeEnabled();
      const privateView = await renterApi.rpc('get_booking_handoff_workflow', { p_booking_id: bookingId, p_kind: kind });
      expect(privateView.error).toBeNull();
      expect(privateView.data[kind]?.inspection ?? null).toBeNull();
      await ownerPage.getByLabel(/Condition photos/).setInputFiles(['front.png', 'back.png'].map(name => ({
        name, mimeType: 'image/png', buffer: image,
      })));
      await ownerPage.getByRole('button', { name: 'Publish & confirm', exact: true }).click();
      await expect(ownerPage.getByText('Published', { exact: true })).toBeVisible();
      await expect(renterPage.getByRole('button', { name: 'Agree to condition', exact: true })).toBeEnabled({ timeout: 30000 });
      if (kind === 'pickup') {
        await renterPage.getByRole('button', { name: 'Request correction', exact: true }).click();
        await renterPage.getByLabel('Correction details').fill('Please clarify that the charger was tested.');
        await renterPage.getByRole('button', { name: 'Send correction request' }).click();
        await expect(ownerPage.getByLabel(/^Item appearance and condition/)).toBeVisible({ timeout: 30000 });
        await ownerPage.getByLabel(/Functional condition/).fill('Camera and charger were tested and work correctly.');
        await ownerPage.getByRole('button', { name: 'Publish & confirm', exact: true }).click();
        await expect(renterPage.getByRole('button', { name: 'Agree to condition', exact: true })).toBeEnabled({ timeout: 30000 });
        await renterPage.getByRole('button', { name: 'Agree to condition', exact: true }).click();
      } else {
        await renterPage.getByRole('button', { name: 'Dispute condition', exact: true }).click();
        await renterPage.getByLabel('Dispute reason').fill('The photographed scratch existed before the rental.');
        await renterPage.getByRole('button', { name: 'Send dispute', exact: true }).click();
      }
      const code = renterPage.getByLabel('Six-digit handoff code');
      await expect(code).toHaveText(/^\d{6}$/);
      await ownerPage.getByLabel('Enter the renter’s six-digit code', { exact: true }).fill((await code.textContent())!);
      await ownerPage.getByRole('button', {
        name: kind === 'pickup' ? 'Verify and start rental' : 'Verify and confirm receipt',
      }).click();
      await expect(ownerPage.getByRole('heading', {
        name: kind === 'pickup' ? 'Pickup verified' : 'Return verified', exact: true,
      })).toBeVisible();
      if (kind === 'pickup') {
        const earlyPickup = await ownerApi.rpc('get_booking_handoff_workflow', { p_booking_id: bookingId, p_kind: 'pickup' });
        expect(earlyPickup.error).toBeNull();
        expect(Date.parse(earlyPickup.data.actual_pickup_at)).toBeLessThan(pickupStartsAt);
        await ownerPage.getByRole('button', { name: 'View return details' }).click();
        await expect(renterPage.getByRole('button', { name: 'View return details' })).toBeVisible({ timeout: 30000 });
        await renterPage.getByRole('button', { name: 'View return details' }).click();
        await ownerPage.getByRole('button', { name: 'Begin return inspection', exact: true }).click();
      }
    }
    const returned = await renterApi.rpc('get_booking_handoff_workflow', { p_booking_id: bookingId, p_kind: 'return' });
    expect(returned.error).toBeNull();
    expect(returned.data.workflow.physical_return_verified).toBe(true);
    expect(returned.data.workflow.condition_status).toBe('disputed');
    expect(returned.data.workflow.financially_closed).toBe(false);
    await expect(renterPage.getByRole('heading', { name: 'Return verified', exact: true })).toBeVisible({ timeout: 30000 });
    expect(await renterPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await ownerPage.screenshot({ path: test.info().outputPath('owner-return.png'), fullPage: true });
    await renterPage.screenshot({ path: test.info().outputPath('renter-disputed-return-mobile.png'), fullPage: true });
    await test.info().attach('local-fixture', {
      body: JSON.stringify({ bookingId, listingId, retained: 'Immutable synthetic local evidence; no hosted data changed.' }),
      contentType: 'application/json',
    });
  } finally {
    await ownerContext.close();
    await renterContext.close();
    const hiddenFixture = await admin.from('listings').update({ status: 'draft' }).eq('id', listingId);
    expect(hiddenFixture.error).toBeNull();
  }
});
