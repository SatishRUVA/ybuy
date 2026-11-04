import { expect, test } from '@playwright/test';

test('customer administrator routes link to the isolated portal instead of loading admin screens', async ({ page }) => {
  await page.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
  const adminScripts: string[] = [];
  page.on('request', request => { if (/admin-page.*\.js/.test(request.url())) adminScripts.push(request.url()); });
  await page.goto('http://localhost:5192/admin/users');
  await expect(page.getByRole('heading', { name: 'Administration has moved' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open YBuy administration' })).toHaveAttribute('href', 'https://ybuy-admin.vercel.app');
  expect(adminScripts).toEqual([]);
});

test('role-specific authenticator unlocks only matching profiles and handles expiry on desktop and phone', async ({ page }) => {
  let verifiedRole: 'admin' | 'super_admin' | null = null;
  const errors: string[] = [];
  await page.clock.install();
  page.on('pageerror', error => { errors.push(error.message); console.error('Admin portal browser error:', error.message); });
  await page.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/admin/access', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({
      status: verifiedRole ? 200 : 401, json: verifiedRole ? { role: verifiedRole } : { error: 'Verify access.' },
    });
    if (request.method() === 'DELETE') {
      verifiedRole = null;
      return route.fulfill({ json: { ok: true } });
    }
    const { role, code } = request.postDataJSON();
    if (code !== (role === 'admin' ? '123456' : '654321')) {
      return route.fulfill({ status: 401, json: { error: 'Invalid authenticator code for this role.' } });
    }
    verifiedRole = role;
    return route.fulfill({ json: { role, expiresAt: Date.now() + 7200000 } });
  });
  await page.route('**/api/admin/profiles', route => route.fulfill({
    json: [{ id: `${verifiedRole}-id`, name: verifiedRole === 'admin' ? 'Test Admin' : 'Test Super Admin',
      role: verifiedRole === 'admin' ? 'Admin' : 'Super Admin' }],
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  await page.getByLabel('Admin authenticator code', { exact: true }).fill('654321');
  await page.getByRole('button', { name: 'Verify & choose profile' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid authenticator code');
  for (const [role, code, name, width] of [
    ['admin', '123456', 'Admin', 1440], ['super_admin', '654321', 'Super Admin', 390],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByLabel('Administrator role').selectOption(role);
    await page.getByLabel(`${name} authenticator code`, { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Verify & choose profile' }).click();
    await expect(page.getByRole('heading', { name: `Choose ${role === 'admin' ? 'an Admin' : 'a Super Admin'} profile` })).toBeVisible();
    const selector = page.getByLabel('Administrator profile');
    await expect(selector.locator('option:not([disabled])')).toHaveText([`Test ${name} - ${name}`]);
    await expect(page.getByRole('textbox', { name: /authenticator code/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Use a different role' }).click();
    await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  }
  verifiedRole = 'admin';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose an Admin profile' })).toBeVisible();
  verifiedRole = null;
  await page.clock.fastForward(30_001);
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  expect(errors).toEqual([]);
});
