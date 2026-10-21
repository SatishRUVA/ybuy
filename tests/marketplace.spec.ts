import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

const appUrl = 'http://127.0.0.1:5174';
const userId = 'b1000000-0000-4000-8000-000000000001';

function sessionForUser() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = {
    id: userId, aud: 'authenticated', role: 'authenticated', email: 'renter@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Renter' }, identities: [],
    email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  };
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: userId, aud: 'authenticated', role: 'authenticated', exp: expiresAt, iat: expiresAt - 3600,
    })}.test-signature`,
    refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user,
  };
}

async function setup(page: Page, flags: { item_requests: boolean; bidding: boolean; mock_bidding?: boolean }, admin = false) {
  const channels = new Map<string, { socket: WebSocketRoute; joinRef: string }>();
  await page.routeWebSocket('**/realtime/v1/websocket**', (socket) => {
    socket.onMessage((message) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === 'phx_join') {
        channels.set(topic, { socket, joinRef });
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', {
          status: 'ok', response: { postgres_changes: payload.config.postgres_changes.map((filter: object) => ({ ...filter, id: 1 })) },
        }]));
      } else if (event === 'heartbeat' || event === 'phx_leave') {
        if (event === 'phx_leave') channels.delete(topic);
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appUrl) return route.continue();

    const user = sessionForUser().user;
    let body: unknown = [];
    if (url.pathname === '/auth/v1/user') body = user ?? {};
    if (url.pathname === '/rest/v1/rpc/has_active_session') body = Boolean(user);
    if (url.pathname === '/rest/v1/rpc/get_my_profile') body = user && {
      id: user.id, email: user.email, full_name: 'Renter', avatar_url: null, phone: null, location: null,
      created_at: user.created_at,
    };
    if (url.pathname === '/rest/v1/rpc/get_my_admin_access') body = admin ? { role: 'admin', permissions: ['flags.manage'] } : null;
    if (url.pathname === '/rest/v1/rpc/expire_marketplace_activity') body = { expired: 0 };
    if (url.pathname === '/rest/v1/rpc/get_item_request_response_counts') body = {};
    if (url.pathname === '/rest/v1/feature_flags') {
      body = Object.entries(flags).map(([key, enabled]) => ({ key, enabled, description: `Control ${key}`, updated_at: new Date().toISOString() }));
    }
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: JSON.stringify(body),
    });
  });
  return {
    disconnectAndChange(key: keyof typeof flags, enabled: boolean, event: 'phx_error' | 'phx_close') {
      flags[key] = enabled;
      for (const [topic, { socket, joinRef }] of channels) {
        if (topic.startsWith('realtime:feature-flags:')) {
          if (event === 'phx_close') channels.delete(topic);
          socket.send(JSON.stringify([joinRef, null, topic, event, {}]));
        }
      }
    },
    update(key: keyof typeof flags, enabled: boolean) {
      flags[key] = enabled;
      for (const [topic, { socket, joinRef }] of channels) {
        socket.send(JSON.stringify([joinRef, null, topic, 'postgres_changes', {
          ids: [1], data: { schema: 'public', table: 'feature_flags', type: 'UPDATE',
            commit_timestamp: new Date().toISOString(), columns: [], record: { key, enabled }, old_record: {} },
        }]));
      }
    },
    connections: () => [...channels.keys()].filter((topic) => topic.startsWith('realtime:feature-flags:')).length,
  };
}

async function signIn(page: Page, path: string) {
  await page.goto(`${appUrl}${path}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (session) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const { error } = await supabase.auth.setSession(session);
    if (error) throw error;
  }, sessionForUser());
}

test('real bidding flag does not enable the mock demo', async ({ page }) => {
  await setup(page, { item_requests: false, bidding: true });
  await page.goto(`${appUrl}/bidding`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mock bidding is offline')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mock bidding' })).toBeVisible();
  await expect(page.getByLabel('Your demo bid')).toHaveCount(0);
});

