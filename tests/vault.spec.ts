import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

const appUrl = 'http://127.0.0.1:5174';
const userId = 'e1000000-0000-4000-8000-000000000001';
const factorId = 'e2000000-0000-4000-8000-000000000001';

async function setup(page: Page, options: { admin?: boolean; enroll?: boolean; rejectCode?: boolean; rejectSave?: boolean; ttl?: number; rejectStatus?: boolean; unavailable?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: userId, aud: 'authenticated', role: 'authenticated', email: 'vault@example.test',
    app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Vault Operator' },
    created_at: new Date().toISOString(),
    factors: options.enroll ? [] : [{ id: factorId, factor_type: 'totp', status: 'verified', friendly_name: 'Test authenticator' }],
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = (aal: string) => ({
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      aud: 'authenticated', role: 'authenticated', sub: userId, exp: now + 3600, iat: now,
      aal, amr: [{ method: 'totp', timestamp: now }],
    })}.fixture`,
    refresh_token: 'fixture-refresh-token', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer', user,
  });
  let statusReads = 0;
  let secretWrites = 0;
  let stored = false;
  let verifyPosts = 0;
  await page.addInitScript((value) => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), session('aal1'));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appUrl) return route.continue();
    let body: unknown = [];
    if (url.pathname === '/auth/v1/user') body = user;
    if (url.pathname.endsWith('/has_active_session')) body = true;
    if (url.pathname.endsWith('/get_my_profile')) body = { ...user, full_name: 'Vault Operator' };
    if (url.pathname.endsWith('/get_my_admin_access')) body = {
      role: options.admin ? 'admin' : 'super_admin', permissions: ['analytics.view', 'integrations.view'],
    };
    if (url.pathname.endsWith('/admin_overview')) body = {
      users_total: 0, users_new: 0, listings_published: 0, listings_suspended: 0,
      bookings_by_status: {}, gross_rental: 0, platform_fees: 0, refunds: 0,
      deposit_liability: 0, payables_outstanding: 0, recent_actions: [],
      period: { from: new Date().toISOString(), to: new Date().toISOString() },
    };
    if (url.pathname.endsWith('/admin_vault_prepare')) {
      if (options.unavailable) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'RPC not installed', code: 'PGRST202' }) });
      body = null;
    }
    if (url.pathname === '/auth/v1/factors' && route.request().method() === 'POST') body = {
      id: factorId, type: 'totp', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>', secret: 'FIXTUREONLYNOTAREALKEY' },
    };
    if (url.pathname.endsWith('/challenge')) body = { id: 'challenge-fixture', type: 'totp', expires_at: now + 60 };
    if (url.pathname.endsWith('/verify')) {
      verifyPosts += 1;
      if (options.rejectCode) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'Invalid code', code: 'mfa_verification_failed' }) });
      body = session('aal2');
    }
    if (url.pathname.endsWith('/admin_vault_status')) {
      statusReads += 1;
      if (options.rejectStatus) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Recent authenticator verification required', code: '42501' }) });
      body = {
        expires_at: new Date(Date.now() + (options.ttl ?? 300000)).toISOString(),
        entries: [{ key: 'RESEND_API_KEY', configured: stored, version: stored ? 1 : 0, updated_at: stored ? new Date().toISOString() : null }],
      };
    }
    if (url.pathname.endsWith('/admin_vault_save')) {
      secretWrites += 1;
      if (options.rejectSave) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal failure containing fake-secret-value', code: 'XX000' }) });
      stored = true;
      body = { ok: true, version: 1 };
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/src/lib/supabase.ts', mockSupabaseModule);
  return { reads: () => statusReads, writes: () => secretWrites, verifications: () => verifyPosts };
}

async function start(page: Page) {
  await page.goto(`${appUrl}/admin/vault`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Set up or verify authenticator' }).click();
}
async function unlock(page: Page) {
  await page.getByLabel('Authenticator security code').fill('123456');
  await page.getByRole('button', { name: 'Verify and unlock', exact: true }).click();
}

test('Super Admin vault is locked until MFA, stores write-only values and locks again', async ({ page }) => {
  const calls = await setup(page);
  await start(page);
  expect(calls.reads()).toBe(0);
  await unlock(page);
  await expect(page.getByText('Not stored in vault', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add secret', exact: true }).click();
  await page.getByLabel('New secret value').fill('fake-secret-value');
  const request = page.waitForRequest((request) => request.url().endsWith('/admin_vault_save'));
  await page.getByRole('button', { name: 'Store encrypted secret' }).click();
  expect((await request).postDataJSON()).toMatchObject({ p_key: 'RESEND_API_KEY', p_expected_version: 0, p_secret: 'fake-secret-value' });
  await expect(page.getByText('Stored - value hidden', { exact: true })).toBeVisible();
  await expect(page.getByText('Secret stored encrypted.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reveal|Copy secret/ })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fake-secret-value');
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(page.getByText('Unlock with MFA', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace secret' })).toHaveCount(0);
});

test('ordinary admin cannot see or open Vault Chest', async ({ page }) => {
  const calls = await setup(page, { admin: true });
  await page.goto(`${appUrl}/admin/vault`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Admin', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vault Chest', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vault Chest', exact: true })).toHaveCount(0);
  expect(calls.reads()).toBe(0);
});

test('invalid code does not call the vault status endpoint', async ({ page }) => {
  const calls = await setup(page, { rejectCode: true });
  await start(page);
  await unlock(page);
  await expect(page.getByText(/authenticator code could not be verified/)).toBeVisible();
  expect(calls.verifications()).toBe(1);
  expect(calls.reads()).toBe(0);
  await expect(page.getByLabel('Authenticator security code')).toHaveValue('');
});

test('new MFA enrollment shows a usable QR and manual key, then removes both after verification', async ({ page }) => {
  await setup(page, { enroll: true });
  await start(page);
  const image = page.getByRole('img', { name: 'YBuy authenticator enrollment QR code' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByLabel('Manual setup key')).toHaveValue('FIXTUREONLYNOTAREALKEY');
  await unlock(page);
  await expect(page.getByText('Not stored in vault', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Manual setup key')).toHaveCount(0);
});

test('vault expiry removes an open editor and clears secret input', async ({ page }) => {
  await setup(page, { ttl: 3500 });
  await start(page);
  await unlock(page);
  await page.getByRole('button', { name: 'Add secret', exact: true }).click();
  await page.getByLabel('New secret value').fill('fake-secret-value');
  await expect(page.getByText(/Vault access expired/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByLabel('New secret value')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add secret', exact: true })).toHaveCount(0);
});

test('save failure is explicit, does not echo backend secret input and clears the value', async ({ page }) => {
  await setup(page, { rejectSave: true });
  await start(page);
  await unlock(page);
  await page.getByRole('button', { name: 'Add secret', exact: true }).click();
  await page.getByLabel('New secret value').fill('fake-secret-value');
  await page.getByRole('button', { name: 'Store encrypted secret' }).click();
  await expect(page.getByText(/secret could not be saved/)).toBeVisible();
  await expect(page.getByLabel('New secret value')).toHaveValue('');
  await expect(page.getByText('Internal failure containing fake-secret-value')).toHaveCount(0);
  await expect(page.getByText('Secret stored encrypted.', { exact: false })).toHaveCount(0);
});

test('server denial after MFA remains locked and reports missing access or migration', async ({ page }) => {
  await setup(page, { rejectStatus: true });
  await start(page);
  await unlock(page);
  await expect(page.getByText(/Vault access was not granted/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add secret', exact: true })).toHaveCount(0);
});

test('missing vault backend blocks authenticator setup before any Auth mutation', async ({ page }) => {
  await setup(page, { unavailable: true, enroll: true });
  let authMutations = 0;
  page.on('request', (request) => {
    if (request.url().includes('/auth/v1/factors') && request.method() !== 'GET') authMutations += 1;
  });
  await start(page);
  await expect(page.getByText(/install the vault backend migration/)).toBeVisible();
  await expect(page.getByLabel('Manual setup key')).toHaveCount(0);
  expect(authMutations).toBe(0);
});
