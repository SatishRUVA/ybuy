import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { loadTestActors } from '../local/test-accounts';

test('test Stripe checkout requires provider confirmation before the rental lifecycle', async ({ page }) => {
  test.setTimeout(180_000);
  const backend = 'https://jzyjmsixfuwzfnntewqn.supabase.co';
  const actors = loadTestActors(true);
  const owner = actors.find(actor => actor.email === 'owner5@example.test');
  const renter = actors.find(actor => actor.email === 'renter5@example.test');
  if (!owner || !renter) throw new Error('Missing synthetic staging payment actors.');
  const keys = JSON.parse(execSync('pnpm exec supabase projects api-keys --project-ref jzyjmsixfuwzfnntewqn --output json', {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })) as { name: string; api_key: string }[];
  const anon = keys.find(key => key.name === 'anon')?.api_key;
  if (!anon) throw new Error('Missing staging public key.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const ownerApi = createClient(backend, anon, options);
  const renterApi = createClient(backend, anon, options);
  expect((await ownerApi.auth.signInWithPassword(owner)).error).toBeNull();
  expect((await renterApi.auth.signInWithPassword(renter)).error).toBeNull();
  const category = await ownerApi.from('categories').select('id').eq('active', true).limit(1).single();
  expect(category.error).toBeNull();
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const fixture = await ownerApi.from('listings').insert({
    owner_id: owner.id, category_id: category.data!.id, status: 'draft',
    title: `Synthetic Stripe camera ${crypto.randomUUID()}`,
    description: 'Synthetic test-mode rental. No actual item or real-money transaction.',
    price_per_day: 10, deposit: 0, estimated_value: 200, item_condition: 'good',
    availability_start: start, availability_end: end, available_quantity: 1, instant_booking: true,
    location_label: 'Dallas, TX', location_lat: 32.78, location_lng: -96.8,
  }).select('id').single();
  expect(fixture.error).toBeNull();
  const listingId = fixture.data!.id;
  let bookingId: string | undefined;
  try {
    expect((await ownerApi.from('listing_images').insert({
      listing_id: listingId, url: 'https://example.test/synthetic-camera.jpg', sort_order: 0,
    })).error).toBeNull();
    expect((await ownerApi.from('listing_pickup_locations').insert({
      listing_id: listingId, owner_id: owner.id, address: 'Synthetic pickup only', city: 'Dallas',
      state: 'TX', postal_code: '75201', country: 'US', latitude: 32.78, longitude: -96.8,
    })).error).toBeNull();
    expect((await ownerApi.from('listings').update({ status: 'published' }).eq('id', listingId)).error).toBeNull();
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sign in or create an account' }).click();
    const signIn = page.getByRole('dialog');
    await signIn.getByLabel('Email', { exact: true }).fill(renter.email);
    await signIn.getByLabel('Password', { exact: true }).fill(renter.password);
    await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(signIn).not.toBeVisible();
    await page.goto(`/checkout/${listingId}?start=${start}&end=${end}`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('checkbox', { name: 'I have reviewed the dates, estimated cost, and rental terms.' }).check();
    await page.getByRole('button', { name: 'Continue to payment', exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });
    const requested = await renterApi.from('bookings').select('id,status,total').eq('listing_id', listingId).single();
    expect(requested.error).toBeNull();
    expect(requested.data!.status).toBe('pending_payment');
    bookingId = requested.data!.id;
    expect((await ownerApi.rpc('mark_booking_active', { p_booking_id: bookingId })).error).not.toBeNull();
    const url = new URL(page.url());
    expect(url.hostname).toBe('checkout.stripe.com');
    expect(url.pathname, 'Never enter payment details into a live Stripe session').toContain('cs_test_');
    await page.getByLabel('Email', { exact: true }).fill(renter.email);
    await page.getByRole('button', { name: 'Pay with card', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.locator('#cardNumber').fill('4242424242424242', { timeout: 20_000 });
    await page.locator('#cardExpiry').fill('1230');
    await page.locator('#cardCvc').fill('123');
    await page.locator('#billingName').fill('Synthetic Renter');
    if (await page.locator('#billingPostalCode').isVisible()) await page.locator('#billingPostalCode').fill('75201');
    const saveWithLink = page.getByRole('checkbox', { name: 'Save my information with Link for faster checkout' });
    if (await saveWithLink.isVisible()) await saveWithLink.uncheck();
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^https://ybuy-redesign-v1\\.vercel\\.app/confirmation/${bookingId}`), { timeout: 90_000 });
    await expect.poll(async () => {
      const state = await renterApi.from('bookings').select('status').eq('id', bookingId).single();
      if (state.error) throw new Error(state.error.message);
      return state.data.status;
    }, { timeout: 90_000, message: 'Only the signed provider webhook may confirm payment' }).toBe('confirmed');
    const paid = await renterApi.from('payments').select('status,stripe_payment_intent_id,amount,currency').eq('booking_id', bookingId).single();
    expect(paid.error).toBeNull();
    expect(paid.data!.status).toBe('succeeded');
    expect(paid.data!.stripe_payment_intent_id).toMatch(/^pi_/);
    expect(Number(paid.data!.amount)).toBe(Number(requested.data!.total));
    expect(paid.data!.currency).toBe('usd');
    expect((await renterApi.rpc('mark_booking_active', { p_booking_id: bookingId })).error).toBeNull();
    expect((await renterApi.rpc('start_booking_return', { p_booking_id: bookingId })).error).toBeNull();
    expect((await renterApi.rpc('complete_booking_return', { p_booking_id: bookingId })).error).not.toBeNull();
    const completed = await ownerApi.rpc('complete_booking_return', { p_booking_id: bookingId });
    expect(completed.error).toBeNull();
    expect(completed.data.status).toBe('completed');
  } finally {
    if (!bookingId) {
      const created = await renterApi.from('bookings').select('id').eq('listing_id', listingId).maybeSingle();
      expect(created.error).toBeNull();
      bookingId = created.data?.id;
    }
    if (bookingId) {
      const state = await renterApi.from('bookings').select('status').eq('id', bookingId).single();
      expect(state.error).toBeNull();
      if (['requested', 'pending_payment'].includes(state.data!.status)) {
        expect((await renterApi.rpc('cancel_booking', { p_booking_id: bookingId })).error).toBeNull();
      }
      await test.info().attach('retained-synthetic-payment-record', {
        body: JSON.stringify({ listingId, bookingId }), contentType: 'application/json',
      });
    }
    expect((await ownerApi.from('listings').update({ status: 'draft' }).eq('id', listingId)).error).toBeNull();
    await ownerApi.auth.signOut({ scope: 'local' });
    await renterApi.auth.signOut({ scope: 'local' });
  }
});
