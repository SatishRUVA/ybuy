import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseModule } from './mock-supabase';

const userId = '10000000-0000-4000-8000-000000000001';
const appNoticeId = '20000000-0000-4000-8000-000000000001';
const requestNoticeId = '20000000-0000-4000-8000-000000000002';
const messageNoticeId = '20000000-0000-4000-8000-000000000004';

async function setup(page: Page, surface: 'main' | 'preview' = 'preview') {
  await page.addInitScript(() => Object.assign(globalThis, {
    $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type,
    __vite_plugin_react_preamble_installed__: true,
  }));
  await page.route('**/src/main.tsx*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import App from '/src/${surface === 'main' ? 'main-site/' : ''}App.tsx';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));`,
  }));
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
    { id: messageNoticeId, event_key: 'message:test', category: 'messages', title: 'New message',
      body: 'You have a new message.', destination: '/messages/30000000-0000-4000-8000-000000000001', created_at: '2026-11-02T11:00:00Z', read_at: null as string | null },
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
    const headers: Record<string, string> = { 'access-control-allow-origin': request.headers().origin ?? 'http://localhost:5174',
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
      const source = url.pathname.endsWith('/notifications') ? notices : requests;
      const categoryEq = url.searchParams.get('category');
      let rows = source;
      if (categoryEq === 'neq.messages') rows = source.filter(row => row.category !== 'messages');
      if (categoryEq === 'eq.messages') rows = source.filter(row => row.category === 'messages');
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
  return { saved, notices, setFailPreference: () => { failPreference = true; } };
}

test('notification destinations resolve every supported notification path and reject invalid links', async ({ page }) => {
  await setup(page);
  await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  const id = '30000000-0000-4000-8000-000000000001';
  const destinations = [
    ['/dashboard', { name: 'dashboard', tab: 'renting' }],
    ['/dashboard?tab=lending', { name: 'dashboard', tab: 'lending' }],
    ['/dashboard/owner', { name: 'dashboard', tab: 'lending' }],
    ['/dashboard/renter', { name: 'dashboard', tab: 'renting' }],
    ['/dashboard/listings', { name: 'owner-listings' }],
    ['/requests', { name: 'requests', tab: 'browse' }],
    ['/requests?tab=mine', { name: 'requests', tab: 'mine' }],
    ['/requests?tab=offers', { name: 'requests', tab: 'offers' }],
    [`/requests/${id}/matches`, { name: 'requests', requestId: id, matches: true }],
    ['/bidding', { name: 'bidding' }],
    [`/bidding/${id}`, { name: 'bidding-detail', id }],
    [`/auction/${id}`, { name: 'auction', id }],
    [`/listing/${id}`, { name: 'listing', id }],
    [`/listing/${id}?request=${id}`, { name: 'listing', id, requestId: id }],
    [`/confirmation/${id}`, { name: 'confirmation', id }],
    [`/check-in/${id}`, { name: 'check-in', id }],
    [`/check-out/${id}`, { name: 'check-out', id }],
    ['/messages', { name: 'messaging' }],
    [`/messages/${id}`, { name: 'conversation', id }],
    ['/support', { name: 'support' }],
    [`/support/${id}`, { name: 'support', id }],
    ['/claims', { name: 'claims' }],
    [`/claims/${id}`, { name: 'claim-detail', id }],
    ['/profile', { name: 'trust-profile' }],
    ['/payouts', { name: 'owner-payouts' }],
    ['/wallet', { name: 'wallet' }],
  ] as const;
  const invalid = ['', '/unknown', '/check-in', '/check-out/not-a-uuid', `/listing/${id}/extra`,
    `/requests/${id}/unknown`, '/admin', 'javascript:alert(1)', 'https://example.test/dashboard',
    '//example.test/dashboard', '/dashboard#unknown', `/check-in/${id}\\extra`];
  const result = await page.evaluate(async ({ paths, invalid }) => {
    const { notificationRoute } = await import('/src/router.tsx');
    return {
      supported: paths.map(destination => notificationRoute(destination)),
      invalid: invalid.map(destination => notificationRoute(destination)),
    };
  }, { paths: destinations.map(([path]) => path), invalid });
  expect(result.supported).toEqual(destinations.map(([, route]) => route));
  expect(result.invalid).toEqual(invalid.map(() => null));
});

