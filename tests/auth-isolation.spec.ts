import { expect, test, type Page } from '@playwright/test';
import type { Session, User } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mockSupabaseModule } from './mock-supabase';
import { appUrl, appWebSocketUrl } from './test-url';

// Mocked Data API tests exercise browser state, not RLS or real Google OAuth.
const apiUrl = 'http://localhost:54321';
const aliceId = '10000000-0000-4000-8000-000000000001';
const bobId = '10000000-0000-4000-8000-000000000002';
test.setTimeout(60_000);

function sessionFor(id: string): Session {
  const name = id === aliceId ? 'Alice' : 'Bob';
  const user: User = {
    id, aud: 'authenticated', role: 'authenticated', email: `${name.toLowerCase()}@example.test`,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: name }, identities: [],
    email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: id, aud: 'authenticated', role: 'authenticated', exp: expiresAt, iat: expiresAt - 3600,
  })}.test-signature`;
  return { access_token: accessToken, refresh_token: `test-refresh-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user };
}

const aliceListing = {
  id: '30000000-0000-4000-8000-000000000001', owner_id: aliceId,
  category_id: '20000000-0000-4000-8000-000000000001', title: 'Alice camera',
  description: 'Test listing', price_per_day: 10, deposit: 0, status: 'published',
  created_at: '2026-01-01T00:00:00Z', listing_images: [], categories: { name: 'Electronics' },
  owner: { id: aliceId, full_name: 'Alice', avatar_url: null },
};

async function setup(page: Page, id?: string) {
  await page.route('**/src/lib/local-profile-login.ts*', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'export const LOCAL_PROFILE_LOGIN=false; export const HOSTED_PROFILE_LOGIN=false; export const PROFILE_LOGIN=false; export const PROFILE_ENDPOINT="/api/local-profiles"; export async function loadLocalProfiles(){throw new Error("Profile picker not used in email authentication tests");}',
  }));
  await page.routeWebSocket(`${appWebSocketUrl}/**`, () => {});
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appUrl) {
      if (url.pathname === '/src/lib/local-profile-login.ts') return route.fallback();
      if (url.pathname === '/src/lib/supabase.ts') return mockSupabaseModule(route);
      return route.continue();
    }
    if (url.origin !== apiUrl) return route.fulfill({ contentType: 'application/json', body: '{}' });

    const token = request.headers().authorization?.replace('Bearer ', '');
    const sub = token?.split('.').length === 3
      ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string
      : undefined;
    const user = sub ? sessionFor(sub).user : null;
    let body: unknown = [];
    if (url.pathname === '/rest/v1/rpc/has_active_session') body = Boolean(user);
    if (url.pathname === '/auth/v1/user') body = user;
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (url.pathname === '/rest/v1/rpc/get_my_profile') body = user && {
      id: user.id, email: user.email, full_name: user.user_metadata.full_name,
      avatar_url: null, phone: null, location: null, created_at: user.created_at,
    };
    if (url.pathname === '/rest/v1/favorites' && sub === aliceId) {
      body = url.searchParams.get('select') === 'listing_id'
        ? [{ listing_id: aliceListing.id }]
        : [{ listing: aliceListing }];
    }
    if (url.pathname === '/rest/v1/listings' && url.searchParams.get('owner_id') === `eq.${aliceId}`) {
      body = [aliceListing];
    }
    return route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(body) });
  });
  if (id) {
    await page.addInitScript((session) => {
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session));
    }, sessionFor(id));
  }
}

async function switchAccount(page: Page, id: string) {
  await page.evaluate(async (session) => {
    const modulePath = '/src/lib/supabase.ts';
    const { supabase } = await import(modulePath);
    const { error } = await supabase.auth.setSession(session);
    if (error) throw error;
  }, sessionFor(id));
}

