import { expect, test } from '@playwright/test';

const journeys = [
  { role: 'Renters', paths: ['/dashboard?tab=renting', '/favorites', '/messages', '/notifications', '/profile', '/requests', '/need-something', '/bidding'] },
  { role: 'Owners', paths: ['/dashboard?tab=lending', '/dashboard/listings', '/dashboard/payouts', '/create-listing'] },
  { role: 'Admin', paths: ['/admin'] },
];
const headings: Record<string, string> = {
  '/dashboard?tab=renting': 'Your next good plans.',
  '/favorites': 'Keep the good finds.',
  '/messages': 'Good rentals start with a hello.',
  '/notifications': 'The useful updates.',
  '/profile': 'A little more about you.',
  '/requests': 'Good plans need good gear.',
  '/need-something': 'Good plans need good gear.',
  '/bidding': 'Great gear. Your bid.',
  '/dashboard?tab=lending': 'A little more from what you own.',
  '/dashboard/listings': 'Your gear, working for you.',
  '/dashboard/payouts': 'Your gear. Your returns.',
  '/admin': 'Keep the good plans running.',
};

for (const journey of journeys) {
  test(`native ${journey.role} routes use real local data and stay responsive`, async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|images\.pexels\.com)\//, (route) => route.abort());
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a local profile' }).getByLabel('Profile', { exact: true });
    await expect(picker).toBeEnabled();
    const profileId = await picker.locator(`optgroup[label="${journey.role}"] option`).first().evaluate((option) => (option as HTMLOptionElement).value);
    await picker.selectOption(profileId);
    await expect(page.getByRole('dialog', { name: 'Choose a local profile' })).not.toBeVisible();
    for (const path of journey.paths) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const main = page.locator('#p1-main main').first();
      await expect(main).toBeVisible();
      await expect(main.locator('h1').first()).toBeVisible();
      if (headings[path]) await expect(main.getByRole('heading', { name: headings[path], exact: true })).toBeVisible();
      await expect(main.getByRole('status')).toHaveCount(0);
      await expect(main.getByRole('alert')).toHaveCount(0);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(main).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${path.replace(/[^a-z0-9]/gi, '-')}-${width}.png`), fullPage: true });
      }
      await expect(main.getByRole('alert')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
