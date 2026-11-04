import { expect, test } from '@playwright/test';
import { canPlacePreviewBid, canSelectPreviewWinner } from '../src/lib/auction-eligibility';
import type { ListingAuction } from '../src/lib/listing-auctions';

const now = Date.parse('2026-11-01T12:00:00Z');
const auction: ListingAuction = {
  id: 'a0000000-0000-4000-8000-000000000001',
  listing_id: 'b0000000-0000-4000-8000-000000000001',
  status: 'open',
  start_date: '2026-11-03',
  end_date: '2026-11-05',
  starts_at: '2026-11-01T11:00:00Z',
  ends_at: '2026-11-01T13:00:00Z',
  selection_deadline: null,
  payment_deadline: null,
  server_now: '2026-11-01T12:00:00Z',
  minimum_next_bid: 20,
  top_bids: [],
  my_bid_count: 0,
  my_daily_rate: null,
  my_booking_id: null,
  selected_bid_id: null,
  is_owner: false,
};

test('native bidding controls follow the current server auction state', () => {
  expect(canPlacePreviewBid(auction, now)).toBe(true);
  expect(canPlacePreviewBid({ ...auction, my_bid_count: 3 }, now)).toBe(false);
  expect(canPlacePreviewBid({ ...auction, ends_at: '2026-11-01T11:59:59Z' }, now)).toBe(false);
  expect(canPlacePreviewBid({ ...auction, status: 'owner_selection' }, now)).toBe(false);

  expect(canSelectPreviewWinner({ ...auction, is_owner: true }, now)).toBe(true);
  expect(canSelectPreviewWinner({ ...auction, is_owner: true, status: 'owner_selection',
    selection_deadline: '2026-11-01T13:00:00Z' }, now)).toBe(false);
  expect(canSelectPreviewWinner({ ...auction, is_owner: false }, now)).toBe(false);
  expect(canSelectPreviewWinner({ ...auction, is_owner: true, status: 'ended' }, now)).toBe(false);
});