for (const surface of ['main', 'preview'] as const) {
  for (const kind of ['check-in', 'check-out'] as const) {
    test(`notification destinations open ${kind} handoff from ${surface}`, async ({ page }) => {
      test.setTimeout(90_000);
      const backend = await setup(page, surface);
      page.on('pageerror', error => console.error(error.message));
      const id = '30000000-0000-4000-8000-000000000001';
      backend.notices[0].destination = `/${kind}/${id}`;
      backend.notices[0].title = kind === 'check-in' ? 'Renter proposed a handoff time' : 'Your renter started a return';
      await page.route('**/rest/v1/bookings?*', route => route.fulfill({ json: {
        id, listing_id: id, renter_id: userId, owner_id: '10000000-0000-4000-8000-000000000002',
        start_date: '2026-11-02', end_date: '2026-11-05', quantity: 1,
        status: kind === 'check-in' ? 'confirmed' : 'active',
        daily_rate: 20, days: 3, subtotal: 60, service_fee_amount: 0, insurance_amount: 0, deposit: 0, total: 60,
        listing: { id, title: 'Notification handoff camera', listing_images: [] },
        renter: { id: userId, full_name: 'Notification Tester', avatar_url: null },
        owner: { id: '10000000-0000-4000-8000-000000000002', full_name: 'Camera Owner', avatar_url: null },
      } }));
      await page.route('**/rpc/get_booking_handoff', route => route.fulfill({ json: {
        booking_id: id, booking_status: kind === 'check-in' ? 'confirmed' : 'active',
        start_date: '2026-11-02', end_date: '2026-11-05', is_owner: false,
        status: kind === 'check-in' ? 'pickup_ready' : 'rental_active',
        pickup_arrived_at: null, actual_pickup_at: null, return_initiated_at: null, actual_return_at: null,
        pickup: null, return: null, events: [], cases: [],
      } }));
      await page.route('**/rpc/get_booking_pickup', route => route.fulfill({ json: {
        address: '123 Test Street', city: 'Dallas', state: 'TX', postalCode: '75201',
      } }));
      await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
      if (surface === 'main') await page.getByRole('button', { name: 'View update', exact: true }).first().click();
      else await page.getByRole('link').filter({ has: page.getByRole('heading', { name: backend.notices[0].title, exact: true }) }).click();
      await expect(page).toHaveURL(new RegExp(`/${kind}/${id}$`));
      await expect(page.getByRole('heading', { name: kind === 'check-in' ? 'Pickup handoff' : 'Return handoff', exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Notification handoff camera', { exact: true })).toBeVisible();
      expect(backend.notices[0].read_at).not.toBeNull();
    });
  }

  test(`notification destinations show an error without marking unknown links read in ${surface}`, async ({ page }) => {
    test.setTimeout(90_000);
    const backend = await setup(page, surface);
    page.on('pageerror', error => console.error(error.message));
    backend.notices[0].destination = '/unsupported-destination';
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    if (surface === 'main') await page.getByRole('button', { name: 'View update', exact: true }).first().click();
    else await page.getByRole('link').filter({ has: page.getByRole('heading', { name: backend.notices[0].title, exact: true }) }).click();
    if (surface === 'main') await expect(page.getByText('This notification destination is unavailable.', { exact: true })).toBeVisible();
    else await expect(page.getByRole('alert')).toContainText('This notification destination is unavailable.');
    await expect(page).toHaveURL(/\/notifications$/);
    expect(backend.notices[0].read_at).toBeNull();
  });
}

for (const width of [1440, 320]) {
  test(`production notifications use real adapter and persisted preferences at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 320 ? 480 : 1000 });
    const backend = await setup(page);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 30_000 });
    const inbox = page.getByRole('region', { name: 'Notification inbox' });
    await expect(inbox.getByRole('button', { name: 'Unread (3)', exact: true })).toBeVisible();
    if (width === 1440) {
      await expect(page.getByRole('link', { name: 'Messages, 1 unread', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: '3 unread notifications', exact: true })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('link', { name: 'Messages (1 unread)', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Notifications (3 unread)', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(inbox.getByRole('heading', { name: 'New message', exact: true })).toHaveCount(0);
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
    await inbox.getByRole('checkbox', { name: 'Select Your winning bid', exact: true }).check();
    await inbox.getByRole('checkbox', { name: 'Select Request match found', exact: true }).check();
    await inbox.getByRole('button', { name: 'Mark 2 read', exact: true }).click();
    await expect(inbox.getByRole('button', { name: 'Unread (1)', exact: true })).toBeVisible();
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
