import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { loadTestActors } from '../local/test-accounts';

test('owner blocks and unblocks a draft in the real edit wizard; saves survive reload and renter writes are denied', async ({ page }) => {
  test.setTimeout(120_000);
  const actors = loadTestActors(true);
  const owner = actors.find((actor) => actor.email === 'owner1@example.test');
  const renter = actors.find((actor) => actor.email === 'renter1@example.test');
  if (!owner || !renter) throw new Error('Missing synthetic staging owner/renter accounts.');
  const keys = JSON.parse(execSync('pnpm exec supabase projects api-keys --project-ref jzyjmsixfuwzfnntewqn --output json', {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })) as { name: string; api_key: string }[];
  const anon = keys.find((key) => key.name === 'anon')?.api_key;
  if (!anon) throw new Error('Missing public staging backend key.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const backend = 'https://jzyjmsixfuwzfnntewqn.supabase.co';
  const ownerApi = createClient(backend, anon, options);
  const renterApi = createClient(backend, anon, options);
  expect((await ownerApi.auth.signInWithPassword(owner)).error).toBeNull();
  expect((await renterApi.auth.signInWithPassword(renter)).error).toBeNull();
  const category = await ownerApi.from('categories').select('id').eq('active', true).limit(1).single();
  expect(category.error).toBeNull();
  const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const fixture = await ownerApi.from('listings').insert({
    owner_id: owner.id, category_id: category.data!.id, status: 'draft',
    title: `Staging availability fixture ${crypto.randomUUID()}`,
    description: 'Synthetic camera for testing owner availability. No actual item or payment.',
    price_per_day: 10, deposit: 0, estimated_value: 200, item_condition: 'good',
    availability_start: day(2), availability_end: day(30), available_quantity: 1,
  }).select('id').single();
  expect(fixture.error).toBeNull();
  const id = fixture.data!.id;
  try {
    expect((await ownerApi.from('listing_images').insert({
      listing_id: id, url: 'https://example.test/owner-availability-fixture.png', sort_order: 0,
    })).error).toBeNull();
    expect((await ownerApi.from('listing_pickup_locations').upsert({
      listing_id: id, owner_id: owner.id, address: '123 Test Street, Irving, TX 75039, US',
      street_address: '123 Test Street', city: 'Irving', state: 'TX', postal_code: '75039',
      country: 'US', latitude: 32.8, longitude: -96.9, place_id: 'owner-availability-fixture',
    }, { onConflict: 'listing_id' })).error).toBeNull();
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sign in or create an account' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email', { exact: true }).fill(owner.email);
    await dialog.getByLabel('Password', { exact: true }).fill(owner.password);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    async function openAvailability() {
      await page.goto(`/edit-listing/${id}`);
      await expect(page.getByRole('region', { name: 'Step 1: The item' })).toBeVisible();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Step 2: Photos' })).toBeVisible();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Step 3: Price & pickup' })).toBeVisible();
      await expect(page.getByText(/private offers/i)).toHaveCount(0);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Step 4: Availability' })).toBeVisible();
    }
    await openAvailability();
    const calendar = page.getByRole('region', { name: 'Block unavailable days' });
    await calendar.getByRole('button', { name: /, available$/ }).first().click();
    await expect(calendar.getByRole('button', { name: /, blocked$/ })).toHaveCount(1);
    const saved = await ownerApi.rpc('get_listing_unavailable_dates', { p_listing_id: id });
    expect(saved.error).toBeNull();
    expect(saved.data.blocked).toHaveLength(1);
    const blockedDate = saved.data.blocked[0];
    const denied = await renterApi.from('listing_availability').upsert({ listing_id: id, date: blockedDate, is_available: true });
    expect(denied.error).not.toBeNull();
    await page.reload();
    await openAvailability();
    await expect(calendar.getByRole('button', { name: /, blocked$/ })).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('owner-blocked-draft.png'), fullPage: true });
    await calendar.getByRole('button', { name: /, blocked$/ }).click();
    await expect(calendar.getByRole('button', { name: /, blocked$/ })).toHaveCount(0);
    const cleared = await ownerApi.rpc('get_listing_unavailable_dates', { p_listing_id: id });
    expect(cleared.error).toBeNull();
    expect(cleared.data.blocked).toEqual([]);
  } finally {
    expect((await ownerApi.from('listings').delete().eq('id', id)).error).toBeNull();
    await ownerApi.auth.signOut({ scope: 'local' });
    await renterApi.auth.signOut({ scope: 'local' });
  }
});
