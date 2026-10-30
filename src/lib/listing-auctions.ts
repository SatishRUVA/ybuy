import { supabase } from '@/lib/supabase';
import { assertUuid, UUID_RE } from '@/lib/text-safety';
import { addDaysIso } from '@/lib/geo';

export interface ListingAuctionPreferences {
  enabled: boolean;
  start_date: string | null;
  end_date: string | null;
  bidding_starts_at?: string | null;
  bidding_ends_at?: string | null;
}

export const EMPTY_AUCTION_PREFERENCES: ListingAuctionPreferences = { enabled: false, start_date: null, end_date: null };

export function earliestAuctionPickupDate(): string {
  return addDaysIso(new Date(Date.now() + 26 * 3600000).toISOString().slice(0, 10), 1);
}

export function listingAuctionError(value: ListingAuctionPreferences, start: string, end: string): string | null {
  if (!value.enabled) return null;
  if (!value.start_date || !value.end_date || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))
    || !Number.isFinite(Date.parse(value.start_date)) || !Number.isFinite(Date.parse(value.end_date))
    || value.start_date < start || value.end_date > end || value.end_date <= value.start_date) {
    return 'Choose a complete auction rental period inside your listing availability.';
  }
  if (value.bidding_starts_at !== undefined || value.bidding_ends_at !== undefined) {
    const opens = value.bidding_starts_at ? Date.parse(value.bidding_starts_at) : Date.now() + 60_000;
    const closes = Date.parse(value.bidding_ends_at ?? '');
    if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes - 10 * 60_000 <= opens) return 'Choose rental dates that leave at least 10 minutes for bidding to open.';
    const expectedClose = new Date(value.start_date + 'T00:00:00');
    expectedClose.setDate(expectedClose.getDate() - 1);
    if (closes > expectedClose.getTime()) return 'Bidding must close at least one day before pickup.';
  } else if (value.start_date < earliestAuctionPickupDate()) return 'Choose a pickup date at least one day from now so bidding can close before the rental.';
  return null;
}

export interface AuctionBid {
  id: string;
  rank: number;
  daily_rate: number;
  bid_count: number;
}

export interface ListingAuction {
  id: string;
  listing_id: string;
  status: 'scheduled' | 'open' | 'owner_selection' | 'awaiting_payment' | 'completed' | 'ended' | 'cancelled';
  start_date: string;
  end_date: string;
  starts_at?: string;
  ends_at: string | null;
  selection_deadline: string | null;
  payment_deadline: string | null;
  server_now: string;
  minimum_next_bid: number;
  top_bids: AuctionBid[];
  my_bid_count: number;
  my_daily_rate: number | null;
  my_booking_id: string | null;
  selected_bid_id: string | null;
  is_owner: boolean;
}

function auctionResult(data: unknown): ListingAuction | null {
  if (data === null) return null;
  const value = data as ListingAuction;
  if (!value || typeof value.id !== 'string' || typeof value.listing_id !== 'string'
    || !['scheduled', 'open', 'owner_selection', 'awaiting_payment', 'completed', 'ended', 'cancelled'].includes(value.status)
    || !Array.isArray(value.top_bids) || value.top_bids.length > 3
    || value.top_bids.some(bid => !bid || typeof bid.id !== 'string' || !Number.isInteger(bid.rank) || bid.rank < 1 || bid.rank > 3
      || !Number.isFinite(bid.daily_rate) || bid.daily_rate <= 0 || !Number.isInteger(bid.bid_count) || bid.bid_count < 1 || bid.bid_count > 3)
    || !Number.isFinite(value.minimum_next_bid) || value.minimum_next_bid <= 0 || !Number.isInteger(value.my_bid_count)
    || value.my_bid_count < 0 || value.my_bid_count > 3 || typeof value.is_owner !== 'boolean'
    || typeof value.start_date !== 'string' || typeof value.end_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(value.end_date) || value.end_date <= value.start_date
    || (value.my_daily_rate !== null && (!Number.isFinite(value.my_daily_rate) || value.my_daily_rate <= 0))
    || [value.ends_at, value.selection_deadline, value.payment_deadline].some(date => date !== null && !Number.isFinite(Date.parse(date)))
    || [value.my_booking_id, value.selected_bid_id].some(id => id !== null && typeof id !== 'string')
    || (value.starts_at !== undefined && !Number.isFinite(Date.parse(value.starts_at)))
    || !Number.isFinite(Date.parse(value.server_now))) throw new Error('Could not verify the current auction. Please retry.');
  return value;
}

