import { expect, test, type Page } from '@playwright/test';

async function openAccountTools(page: Page) {
  const tools = page.getByRole('link', { name: 'Help & account tools' });
  if (!await tools.isVisible()) await page.getByRole('button', { name: 'Open navigation' }).click();
  await tools.click();
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|images\.pexels\.com)\//, (route) => route.abort());
});

test('main-site local sign-in exposes the Profile selector', async ({ page }) => {
  test.skip(process.env.VITE_SITE_VARIANT !== 'main', 'Run with VITE_SITE_VARIANT=main.');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in / Join' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a local profile' });
  const select = dialog.getByLabel('Profile', { exact: true });
  await expect(select).toBeEnabled();
  await expect(select.locator('optgroup[label="Owners"] option')).toHaveCount(10);
  await expect(select.locator('optgroup[label="Renters"] option')).toHaveCount(10);
  await expect(select.locator('optgroup[label="Admin"] option')).toHaveCount(1);
  await expect(select.locator('optgroup[label="Super Admin"] option')).toHaveCount(1);
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveCount(0);
  await select.selectOption({ label: 'Maya Patel - Owner' });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back, Maya', exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Welcome back, Maya', exact: true })).toBeVisible();
});

test('Login exposes exactly 22 named profiles without automatically signing in', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a local profile' });
  const select = dialog.getByLabel('Profile', { exact: true });
  await expect(select).toBeEnabled();
  await expect(select.locator('optgroup[label="Owners"] option')).toHaveCount(10);
  await expect(select.locator('optgroup[label="Renters"] option')).toHaveCount(10);
  await expect(select.locator('optgroup[label="Admin"] option')).toHaveCount(1);
  await expect(select.locator('optgroup[label="Super Admin"] option')).toHaveCount(1);
  const names = await select.locator('optgroup option').allTextContents();
  expect(new Set(names).size).toBe(22);
  expect(names.every((name) => !/owner\d|renter\d/i.test(name))).toBe(true);
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('local-profiles-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
});

test('top-right account dropdown exposes only sign-out and profile switching', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a local profile' });
  await picker.getByLabel('Profile', { exact: true }).selectOption({ label: 'Maya Patel - Owner' });
  await expect(picker).not.toBeVisible();
  const trigger = page.getByRole('button', { name: 'Open account menu', includeHidden: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('region', { name: 'Account actions', exact: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(menu.getByRole('button')).toHaveCount(2);
    await expect(menu.getByRole('button', { name: 'Switch profile', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(200);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('link', { name: 'YBuy home', exact: true }).click();
    await expect(menu).not.toBeVisible();
  }
  await trigger.click();
  await page.getByRole('region', { name: 'Account actions' }).getByRole('button', { name: 'Switch profile' }).click();
  await expect(picker).toBeVisible();
  await expect(picker.getByLabel('Profile').locator('optgroup option')).toHaveCount(22);
  await page.keyboard.press('Escape');
  await trigger.click();
  await page.getByRole('region', { name: 'Account actions' }).getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('Owner listings use the main workspace layout and remain responsive', async ({ page }) => {
  await page.goto('/dashboard?tab=lending', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a local profile' });
  await dialog.getByLabel('Profile', { exact: true }).selectOption({ label: 'Maya Patel - Owner' });
  await expect(page.getByRole('button', { name: 'Open account menu' }).getByRole('img')).toHaveAttribute('alt', 'Maya Patel');

  const workspaceNav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await workspaceNav.getByRole('link', { name: 'My listings' }).click();
  await expect(page).toHaveURL(/\/dashboard\/listings$/);
  await expect(page.getByRole('heading', { name: 'Your gear, working for you.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your inventory' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The next handoffs' })).toHaveCount(0);
  await expect(workspaceNav.getByRole('link', { name: 'My listings' })).toHaveAttribute('aria-current', 'page');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('all named accounts create real sessions with their own profile and database staff permissions', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a local profile' });
  const select = dialog.getByLabel('Profile', { exact: true });
  await expect(select).toBeEnabled();
  const profiles = await select.locator('optgroup option').evaluateAll((options) =>
    options.map((option) => ({ id: (option as HTMLOptionElement).value, label: option.textContent ?? '' })));
  expect(profiles).toHaveLength(22);
  for (const profile of profiles) {
    await select.selectOption(profile.id);
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Open account menu' }).getByRole('img')).toHaveAttribute('alt', profile.label.split(' - ')[0]);
    const access = await page.evaluate(async () => {
      // @ts-expect-error Vite serves this module directly in the browser.
      const { supabase } = await import('/src/lib/supabase.ts');
      const { data: session } = await supabase.auth.getSession();
      const identity = await supabase.rpc('get_my_profile').single();
      const admin = await supabase.rpc('get_my_admin_access');
      if (identity.error || admin.error) throw new Error('Local session permission checks failed.');
      return { id: session.session?.user.id, profile: identity.data, access: admin.data };
    });
    expect(access.id).toBe(profile.id);
    expect(access.profile.id).toBe(profile.id);
    expect(access.profile.full_name).toBe(profile.label.split(' - ')[0]);
    const role = profile.label.split(' - ')[1];
    if (role === 'Admin' || role === 'Super Admin') {
      expect(access.access.role).toBe(role === 'Admin' ? 'admin' : 'super_admin');
      expect(access.access.permissions).toContain('users.manage');
      if (role === 'Admin') expect(access.access.permissions).not.toContain('admins.manage');
      else expect(access.access.permissions).toContain('admins.manage');
    } else {
      expect(access.access).toBeNull();
    }
    await openAccountTools(page);
    await page.getByRole('button', { name: 'Switch local profile' }).click();
    await expect(select).toBeEnabled();
  }
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Open account menu' }).getByRole('img')).toHaveAttribute('alt', 'Daniel Lawson');
  await page.setViewportSize({ width: 390, height: 844 });
  await openAccountTools(page);
  await page.getByRole('button', { name: 'Switch local profile' }).click();
  await expect(dialog).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await page.screenshot({ path: test.info().outputPath('local-profiles-mobile.png') });
  await page.keyboard.press('Escape');
  await openAccountTools(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
});

test('invalid profile and cross-origin selection are rejected', async ({ request, baseURL }) => {
  const invalid = await request.post('/api/local-profiles', {
    headers: { origin: baseURL! }, data: { id: 'not-a-local-profile' },
  });
  expect(invalid.status()).toBe(400);
  const crossOrigin = await request.post('/api/local-profiles', {
    headers: { origin: 'https://example.com' }, data: { id: 'not-a-local-profile' },
  });
  expect(crossOrigin.status()).toBe(403);
  const missingOrigin = await request.post('/api/local-profiles', { data: { id: 'not-a-local-profile' } });
  expect(missingOrigin.status()).toBe(403);
});
