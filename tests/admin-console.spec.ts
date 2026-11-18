import { expect, test, type Page } from '@playwright/test';

const appUrl = `http://localhost:${process.env.YBUY_TEST_PORT ?? '5174'}`;

const userId = 'b0000000-0000-4000-8000-000000000001';
const caseId = 'b0000000-0000-4000-8000-000000000002';
const now = '2026-10-18T12:00:00Z';
const caseRow = {
  id: caseId, kind: 'support', subject: 'Pickup question', description: 'Please clarify pickup.',
  category: 'pickup_return', priority: 'normal', status: 'open', booking_id: null,
  created_by: userId, assigned_to: null, created_at: now, updated_at: now,
};

test.setTimeout(60_000);

async function setup(page: Page, permissions: string[]) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: expires })}.test`,
    refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires,
    user: {
      id: userId, aud: 'authenticated', role: 'authenticated', email: 'operations@example.test',
      app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Test Operator' }, created_at: now,
    },
  };
  await page.addInitScript((value) => { localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)); }, session);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appUrl) return route.continue();
    if (url.hostname !== 'localhost') return route.fulfill({ contentType: 'application/json', body: '{}' });
    let body: unknown = [];
    if (url.pathname.endsWith('/has_active_session')) body = true;
    if (url.pathname.endsWith('/get_my_profile')) body = {
      id: userId, full_name: 'Test Operator', email: 'operations@example.test', created_at: now,
    };
    if (url.pathname.endsWith('/get_my_admin_access')) body = { role: 'admin', permissions };
    if (url.pathname.endsWith('/admin_list_listings')) body = { total: 0, rows: [] };
    if (url.pathname.endsWith('/admin_list_cases')) body = { total: 1, rows: [caseRow] };
    if (url.pathname.endsWith('/get_case_detail')) body = {
      case: caseRow,
      replies: [{ id: 'reply', author_id: userId, body: 'Reply from staff', is_private: false, created_at: now }],
      evidence: [], events: [{ id: 'event', event_type: 'created', detail: {}, created_at: now }],
      booking: null, deadline_policy_unresolved: false,
    };
    if (url.pathname.endsWith('/admin_update_case')) body = { ok: true };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('admin queues follow task groups and stay permission-gated on desktop and phone', async ({ page }) => {
  await setup(page, ['listings.moderate', 'support.manage']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${appUrl}/admin/listings`);

  const navigation = page.getByRole('navigation', { name: 'Admin', exact: true });
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Listings', exact: true })).toBeVisible();
  await expect(navigation.getByText('Moderation', { exact: true })).toBeVisible();
  await expect(navigation.getByText('Disputes', { exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Listings', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: 'Support tickets', exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Payments', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Support tickets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Support tickets', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('admin-console-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
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

  const navigation = page.getByRole('navigation', { name: 'Admin', exact: true });
  await expect(navigation.getByRole('button', { name: 'Listings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Support tickets', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Listings', exact: true })).toHaveCount(0);
});

test('case action form submits the selected Radix status and required audit reason', async ({ page }) => {
  await setup(page, ['support.manage']);
  await page.goto(`${appUrl}/admin/support`);
  await page.getByRole('button', { name: 'Pickup question', exact: true }).click();
  await page.getByRole('button', { name: 'Manage case', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Manage case' });
  const status = dialog.getByRole('combobox', { name: 'Status' });
  await status.click();
  await page.getByRole('option', { name: 'in progress', exact: true }).click();
  await dialog.getByLabel('Reason / decision', { exact: true }).fill('Confirmed the pickup arrangement');

  const update = page.waitForRequest((request) => request.url().endsWith('/admin_update_case'));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await update).postDataJSON()).toMatchObject({
    p_case_id: caseId, p_status: 'in_progress', p_reason: 'Confirmed the pickup arrangement',
  });
  await expect(page.getByText('Case saved.', { exact: true })).toBeVisible();
});