test('persisted-offer ribbon scrolls with heartbeat, compact height and accessible motion alternatives', async ({ page }) => {
  test.slow(true, 'Checks ribbon motion, images, keyboard links and responsive layout on two routes.');
  await setup(page, { item_requests: false, bidding: true });
  const rows = Array.from({ length: 5 }, (_, index) => ({
    listing_id: `b3000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title: `Ticker fixture ${index + 1}`, daily_rate: 100 - index,
    start_date: '2026-11-02', end_date: '2026-11-05',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    image_url: index===0?`${appUrl}/ticker-photo.svg`:index===1?`${appUrl}/ticker-missing.jpg`:null,
  }));
  await page.route('**/ticker-photo.svg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="70"><rect width="56" height="70" fill="#00785e"/></svg>',
  }));
  await page.route('**/ticker-missing.jpg', route => route.fulfill({ status:404, body:'Not found' }));
  await page.route('**/rest/v1/rpc/get_top_listing_bids', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(rows),
  }));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const ticker = page.getByRole('region', { name: 'Top five eligible rental offers' });
  await expect(ticker.getByRole('link')).toHaveCount(5);
  await expect(ticker.getByRole('heading', { name:'TOP 5 OFFERS' })).toBeVisible();
  await expect(ticker.locator('.bid-card-image img').first()).toBeVisible();
  await expect(ticker.locator('.bid-card-image').nth(1).locator('svg')).toBeVisible();
  await expect(ticker.locator('.bid-card-price').first()).toHaveText('$100.00/day');
  await expect(ticker.getByRole('link', { name: /Ticker fixture 1 / })).toHaveAttribute('href', `/listing/${rows[0].listing_id}#rental-offer`);
  await expect(ticker.getByRole('button')).toHaveCount(1);
  const track = ticker.locator('.bid-banner-track');
  await expect(track).toHaveCSS('animation-name', 'bid-news-scroll');
  await expect(ticker.locator('.bid-banner-live')).toHaveCSS('animation-name', 'bid-live-glow');
  await expect(ticker.locator('.bid-banner-live > span')).toHaveCSS('animation-name', 'bid-heartbeat');
  const transforms = await track.evaluate(el => {
    const animation = el.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const start = getComputedStyle(el).transform;
    animation.currentTime = 21000;
    const halfway = getComputedStyle(el).transform;
    animation.play();
    return { start, halfway };
  });
  expect(transforms.halfway).not.toBe(transforms.start);
  expect(await ticker.locator('.bid-banner-copy a').evaluateAll(links => links.every(link => link.getAttribute('tabindex') === '-1'))).toBe(true);
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await ticker.boundingBox())!.height).toBeLessThanOrEqual(76);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path:test.info().outputPath(`news-ribbon-${width}.png`) });
  }
  await ticker.hover();
  await expect(track).toHaveCSS('animation-play-state', 'paused');
  const motion = ticker.getByRole('button', { name: 'Stop bidding ribbon motion' });
  await motion.click();
  await expect(motion).toHaveAttribute('aria-pressed', 'true');
  await expect(track).toHaveCSS('animation-name', 'none');
  await motion.click();
  await expect(motion).toHaveAttribute('aria-pressed', 'false');
  await ticker.getByRole('link').first().focus();
  await page.keyboard.press('Tab');
  await expect(ticker.getByRole('link').nth(1)).toBeFocused();
  await expect(track).toHaveCSS('animation-name', 'none');
  await expect(ticker.getByRole('link').nth(1)).toBeInViewport();
  await motion.evaluate(el => (el as HTMLElement).blur());
  await ticker.getByRole('link').nth(1).evaluate(el => (el as HTMLElement).blur());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(track).toHaveCSS('animation-name', 'none');
  await expect(ticker.locator('.bid-banner-live > span')).toHaveCSS('animation-name', 'none');
  await expect(ticker.locator('.bid-banner-live')).toHaveCSS('animation-name', 'none');
  for (const card of await ticker.getByRole('link').all()) {
    const box = await card.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  }
  await page.goto(`${appUrl}/search`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Top five eligible rental offers' }).getByRole('link')).toHaveCount(5);
});

