import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { appUrl } from './test-url';
import { mockSupabaseModule } from './mock-supabase';

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

async function setup(page: Page, flags: { item_requests: boolean; bidding: boolean; private_offers?: boolean; mock_bidding?: boolean }, admin = false) {
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
    if (url.origin === appUrl) {
      if (url.pathname === '/src/lib/supabase.ts') return mockSupabaseModule(route);
      return route.continue();
    }

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
    if (url.pathname === '/rest/v1/rpc/get_listing_auction_feed') body = { items: [], total: 0, categories: [] };
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
  await page.addInitScript((session) => {
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session));
  }, sessionForUser());
  await page.goto(`${appUrl}${path}`, { waitUntil: 'domcontentloaded' });
}

test('auction notification inbox shows event icons and opens the real auction on desktop and phone', async ({ page }, testInfo) => {
  test.slow();
  await setup(page, { item_requests: false, bidding: true });
  const listingId = 'b3000000-0000-4000-8000-000000000001';
  const events = [
    ['auction-bid-accepted', 'Bid accepted'],
    ['auction-outbid', 'You have been outbid'],
    ['auction-extended', 'Auction extended'],
    ['auction-closed', 'Auction ended'],
    ['auction-winner', 'Your rental bid was selected'],
    ['auction-not-selected', 'Not selected'],
    ['auction-payment-reminder', 'Payment reminder'],
    ['booking', 'Booking confirmed'],
  ];
  const notifications = events.map(([event, title], index) => ({
    id: `c1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    event_key: `${event}:fixture`, category: 'bookings', title,
    body: `Auction update for Camera rental: ${title}.`,
    destination: `/bidding/${listingId}`, created_at: new Date().toISOString(), read_at: null,
  }));
  await page.route('**/rest/v1/notifications?**', (route) => route.fulfill({
    contentType: 'application/json', headers: { 'content-range': '0-7/8', 'access-control-expose-headers': 'content-range' },
    body: route.request().method() === 'HEAD' ? '' : JSON.stringify(notifications),
  }));
  await page.route('**/rest/v1/notification_preferences?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(Object.fromEntries(
      ['bookings', 'messages', 'requests', 'payments', 'cases', 'promotions']
        .flatMap((category) => ['in_app', 'email'].map((channel) => [`${category}_${channel}`, category === 'bookings'])),
    )),
  }));
  await page.route('**/rest/v1/rpc/mark_persistent_notification_read', (route) => route.fulfill({
    contentType: 'application/json', body: 'null',
  }));
  await page.route('**/functions/v1/send-notification-emails', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ processed: 0, sent: 0, retrying: 0, failed: 0, unknown: 0 }),
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, '/notifications');
  const history = page.getByRole('region', { name: 'Notification history' });
  await expect(history).toBeVisible({ timeout: 60000 });
  for (const [, title] of events) await expect(history.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(history.locator('svg')).toHaveCount(8);
  await expect(page.getByRole('main').getByText('8 unread notifications', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('auction-notifications-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(history.getByRole('button', { name: 'View update' })).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('auction-notifications-mobile.png'), fullPage: true });
  await history.getByRole('button', { name: 'View update' }).first().click();
  await expect(page).toHaveURL(`${appUrl}/bidding/${listingId}`);
});

test('real bidding flag does not enable the mock demo', async ({ page }) => {
  await setup(page, { item_requests: false, bidding: true });
  await page.goto(`${appUrl}/bidding`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Live bidding', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('TEST DATA · 10 sample auctions')).toBeVisible();
  await expect(page.getByLabel('Your demo bid')).toHaveCount(0);
});

test('live ticker counts down automatically and removes offers at their bidding deadline', async ({ page }) => {
  const now = new Date('2026-10-27T09:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await setup(page, { item_requests: false, bidding: true });
  const row = {
    listing_id: 'b3000000-0000-4000-8000-000000000001',
    title: 'Countdown fixture', daily_rate: 25,
    start_date: '2026-11-02', end_date: '2026-11-05',
    expires_at: new Date(now.getTime() + 3602000).toISOString(), image_url: null,
  };
  await page.route('**/rest/v1/rpc/get_top_listing_bids', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([row]),
  }));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const ticker = page.getByRole('region', { name: 'Top rental offers' });
  const time = ticker.locator('.bid-banner-group').first().locator('time');
  await expect(time).toHaveText(' · 1h 00m 02s left to bid');
  await expect(time).toHaveAttribute('datetime', row.expires_at);
  await page.clock.runFor(3000);
  await expect(time).toHaveText(' · 0h 59m 59s left to bid');
  await page.setViewportSize({ width: 375, height: 812 });
  const badge = ticker.locator('.bid-card-badge').first();
  expect(await badge.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.clock.fastForward(3599000);
  await expect(ticker.getByRole('link', { name: /Countdown fixture/ })).toHaveCount(0);
  await expect(ticker.locator('time')).toHaveCount(0);
});

test('Top Offers news ribbon stays 72px tall with heartbeat, whole-dollar prices and accessible motion', async ({ page }) => {
  test.slow(true, 'Checks scrolling, keyboard links and responsive layout on two routes.');
  await setup(page, { item_requests: false, bidding: true });
  const rows = Array.from({ length: 5 }, (_, index) => ({
    listing_id: `b3000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title: `Ticker fixture ${index + 1}${index === 0 ? ' with a very long rental title that must truncate without changing card dimensions' : ''}`, daily_rate: 100.5 - index,
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
  const ticker = page.getByRole('region', { name: 'Top rental offers' });
  await expect(ticker.getByRole('link')).toHaveCount(6);
  await expect(ticker.getByRole('heading', { name: 'Top Offers', exact: true })).toBeVisible();
  await expect(ticker.locator('.bid-card-image img').first()).toBeVisible();
  await expect(ticker.locator('.bid-card-image').nth(1).locator('svg')).toBeVisible();
  await expect(ticker.locator('.bid-card-price').first()).toHaveText('$101 / day');
  await expect(ticker.getByRole('link', { name: /Ticker fixture 1 / })).toHaveAttribute('href', `/bidding/${rows[0].listing_id}`);
  await expect(ticker.locator('.bid-banner-group').first().locator('.bid-card-badge')).toHaveText(Array(5).fill(/LIVE OFFER.*left to bid/));
  await expect(ticker.locator('.bid-banner-arrow')).toHaveCount(0);
  const firstTitle = ticker.locator('.bid-card-title').first();
  await expect(firstTitle).toHaveCSS('text-overflow', 'ellipsis');
  expect(await firstTitle.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(firstTitle).toHaveAttribute('title', rows[0].title);
  const geometry = await ticker.locator('.bid-banner-group').first().locator('.bid-card').evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    const image = card.querySelector('.bid-card-image')!.getBoundingClientRect();
    const content = card.querySelector('.bid-card-content')!.getBoundingClientRect();
    return { width: box.width, height: box.height, padding: style.padding, border: style.borderWidth, imageWidth: image.width, imageHeight: image.height, imageInset: Math.round(image.x - box.x), textInset: Math.round(content.x - box.x), imageTop: Math.round(image.y - box.y), textTop: Math.round(content.y - box.y), bottom: Math.round(Math.max(image.bottom, content.bottom) - box.y) };
  }));
  for (const card of geometry) {
    expect({ ...card, width: Math.round(card.width) }).toEqual({ ...geometry[0], width: Math.round(geometry[0].width) });
    expect(card.height).toBe(56);
    expect(card.border).toBe('0px');
    expect(card.imageWidth).toBe(40);
    expect(card.imageHeight).toBe(40);
    expect(card.bottom).toBeLessThanOrEqual(card.height - 6);
  }
  const toggle = ticker.getByRole('button', { name: /bidding ribbon motion/ });
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
  expect(transforms.start).not.toBe(transforms.halfway);
  expect(Number(transforms.halfway.split(',')[4])).toBeLessThan(Number(transforms.start.split(',')[4]));
  expect(await ticker.locator('.bid-banner-copy a').evaluateAll(links => links.every(link => link.getAttribute('tabindex') === '-1'))).toBe(true);
  for (const [width, height] of [[2000, 900], [1440, 900], [1024, 900], [768, 900], [812, 375], [375, 812]]) {
    await page.setViewportSize({ width, height });
    const bounds = (await ticker.boundingBox())!;
    expect(bounds.height).toBe(72);
    expect(bounds.x).toBe(0);
    expect(bounds.width).toBe(width);
    await expect(ticker).toHaveCSS('margin', '0px');
    await expect(ticker.locator('.bid-card-title').first()).toHaveCSS('font-size', '13px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`top-offers-${width}.png`) });
  }
  await ticker.hover();
  await expect(track).toHaveCSS('animation-play-state', 'running');
  await ticker.locator('.bid-banner-viewport').hover();
  await expect(track).toHaveCSS('animation-play-state', 'running');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(track).toHaveCSS('animation-name', 'none');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Tab');
  await expect(ticker.getByRole('group', { name: 'Live rental offers' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(track).toHaveCSS('animation-name', 'none');
  for (const card of await ticker.getByRole('link', { name: /Ticker fixture/ }).all()) {
    await expect(card).toBeFocused();
    await expect(card).toBeInViewport();
    await expect(card).toHaveCSS('outline-style', 'solid');
    expect(await card.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Tab');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(track).toHaveCSS('animation-name', 'none');
  await expect(ticker.locator('.bid-banner-live > span')).toHaveCSS('animation-name', 'none');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(ticker.locator('.bid-card-title').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(ticker.locator('.bid-card').first()).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.1)');
  await page.screenshot({ path: test.info().outputPath('top-offers-dark-mobile.png') });
  await page.goto(`${appUrl}/search`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Top rental offers' }).getByRole('link')).toHaveCount(6);
});

test('bidding sleeve minimizes and expands with keyboard on desktop and phone', async ({ page }) => {
  test.slow();
  await setup(page, { item_requests: false, bidding: true });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const ticker = page.getByRole('region', { name: 'Top rental offers' });
  await expect(ticker.getByRole('heading', { name: 'Top Offers', exact: true })).toBeVisible();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const motion = ticker.getByRole('button', { name: 'Pause bidding ribbon motion' });
    await motion.click();
    const minimize = ticker.getByRole('button', { name: 'Minimize bidding banner' });
    await expect(minimize).toHaveAttribute('aria-expanded', 'true');
    await minimize.focus();
    await page.keyboard.press('Enter');
    const expand = ticker.getByRole('button', { name: 'Expand bidding banner' });
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(expand).toHaveText('LIVE BIDDING');
    expect((await expand.boundingBox())!.x).toBe(0);
    await expect(expand.locator('svg')).toHaveCount(0);
    await expect(expand.locator('.bid-banner-live')).toHaveCSS('animation-name', 'bid-live-glow');
    await expect(expand.locator('.bid-banner-live > span')).toHaveCSS('animation-name', 'bid-heartbeat');
    await expect(ticker.getByRole('heading')).toHaveCount(0);
    await expect(ticker.getByRole('link')).toHaveCount(0);
    await expect(ticker).toHaveCSS('height', '0px');
    const tabBox = (await expand.boundingBox())!;
    expect(await expand.evaluate((el, point) => {
      const top = document.elementFromPoint(point.x, point.y);
      return top === el || (top !== null && el.contains(top));
    }, { x: tabBox.x + tabBox.width / 2, y: tabBox.y + tabBox.height / 2 })).toBe(true);
    const controlledId = await expand.getAttribute('aria-controls');
    expect(await page.locator('[id]').evaluateAll((elements, id) =>
      elements.some(element => element.id === id && element.hasAttribute('hidden')), controlledId)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`bidding-sleeve-${width}.png`) });
    await page.keyboard.press('Space');
    await expect(minimize).toBeFocused();
    await expect(minimize).toHaveAttribute('aria-expanded', 'true');
    await expect(ticker).toHaveCSS('height', '72px');
    await expect(ticker.getByRole('heading', { name: 'Top Offers', exact: true })).toBeVisible();
    const resume = ticker.getByRole('button', { name: 'Resume bidding ribbon motion' });
    await expect(resume).toHaveAttribute('aria-pressed', 'true');
    await resume.click();
    await expect(ticker.locator('.bid-banner-track')).toHaveCSS('animation-name', 'bid-news-scroll');
    await ticker.getByRole('button', { name: 'Minimize bidding banner' }).click();
    await ticker.getByRole('button', { name: 'Expand bidding banner' }).click();
    const track = ticker.locator('.bid-banner-track');
    await expect(track).toHaveCSS('animation-name', 'bid-news-scroll');
    await expect(track).toHaveCSS('animation-play-state', 'running');
    const initialPosition = await track.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
    await expect.poll(() => track.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)).toBeLessThan(initialPosition - 1);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ticker.getByRole('button', { name: 'Minimize bidding banner' }).click();
  await ticker.getByRole('button', { name: 'Expand bidding banner' }).click();
  await expect(ticker.locator('.bid-banner-track')).toHaveCSS('animation-name', 'none');
  await expect(ticker.locator('.bid-banner-viewport')).toHaveCSS('scrollbar-width', 'none');

  await page.route('**/rest/v1/rpc/get_top_listing_bids', route => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Feed temporarily unavailable' }),
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(ticker.getByText('Live offers unavailable')).toBeVisible();
  await ticker.getByRole('button', { name: 'Minimize bidding banner' }).click();
  await expect(ticker.getByText('Live offers unavailable')).toBeHidden();
  await ticker.getByRole('button', { name: 'Expand bidding banner' }).click();
  await expect(ticker.getByRole('button', { name: 'Retry offers' })).toBeVisible();
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
  const ticker = page.getByRole('region', { name: 'Top rental offers' });
  await expect(ticker.getByText('TEST DATA', { exact: true })).toBeVisible();
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

test('private offers remain available when bidding and item requests are disabled', async ({ page }) => {
  await setup(page, { item_requests: false, bidding: false, private_offers: true });
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
  await setup(page, { item_requests: true, bidding: false, private_offers: true });
  await signIn(page, '/requests');
  await expect(page.getByRole('tab', { name: 'Find requests' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'My requests' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Offers & negotiations' })).toBeVisible();
});

test('an open private-offers page follows its own websocket flag', async ({ page }) => {
  const live = await setup(page, { item_requests: false, bidding: false, private_offers: true });
  await signIn(page, '/requests');
  await expect(page.getByText('No offers or negotiations yet')).toBeVisible();
  expect(live.connections()).toBe(1);
  live.update('private_offers', false);
  await expect(page.getByText('Item requests are not enabled yet')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Offers & negotiations' })).toHaveCount(0);
  live.update('private_offers', true);
  await expect(page.getByText('No offers or negotiations yet')).toBeVisible();
  expect(page.url()).toBe(`${appUrl}/requests`);
});

test('the admin flag switch reflects changes from another client without user action', async ({ page }) => {
  const live = await setup(page, { item_requests: false, bidding: false, private_offers: false }, true);
  await signIn(page, '/admin/flags');
  await expect(page.getByRole('switch', { name: 'Enable bidding', exact: true })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Enable private_offers', exact: true })).not.toBeChecked();
  live.update('bidding', true);
  await expect(page.getByRole('switch', { name: 'Disable bidding', exact: true })).toBeChecked();
  live.update('bidding', false);
  await expect(page.getByRole('switch', { name: 'Enable bidding', exact: true })).not.toBeChecked();
  live.update('private_offers', true);
  await expect(page.getByRole('switch', { name: 'Disable private_offers', exact: true })).toBeChecked();
  live.update('private_offers', false);
  await expect(page.getByRole('switch', { name: 'Enable private_offers', exact: true })).not.toBeChecked();
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
    const live = await setup(page, { item_requests: false, bidding: false, private_offers: true });
    await signIn(page, '/requests');
    await expect(page.getByText('No offers or negotiations yet')).toBeVisible();
    live.disconnectAndChange('private_offers', false, event);
    await expect(page.getByText(/Live feature settings are disconnected/)).toBeVisible();
    await expect(page.getByText('No offers or negotiations yet')).toHaveCount(0);
    await expect(page.getByText('Item requests are not enabled yet')).toBeVisible({ timeout: 15000 });
  });
}

test('a mounted listing private-offer form reacts to private_offers flag changes', async ({ page }) => {
  const live = await setup(page, { item_requests: false, bidding: false, private_offers: true });
  const listing = {
    id: '30000000-0000-4000-8000-000000000001',
    owner_id: '10000000-0000-4000-8000-000000000001',
    category_id: '20000000-0000-4000-8000-000000000001',
    title: 'Negotiable test listing', description: 'A published listing accepting offers.',
    price_per_day: 12, deposit: 0, location_lat: null, location_lng: null, location_label: 'Dallas, TX',
    status: 'published', created_at: '2026-01-01T00:00:00Z', listing_images: [],
    available_quantity: 1, negotiation_enabled: true, offer_minimum_daily: 10, offer_maximum_daily: 14,
    owner: { id: '10000000-0000-4000-8000-000000000001', full_name: 'Owner', avatar_url: null },
    categories: { name: 'Tools' },
  };
  await page.route('**/rest/v1/listings?**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('id') === `eq.${listing.id}` ? listing : []) });
  });
  await signIn(page, `/listing/${listing.id}`);
  await expect(page.getByRole('heading', { name: 'Make an offer', exact: true })).toBeVisible();
  live.update('private_offers', false);
  await expect(page.getByRole('heading', { name: 'Make an offer', exact: true })).toHaveCount(0);
  live.update('private_offers', true);
  await expect(page.getByRole('heading', { name: 'Make an offer', exact: true })).toBeVisible();
});

test('LIVE BIDDING shows ten clearly labeled demo offers when the test feed is empty', async ({ page }) => {
  await setup(page, { item_requests: false, bidding: true });
  await page.setViewportSize({ width: 2000, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const ticker = page.getByRole('region', { name: 'Top rental offers' });
  await expect(ticker.getByRole('heading', { name: 'Top Offers', exact: true })).toBeVisible();
  await expect(ticker.getByText('LIVE BIDDING', { exact: true })).toBeVisible();
  await expect(ticker.getByText('TEST DATA', { exact: true })).toBeVisible();
  const offers = ticker.locator('.bid-banner-group').first().locator('.bid-card-demo');
  await expect(offers).toHaveCount(10);
  await expect(offers.first()).toContainText('10×10 Event Canopy');
  await expect(offers.first()).toContainText('$35');
  for (const image of await offers.locator('img').all()) {
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  }
  await ticker.screenshot({ path: test.info().outputPath('top-offers-reference-desktop.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(ticker.getByText('TEST DATA', { exact: true })).toBeVisible();
  await ticker.screenshot({ path: test.info().outputPath('top-offers-reference-mobile.png') });
});

test('LIVE BIDDING uses persisted top offers instead of synthetic demo content', async ({ page }) => {
  await setup(page, { item_requests: false, bidding: true });
  await page.route('**/rest/v1/rpc/get_top_listing_bids', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      listing_id: '30000000-0000-4000-8000-000000000001',
      title: 'Persisted renter offer', daily_rate: 42.5,
      start_date: '2027-01-04', end_date: '2027-01-07',
      expires_at: new Date(Date.now() + 60000).toISOString(), image_url: null,
    }]),
  }));
  await page.goto('/');

  const ticker = page.getByRole('region', { name: 'Top rental offers' });
  await expect(ticker.getByRole('link', { name: /Persisted renter offer/ })).toBeVisible();
  await expect(ticker.getByText('TEST DATA', { exact: true })).toHaveCount(0);
  await expect(ticker.locator('.bid-card-demo')).toHaveCount(0);
});

test('LIVE BIDDING opens ten filterable samples with keyboard and responsive category controls', async ({ page }, testInfo) => {
  test.slow();
  await setup(page, { item_requests: false, bidding: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const ticker = page.getByRole('region', { name: 'Top rental offers' });
  const link = ticker.getByRole('link', { name: 'LIVE BIDDING', exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${appUrl}/bidding`);
  const samples = page.getByRole('list', { name: 'Sample auctions', exact: true });
  await expect(samples.getByRole('listitem')).toHaveCount(10, { timeout: 60000 });
  await expect(samples.getByRole('link')).toHaveCount(0);
  const electronics = page.getByRole('button', { name: 'Electronics (2)', exact: true });
  await electronics.click();
  await expect(electronics).toHaveAttribute('aria-pressed', 'true');
  await expect(samples.getByRole('listitem')).toHaveCount(2);
  await expect(samples).toContainText('Sony FX3');
  await expect(page.getByRole('main').getByRole('status')).toContainText('2 sample auctions in Electronics');
  for (const width of [1440, 375, 812]) {
    await page.setViewportSize({ width, height: width === 812 ? 375 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`bidding-categories-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'All categories (10)', exact: true }).click();
  await expect(samples.getByRole('listitem')).toHaveCount(10);
  await page.getByRole('button', { name: 'Tools & Equipment (2)', exact: true }).click();
  await expect(samples.getByRole('listitem')).toHaveCount(2);
  await expect(samples).toContainText('Cordless Drill');
});

test('live bidding filters all auction pages, never replaces empty filtered results or errors with samples', async ({ page }) => {
  test.slow();
  await setup(page, { item_requests: false, bidding: true });
  const categories = [
    { id: '93000000-0000-4000-8000-000000000001', name: 'Electronics', count: 25 },
    { id: '93000000-0000-4000-8000-000000000002', name: 'Tools & Equipment', count: 1 },
  ];
  let fails = false;
  await page.route('**/rest/v1/rpc/get_listing_auction_feed', route => {
    if (fails) return route.fulfill({ status: 503, json: { message: 'Auction service unavailable' } });
    const { p_category_id: category, p_offset: offset } = route.request().postDataJSON();
    const total = category === categories[1].id ? 0 : category ? 25 : 26;
    return route.fulfill({ json: { categories, total, items: Array.from({ length: Math.min(24, Math.max(0, total - offset)) }, (_, index) => ({
      listing_id: `94000000-0000-4000-8000-${String(offset + index + 1).padStart(12, '0')}`,
      title: `Auction rental ${offset + index + 1}`, category_id: categories[0].id, category_name: 'Electronics',
      daily_rate: 20, has_bids: index !== 0, image_url: null, start_date: '2026-11-05', end_date: '2026-11-08',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })) } });
  });
  await page.goto('/bidding', { waitUntil: 'domcontentloaded' });
  const results = page.getByRole('list', { name: 'Open auctions', exact: true });
  await expect(results.getByRole('listitem')).toHaveCount(24, { timeout: 60000 });
  await page.getByRole('button', { name: 'All categories (26)', exact: true }).click();
  await expect(results.getByRole('listitem')).toHaveCount(24);
  await expect(page.getByRole('button', { name: 'Refresh auctions', exact: true })).toBeEnabled();
  await expect(results.getByRole('link').first()).toHaveAttribute('href', /^\/bidding\/[0-9a-f-]+$/);
  await expect(results).toContainText('Starting daily bid');
  await page.getByRole('button', { name: 'Load more auctions', exact: true }).click();
  await expect(results.getByRole('listitem')).toHaveCount(26);
  await page.getByRole('button', { name: 'Electronics (25)', exact: true }).click();
  await expect(results.getByRole('listitem')).toHaveCount(24);
  await page.getByRole('button', { name: 'Electronics (25)', exact: true }).click();
  await expect(results.getByRole('listitem')).toHaveCount(24);
  await expect(page.getByRole('button', { name: 'Refresh auctions', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Tools & Equipment (1)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No open auctions right now' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Sample auctions' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear category filter' }).click();
  await expect(results.getByRole('listitem')).toHaveCount(24);
  fails = true;
  await page.getByRole('button', { name: 'Refresh auctions', exact: true }).click();
  await expect(page.getByText('Auction service unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Sample auctions' })).toHaveCount(0);
  fails = false;
  await page.getByRole('button', { name: 'Retry auctions', exact: true }).click();
  await expect(page.getByText('Auction service unavailable', { exact: true })).toHaveCount(0);
});

test('renter bidding is a separate flow from listing details', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const live = await setup(page, { item_requests: false, bidding: true });
  const listing = {
    id: 'b3000000-0000-4000-8000-000000000003', owner_id: 'b1000000-0000-4000-8000-000000000002',
    category_id: '20000000-0000-4000-8000-000000000001', title: 'Separate bidding camera',
    description: 'A camera with its own auction page.', price_per_day: 40, deposit: 0,
    location_lat: 30.27, location_lng: -97.74, location_label: 'Austin, TX',
    available_quantity: 1, auction_enabled: true, status: 'published',
    created_at: '2026-10-20T00:00:00Z', listing_images: [],
    owner: { id: 'b1000000-0000-4000-8000-000000000002', full_name: 'Owner', avatar_url: null },
    categories: { name: 'Cameras' },
  };
  await page.route('**/rest/v1/listings?**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.searchParams.get('id') === `eq.${listing.id}` ? listing : [] });
  });
  const auction = {
    id: 'b4000000-0000-4000-8000-000000000003', listing_id: listing.id, status: 'open',
    start_date: '2026-11-05', end_date: '2026-11-08', ends_at: new Date(Date.now() + 3600000).toISOString(),
    selection_deadline: null, payment_deadline: null, server_now: new Date().toISOString(),
    minimum_next_bid: 41, top_bids: [], my_bid_count: 0, my_daily_rate: null,
    my_booking_id: null, selected_bid_id: null, is_owner: false,
  };
  await page.route('**/rest/v1/rpc/get_listing_auction', route => route.fulfill({ json: auction }));
  await page.route('**/rest/v1/rpc/place_listing_auction_bid', route => {
    expect(route.request().postDataJSON()).toMatchObject({ p_listing_id: listing.id, p_daily_rate: 41 });
    return route.fulfill({ json: { ...auction, minimum_next_bid: 42, my_bid_count: 1, my_daily_rate: 41 } });
  });
  await signIn(page, `/listing/${listing.id}`);
  await expect(page.getByRole('heading', { name: listing.title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Competitive bidding', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Your competitive bid per day (USD)')).toHaveCount(0);
  await page.getByRole('link', { name: 'View auction in Bidding' }).click();
  await expect(page).toHaveURL(`${appUrl}/bidding/${listing.id}`);
  await expect(page.getByRole('heading', { name: listing.title, exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Your competitive bid per day (USD)').fill('41');
  await page.getByRole('button', { name: 'Place bid', exact: true }).click();
  await expect(page.getByText('Your highest bid: $41.00/day.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: listing.title, exact: true })).toBeVisible({ timeout: 30_000 });
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`renter-bidding-${width}.png`), fullPage: true });
  }
  live.update('bidding', false);
  await expect(page.getByText('Bidding is offline', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place bid', exact: true })).toHaveCount(0);
});

test('owner bidding is managed outside the listing with anonymous top bids', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setup(page, { item_requests: false, bidding: true });
  const listing = {
    id: 'b3000000-0000-4000-8000-000000000001', owner_id: userId,
    category_id: '20000000-0000-4000-8000-000000000001', title: 'Owner auction camera',
    description: 'Owner dashboard test listing.', price_per_day: 40, price_per_week: null, deposit: 0,
    location_lat: 30.27, location_lng: -97.74, location_label: 'Austin, TX',
    instant_booking: false, protection_eligible: false, delivery_available: false, owner_verified: false,
    available_quantity: 1, negotiation_enabled: false, auction_enabled: true, status: 'published',
    created_at: '2026-10-20T00:00:00Z',
    listing_images: [{ url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22%3E%3Crect width=%2264%22 height=%2264%22 fill=%22%23e6f4f1%22/%3E%3C/svg%3E', sort_order: 0 }],
    owner: { id: userId, full_name: 'Owner', avatar_url: null }, categories: { name: 'Cameras' },
  };
  await page.route('**/rest/v1/listings*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('owner_id') === `eq.${userId}`) return route.fulfill({ json: [listing] });
    if (url.searchParams.get('id') === `eq.${listing.id}`) return route.fulfill({ json: listing });
    return route.fallback();
  });
  let auction = {
    id: 'b4000000-0000-4000-8000-000000000001', listing_id: listing.id, status: 'open' as 'open' | 'awaiting_payment',
    start_date: '2026-11-05', end_date: '2026-11-08', ends_at: new Date(Date.now() + 3600000).toISOString(),
    selection_deadline: null as string | null, payment_deadline: null as string | null, server_now: new Date().toISOString(),
    minimum_next_bid: 45,
    top_bids: [
      { id: 'b5000000-0000-4000-8000-000000000001', rank: 1, daily_rate: 45, bid_count: 2 },
      { id: 'b5000000-0000-4000-8000-000000000002', rank: 2, daily_rate: 40, bid_count: 1 },
    ],
    my_bid_count: 0, my_daily_rate: null, my_booking_id: null, selected_bid_id: null as string | null, is_owner: true,
  };
  await page.route('**/rest/v1/rpc/get_listing_auction', route => route.fulfill({ json: auction }));
  await page.route('**/rest/v1/rpc/select_listing_auction_winner', route => {
    const body = route.request().postDataJSON() as { p_bid_id?: string };
    auction = {
      ...auction,
      status: 'awaiting_payment',
      selected_bid_id: body.p_bid_id ?? null,
      payment_deadline: new Date(Date.now() + 3600000).toISOString(),
      server_now: new Date().toISOString(),
    };
    return route.fulfill({ json: auction });
  });

  await signIn(page, '/bidding');
  await expect(page.getByRole('heading', { name: 'Owner — Bidding' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'Owner auction camera' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('$45.00');
  await expect(page.getByRole('table')).toContainText('2 bids');
  await expect(page.getByText('Bids are anonymous. Owners can select a winner during bidding; selecting closes the auction.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select winner' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Select winner' }).first().click();
  await expect(page.getByRole('button', { name: 'Select winner' })).toHaveCount(0);
  await expect(page.getByText('Payment pending')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('owner-bidding-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('owner-bidding-mobile.png'), fullPage: true });
  await page.goto(`/bidding/${listing.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Manage my auctions', exact: true })).toBeVisible();
  await expect(page.getByLabel('Your competitive bid per day (USD)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage my auctions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Owner — Bidding' })).toBeVisible();
});