for (const width of [390, 1440]) {
  test(`shared sign-in fields stay visible and checkboxes remain keyboard accessible at ${width}px`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${appUrl}/dashboard`);
    await page.getByRole('button', { name: 'Sign in or create an account' }).click();
    const dialog = page.getByRole('dialog');
    const email = dialog.getByLabel('Email', { exact: true });
    const password = dialog.getByLabel('Password', { exact: true });
    await dialog.getByRole('heading').click();
    for (const input of [email, password]) {
      await expect(input).not.toBeFocused();
      await expect(input).toHaveCSS('border-top-width', '1px');
      await expect(input).toHaveCSS('border-top-style', 'solid');
      await expect(input).toHaveCSS('padding-left', '12px');
      await expect(input).toHaveCSS('padding-top', '0px');
      const bounds = await input.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    const checkbox = dialog.getByRole('checkbox', { name: 'Show password' });
    await expect(checkbox).not.toBeChecked();
    await password.focus();
    await page.keyboard.press('Tab');
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(password).toHaveAttribute('type', 'text');
    await page.keyboard.press('Space');
    await expect(password).toHaveAttribute('type', 'password');
    await page.emulateMedia({ forcedColors: 'active' });
    await checkbox.check();
    await expect(password).toHaveAttribute('type', 'text');
    await page.emulateMedia({ forcedColors: 'none' });
    await page.screenshot({ path: test.info().outputPath(`sign-in-fields-${width}.png`) });
  });
}

test('protected navigation preserves destination and offers YBuy and Google authentication', async ({ page }) => {
  await setup(page);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name: 'Bookings' }).click();
  await expect(page).toHaveURL(`${appUrl}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await page.goto(`${appUrl}/dashboard?tab=lending#section`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${appUrl}/dashboard?tab=lending#section`);
});

test('local development skips the hosted security-code gate and preserves the destination', async ({ page }) => {
  await setup(page);
  let verificationRequested = false;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/access/verify') verificationRequested = true;
  });
  await page.goto(`${appUrl}/access?redirect=${encodeURIComponent('/dashboard?tab=lending')}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(`${appUrl}/dashboard?tab=lending`);
  await expect(page.getByLabel('Security code')).toHaveCount(0);
  expect(verificationRequested).toBe(false);
});

test('Google sign-in preserves the private destination and prompts for an account', async ({ page }) => {
  await setup(page);
  await page.goto(`${appUrl}/dashboard?tab=lending#section`);
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const authorization = page.waitForRequest((req) => new URL(req.url()).pathname === '/auth/v1/authorize');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const url = new URL((await authorization).url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('redirect_to')).toBe(`${appUrl}/dashboard?tab=lending#section`);
  expect(url.searchParams.get('prompt')).toBe('select_account');
});

test('Google initialization failure stays visible with email sign-in available', async ({ page }) => {
  await setup(page);
  await page.goto(`${appUrl}/dashboard`);
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  await page.evaluate(async () => {
    const modulePath = '/src/lib/supabase.ts';
    const { supabase } = await import(modulePath);
    supabase.auth.signInWithOAuth = async () => { throw new Error('Provider unavailable'); };
  });
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Could not start Google sign-in');
  await expect(page.getByRole('dialog').getByLabel('Email', { exact: true })).toBeEnabled();
});

test('YBuy email and password sign-in still authenticates on the requested page', async ({ page }) => {
  await setup(page);
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ email: 'alice@example.test', password: 'Test-password-123' });
    await route.fulfill({ json: sessionFor(aliceId) });
  });
  await page.goto(`${appUrl}/favorites`);
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  await page.getByRole('dialog').getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByRole('dialog').getByLabel('Password', { exact: true }).fill('Test-password-123');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Alice camera')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(`${appUrl}/favorites`);
});

