import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Session, User } from '@supabase/supabase-js';
import { mockSupabaseModule } from './mock-supabase';
import { appUrl } from './test-url';

test.setTimeout(60_000);

const apiUrl = 'http://localhost:54321';
const adminId = '10000000-0000-4000-8000-000000000003';
const bidderId = '10000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000002';
const categoryId = '20000000-0000-4000-8000-000000000001';
const listingId = '30000000-0000-4000-8000-000000000001';
const bidId = '50000000-0000-4000-8000-000000000001';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=';

function sessionFor(id: string, email: string, name: string): Session {
  const user: User = {
    id, aud: 'authenticated', role: 'authenticated', email,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: name }, identities: [],
    email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  };
  const expiresAt = Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: id, aud: 'authenticated', role: 'authenticated', exp: expiresAt,
    })}.test-signature`,
    refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user,
  };
}

const listing = {
  id: listingId, owner_id: ownerId, category_id: categoryId, title: 'Mirrorless travel camera',
  description: 'A compact camera with a carrying case.', price_per_day: 25, price_per_week: null,
  deposit: 50, estimated_value: 200, location_lat: 32.8, location_lng: -96.9,
  location_label: 'Irving, TX', instant_booking: false, protection_eligible: false,
  delivery_available: true, delivery_fee: 15, owner_verified: true, status: 'published',
  availability_start: '2026-11-10', availability_end: '2026-11-30',
  created_at: '2026-10-01T00:00:00Z', listing_images: [{ url: image, sort_order: 0 }],
  categories: { name: 'Electronics' }, owner: { id: ownerId, full_name: 'Camera Owner', avatar_url: null },
};

const auction = {
  id: '60000000-0000-4000-8000-000000000001', listing_id: listingId, status: 'open',
  start_date: '2026-11-10', end_date: '2026-11-12', starts_at: '2026-11-01T11:00:00Z',
  ends_at: '2026-11-01T13:00:00Z', selection_deadline: null, payment_deadline: null,
  server_now: '2026-11-01T12:00:00Z', minimum_next_bid: 26, top_bids: [],
  my_bid_count: 0, my_daily_rate: null, my_booking_id: null, selected_bid_id: null, is_owner: false,
};

async function setupMutationPage(page: import('@playwright/test').Page, kind: 'admin' | 'bid') {
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
  await page.addInitScript((session) => {
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session));
  }, sessionFor(kind === 'admin' ? adminId : bidderId,
    kind === 'admin' ? 'admin@example.test' : 'bidder@example.test',
    kind === 'admin' ? 'Preview Admin' : 'Preview Bidder'));

  await page.routeWebSocket('**/realtime/v1/websocket**', socket => {
    socket.onMessage(message => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === 'phx_join' || event === 'heartbeat' || event === 'phx_leave') {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok',
          response: event === 'phx_join'
            ? { postgres_changes: payload.config.postgres_changes.map((filter: object, index: number) => ({ ...filter, id: index + 1 })) }
            : {},
        }]));
      }
    });
  });

  let failOnce = true;
  const bids: Record<string, unknown>[] = [];
  const approvals: Record<string, unknown>[] = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appUrl) return url.pathname === '/src/lib/supabase.ts' ? mockSupabaseModule(route) : route.continue();
    if (url.origin !== apiUrl) {
      if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/png', body: Buffer.from(image.split(',')[1], 'base64') });
      return route.continue();
    }

    const headers = {
      'access-control-allow-origin': appUrl, 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS,HEAD', 'content-range': '0-0/0',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const rpc = url.pathname.replace('/rest/v1/rpc/', '');
    let responseStatus = 200;
    let body: unknown = [];
    if (url.pathname === '/auth/v1/user') {
      body = sessionFor(kind === 'admin' ? adminId : bidderId,
        kind === 'admin' ? 'admin@example.test' : 'bidder@example.test',
        kind === 'admin' ? 'Preview Admin' : 'Preview Bidder').user;
    } else if (rpc === 'has_active_session') body = true;
    else if (rpc === 'get_my_profile') {
      const id = kind === 'admin' ? adminId : bidderId;
      body = { id, full_name: kind === 'admin' ? 'Preview Admin' : 'Preview Bidder',
        email: kind === 'admin' ? 'admin@example.test' : 'bidder@example.test',
        avatar_url: null, phone: null, location: null, created_at: '2026-01-01T00:00:00Z' };
    } else if (rpc === 'get_my_admin_access') {
      body = kind === 'admin' ? { role: 'admin', permissions: ['listings.moderate'] } : null;
    } else if (url.pathname === '/rest/v1/feature_flags') {
      body = [{ key: 'bidding', enabled: true, description: 'Live bidding', updated_at: '2026-01-01T00:00:00Z' }];
    } else if (url.pathname === '/rest/v1/notifications') body = [];
    else if (url.pathname === '/rest/v1/listings') {
      body = request.headers().accept?.includes('vnd.pgrst.object') ? listing : [listing];
    } else if (rpc === 'get_listing_auction') body = auction;
    else if (rpc === 'place_listing_auction_bid') {
      bids.push(request.postDataJSON());
      if (failOnce) {
        failOnce = false;
        responseStatus = 503;
        body = { message: 'Bid service temporarily unavailable', code: 'P0001' };
      } else {
        body = { ...auction, minimum_next_bid: 27, my_bid_count: 1, my_daily_rate: 26,
          top_bids: [{ id: bidId, rank: 1, daily_rate: 26, bid_count: 1 }] };
      }
    } else if (rpc === 'admin_list_listings') {
      body = { total: 1, rows: [{
        id: listingId, title: listing.title, status: 'pending_approval', price_per_day: 25, deposit: 50,
        created_at: '2026-10-01T00:00:00Z', owner_id: ownerId, owner_name: 'Camera Owner',
        owner_email: 'owner@example.test', category: 'Electronics', open_flags: 0,
      }] };
    } else if (rpc === 'admin_get_listing_publication_review') {
      body = { id: listingId, revision: 3, title: listing.title, description: listing.description,
        estimated_value: 200, deposit: 50, price_per_day: 25, available_quantity: 1,
        availability_start: '2026-11-10', availability_end: '2026-11-30', delivery_fee: 15,
        images: [], blocking_flags: [] };
    } else if (rpc === 'admin_approve_listing_publication') {
      approvals.push(request.postDataJSON());
      if (failOnce) {
        failOnce = false;
        responseStatus = 403;
        body = { message: 'Permission denied by test fixture', code: '42501' };
      } else body = { revision: 4, status: 'published', deposit: 50 };
    }
    return route.fulfill({
      status: responseStatus, headers, contentType: 'application/json',
      body: body === null ? '' : JSON.stringify(body),
    });
  });
  return { bids, approvals };
}

test('Preview admin keeps native templates and delegates changes to real protected operations', async () => {
  const source = await readFile(new URL('../src/components/preview-administration.tsx', import.meta.url), 'utf8');
  for (const markup of ['p1-work-page', 'p1-admin-metrics', 'p1-admin-overview', 'p1-moderation-list', 'p1-member-list', 'p1-report-bars']) {
    expect(source).toContain(`className="${markup}"`);
  }
  for (const operation of ['fetchOverview(from, to)', 'listListings({ status:', 'approveListingPublication(', 'setUserRestriction(']) {
    expect(source).toContain(operation);
  }
  expect(source).toContain('<AdminPage section={toolSection} />');
  expect(source).not.toContain('usePreview(');
  expect(source).not.toContain("from '@/preview-1/state'");
});

test('Preview bidding and BidRoom retain their native presentation and server-owned auction lifecycle', async () => {
  const source = await readFile(new URL('../src/components/preview-bidding.tsx', import.meta.url), 'utf8');
  for (const markup of ['p1-bid-intro', 'p1-auction-grid', 'p1-auction-card', 'p1-bid-room-head', 'p1-bid-room-layout', 'p1-bid-rules']) {
    expect(source).toContain(`className="${markup}"`);
  }
  for (const operation of ['getListingAuctionFeed(category', 'getListingAuction(id)', 'placeListingAuctionBid(id, amount', 'selectListingAuctionWinner(id, bidId)']) {
    expect(source).toContain(operation);
  }
  for (const status of ['scheduled', 'open', 'owner_selection', 'awaiting_payment', 'completed', 'ended', 'cancelled']) {
    expect(source).toContain(`'${status}'`);
  }
  expect(source).toContain('navigate({ name: \'confirmation\'');
  expect(source).not.toContain('usePreview(');
  expect(source).not.toContain('Simulate successful winner payment');
  expect(source).not.toContain('Explore demo lifecycle');
});

test('native BidRoom keeps a failed bid draft and retries the same authorized bid RPC', async ({ page }) => {
  const calls = await setupMutationPage(page, 'bid');
  await page.goto(`${appUrl}/auction/${listingId}`, { waitUntil: 'domcontentloaded' });
  const input = page.getByRole('spinbutton', { name: 'Your bid per day' });
  const submit = page.getByRole('button', { name: 'Place bid · $26 / day' });
  await expect(submit).toBeVisible({ timeout: 20_000 });

  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Bid service temporarily unavailable');
  await expect(input).toHaveValue('26.00');
  await expect(page.getByRole('button', { name: 'Place bid · $26 / day' })).toBeVisible();

  await page.getByRole('button', { name: 'Place bid · $26 / day' }).click();
  await expect(page.getByText('You’re currently leading')).toBeVisible();
  expect(calls.bids).toHaveLength(2);
  expect(calls.bids[0]).toMatchObject({ p_listing_id: listingId, p_daily_rate: 26 });
  expect(calls.bids[1]).toMatchObject({ p_listing_id: listingId, p_daily_rate: 26 });
  expect(calls.bids[1].p_idempotency_key).toBe(calls.bids[0].p_idempotency_key);
  expect(calls.bids[0].p_idempotency_key).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
});

test('native admin moderation shows permission rejection and retries the protected publication RPC', async ({ page }) => {
  const calls = await setupMutationPage(page, 'admin');
  await page.goto(`${appUrl}/admin/moderation`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Review listing' }).waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('button', { name: 'Review listing' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: listing.title })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Reason for approval' }).fill('Reviewed current listing details');

  await dialog.getByRole('button', { name: 'Approve listing' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Permission denied by test fixture');
  await expect(dialog.getByRole('heading', { name: listing.title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review listing' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Approve listing' }).click();
  await expect(page.getByText('The queue is clear.')).toBeVisible();
  expect(calls.approvals).toEqual([
    { p_listing_id: listingId, p_revision: 3, p_reason: 'Reviewed current listing details' },
    { p_listing_id: listingId, p_revision: 3, p_reason: 'Reviewed current listing details' },
  ]);
});
