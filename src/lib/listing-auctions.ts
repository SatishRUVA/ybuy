import { supabase } from '@/lib/supabase';
import { assertUuid, UUID_RE } from '@/lib/text-safety';
import { addDaysIso } from '@/lib/geo';
import { signListingImageUrl } from '@/lib/listings';

export interface ListingAuctionPreferences {
  enabled: boolean;
  date_flexible?: boolean;
  starts_immediately?: boolean;
  opening_daily_rate?: number | null;
  start_date: string | null;
  end_date: string | null;
  bidding_starts_at?: string | null;
  bidding_ends_at?: string | null;
}

export const EMPTY_AUCTION_PREFERENCES: ListingAuctionPreferences = { enabled: false, start_date: null, end_date: null };

export function auctionPublicationMessage(auction: Pick<ListingAuction, 'status' | 'starts_at' | 'ends_at'>): string {
  if (!['scheduled', 'open'].includes(auction.status)) return `Bidding settings saved. Auction ${auction.status.replace(/_/g, ' ')}.`;
  const format = (value: string) => new Date(value).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  if (!auction.starts_at || !auction.ends_at || !Number.isFinite(Date.parse(auction.starts_at)) || !Number.isFinite(Date.parse(auction.ends_at))) {
    throw new Error('Could not verify the saved bidding schedule. Refresh your auction before continuing.');
  }
  if (auction.status === 'scheduled') return `Your item is scheduled for bidding. Bidding opens ${format(auction.starts_at)} and closes ${format(auction.ends_at)}.`;
  return `Your item is open for bidding. Bidding closes ${format(auction.ends_at)}.`;
}

export function earliestAuctionPickupDate(): string {
  return addDaysIso(new Date(Date.now() + 26 * 3600000).toISOString().slice(0, 10), 1);
}

export function listingAuctionError(value: ListingAuctionPreferences, start: string, end: string): string | null {
  if (!value.enabled) return null;
  if (value.opening_daily_rate !== undefined && value.opening_daily_rate !== null
    && (!Number.isFinite(value.opening_daily_rate) || value.opening_daily_rate < 0.01 || value.opening_daily_rate > 100000)) {
    return 'Enter a starting bid from $0.01 to $100,000 per day.';
  }
  if (!value.start_date || !value.end_date || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))
    || !Number.isFinite(Date.parse(value.start_date)) || !Number.isFinite(Date.parse(value.end_date))
    || value.start_date < start || value.end_date > end || value.end_date <= value.start_date) {
    return 'Choose a complete auction rental period inside your listing availability.';
  }
  const opens = value.starts_immediately ? Date.now() : Date.parse(value.bidding_starts_at ?? '');
  const closes = Date.parse(value.bidding_ends_at ?? '');
  if (!Number.isFinite(opens) || !Number.isFinite(closes)
    || (!value.starts_immediately && opens <= Date.now()) || closes - 10 * 60_000 <= opens) {
    return 'Choose future bidding times with at least 10 minutes for bids.';
  }
  const pickup = new Date(value.start_date + 'T00:00:00').getTime();
  if (closes + 2 * 60 * 60_000 > pickup) return 'Bidding must close at least 2 hours before pickup.';
  return null;
}

export interface AuctionBid {
  id: string;
  rank: number;
  daily_rate: number;
  bid_count: number;
  start_date?: string;
  end_date?: string;
  total_value?: number;
}

export interface MyAuctionBid {
  id: string;
  daily_rate: number;
  submitted_at: string;
  bid_count: number;
  passed: boolean;
  is_current: boolean;
  rank: number | null;
  selected: boolean;
  start_date?: string;
  end_date?: string;
  total_value?: number;
  booking_id?: string | null;
  payment_deadline?: string | null;
  payment_status?: 'pending' | 'paid' | 'expired' | null;
}

export interface OwnerAuctionBid extends MyAuctionBid {
  eligible: boolean;
  renter: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    rating: number | null;
    review_count: number;
  };
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
  minimum_increment: number;
  minimum_next_bid: number;
  top_bids: AuctionBid[];
  my_bid_count: number;
  my_daily_rate: number | null;
  my_rank: number | null;
  my_bids: MyAuctionBid[];
  owner_bids: OwnerAuctionBid[] | null;
  my_booking_id: string | null;
  my_payment_deadline?: string | null;
  my_payment_status?: 'pending' | 'paid' | 'expired' | null;
  selected_bid_id: string | null;
  selected_payment_status: 'pending' | 'paid' | 'expired' | null;
  owner_decision_missed_at: string | null;
  owner_missed_decision_count?: number;
  owner_decision_hours?: number;
  winner_payment_hours?: number;
  is_owner: boolean;
  date_flexible?: boolean;
  participant_count?: number;
  total_bid_count?: number;
}