test('password reset request returns enumeration-safe confirmation', async ({ page }) => {
  await setup(page);
  let resetEmail = '';
  await page.route('**/auth/v1/recover', async (route) => {
    resetEmail = route.request().postDataJSON().email;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await dialog.getByRole('button', { name: 'Forgot password?' }).click();
  await dialog.getByRole('button', { name: 'Send reset link' }).click();
  await expect(dialog.getByRole('alert')).toContainText('If an account uses that email');
  expect(resetEmail).toBe('alice@example.test');
});

test('password recovery callback accepts a new password', async ({ page }) => {
  await setup(page);
  let updatedPassword = '';
  await page.route('**/auth/v1/user', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    updatedPassword = route.request().postDataJSON().password;
    await route.fulfill({ json: sessionFor(aliceId).user });
  });
  const recovery = sessionFor(aliceId);
  const hash = new URLSearchParams({
    access_token: recovery.access_token, refresh_token: recovery.refresh_token,
    expires_in: '3600', token_type: 'bearer', type: 'recovery',
  });
  await page.goto(`${appUrl}/#${hash}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await dialog.getByLabel('New password', { exact: true }).fill('New-test-password-456');
  await dialog.getByRole('button', { name: 'Update password' }).click();
  await expect(dialog).toHaveCount(0);
  expect(updatedPassword).toBe('New-test-password-456');
});

test('OAuth callback failures are visible and private routes stay gated', async ({ page }) => {
  await setup(page);
  await page.goto(`${appUrl}/favorites#error=access_denied&error_description=Denied`);
  await expect(page.getByRole('alert')).toContainText('Sign-in was cancelled');
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page).toHaveURL(`${appUrl}/favorites`);
});

test('switching accounts clears favorites before the new request finishes', async ({ page }) => {
  await setup(page, aliceId);
  await page.goto(`${appUrl}/favorites`);
  await expect(page.getByText('Alice camera')).toBeVisible();
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/rest/v1/favorites?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('user_id') !== `eq.${bobId}`) return route.fallback();
    await pending;
    return route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await switchAccount(page, bobId);
  await expect(page.getByText('Alice camera')).toHaveCount(0);
  release?.();
  await expect(page.getByRole('heading', { name: 'Nothing saved yet' })).toBeVisible();
});

test('a late response for the old account cannot populate the new account', async ({ page }) => {
  await setup(page, aliceId);
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/rest/v1/favorites?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('user_id') !== `eq.${aliceId}`) return route.fallback();
    await pending;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ listing: aliceListing }]) });
  });
  const aliceRequest = page.waitForRequest((req) => req.url().includes('/favorites?'));
  await page.goto(`${appUrl}/favorites`);
  await aliceRequest;
  await switchAccount(page, bobId);
  await expect(page.getByRole('heading', { name: 'Nothing saved yet' })).toBeVisible();
  const oldResponse = page.waitForResponse((res) => res.url().includes(encodeURIComponent(aliceId)) && res.url().includes('/favorites?'));
  release?.();
  await oldResponse;
  await expect(page.getByText('Alice camera')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nothing saved yet' })).toBeVisible();
});

test('account switching clears owner listings and scopes both booking tabs', async ({ page }) => {
  await setup(page, aliceId);
  const bookingFilters: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname === '/rest/v1/bookings') bookingFilters.push(url.search);
  });
  await page.goto(`${appUrl}/dashboard?tab=lending`);
  await expect(page.getByRole('heading', { name: 'Alice camera', exact: true })).toBeVisible();
  await switchAccount(page, bobId);
  await expect(page.getByText('Alice camera', { exact: true })).toHaveCount(0);
  await expect.poll(() => bookingFilters.some((filter) => filter.includes(`renter_id=eq.${bobId}`))).toBe(true);
  await expect.poll(() => bookingFilters.some((filter) => filter.includes(`owner_id=eq.${bobId}`))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Turn something you own into income.' })).toBeVisible();
});

