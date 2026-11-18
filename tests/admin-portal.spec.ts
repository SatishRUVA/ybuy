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

test('admin authenticator unlocks admin profiles and handles expiry on desktop and phone', async ({ page }) => {
  let verified = false;
  const errors: string[] = [];
  await page.clock.install();
  page.on('pageerror', error => { errors.push(error.message); console.error('Admin portal browser error:', error.message); });
  await page.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/admin/access', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({
      status: verified ? 200 : 401, json: verified ? { role: 'admin' } : { error: 'Verify access.' },
    });
    if (request.method() === 'DELETE') {
      verified = false;
      return route.fulfill({ json: { ok: true } });
    }
    const { role, code } = request.postDataJSON();
    if (role !== 'admin' || code !== '123456') {
      return route.fulfill({ status: 401, json: { error: 'Invalid administrator authenticator code.' } });
    }
    verified = true;
    return route.fulfill({ json: { role: 'admin', expiresAt: Date.now() + 7200000 } });
  });
  await page.route('**/api/admin/profiles', route => route.fulfill({
    json: [{ id: 'admin-id', name: 'Test Admin', role: 'Admin' }],
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  await expect(page.getByLabel('Administrator role')).toHaveCount(0);
  await expect(page.getByText(/Super Admin/i)).toHaveCount(0);
  await page.getByLabel('Admin authenticator code', { exact: true }).fill('654321');
  await page.getByRole('button', { name: 'Verify & choose profile' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid administrator authenticator code');
  await page.getByLabel('Admin authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & choose profile' }).click();
  await expect(page.getByRole('heading', { name: 'Choose an Admin profile' })).toBeVisible();
  const selector = page.getByLabel('Administrator profile');
  await expect(selector.locator('option:not([disabled])')).toHaveText(['Test Admin - Admin']);
  await expect(page.getByRole('textbox', { name: /authenticator code/ })).toHaveCount(0);
  await expect(page.getByText(/Super Admin/i)).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  verified = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose an Admin profile' })).toBeVisible();
  verified = false;
  await page.clock.fastForward(30_001);
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('admin portal omits control-plane sections even when the profile has elevated permissions', async ({ page }) => {
  let verified = false;
  const controlReads: string[] = [];
  const now = new Date().toISOString();
  await page.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/admin/access', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({
      status: verified ? 200 : 401, json: verified ? { role: 'admin' } : { error: 'Verify access.' },
    });
    if (request.method() === 'DELETE') {
      verified = false;
      return route.fulfill({ json: { ok: true } });
    }
    verified = request.postDataJSON().role === 'admin';
    return route.fulfill({ json: { role: 'admin', expiresAt: Date.now() + 7200000 } });
  });
  await page.route('**/api/admin/profiles', route => route.fulfill({
    json: route.request().method() === 'GET'
      ? [{ id: 'admin-id', name: 'Test Admin', role: 'Admin' }]
      : { tokenHash: 'test-hash' },
  }));
  await page.route('**/auth/v1/verify', route => route.fulfill({ json: {
    access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'admin-id', aud: 'authenticated', role: 'authenticated', email: 'admin@example.test',
      app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Test Admin' }, created_at: now },
  } }));
  await page.route('**/rest/v1/rpc/**', route => {
    const rpc = new URL(route.request().url()).pathname.split('/').pop();
    if (/admin_(list_settings|list_admins|set_feature_flag|list_audit|search_auction_decisions)/.test(rpc ?? '')) {
      controlReads.push(rpc!);
    }
    const body = rpc === 'has_active_session' ? true
      : rpc === 'get_my_profile' ? { id: 'admin-id', full_name: 'Test Admin', email: 'admin@example.test', created_at: now }
        : rpc === 'get_my_admin_access' ? { role: 'admin', permissions: [
          'analytics.view', 'users.manage', 'listings.moderate', 'bookings.view', 'payments.view',
          'payouts.view', 'reviews.moderate', 'categories.manage', 'audit.view', 'integrations.view',
          'config.manage', 'flags.manage', 'admins.manage', 'disputes.manage', 'support.manage',
          'promotions.manage', 'credits.manage', 'refunds.issue', 'refunds.approve', 'refunds.senior', 'fraud.investigate',
        ] }
          : rpc === 'admin_overview' ? {
            users_total: 1, users_new: 0, listings_published: 0, listings_suspended: 0,
            bookings_by_status: {}, gross_rental: 0, platform_fees: 0, refunds: 0,
            deposit_liability: 0, payables_outstanding: 0, recent_actions: [],
          }
            : null;
    return route.fulfill({ json: body });
  });

  await page.goto('/');
  await page.getByLabel('Admin authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & choose profile' }).click();
  await page.getByLabel('Administrator profile').selectOption('admin-id');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Admin', exact: true });
  for (const section of ['Global settings', 'Feature flags', 'Integrations & health', 'Audit log', 'Administrators', 'Missed bidding decisions']) {
    await expect(nav.getByRole('button', { name: section, exact: true })).toHaveCount(0);
  }
  await expect(page.getByText(/Super Admin/i)).toHaveCount(0);

  for (const path of ['settings', 'flags', 'integrations', 'audit', 'admins', 'auction-decisions', 'vault']) {
    await page.evaluate(path => {
      window.history.pushState(null, '', `/admin/${path}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  }
  expect(controlReads).toEqual([]);
});

test('admin portal rejects Super Admin profiles returned by the profile service', async ({ page }) => {
  await page.route(/https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/admin/access', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 401, json: { error: 'Verify access.' } })
    : route.fulfill({ json: { role: 'admin' } }));
  await page.route('**/api/admin/profiles', route => route.fulfill({
    json: [{ id: 'super-id', name: 'Super Admin', role: 'Super Admin' }],
  }));
  await page.goto('/');
  await page.getByLabel('Admin authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & choose profile' }).click();
  await expect(page.getByRole('alert')).toContainText('Test profile list is invalid');
  await expect(page.getByLabel('Administrator profile')).toHaveCount(0);
});
