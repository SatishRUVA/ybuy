import { expect, test, type Page } from '@playwright/test';
import { appUrl } from './test-url';

// Mocked RPC checks cover browser behavior; database tests cover authorization and persistence.
const userId = 'b0000000-0000-4000-8000-000000000001';
const caseId = 'b0000000-0000-4000-8000-000000000002';
const now = '2026-10-18T12:00:00Z';
const caseRow = {
  id: caseId, kind: 'support', subject: 'Pickup question', description: 'Please clarify pickup.',
  category: 'pickup_return', priority: 'normal', status: 'open', booking_id: null,
  created_by: userId, assigned_to: null, created_at: now, updated_at: now,
};

async function setup(page: Page, permissions: string[]) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: expires })}.test`,
    refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires,
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'operations@example.test',
      app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Test Operator' }, created_at: now },
  };
  await page.addInitScript((value) => { localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)); }, session);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appUrl) return route.continue();
    if (url.hostname !== 'localhost') return route.fulfill({ contentType: 'application/json', body: '{}' });
    let body: unknown = [];
    if (url.pathname.endsWith('/has_active_session')) body = true;
    if (url.pathname.endsWith('/get_my_profile')) body = { id: userId, full_name: 'Test Operator', email: 'operations@example.test', created_at: now };
    if (url.pathname.endsWith('/get_my_admin_access')) body = permissions.length ? { role: 'admin', permissions } : null;
    if (url.pathname.endsWith('/admin_list_cases') || url.pathname.endsWith('/list_my_cases')) body = { total: 1, rows: [caseRow] };
    if (url.pathname.endsWith('/get_case_detail')) body = {
      case: caseRow, replies: [{ id: 'reply', author_id: userId, body: 'Reply from staff', is_private: false, created_at: now }],
      evidence: [], events: [{ id: 'event', event_type: 'created', detail: {}, created_at: now }],
      booking: null, deadline_policy_unresolved: false,
    };
    if (url.pathname.endsWith('/create_case') || url.pathname.endsWith('/admin_create_case')) body = { ...caseRow, ...route.request().postDataJSON(), id: caseId };
    if (url.pathname.endsWith('/admin_update_case') || url.pathname.endsWith('/reply_to_case')) body = { ok: true };
    if (url.pathname.endsWith('/admin_list_promotions')) body = { total: 0, rows: [] };
    if (url.pathname.endsWith('/admin_save_promotion')) body = { id: caseId };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('configuration administrator can add marketplace countries with an audit reason', async ({ page }) => {
  await setup(page, ['config.manage']);
  await page.route('**/rest/v1/rpc/admin_get_agreement_terms', route =>
    route.fulfill({ contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/rpc/admin_list_settings', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([{
      key: 'marketplace_country_codes', value: ['US'], value_type: 'country_codes',
      min_value: null, max_value: null, description: 'Enabled marketplace countries', is_public: true, updated_at: now,
    }]) }));
  await page.route('**/rest/v1/reference_countries?**', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([
      { code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' },
    ]) }));
  await page.route('**/rest/v1/rpc/admin_update_setting', route =>
    route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await page.goto(`${appUrl}/admin/settings`);
  await expect(page.getByRole('heading', { name: 'Global settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('checkbox', { name: 'United States', exact: true })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Canada', exact: true }).check();
  await dialog.getByLabel('Reason (recorded in the audit log)').fill('Enable Canadian marketplace locations');
  const save = page.waitForRequest(request => request.url().endsWith('/admin_update_setting'));
  await dialog.getByRole('button', { name: 'Save change', exact: true }).click();
  expect((await save).postDataJSON()).toEqual({
    p_key: 'marketplace_country_codes', p_value: ['US', 'CA'], p_reason: 'Enable Canadian marketplace locations',
  });
  await expect(page.getByText('marketplace_country_codes updated.', { exact: true })).toBeVisible();
});

test('support operator sees supported modules, but not financial grants', async ({ page }) => {
  await setup(page, ['support.manage']);
  await page.goto(`${appUrl}/admin/support`);
  await expect(page.getByRole('heading', { name: 'Support tickets', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Admin', exact: true });
  await expect(nav.getByRole('button', { name: 'Support tickets' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Promotions & rewards' })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Refund requests' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pickup question', exact: true }).click();
  await expect(page.getByRole('article').getByText('Reply from staff', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage case', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Manage case' })).toBeVisible();
  await page.getByLabel('Reason / decision', { exact: true }).fill('Investigating the pickup issue');
  await page.getByLabel('Status', { exact: true }).selectOption('in_progress');
  const update = page.waitForRequest((request) => request.url().endsWith('/admin_update_case'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await update).postDataJSON()).toMatchObject({ p_case_id: caseId, p_status: 'in_progress' });
  await expect(page.getByText('Case saved.', { exact: true })).toBeVisible();
});

test('participant support has no staff-only controls', async ({ page }) => {
  await setup(page, []);
  await page.goto(`${appUrl}/support/${caseId}`);
  await expect(page.getByRole('heading', { name: 'Pickup question', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage case', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add reply', exact: true }).click();
  await expect(page.getByLabel('Visibility', { exact: true })).toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('Thanks for checking.');
  const reply = page.waitForRequest((request) => request.url().endsWith('/reply_to_case'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await reply).postDataJSON()).toMatchObject({ p_case_id: caseId, p_private: false });
});

test('ordinary user is denied the admin console', async ({ page }) => {
  await setup(page, []);
  await page.goto(`${appUrl}/admin/support`);
  await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Admin', exact: true })).toHaveCount(0);
});

test('server failures are shown without a successful case save', async ({ page }) => {
  await setup(page, ['support.manage']);
  await page.route('**/rest/v1/rpc/admin_create_case', (route) => route.fulfill({
    status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Not authorized', code: '42501' }),
  }));
  await page.goto(`${appUrl}/admin/support`);
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await page.getByLabel('Subject', { exact: true }).fill('Booking assistance');
  await page.getByLabel('Describe the issue', { exact: true }).fill('A question for support.');
  await page.getByLabel('Affected user ID', { exact: true }).fill(userId);
  await page.getByLabel('Creation reason', { exact: true }).fill('User requested assistance');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Not authorized');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('ticket forms remain usable in a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await setup(page, []);
  await page.goto(`${appUrl}/support`);
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await page.getByLabel('Subject', { exact: true }).fill('Pickup location');
  await page.getByLabel('Describe the issue', { exact: true }).fill('Where should we meet?');
  const created = page.waitForRequest((request) => request.url().endsWith('/create_case'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await created).postDataJSON()).toMatchObject({ p_kind: 'support', p_subject: 'Pickup location' });
  await expect(page.getByRole('heading', { name: 'Pickup question', exact: true })).toBeVisible();
});

test('campaign form sends the server contract and real financial constraints', async ({ page }) => {
  await setup(page, ['promotions.manage']);
  await page.goto(`${appUrl}/admin/promotions`);
  await page.getByRole('button', { name: 'New campaign', exact: true }).click();
  await page.getByLabel('Campaign name', { exact: true }).fill('Local test campaign');
  await page.getByLabel('Promotion code', { exact: true }).fill('LOCAL10');
  await page.getByLabel('Discount type', { exact: true }).selectOption('percentage');
  await page.getByLabel('Discount value (% or USD)', { exact: true }).fill('10');
  await page.getByLabel('Starts (local time)', { exact: true }).fill('2026-10-18T12:00');
  await page.getByLabel('Ends (local time)', { exact: true }).fill('2026-11-18T12:00');
  await page.getByLabel('Change reason', { exact: true }).fill('Testing an inactive platform campaign');
  const saved = page.waitForRequest((request) => request.url().endsWith('/admin_save_promotion'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    p_id: null, p_reason: 'Testing an inactive platform campaign',
    p_values: { description: 'Local test campaign', code: 'LOCAL10', discount_type: 'percent', discount_value: 10, active: false, min_subtotal: 0, per_user_limit: 1 },
  });
  await expect(page.getByText('Campaign saved.', { exact: true })).toBeVisible();
});

test('credit-only operator does not fetch unauthorized campaign data', async ({ page }) => {
  await setup(page, ['credits.manage']);
  const campaignCalls: string[] = [];
  page.on('request', (request) => { if (request.url().endsWith('/admin_list_promotions')) campaignCalls.push(request.url()); });
  await page.goto(`${appUrl}/admin/promotions`);
  await expect(page.getByRole('heading', { name: 'Test credit administration' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New campaign', exact: true })).toHaveCount(0);
  expect(campaignCalls).toEqual([]);
});