test('new account profile counts are zero and old profile never persists', async ({ page }) => {
  await setup(page, aliceId);
  await page.goto(`${appUrl}/profile`);
  await expect(page.getByText('Signed in as alice@example.test', { exact: true })).toBeVisible();
  await switchAccount(page, bobId);
  await expect(page.getByText('Signed in as alice@example.test')).toHaveCount(0);
  await expect(page.getByText('Signed in as bob@example.test', { exact: true })).toBeVisible();
  for (const label of ['Completed rentals', 'Listings owned', 'Reviews received']) {
    await expect(page.getByText(label, { exact: true }).locator('..')).toContainText('0');
  }
});

for (const status of [400, 503]) {
  test(`failed remote sign-out (${status}) reports the error and clears the local session`, async ({ page }) => {
    await setup(page, aliceId);
    await page.route('**/auth/v1/logout?**', (route) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify({ message: 'Sign-out unavailable' }),
    }));
    await page.goto(`${appUrl}/profile`);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not sign out');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByText('Signed in as alice@example.test')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('sb-localhost-auth-token'))).toBeNull();
  });
}

test('successful logout clears private UI and persisted auth state', async ({ page }) => {
  await setup(page, aliceId);
  await page.goto(`${appUrl}/profile`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page.getByText('Signed in as alice@example.test')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sb-localhost-auth-token'))).toBeNull();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an SDK session-end event clears private UI and prompts sign-in', async ({ page }) => {
  await setup(page, aliceId);
  await page.goto(`${appUrl}/favorites`);
  await expect(page.getByText('Alice camera')).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = '/src/lib/supabase.ts';
    const { supabase } = await import(modulePath);
    await supabase.auth.signOut({ scope: 'local' });
  });
  await expect(page.getByRole('alert')).toContainText('Your session has expired or ended');
  await expect(page.getByText('Alice camera')).toHaveCount(0);
});

test('profile fetch failure has a visible recovery message rather than a blank page', async ({ page }) => {
  await setup(page, aliceId);
  await page.route('**/rest/v1/rpc/get_my_profile', (route) => route.fulfill({
    status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Denied' }),
  }));
  await page.goto(`${appUrl}/profile`);
  await expect(page.getByRole('alert')).toContainText('Could not load your profile');
  await expect(page.getByText('Your profile is unavailable. Please refresh to retry.')).toBeVisible();
});

test('favorite deletion failure preserves the item and displays the error', async ({ page }) => {
  await setup(page, aliceId);
  await page.route('**/rest/v1/favorites?**', (route) => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Cannot remove favorite' }) })
    : route.fallback());
  await page.goto(`${appUrl}/favorites`);
  await page.getByRole('button', { name: /Remove from/ }).click();
  await expect(page.getByText('Could not remove this saved item. Please try again.')).toBeVisible();
  await expect(page.getByText('Alice camera')).toBeVisible();
});

test('startup never seeds and demo tooling refuses remote databases', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(manifest.scripts.dev).toBe('vite');
  const disabled = spawnSync(process.execPath, ['scripts/seed-demo.mjs'], {
    env: { ...process.env, DEMO_MODE: 'false' }, encoding: 'utf8',
  });
  expect(disabled.status).toBe(0);
  expect(disabled.stdout).toContain('No data was changed');
  const remote = spawnSync(process.execPath, ['scripts/seed-demo.mjs'], {
    env: { ...process.env, DEMO_MODE: 'true', VITE_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'not-a-secret' },
    encoding: 'utf8',
  });
  expect(remote.status).toBe(1);
  expect(remote.stderr).toContain('Refusing to seed a non-local database');
  const missingKey = spawnSync(process.execPath, ['scripts/seed-demo.mjs'], {
    env: { ...process.env, DEMO_MODE: 'true', VITE_SUPABASE_URL: apiUrl, SUPABASE_SERVICE_ROLE_KEY: '' },
    encoding: 'utf8',
  });
  expect(missingKey.status).toBe(1);
  expect(missingKey.stderr).toContain('SUPABASE_SERVICE_ROLE_KEY is required');
});