function auctionResult(data: unknown): ListingAuction | null {
  if (data === null) return null;
  const value = data as ListingAuction;
  // SQL equality returns null when selected_bid_id is null (no winner yet).
  const validSelection = (selected: unknown) => typeof selected === 'boolean'
    || (selected === null && value.selected_bid_id === null);
  const validPayment = (bid: MyAuctionBid) =>
    (bid.booking_id === undefined || bid.booking_id === null || (typeof bid.booking_id === 'string' && UUID_RE.test(bid.booking_id)))
    && (bid.payment_deadline === undefined || bid.payment_deadline === null || Number.isFinite(Date.parse(bid.payment_deadline)))
    && (bid.payment_status === undefined || bid.payment_status === null || ['pending', 'paid', 'expired'].includes(bid.payment_status));
  const validPeriod = (bid: AuctionBid | MyAuctionBid) => value.date_flexible !== true
    || (typeof bid.start_date === 'string' && typeof bid.end_date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(bid.start_date) && /^\d{4}-\d{2}-\d{2}$/.test(bid.end_date)
      && bid.start_date >= value.start_date && bid.end_date <= value.end_date && bid.end_date > bid.start_date
      && Number.isFinite(bid.total_value) && Number(bid.total_value) > 0);
  if (!value || typeof value.id !== 'string' || typeof value.listing_id !== 'string'
    || !['scheduled', 'open', 'owner_selection', 'awaiting_payment', 'completed', 'ended', 'cancelled'].includes(value.status)
    || !Array.isArray(value.top_bids) || value.top_bids.length > 3
    || value.top_bids.some(bid => !bid || typeof bid.id !== 'string' || !Number.isInteger(bid.rank) || bid.rank < 1 || bid.rank > 3
      || !Number.isFinite(bid.daily_rate) || bid.daily_rate <= 0 || !Number.isInteger(bid.bid_count) || bid.bid_count < 1 || bid.bid_count > 3 || !validPeriod(bid))
    || !Number.isFinite(value.minimum_increment) || value.minimum_increment <= 0
    || !Number.isFinite(value.minimum_next_bid) || value.minimum_next_bid <= 0 || !Number.isInteger(value.my_bid_count)
    || value.my_bid_count < 0 || value.my_bid_count > 3 || typeof value.is_owner !== 'boolean'
    || !(value.my_rank === null || (Number.isInteger(value.my_rank) && value.my_rank > 0))
    || !Array.isArray(value.my_bids) || value.my_bids.length > 3
    || value.my_bids.some(bid => !bid || typeof bid.id !== 'string' || !Number.isFinite(bid.daily_rate) || bid.daily_rate <= 0
      || !Number.isFinite(Date.parse(bid.submitted_at)) || !Number.isInteger(bid.bid_count) || bid.bid_count < 1 || bid.bid_count > 3
      || typeof bid.passed !== 'boolean' || typeof bid.is_current !== 'boolean' || !validSelection(bid.selected)
      || !(bid.rank === null || (Number.isInteger(bid.rank) && bid.rank > 0)) || !validPeriod(bid) || !validPayment(bid))
    || (value.is_owner ? !Array.isArray(value.owner_bids) : value.owner_bids !== null)
    || (Array.isArray(value.owner_bids) && value.owner_bids.some(bid => !bid || typeof bid.id !== 'string'
      || !Number.isFinite(bid.daily_rate) || bid.daily_rate <= 0 || !Number.isFinite(Date.parse(bid.submitted_at))
      || !Number.isInteger(bid.bid_count) || bid.bid_count < 1 || bid.bid_count > 3
      || typeof bid.passed !== 'boolean' || typeof bid.is_current !== 'boolean' || !validSelection(bid.selected)
      || typeof bid.eligible !== 'boolean' || !(bid.rank === null || (Number.isInteger(bid.rank) && bid.rank > 0))
      || !bid.renter || typeof bid.renter.id !== 'string' || typeof bid.renter.full_name !== 'string'
      || (bid.renter.avatar_url !== null && typeof bid.renter.avatar_url !== 'string')
      || (bid.renter.rating !== null && (!Number.isFinite(bid.renter.rating) || bid.renter.rating < 0 || bid.renter.rating > 5))
      || !Number.isInteger(bid.renter.review_count) || bid.renter.review_count < 0 || !validPeriod(bid) || !validPayment(bid)))
    || typeof value.start_date !== 'string' || typeof value.end_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(value.end_date) || value.end_date <= value.start_date
    || (value.my_daily_rate !== null && (!Number.isFinite(value.my_daily_rate) || value.my_daily_rate <= 0))
    || [value.ends_at, value.selection_deadline, value.payment_deadline].some(date => date !== null && !Number.isFinite(Date.parse(date)))
    || [value.my_booking_id, value.selected_bid_id].some(id => id !== null && typeof id !== 'string')
    || (value.selected_payment_status !== null && !['pending', 'paid', 'expired'].includes(value.selected_payment_status))
    || (value.my_payment_status !== undefined && value.my_payment_status !== null && !['pending', 'paid', 'expired'].includes(value.my_payment_status))
    || (value.my_payment_deadline !== undefined && value.my_payment_deadline !== null && !Number.isFinite(Date.parse(value.my_payment_deadline)))
    || (value.owner_decision_missed_at !== null && !Number.isFinite(Date.parse(value.owner_decision_missed_at)))
    || (value.owner_missed_decision_count !== undefined && (!Number.isInteger(value.owner_missed_decision_count) || value.owner_missed_decision_count < 0))
    || (value.owner_decision_hours !== undefined && (!Number.isInteger(value.owner_decision_hours) || value.owner_decision_hours !== 0))
    || (value.winner_payment_hours !== undefined && (!Number.isInteger(value.winner_payment_hours) || value.winner_payment_hours < 1))
    || (value.starts_at !== undefined && !Number.isFinite(Date.parse(value.starts_at)))
    || (value.date_flexible !== undefined && typeof value.date_flexible !== 'boolean')
    || [value.participant_count, value.total_bid_count].some(count => count !== undefined && (!Number.isSafeInteger(count) || Number(count) < 0))
    || !Number.isFinite(Date.parse(value.server_now))) throw new Error('Could not verify the current auction. Please retry.');
  return {
    ...value,
    my_bids: value.my_bids.map(bid => ({ ...bid, selected: bid.selected === true })),
    owner_bids: value.owner_bids?.map(bid => ({ ...bid, selected: bid.selected === true })) ?? null,
  };
}