export async function getListingAuction(listingId: string): Promise<ListingAuction | null> {
  assertUuid(listingId, 'listing id');
  const { data, error } = await supabase.rpc('get_listing_auction', { p_listing_id: listingId });
  if (error) throw new Error(error.message);
  return auctionResult(data);
}

export async function placeListingAuctionBid(listingId: string, dailyRate: number, idempotencyKey: string): Promise<ListingAuction> {
  assertUuid(listingId, 'listing id');
  assertUuid(idempotencyKey, 'idempotency key');
  if (!Number.isFinite(dailyRate) || dailyRate <= 0 || Math.abs(Math.round(dailyRate * 100) - dailyRate * 100) > 0.0000001) throw new Error('Enter a positive daily price with at most two decimal places.');
  const { data, error } = await supabase.rpc('place_listing_auction_bid', {
    p_listing_id: listingId, p_daily_rate: dailyRate, p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(error.message);
  const result = auctionResult(data);
  if (!result) throw new Error('The server did not confirm your bid. Refresh before trying again.');
  return result;
}

export async function selectListingAuctionWinner(listingId: string, bidId: string): Promise<ListingAuction> {
  assertUuid(listingId, 'listing id'); assertUuid(bidId, 'bid id');
  const { data, error } = await supabase.rpc('select_listing_auction_winner', { p_listing_id: listingId, p_bid_id: bidId });
  if (error) throw new Error(error.message);
  const result = auctionResult(data);
  if (!result) throw new Error('The server did not confirm a winner. Refresh before trying again.');
  return result;
}

export interface AuctionFeedItem {
  listing_id: string;
  title: string;
  category_id: string;
  category_name: string;
  daily_rate: number;
  has_bids: boolean;
  start_date: string;
  end_date: string;
  expires_at: string;
  image_url: string | null;
}

export interface AuctionFeed {
  items: AuctionFeedItem[];
  total: number;
  categories: { id: string; name: string; count: number }[];
}

export async function getListingAuctionFeed(categoryId: string | null, offset = 0): Promise<AuctionFeed> {
  if (categoryId !== null) assertUuid(categoryId, 'category id');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Choose a valid auction page.');
  const { data, error } = await supabase.rpc('get_listing_auction_feed', { p_category_id: categoryId, p_offset: offset });
  if (error) throw new Error(error.message);
  const value = data as AuctionFeed | null;
  if (!value || !Number.isSafeInteger(value.total) || value.total < 0
    || !Array.isArray(value.items) || value.items.length > 24 || !Array.isArray(value.categories)
    || value.items.some(item => !item || typeof item.listing_id !== 'string' || !UUID_RE.test(item.listing_id) || typeof item.title !== 'string'
      || typeof item.category_id !== 'string' || !UUID_RE.test(item.category_id) || typeof item.category_name !== 'string'
      || !Number.isFinite(item.daily_rate) || item.daily_rate <= 0 || typeof item.has_bids !== 'boolean'
      || typeof item.start_date !== 'string' || typeof item.end_date !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(item.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(item.end_date)
      || !Number.isFinite(Date.parse(item.start_date)) || !Number.isFinite(Date.parse(item.end_date)) || item.end_date <= item.start_date
      || typeof item.expires_at !== 'string' || !Number.isFinite(Date.parse(item.expires_at)) || (item.image_url !== null && typeof item.image_url !== 'string'))
    || value.categories.some(category => !category || typeof category.id !== 'string' || !UUID_RE.test(category.id) || typeof category.name !== 'string'
      || !Number.isSafeInteger(category.count) || category.count < 1)) {
    throw new Error('Could not verify the live auction results. Please retry.');
  }
  return value;
}
