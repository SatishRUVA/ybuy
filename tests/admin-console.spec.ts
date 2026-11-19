import { expect, test, type Page } from '@playwright/test';

const appUrl = `http://localhost:${process.env.YBUY_TEST_PORT ?? '5174'}`;

const userId = 'b0000000-0000-4000-8000-000000000001';
const caseId = 'b0000000-0000-4000-8000-000000000002';
const bookingId = 'b0000000-0000-4000-8000-000000000003';
const renterId = 'b0000000-0000-4000-8000-000000000004';
const ownerId = 'b0000000-0000-4000-8000-000000000005';
const now = '2026-10-18T12:00:00Z';
const caseRow = {
  id: caseId, kind: 'support', subject: 'Pickup question', description: 'Please clarify pickup.',
  category: 'pickup_return', priority: 'normal', status: 'open', booking_id: null,
  created_by: userId, assigned_to: null, created_at: now, updated_at: now,
};

test.setTimeout(60_000);

async function setup(page: Page, permissions: string[], adminRole: 'admin' | 'super_admin' = 'admin') {
  let verified = false;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appUrl && url.pathname === '/api/admin/access') {
      if (route.request().method() === 'GET') return route.fulfill({
        status: verified ? 200 : 401, json: verified ? { role: 'admin' } : { error: 'Verify access.' },
      });
      if (route.request().method() === 'DELETE') {
        verified = false;
        return route.fulfill({ json: { ok: true } });
      }
      const { role, code } = route.request().postDataJSON();
      verified = role === 'admin' && code === '123456';
      return route.fulfill({
        status: verified ? 200 : 401,
        json: verified ? { role: 'admin', expiresAt: Date.now() + 7_200_000 } : { error: 'Invalid authenticator code.' },
      });
    }
    if (url.origin === appUrl && url.pathname === '/api/admin/profiles') {
      return route.fulfill({
        json: route.request().method() === 'GET'
          ? [{ id: userId, name: 'Test Operator', role: 'Admin' }]
          : { tokenHash: 'test-token-hash' },
      });
    }
    if (url.origin === appUrl) return route.continue();
    if (url.hostname !== 'localhost') return route.fulfill({ contentType: 'application/json', body: '{}' });
    let body: unknown = [];
    if (url.pathname.endsWith('/has_active_session')) body = true;
    if (url.pathname.endsWith('/auth/v1/verify')) body = {
      access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: userId, aud: 'authenticated', role: 'authenticated', email: 'operations@example.test',
        app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Test Operator' }, created_at: now,
      },
    };
    if (url.pathname.endsWith('/get_my_profile')) body = {
      id: userId, full_name: 'Test Operator', email: 'operations@example.test', created_at: now,
    };
    if (url.pathname.endsWith('/get_my_admin_access')) body = { role: adminRole, permissions };
    if (url.pathname.endsWith('/admin_get_agreement_terms')) body = null;
    if (url.pathname.endsWith('/admin_list_service_fee_configurations')) body = [{
      id: 'b0000000-0000-4000-8000-000000000007',
      total_fee_pct: 0.22,
      renter_share_percent: 50,
      effective_from: new Date(Date.now() - 86_400_000).toISOString(),
      effective_to: null,
      created_by: userId,
      reason: 'Local Super Admin screenshot fixture',
      created_at: now,
      updated_by: null,
      updated_reason: null,
    }];
    if (url.pathname.endsWith('/admin_list_listings')) body = { total: 0, rows: [] };
    if (url.pathname.endsWith('/admin_list_cases')) {
      const { p_status: status } = route.request().postDataJSON();
      body = status === null || status === 'open' ? { total: 1, rows: [caseRow] } : { total: 0, rows: [] };
    }
    if (url.pathname.endsWith('/get_case_detail')) body = {
      case: caseRow,
      replies: [{ id: 'reply', author_id: userId, body: 'Reply from staff', is_private: false, created_at: now }],
      evidence: [], events: [{ id: 'event', event_type: 'created', detail: {}, created_at: now }],
      booking: null, deadline_policy_unresolved: false,
    };
    if (url.pathname.endsWith('/admin_update_case')) body = { ok: true };
    if (url.pathname.endsWith('/admin_get_booking_360')) body = {
      booking: {
        id: bookingId, status: 'confirmed', start_date: '2026-10-20', end_date: '2026-10-22',
        quantity: 1, daily_rate: 20, days: 2, subtotal: 40, service_fee_amount: 4, deposit: 10, total: 54,
        deposit_collection_model: 'captured', created_at: now, updated_at: now,
        listing: { id: 'b0000000-0000-4000-8000-000000000006', title: 'Camera', status: 'published' },
        renter: { id: renterId, customer_id: 'YB-0000000001', full_name: 'Renter One', email: 'renter@example.test' },
        owner: { id: ownerId, customer_id: 'YB-0000000002', full_name: 'Owner One', email: 'owner@example.test' },
        handoff: null, inspections: [],
      },
      payments: null, refund_requests: null, deposit_authorizations: null, settlement: null,
      legacy_payouts: null, cases: null, reviews: null, promotion_redemption: null, credit_reservation: null, timeline: [],
    };
    if (url.pathname.endsWith('/admin_get_customer_360')) body = {
      customer: {
        id: ownerId, customer_id: 'YB-0000000002', full_name: 'Owner One', email: 'owner@example.test',
        phone: null, created_at: now, restriction: null,
      },
      bookings: null, cases: null, reviews: null, credits: null, promotion_redemptions: null,
    };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function signInAdmin(page: Page) {
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  await page.getByLabel('Admin authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & choose profile' }).click();
  await expect(page.getByRole('heading', { name: 'Choose an Admin profile' })).toBeVisible();
  await page.getByLabel('Administrator profile').selectOption(userId);
}

