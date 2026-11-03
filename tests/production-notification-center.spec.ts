import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

const userId = '10000000-0000-4000-8000-000000000001';
const appNoticeId = '20000000-0000-4000-8000-000000000001';
const requestNoticeId = '20000000-0000-4000-8000-000000000002';

async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));
  const expiresAt = Math.floor(Date.parse('2026-11-02T13:00:00Z') / 1000);
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'renter@example.test',
    app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: 'Notification Tester' },
    identities: [], created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z' };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  await page.addInitScript(session => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session)), {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: expiresAt })}.test-signature`,
    refresh_token: 'test-refresh', token_type: 'bearer', expires_at: expiresAt, expires_in: 3600, user,
  });
  await page.route('**/src/lib/supabase.ts*', mockSupabaseModule);
  await page.route(/^https:\/\//, route => route.abort());
  await page.routeWebSocket('**/realtime/v1/websocket**', socket => {
    socket.onMessage(message => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (['phx_join', 'phx_leave', 'heartbeat'].includes(event)) socket.send(JSON.stringify([
        joinRef, ref, topic, 'phx_reply', { status: 'ok', response: event === 'phx_join'
          ? { postgres_changes: payload.config.postgres_changes.map((filter: object, id: number) => ({ ...filter, id })) } : {} },
      ]));
    });
  });
  const notices = [
    { id: appNoticeId, event_key: 'auction-winner:test', category: 'bidding', title: 'Your winning bid',
      body: 'Complete payment before the deadline.', destination: '/dashboard', created_at: '2026-11-02T10:00:00Z', read_at: null as string | null },
    { id: '20000000-0000-4000-8000-000000000003', event_key: 'listing-availability:test', category: 'listings', title: 'Listing available tomorrow',
      body: 'Check the listing dates.', destination: '/dashboard/listings', created_at: '2026-11-01T10:00:00Z', read_at: null as string | null },
  ];
  const requests = [{ id: requestNoticeId, event_type: 'request_match', item_request_id: '30000000-0000-4000-8000-000000000001',
    negotiation_id: null, title: 'Request match found', body: 'A rental matches your request.', created_at: '2026-11-02T09:00:00Z', read_at: null as string | null }];
  const preferences: Record<string, boolean> = Object.fromEntries(
    ['bookings', 'messages', 'requests', 'listings', 'bidding', 'payments', 'cases', 'promotions']
      .flatMap(category => [[`${category}_in_app`, true], [`${category}_email`, true]]),
  );
  const saved: Record<string, boolean>[] = [];
  let failPreference = false;
  await page.route('http://localhost:54321/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers: Record<string, string> = { 'access-control-allow-origin': 'http://localhost:5174',
      'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS,HEAD' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const rpc = url.pathname.replace('/rest/v1/rpc/', '');
    let body: unknown = [];
    let status = 200;
    if (url.pathname === '/auth/v1/user') body = user;
    else if (rpc === 'has_active_session') body = true;
    else if (rpc === 'get_my_profile') body = { id: userId, email: user.email, full_name: 'Notification Tester', avatar_url: null, created_at: user.created_at };
    else if (rpc === 'get_my_admin_access') body = null;
    else if (url.pathname === '/rest/v1/notifications' || url.pathname === '/rest/v1/marketplace_notifications') {
      const rows = url.pathname.endsWith('/notifications') ? notices : requests;
      headers['content-range'] = `0-${Math.max(0, rows.length - 1)}/${request.method() === 'HEAD' ? rows.filter(row => !row.read_at).length : rows.length}`;
      body = rows;
    } else if (url.pathname === '/rest/v1/notification_preferences') {
      if (request.method() === 'PATCH') {
        const patch: Record<string, boolean> = request.postDataJSON();
        if (failPreference) { status = 503; body = { message: 'Preference service unavailable' }; }
        else { saved.push(patch); Object.assign(preferences, patch); body = { user_id: userId }; }
      } else body = preferences;
    } else if (rpc === 'mark_persistent_notification_read') {
      const id = request.postDataJSON().p_notification_id;
      const row = notices.find(item => item.id === id);
      if (row) row.read_at = '2026-11-02T12:00:00Z';
    } else if (rpc === 'mark_marketplace_notification_read') {
      requests[0].read_at = '2026-11-02T12:00:00Z';
    } else if (!['/rest/v1/feature_flags', '/rest/v1/app_settings'].includes(url.pathname)) {
      status = 500; body = { message: `Unexpected backend request: ${url.pathname}` };
    }
    return route.fulfill({ status, headers, contentType: 'application/json',
      body: request.method() === 'HEAD' ? '' : JSON.stringify(body) });
  });
  return { saved, setFailPreference: () => { failPreference = true; } };
}

for (const width of [1440, 320]) {
  test(`production notifications use real adapter and persisted preferences at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 320 ? 480 : 1000 });
    const backend = await setup(page);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: '3 unread notifications', exact: true })).toBeVisible();
    await expect(page.getByText('Sample updates for design approval.', { exact: false })).toHaveCount(0);
    const settings = page.getByRole('complementary', { name: 'Notification settings' });
    await expect(settings.getByRole('switch', { name: /^Bookings/ })).toBeDisabled();
    await expect(settings.getByRole('switch', { name: /^Payments/ })).toBeDisabled();
    await expect(settings.getByRole('switch', { name: /^Safety & support/ })).toBeDisabled();
    await settings.getByRole('switch', { name: /^Listings/ }).click();
    await expect(settings.getByRole('switch', { name: /^Listings/ })).not.toBeChecked();
    expect(backend.saved).toEqual([{ listings_in_app: false }]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(settings.getByRole('switch', { name: /^Listings/ })).not.toBeChecked({ timeout: 30_000 });
    const inbox = page.getByRole('region', { name: 'Notification inbox' });
    await inbox.getByRole('checkbox', { name: 'Select Your winning bid', exact: true }).check();
    await inbox.getByRole('checkbox', { name: 'Select Request match found', exact: true }).check();
    await inbox.getByRole('button', { name: 'Mark 2 read', exact: true }).click();
    await expect(page.getByRole('link', { name: '1 unread notifications', exact: true })).toBeVisible();
    await expect(inbox.getByRole('heading', { name: 'Your winning bid', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('production preference failures are visible and do not pretend to save', async ({ page }) => {
  test.setTimeout(90_000);
  const backend = await setup(page);
  await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  const settings = page.getByRole('complementary', { name: 'Notification settings' });
  await expect(settings.getByRole('switch', { name: /^Listings/ })).toBeEnabled({ timeout: 30_000 });
  backend.setFailPreference();
  await settings.getByRole('switch', { name: /^Listings/ }).click();
  await expect(settings.getByRole('alert')).toContainText('Preference service unavailable');
  await expect(settings.getByRole('switch', { name: /^Listings/ })).toBeChecked();
  expect(backend.saved).toEqual([]);
});
