import { expect, test } from '@playwright/test';
import { loadTestActors } from '../local/test-accounts';

const backend = 'https://jzyjmsixfuwzfnntewqn.supabase.co';

for (const width of [1440, 768, 390]) {
  test(`main site staging loads real marketplace data at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const backendRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('.supabase.co')) backendRequests.push(request.url());
    });
    const feed = page.waitForResponse((response) =>
      response.url().startsWith(`${backend}/rest/v1/`) && response.ok());
    await page.goto('/');
    await feed;
    await expect(page.getByRole('heading', { name: 'Good gear, close by.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^View listing:/ }).first()).toBeVisible({ timeout: 30_000 });
    const presentation = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(presentation).toEqual({ theme: 'main', accent: '#1b634b', overflow: false });
    expect(backendRequests.length).toBeGreaterThan(0);
    expect(backendRequests.every((url) => url.startsWith(backend))).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'Finding your area' })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Browse by category' }).getByRole('button', { name: 'More categories' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /^View listing:/ }).first()).toBeVisible({ timeout: 30_000 });
    const listingCard = page.getByRole('link', { name: /^View listing:/ }).first();
    await expect.poll(() => listingCard.locator('img').first().evaluate(
      image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
    )).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`home-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: /^View listing:/ }).first().click();
    await expect(page).toHaveURL(/\/listing\/[a-f0-9-]+/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const listingImage = page.locator('.listing-image-main img').first();
    await expect(listingImage).toBeVisible();
    await expect.poll(() => listingImage.evaluate(
      image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
    )).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`listing-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('real UI sign-in persists; authenticated notification worker cannot send mail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const actor = loadTestActors(true).find((account) => account.email === 'owner1@example.test');
  if (!actor) throw new Error('Missing synthetic owner1 staging test account.');
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(actor.email);
  await dialog.getByLabel('Password', { exact: true }).fill(actor.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Renting(?: \d+)?$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next good plans.', exact: true })).toBeVisible();
  await expect(page.locator('main .skeleton')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('renter-dashboard-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: test.info().outputPath('renter-dashboard-390.png'), fullPage: true });
  await page.goto('/dashboard?tab=lending');
  await expect(page.getByRole('heading', { name: 'A little more from what you own.', exact: true })).toBeVisible();
  await expect(page.locator('main .skeleton')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('owner-dashboard-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: test.info().outputPath('owner-dashboard-1440.png'), fullPage: true });
  const response = await page.evaluate(async (url) => {
    const stored = localStorage.getItem('sb-jzyjmsixfuwzfnntewqn-auth-token');
    if (!stored) throw new Error('Missing persisted staging session.');
    const session = JSON.parse(stored);
    if (!session.access_token) throw new Error('Missing access token.');
    const result = await fetch(`${url}/functions/v1/send-notification-emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return { status: result.status, body: await result.json() };
  }, backend);
  expect(response).toEqual({
    status: 503,
    body: { error: 'Notification email delivery is disabled for this environment.' },
  });
});