test('ticker rejects an oversized feed and retry excludes expired offers', async ({ page }) => {
  await setup(page, { item_requests: false, bidding: true });
  let oversized = true;
  await page.route('**/rest/v1/rpc/get_top_listing_bids', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(Array.from({ length: oversized ? 6 : 1 }, (_, index) => ({
      listing_id: `b3000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title: `Expired fixture ${index + 1}`, daily_rate: 10,
      start_date: '2026-11-02', end_date: '2026-11-05',
      expires_at: new Date(Date.now() - 1000).toISOString(), image_url: null,
    }))),
  }));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status').filter({ hasText: 'The live bidding feed returned an invalid result.' })).toBeVisible();
  oversized = false;
  await page.getByRole('button', { name: 'Retry offers', exact: true }).click();
  const ticker = page.getByRole('region', { name: 'Top five eligible rental offers' });
  await expect(ticker.getByText('No eligible offers right now.', { exact: false })).toBeVisible();
  await expect(ticker.getByRole('link', { name: /Expired fixture/ })).toHaveCount(0);
});

test('mock auctions accept demo bids without real mutations and react immediately to the mock flag', async ({ page }) => {
  const live = await setup(page, { item_requests: false, bidding: false, mock_bidding: true });
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/') && request.method() !== 'GET') mutations.push(request.url());
  });
  await page.goto(`${appUrl}/bidding`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Sony A7 IV Mirrorless Camera/ }).click();
  await expect(page).toHaveURL(`${appUrl}/auction/a1`);
  await expect(page.getByText('Demo only', { exact: true })).toBeVisible();
  await page.getByLabel('Your demo bid').fill('82');
  await page.getByRole('button', { name: 'Place demo bid' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a bid above $82');
  await page.getByLabel('Your demo bid').fill('82.01');
  await page.getByRole('button', { name: 'Place demo bid' }).click();
  await expect(page.getByText('Demo bid placed. No money was charged.')).toBeVisible();
  await expect(page.getByText('Current demo bid: $82.01')).toBeVisible();
  expect(mutations).toEqual([]);

  live.update('mock_bidding', false);
  await expect(page.getByText('Mock bidding is offline')).toBeVisible();
  await expect(page.getByLabel('Your demo bid')).toHaveCount(0);
  live.update('mock_bidding', true);
  await expect(page.getByLabel('Your demo bid')).toBeVisible();
  await expect(page.getByText('Current demo bid: $82', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to demo auctions' }).click();
  await expect(page.getByRole('button', { name: /Sony A7 IV Mirrorless Camera/ })).toBeVisible();
});

test('home exposes demo auctions only while mock_bidding is enabled', async ({ page }) => {
  const live = await setup(page, { item_requests: false, bidding: false, mock_bidding: false });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Browse by category' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mock bidding', exact: true })).toHaveCount(0);
  live.update('mock_bidding', true);
  await expect(page.getByRole('heading', { name: 'Mock bidding', exact: true })).toBeVisible();
  live.update('mock_bidding', false);
  await expect(page.getByRole('heading', { name: 'Mock bidding', exact: true })).toHaveCount(0);
});

test('offers remain available when bidding is enabled and item requests are disabled', async ({ page }) => {
  await setup(page, { item_requests: false, bidding: true });
  await signIn(page, '/requests');
  await expect(page.getByRole('heading', { name: 'Item requests', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Offers & negotiations' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('No offers or negotiations yet')).toBeVisible();
});

test('bidding route stays unavailable when its feature flag is off', async ({ page }) => {
  await setup(page, { item_requests: true, bidding: false });
  await signIn(page, '/bidding');
  await expect(page.getByText('Mock bidding is offline')).toBeVisible();
  await expect(page.getByLabel('Your demo bid')).toHaveCount(0);
});

test('request discovery and offer tabs are exposed only when item requests are enabled', async ({ page }) => {
  await setup(page, { item_requests: true, bidding: true });
  await signIn(page, '/requests');
  await expect(page.getByRole('tab', { name: 'Find requests' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'My requests' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Offers & negotiations' })).toBeVisible();
});

test('an open offers page goes offline and returns online through websocket events alone', async ({ page }) => {
  const live = await setup(page, { item_requests: false, bidding: true });
  await signIn(page, '/requests');
  await expect(page.getByText('No offers or negotiations yet')).toBeVisible();
  expect(live.connections()).toBe(1);
  live.update('bidding', false);
  await expect(page.getByText('Item requests are not enabled yet')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Offers & negotiations' })).toHaveCount(0);
  live.update('bidding', true);
  await expect(page.getByText('No offers or negotiations yet')).toBeVisible();
  expect(page.url()).toBe(`${appUrl}/requests`);
});

test('the admin flag switch reflects changes from another client without user action', async ({ page }) => {
  const live = await setup(page, { item_requests: false, bidding: false }, true);
  await signIn(page, '/admin/flags');
  await expect(page.getByRole('switch', { name: 'Enable bidding', exact: true })).not.toBeChecked();
  live.update('bidding', true);
  await expect(page.getByRole('switch', { name: 'Disable bidding', exact: true })).toBeChecked();
  live.update('bidding', false);
  await expect(page.getByRole('switch', { name: 'Enable bidding', exact: true })).not.toBeChecked();
});

test('an open request form disappears immediately when item_requests is disabled', async ({ page }) => {
  const live = await setup(page, { item_requests: true, bidding: false });
  await signIn(page, '/need-something');
  await expect(page.getByRole('heading', { name: 'Request an item', exact: true })).toBeVisible();
  live.update('item_requests', false);
  await expect(page.getByText('Item requests are not enabled yet')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Request an item', exact: true })).toHaveCount(0);
  live.update('item_requests', true);
  await expect(page.getByRole('heading', { name: 'Request an item', exact: true })).toBeVisible();
});

for (const event of ['phx_error', 'phx_close'] as const) {
  test(`${event} blocks feature actions and reconnect resyncs a missed flag change`, async ({ page }) => {
    const live = await setup(page, { item_requests: false, bidding: true });
    await signIn(page, '/requests');
    await expect(page.getByText('No offers or negotiations yet')).toBeVisible();
    live.disconnectAndChange('bidding', false, event);
    await expect(page.getByText(/Live feature settings are disconnected/)).toBeVisible();
    await expect(page.getByText('No offers or negotiations yet')).toHaveCount(0);
    await expect(page.getByText('Item requests are not enabled yet')).toBeVisible({ timeout: 15000 });
  });
}

test('a mounted listing offer form reacts to bidding flag changes', async ({ page }) => {
  const live = await setup(page, { item_requests: false, bidding: true });
  const listing = {
    id: '30000000-0000-4000-8000-000000000001',
    owner_id: '10000000-0000-4000-8000-000000000001',
    category_id: '20000000-0000-4000-8000-000000000001',
    title: 'Negotiable test listing', description: 'A published listing accepting offers.',
    price_per_day: 12, deposit: 0, location_lat: null, location_lng: null, location_label: 'Dallas, TX',
    status: 'published', created_at: '2026-01-01T00:00:00Z', listing_images: [],
    available_quantity: 1, negotiation_enabled: true,
    owner: { id: '10000000-0000-4000-8000-000000000001', full_name: 'Owner', avatar_url: null },
    categories: { name: 'Tools' },
  };
  await page.route('**/rest/v1/listings?**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('id') === `eq.${listing.id}` ? listing : []) });
  });
  await signIn(page, `/listing/${listing.id}`);
  await expect(page.getByRole('heading', { name: 'Make a rental offer', exact: true })).toBeVisible();
  live.update('bidding', false);
  await expect(page.getByRole('heading', { name: 'Make a rental offer', exact: true })).toHaveCount(0);
  live.update('bidding', true);
  await expect(page.getByRole('heading', { name: 'Make a rental offer', exact: true })).toBeVisible();
});