test('admin queues follow task groups and stay permission-gated on desktop and phone', async ({ page }) => {
  await setup(page, ['listings.moderate', 'support.manage', 'disputes.manage']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${appUrl}/admin/listings`);
  await signInAdmin(page);

  const navigation = page.getByRole('navigation', { name: 'Admin', exact: true });
  await expect(page.getByRole('banner')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Listings', exact: true })).toBeVisible();
  await expect(navigation.getByText('Daily Operations', { exact: true })).toBeVisible();
  await expect(navigation.getByText('Customer Care', { exact: true })).toBeVisible();
  await expect(navigation.getByText('Disputes & claims', { exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Listings', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: 'Support tickets', exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Payments', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Support tickets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Support tickets', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('admin-console-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open admin menu' }).click();
  const mobileNavigation = page.getByRole('navigation', { name: 'Admin', exact: true });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Support tickets', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await page.screenshot({ path: test.info().outputPath('admin-console-mobile-navigation.png'), fullPage: true });
  await mobileNavigation.getByRole('button', { name: 'Listings', exact: true }).click();
  await page.waitForURL('**/admin/listings');
  await expect(page.getByRole('heading', { name: 'Listings', exact: true })).toBeVisible({ timeout: 30_000 });
});

test('direct navigation cannot expose an admin section outside granted permissions', async ({ page }) => {
  await setup(page, ['support.manage']);
  await page.goto(`${appUrl}/admin/listings`);
  await signInAdmin(page);

  const navigation = page.getByRole('navigation', { name: 'Admin', exact: true });
  await expect(navigation.getByRole('button', { name: 'Listings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Action Center', exact: true })).toBeVisible();
  await expect(page.getByText('Pickup question', { exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Support tickets', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Listings', exact: true })).toHaveCount(0);
});

test('super admins can access service-fee settings', async ({ page }) => {
  await setup(page, ['config.manage'], 'super_admin');
  await page.goto(`${appUrl}/admin/settings`);
  await signInAdmin(page);

  await expect(page.getByRole('heading', { name: 'Global settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Service-fee allocation', exact: true })).toBeVisible();
  await expect(page.getByText('Current: 22.00% total', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Schedule fee change', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('service-fee-admin-configuration.png'), fullPage: true });
});

test('case action form submits the selected Radix status and required audit reason', async ({ page }) => {
  await setup(page, ['support.manage']);
  await page.goto(`${appUrl}/admin/support`);
  await signInAdmin(page);
  await expect(page.getByRole('combobox', { name: 'Case priority' })).toHaveText('All priorities');

  await page.getByRole('button', { name: 'Search admin records' }).click();
  const searchDialog = page.getByRole('dialog', { name: 'Search admin records' });
  await searchDialog.getByRole('searchbox').fill('Pickup');
  await expect(searchDialog.getByRole('button', { name: /Pickup question/ })).toBeVisible();
  await searchDialog.getByRole('button', { name: /Pickup question/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/support/${caseId}$`));
  await expect(page.getByRole('heading', { name: 'Pickup question', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Manage case', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Manage case' });
  const status = dialog.getByRole('combobox', { name: 'Status' });
  await status.selectOption('in_progress');
  await dialog.getByLabel('Reason / decision', { exact: true }).fill('Confirmed the pickup arrangement');

  const update = page.waitForRequest((request) => request.url().endsWith('/admin_update_case'));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await update).postDataJSON()).toMatchObject({
    p_case_id: caseId, p_status: 'in_progress', p_reason: 'Confirmed the pickup arrangement',
  });
  await expect(page.getByText('Case saved.', { exact: true })).toBeVisible();
});

test('Booking 360 deep links to a permission-checked Customer 360 profile', async ({ page }) => {
  await setup(page, ['bookings.view', 'users.manage']);
  await page.goto(`${appUrl}/admin/bookings/${bookingId}`);
  await signInAdmin(page);

  await expect(page.getByRole('heading', { name: 'Booking 360', exact: true })).toBeVisible();
  await expect(page.getByText('Camera', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Customer 360', exact: true }).nth(1).click();

  await expect(page).toHaveURL(new RegExp(`/admin/users/${ownerId}$`));
  await expect(page.getByRole('heading', { name: 'Customer 360', exact: true })).toBeVisible();
  await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
});
