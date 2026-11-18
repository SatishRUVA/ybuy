import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
after(() => server.close());
const { getListingAuction, placeListingAuctionBid } = await server.ssrLoadModule('/src/lib/listing-auctions.ts');
const { supabase } = await server.ssrLoadModule('/src/lib/supabase.ts');

const bid = {
  id: '10000000-0000-4000-8000-000000000001',
  daily_rate: 36, submitted_at: '2026-10-28T02:56:31Z', bid_count: 1,
  passed: true, is_current: false, rank: null, selected: false,
};
const auction = {
  id: '20000000-0000-4000-8000-000000000001',
  listing_id: '30000000-0000-4000-8000-000000000001',
  status: 'ended', start_date: '2026-11-24', end_date: '2026-11-25',
  ends_at: '2026-11-23T05:50:00Z', selection_deadline: null, payment_deadline: null,
  server_now: '2026-11-03T18:25:00Z', minimum_increment: 1, minimum_next_bid: 37,
  top_bids: [], my_bid_count: 1, my_daily_rate: 36, my_rank: null,
  my_bids: [bid], owner_bids: null, my_booking_id: null, selected_bid_id: null,
  selected_payment_status: null, owner_decision_missed_at: null, is_owner: false,
};
const ownerBid = {
  ...bid, eligible: false,
  renter: { id: '40000000-0000-4000-8000-000000000001', full_name: 'Test renter',
    avatar_url: null, rating: null, review_count: 0 },
};

const cases = [
  { name: 'renter bid with no winner', response: { ...auction, my_bids: [{ ...bid, selected: null }] }, valid: true },
  { name: 'owner bid with no winner', response: { ...auction, is_owner: true,
    owner_bids: [{ ...ownerBid, selected: null }] }, valid: true },
  { name: 'selected winner', response: { ...auction, selected_bid_id: bid.id,
    my_bids: [{ ...bid, selected: true }] }, valid: true },
  { name: 'boolean false', response: auction, valid: true },
  { name: 'null selection with a winner', response: { ...auction, selected_bid_id: bid.id,
    my_bids: [{ ...bid, selected: null }] }, valid: false },
  { name: 'owner null selection with a winner', response: { ...auction, is_owner: true,
    selected_bid_id: bid.id, owner_bids: [{ ...ownerBid, selected: null }] }, valid: false },
  { name: 'string selection', response: { ...auction, my_bids: [{ ...bid, selected: 'false' }] }, valid: false },
  { name: 'missing selection', response: { ...auction, my_bids: [{ ...bid, selected: undefined }] }, valid: false },
  { name: 'invalid daily rate', response: { ...auction,
    my_bids: [{ ...bid, selected: null, daily_rate: -1 }] }, valid: false },
  { name: 'flexible date bid', response: { ...auction, date_flexible: true, participant_count: 1, total_bid_count: 1,
    my_bids: [{ ...bid, start_date: auction.start_date, end_date: auction.end_date, total_value: 36 }] }, valid: true },
  { name: 'flexible bid missing dates', response: { ...auction, date_flexible: true }, valid: false },
  { name: 'flexible bid outside window', response: { ...auction, date_flexible: true,
    my_bids: [{ ...bid, start_date: '2026-11-23', end_date: auction.end_date, total_value: 72 }] }, valid: false },
  { name: 'invalid participant count', response: { ...auction, participant_count: -1 }, valid: false },
  { name: 'no owner grace', response: { ...auction, owner_decision_hours: 0, owner_missed_decision_count: 2 }, valid: true },
  { name: 'reject owner grace', response: { ...auction, owner_decision_hours: 1 }, valid: false },
  { name: 'personal winner payment', response: { ...auction, my_payment_status: 'pending',
    my_payment_deadline: '2026-11-03T19:25:00Z', my_bids: [{ ...bid, booking_id: auction.id, payment_status: 'pending',
      payment_deadline: '2026-11-03T19:25:00Z' }] }, valid: true },
  { name: 'invalid winner payment', response: { ...auction, my_payment_status: 'automatic' }, valid: false },
];

for (const scenario of cases) {
  test(`auction response: ${scenario.name}`, async () => {
    const response = structuredClone(scenario.response);
    const originalRpc = supabase.rpc;
    supabase.rpc = async () => ({ data: response, error: null });
    try {
      if (scenario.valid) {
        const result = await getListingAuction(auction.listing_id);
        assert.equal(result.my_bids[0].selected, scenario.response.selected_bid_id === bid.id);
        if (scenario.response.is_owner) assert.equal(result.owner_bids[0].selected, false);
        assert.deepEqual(response, scenario.response);
      } else {
        await assert.rejects(getListingAuction(auction.listing_id),
          { message: 'Could not verify the current auction. Please retry.' });
      }

    } finally {
      supabase.rpc = originalRpc;
    }
  });
}

test('owner reliability counts do not change review stars', async () => {
  const { fetchOwnerRatings } = await server.ssrLoadModule('/src/lib/reviews.ts');
  const originalRpc = supabase.rpc;
  supabase.rpc = async (name, args) => {
    assert.equal(name, 'get_owner_rating_stats');
    assert.deepEqual(args, { p_owner_ids: [ownerBid.renter.id] });
    return { data: [{ owner_id: ownerBid.renter.id, rating: 4.5, review_count: 4, missed_decision_count: 2, rating_adjustment: 0 }], error: null };
  };
  try {
    assert.deepEqual((await fetchOwnerRatings([ownerBid.renter.id])).get(ownerBid.renter.id),
      { rating: 4.5, count: 4, missedDecisionCount: 2, ratingAdjustment: 0 });
  } finally { supabase.rpc = originalRpc; }
});

test('date-range bids send dates, consent and retry key without changing legacy arguments', async () => {
  const originalRpc = supabase.rpc;
  const calls = [];
  supabase.rpc = async (name, args) => { calls.push({ name, args }); return { data: auction, error: null }; };
  try {
    await placeListingAuctionBid(auction.listing_id, 36, bid.id, true, { start: '2026-11-24', end: '2026-11-25' });
    assert.deepEqual(calls[0].args, { p_listing_id: auction.listing_id, p_daily_rate: 36,
      p_idempotency_key: bid.id, p_deposit_hold_consent: true, p_start_date: '2026-11-24', p_end_date: '2026-11-25' });
    await placeListingAuctionBid(auction.listing_id, 36, bid.id, true);
    assert.equal('p_start_date' in calls[1].args, false);
    await getListingAuction(auction.listing_id, { start: '2026-11-24', end: '2026-11-25' });
    assert.deepEqual(calls[2], { name: 'get_listing_auction', args: {
      p_listing_id: auction.listing_id, p_start_date: '2026-11-24', p_end_date: '2026-11-25',
    } });
    await assert.rejects(placeListingAuctionBid(auction.listing_id, 36, bid.id, true,
      { start: '2026-11-25', end: '2026-11-24' }), /Choose a valid pickup and return date/);
    assert.equal(calls.length, 3);
  } finally { supabase.rpc = originalRpc; }
});