export async function getListingAuction(listingId: string, range?: { start: string; end: string }): Promise<ListingAuction | null> {
  assertUuid(listingId, 'listing id');
  if (range && (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)
    || !Number.isFinite(Date.parse(range.start)) || !Number.isFinite(Date.parse(range.end)) || range.end <= range.start)) {
    throw new Error('Choose a valid pickup and return date.');
  }
  const { data, error } = await supabase.rpc('get_listing_auction', {
    p_listing_id: listingId, ...(range ? { p_start_date: range.start, p_end_date: range.end } : {}),
  });
  if (error) throw new Error(error.message);
  return auctionResult(data);
}

export async function placeListingAuctionBid(listingId: string, dailyRate: number, idempotencyKey: string, depositHoldConsent = false, range?: { start: string; end: string }): Promise<ListingAuction> {
  assertUuid(listingId, 'listing id');
  assertUuid(idempotencyKey, 'idempotency key');
  if (!Number.isFinite(dailyRate) || dailyRate <= 0 || Math.abs(Math.round(dailyRate * 100) - dailyRate * 100) > 0.0000001) throw new Error('Enter a positive daily price with at most two decimal places.');
  if (range && (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)
    || !Number.isFinite(Date.parse(range.start)) || !Number.isFinite(Date.parse(range.end)) || range.end <= range.start)) {
    throw new Error('Choose a valid pickup and return date.');
  }
  const { data, error } = await supabase.rpc('place_listing_auction_bid', {
    p_listing_id: listingId, p_daily_rate: dailyRate, p_idempotency_key: idempotencyKey,
    p_deposit_hold_consent: depositHoldConsent,
    ...(range ? { p_start_date: range.start, p_end_date: range.end } : {}),
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

export interface TopListingBid {
  listing_id: string;
  title: string;
  daily_rate: number;
  start_date: string;
  end_date: string;
  expires_at: string;
  image_url: string | null;
}

async function signAuctionImages<T extends { image_url: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(rows.map(async row => ({
    ...row, image_url: row.image_url === null ? null : await signListingImageUrl(row.image_url),
  })));
}

export async function getTopListingBids(): Promise<TopListingBid[]> {
  const { data, error } = await supabase.rpc('get_top_listing_bids');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || data.length > 24
    || data.some(row => !row || typeof row.listing_id !== 'string' || typeof row.title !== 'string'
      || !Number.isFinite(row.daily_rate) || row.daily_rate <= 0
      || !Number.isFinite(Date.parse(row.expires_at)) || !Number.isFinite(Date.parse(row.start_date))
      || !Number.isFinite(Date.parse(row.end_date)) || (row.image_url !== null && typeof row.image_url !== 'string'))) {
    throw new Error('The live bidding feed returned an invalid result.');
  }
  return signAuctionImages(data as TopListingBid[]);
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
  return { ...value, items: await signAuctionImages(value.items) };
}
