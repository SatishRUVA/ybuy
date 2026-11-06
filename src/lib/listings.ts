import { supabase } from '@/lib/supabase';
import { assertPlainText, PICKUP_TEXT_MAX, sanitizeFilterValue, UUID_RE } from '@/lib/text-safety';
import type { Listing, Category } from '@/data';
import { fetchOwnerRatings } from '@/lib/reviews';
import { listingAvailabilityExpired } from '@/lib/listing-availability';
import { pickupTimeZone, pickupToday } from '@/lib/pickup-timezone';

export interface DbCategory {
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
  sort_order: number;
}

interface DbListingImage {
  url: string;
  sort_order: number;
}

interface DbListingOwner {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

export interface DbListingRow {
  id: string;
  owner_id: string;
  category_id: string;
  title: string;
  description: string | null;
  price_per_day: number;
  price_per_week: number | null;
  deposit: number;
  estimated_value?: number | null;
  item_condition?: string | null;
  revision?: number;
  brand?: string;
  model?: string;
  included_items?: string[];
  additional_details?: string;
  delivery_radius_miles?: number | null;
  pickup_windows?: ('morning' | 'afternoon' | 'evening')[];
  return_windows?: ('morning' | 'afternoon' | 'evening')[];
  return_rules?: string[];
  return_note?: string;
  availability_start?: string | null;
  availability_end?: string | null;
  pickup_time_zone?: string | null;
  delivery_fee?: number;
  duration_discount_min_days?: number | null;
  duration_discount_percent?: number;
  weekly_discount_enabled?: boolean;
  weekly_discount_percent?: number;
  monthly_discount_enabled?: boolean;
  monthly_discount_percent?: number;
  location_lat: number | null;
  location_lng: number | null;
  location_label: string | null;
  distance_miles?: number | null;
  instant_booking: boolean;
  protection_eligible: boolean;
  delivery_available: boolean;
  owner_verified: boolean;
  available_quantity: number;
  auction_enabled?: boolean;
  auction_date_flexible?: boolean;
  auction_opening_daily_rate?: number | null;
  auction_start_date?: string | null;
  auction_end_date?: string | null;
  auction_bidding_starts_at?: string | null;
  auction_bidding_ends_at?: string | null;
  status: 'draft' | 'published' | 'archived' | 'suspended' | 'pending_approval';
  created_at: string;
  listing_images: DbListingImage[];
  owner: DbListingOwner | null;
  categories: { name: string } | null;
}

export const LISTING_SELECT =
  '*, listing_images(url, sort_order), owner:profiles!owner_id(id, full_name, avatar_url), categories(name)';

function listingImagePath(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/listing-images\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function storedListingImageUrl(url: string): string {
  const path = listingImagePath(url);
  return path ? supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl : url;
}

export async function signListingImageUrl(url: string): Promise<string> {
  const path = listingImagePath(url);
  if (!path) return url;
  const { data, error } = await supabase.storage.from('listing-images').createSignedUrl(path, 3600);
  if (error) throw new Error(`Could not load a listing photo: ${error.message}`);
  return data.signedUrl;
}

export async function signListingImages(images: DbListingImage[]): Promise<DbListingImage[]> {
  return Promise.all(images.map(async (image) => ({ ...image, url: await signListingImageUrl(image.url) })));
}

async function signListingRows(rows: DbListingRow[]): Promise<DbListingRow[]> {
  return Promise.all(rows.map(async (row) => ({ ...row, listing_images: await signListingImages(row.listing_images) })));
}

const LEGACY_SEARCH_LISTING_SELECT =
  'id, owner_id, category_id, title, description, price_per_day, deposit, location_lat, location_lng, location_label, status, created_at, listing_images(url, sort_order), owner:profiles!owner_id(id, full_name, avatar_url), categories(name)';

export async function fetchCategories(): Promise<DbCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, icon, active, sort_order')
    .eq('active', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchCategoryCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('get_listing_category_counts');
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Could not verify listing category counts.');
  const counts = new Map<string, number>();
  for (const row of data) {
    if (typeof row.category_id !== 'string' || !Number.isSafeInteger(row.listing_count) || row.listing_count < 0) {
      throw new Error('Could not verify listing category counts.');
    }
    counts.set(row.category_id, row.listing_count);
  }
  return counts;
}

export async function fetchPublishedListings(): Promise<DbListingRow[]> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('status', 'published')
    .or(`availability_end.is.null,availability_end.gt.${new Date().toISOString().slice(0, 10)}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return signListingRows((data ?? []) as unknown as DbListingRow[]);
}

export async function fetchListingById(id: string): Promise<DbListingRow | null> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as DbListingRow;
  const timeZone = await fetchListingTimeZone(id);
  return { ...row, pickup_time_zone: timeZone, listing_images: await signListingImages(row.listing_images) };
}

export async function fetchListingTimeZone(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_listing_time_zone', { p_listing_id: id });
  if (error) throw new Error(error.message);
  if (data !== null && typeof data !== 'string') throw new Error('Could not verify the pickup location timezone.');
  return data;
}

export async function fetchListingsByOwner(ownerId: string): Promise<DbListingRow[]> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('owner_id', ownerId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return signListingRows((data ?? []) as unknown as DbListingRow[]);
}

export async function deleteOwnerListing(ownerId: string, listingId: string): Promise<'deleted' | 'archived'> {
  const currentStatuses = ['requested', 'pending_payment', 'confirmed', 'active', 'return_pending'];
  const { data: currentBooking, error: currentBookingError } = await supabase
    .from('bookings')
    .select('id')
    .eq('listing_id', listingId)
    .in('status', currentStatuses)
    .limit(1)
    .maybeSingle();
  if (currentBookingError) throw currentBookingError;
  if (currentBooking) {
    throw new Error('This listing has a current or upcoming rental. It cannot be removed until all requests and rentals are finished.');
  }

  const { data: pastBooking, error: pastBookingError } = await supabase
    .from('bookings')
    .select('id')
    .eq('listing_id', listingId)
    .limit(1)
    .maybeSingle();
  if (pastBookingError) throw pastBookingError;

  if (pastBooking) {
    const { data, error } = await supabase
      .from('listings')
      .update({ status: 'archived' })
      .eq('id', listingId)
      .eq('owner_id', ownerId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Listing not found or not owned.');
    return 'archived';
  }

  const { data: images, error: imagesError } = await supabase
    .from('listing_images')
    .select('url')
    .eq('listing_id', listingId);
  if (imagesError) throw imagesError;

  const objectPaths = (images ?? []).flatMap(({ url }) => {
    const marker = '/storage/v1/object/public/listing-images/';
    const markerIndex = url.indexOf(marker);
    if (markerIndex < 0) return [];
    return [decodeURIComponent(url.slice(markerIndex + marker.length))];
  });
  if (objectPaths.length > 0) {
    const { error } = await supabase.storage.from('listing-images').remove(objectPaths);
    if (error) throw error;
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('listings')
    .delete()
    .eq('id', listingId)
    .eq('owner_id', ownerId)
    .select('id')
    .maybeSingle();
  if (deleteError) throw deleteError;
  if (!deleted) throw new Error('Listing not found or not owned.');
  return 'deleted';
}

export type SearchSortBy = 'recommended' | 'newest' | 'price-low' | 'price-high' | 'distance';

export interface SearchListingsParams {
  latitude?: number;
  longitude?: number;
  radiusMiles?: number | null;
  startDate?: string;
  endDate?: string;
  keyword?: string;
  locationCity?: string;
  categoryId?: string | null;
  maxPrice?: number;
  verifiedOnly?: boolean;
  instantOnly?: boolean;
  protectionOnly?: boolean;
  deliveryOnly?: boolean;
  sortBy?: SearchSortBy;
  page?: number;
  pageSize?: number;
}

export interface SearchListingsResult {
  rows: DbListingRow[];
  total: number;
  hasMore: boolean;
}

export const SEARCH_PAGE_SIZE = 24;
const SEARCH_CACHE_TTL_MS = 30_000;

function searchCacheKey(params: SearchListingsParams): string {
  return `ybuy:search:${JSON.stringify(params)}`;
}

/** Strips PostgREST filter-syntax characters so a keyword can't inject extra `.or()` clauses. */
function sanitizeKeyword(keyword: string): string {
  return sanitizeFilterValue(keyword);
}

/** Accepts a category id or (case-insensitive) name from a URL; returns the real id or null. */
export function resolveCategoryId(value: string | null | undefined, categories: { id: string; name: string }[]): string | null {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) return null;
  return categories.find((c) => c.id.toLowerCase() === wanted || c.name.toLowerCase() === wanted)?.id ?? null;
}

/** Real server-side search: keyword/category/price filter, sort, and pagination via Supabase. */
export async function searchListings(params: SearchListingsParams): Promise<SearchListingsResult> {
  // category_id is a uuid column; anything else would surface as a raw Postgres cast error.
  if (params.categoryId && !UUID_RE.test(params.categoryId)) throw new Error('That category is not available.');
  if (params.latitude !== undefined || params.longitude !== undefined || params.startDate || params.endDate) {
    const pageSize = params.pageSize ?? SEARCH_PAGE_SIZE;
    const offset = (params.page ?? 0) * pageSize;
    const { data, error } = await supabase.rpc('search_available_listings', {
      p_latitude: params.latitude ?? null, p_longitude: params.longitude ?? null,
      p_radius_miles: params.radiusMiles === undefined ? 5 : params.radiusMiles,
      p_start_date: params.startDate || null, p_end_date: params.endDate || null,
      p_keyword: params.keyword || null, p_category_id: params.categoryId ?? null,
      p_max_price: params.maxPrice ?? null, p_verified_only: params.verifiedOnly ?? false,
      p_instant_only: params.instantOnly ?? false, p_protection_only: params.protectionOnly ?? false,
      p_delivery_only: params.deliveryOnly ?? false, p_sort: params.sortBy ?? 'recommended',
      p_limit: pageSize, p_offset: offset,
    });
    if (error) throw new Error(error.message);
    if (!data || !Array.isArray(data.rows) || !Number.isSafeInteger(data.total)) {
      throw new Error('Search returned an invalid result. Please retry.');
    }
    return {
      rows: await signListingRows(data.rows as DbListingRow[]),
      total: data.total,
      hasMore: offset + data.rows.length < data.total,
    };
  }
  const cacheKey = searchCacheKey(params);
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const entry = JSON.parse(cached) as { cachedAt: number; result: SearchListingsResult };
      if (Date.now() - entry.cachedAt < SEARCH_CACHE_TTL_MS
        && new Date(entry.cachedAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
        && !entry.result.rows.some(row => listingAvailabilityExpired(row.availability_end))) {
        return { ...entry.result, rows: await signListingRows(entry.result.rows) };
      }
      sessionStorage.removeItem(cacheKey);
    }
  } catch {
    // Storage can be unavailable in private browsing; the network path remains authoritative.
  }

  const pageSize = params.pageSize ?? SEARCH_PAGE_SIZE;
  const page = params.page ?? 0;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('listings')
    .select(LISTING_SELECT, { count: 'exact' })
    .eq('status', 'published')
    .or(`availability_end.is.null,availability_end.gt.${new Date().toISOString().slice(0, 10)}`);

  if (params.categoryId) query = query.eq('category_id', params.categoryId);
  if (params.maxPrice != null) query = query.lte('price_per_day', params.maxPrice);
  if (params.verifiedOnly) query = query.eq('owner_verified', true);
  if (params.instantOnly) query = query.eq('instant_booking', true);
  if (params.protectionOnly) query = query.eq('protection_eligible', true);
  if (params.deliveryOnly) query = query.eq('delivery_available', true);

  const keyword = params.keyword ? sanitizeKeyword(params.keyword) : '';
  if (keyword) query = query.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);
  const locationCity = params.locationCity ? sanitizeKeyword(params.locationCity) : '';
  if (locationCity) query = query.ilike('location_label', `%${locationCity}%`);

  if (params.sortBy === 'price-low') {
    query = query.order('price_per_day', { ascending: true });
  } else if (params.sortBy === 'price-high') {
    query = query.order('price_per_day', { ascending: false });
  } else if (params.sortBy === 'recommended') {
    query = query
      .order('owner_verified', { ascending: false })
      .order('instant_booking', { ascending: false })
      .order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error, count } = await query.range(from, to);
  let resultData: unknown[] | null = data;
  let resultCount = count;

  // Older deployments can still serve published listings while optional listing
  // flags and quantity-aware negotiation columns are waiting on migrations.
  if (error?.code === '42703'
      && /owner_verified|instant_booking|protection_eligible|delivery_available|available_quantity/i.test(error.message)) {
    if ((params.verifiedOnly && /owner_verified/i.test(error.message))
      || (params.instantOnly && /instant_booking/i.test(error.message))
      || (params.protectionOnly && /protection_eligible/i.test(error.message))
      || (params.deliveryOnly && /delivery_available/i.test(error.message))) {
      throw error;
    }
    let fallback = supabase
      .from('listings')
      .select(LEGACY_SEARCH_LISTING_SELECT, { count: 'exact' })
      .eq('status', 'published')
      .or(`availability_end.is.null,availability_end.gt.${new Date().toISOString().slice(0, 10)}`);

    if (params.categoryId) fallback = fallback.eq('category_id', params.categoryId);
    if (params.maxPrice != null) fallback = fallback.lte('price_per_day', params.maxPrice);
    if (params.verifiedOnly) fallback = fallback.eq('owner_verified', true);
    if (params.instantOnly) fallback = fallback.eq('instant_booking', true);
    if (params.protectionOnly) fallback = fallback.eq('protection_eligible', true);
    if (params.deliveryOnly) fallback = fallback.eq('delivery_available', true);
    if (keyword) fallback = fallback.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);
    if (locationCity) fallback = fallback.ilike('location_label', `%${locationCity}%`);

    if (params.sortBy === 'price-low') fallback = fallback.order('price_per_day', { ascending: true });
    else if (params.sortBy === 'price-high') fallback = fallback.order('price_per_day', { ascending: false });
    else fallback = fallback.order('created_at', { ascending: false });

    const { data: fallbackData, error: fallbackError, count: fallbackCount } = await fallback.range(from, to);
    if (fallbackError) throw fallbackError;
    resultData = fallbackData;
    resultCount = fallbackCount;
  } else if (error) {
    throw error;
  }

  const rows = (resultData ?? []) as unknown as DbListingRow[];
  const total = resultCount ?? rows.length;
  const result = { rows, total, hasMore: from + rows.length < total };
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), result }));
  } catch {
    // Storage can be unavailable in private browsing; the network result is still valid.
  }
  return { ...result, rows: await signListingRows(rows) };
}


const CATEGORY_PHOTOS = new Map([
  ['Tools & Equipment', '1249611'],
  ['Electronics', '19969452'],
  ['Outdoor & Camping', '699558'],
  ['Party & Events', '169190'],
  ['Sports & Fitness', '841130'],
  ['Vehicles', '170811'],
  ['Home & Garden', '4503273'],
  ['Other', '1866149'],
]);

/** Category artwork is fixed and never sourced from user listing uploads. */
export function toUiCategory(row: DbCategory, listingCountByCategoryId: Map<string, number>): Category {
  const photo = CATEGORY_PHOTOS.get(row.name);
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? 'Package',
    image: photo ? `https://images.pexels.com/photos/${photo}/pexels-photo-${photo}.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop` : '',
    count: listingCountByCategoryId.get(row.id) ?? 0,
  };
}

/**
 * Maps a real DB listing row to the UI's decorative `Listing` shape. Fields not yet backed by
 * real data (rating, reviews, verification, protection/passport §4 items) default to honest
 * empty/zero values rather than fabricated content - they fill in as later build-order steps
 * (reviews, protection) land.
 */
export function toUiListing(row: DbListingRow): Listing {
  const images = [...row.listing_images].sort((a, b) => a.sort_order - b.sort_order).map((i) => i.url);
  const cleanText = (value: string | null | undefined) => value?.split('\u2014').join('-') ?? '';
  const expired = row.pickup_time_zone
    ? listingAvailabilityExpired(row.availability_end, pickupToday(row.pickup_time_zone))
    : listingAvailabilityExpired(row.availability_end);
  return {
    id: row.id,
    title: cleanText(row.title),
    category: cleanText(row.categories?.name),
    images,
    pricePerDay: Number(row.price_per_day),
    distance: row.distance_miles == null ? 0 : Math.round(row.distance_miles * 10) / 10,
    distanceUnit: 'mi',
    owner: {
      id: row.owner?.id ?? row.owner_id,
      name: row.owner?.full_name ?? 'Owner',
      avatar: row.owner?.avatar_url ?? FALLBACK_AVATAR,
      rating: 0,
      rentals: 0,
      responseRate: 0,
      verified: row.owner_verified === true,
      joinedYear: new Date(row.created_at).getFullYear(),
      bio: '',
      onTimeReturns: 0,
      unresolvedClaims: 0,
    },
    rating: 0,
    reviewCount: 0,
    rentalCount: 0,
    available: row.status === 'published' && !expired,
    listingStatus: row.status,
    instantBooking: row.instant_booking === true,
    verifiedOwner: row.owner_verified === true,
    protectionEligible: row.protection_eligible === true,
    deliveryAvailable: row.delivery_available === true,
    condition: row.item_condition?.replace(/_/g, ' ') ?? '',
    description: cleanText(row.description),
    whatsIncluded: row.included_items ?? [],
    brand: row.brand ?? '',
    model: row.model ?? '',
    additionalDetails: row.additional_details ?? '',
    deliveryRadiusMiles: row.delivery_radius_miles ?? null,
    components: [],
    declaredValue: Number(row.estimated_value ?? 0),
    assetId: '',
    serialPartial: '',
    ownershipVerified: false,
    rentalHistory: 0,
    damageHistory: '',
    pickup: cleanText(row.location_label),
    delivery: row.delivery_available && row.delivery_fee != null
      ? `Delivery available${row.delivery_radius_miles ? ` within ${row.delivery_radius_miles} miles (owner-declared)` : ''} for $${Number(row.delivery_fee).toFixed(2)} per trip, arranged separately and not included in the online rental total.`
      : '',
    cancellation: '',
    reviews: [],
    deposit: Number(row.deposit),
    availableQuantity: Number(row.available_quantity ?? 1),
    availabilityStart: row.availability_start ?? null,
    availabilityEnd: row.availability_end ?? null,
    pickupTimeZone: row.pickup_time_zone ?? null,
    availabilityExpired: expired,
    deliveryFee: row.delivery_fee == null ? null : Number(row.delivery_fee),
    auctionEnabled: row.auction_enabled === true,
    durationDiscount: row.duration_discount_percent && row.duration_discount_min_days
      ? { minimumDays: row.duration_discount_min_days, percent: Number(row.duration_discount_percent) } : null,
    weeklyDiscountEnabled: row.weekly_discount_enabled === true,
    weeklyDiscountPercent: Number(row.weekly_discount_percent ?? 0),
    monthlyDiscountEnabled: row.monthly_discount_enabled === true,
    monthlyDiscountPercent: Number(row.monthly_discount_percent ?? 0),
    lat: row.location_lat ?? 0,
    lng: row.location_lng ?? 0,
  };
}

const FALLBACK_AVATAR =
  'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop';

/**
 * Merges each owner's real review rating/count into a set of UI listings so cards and detail
 * views show real trust signals instead of zeros. Owner-level (see fetchOwnerRatings). Returns a
 * new array; on any error it returns the input unchanged so listings still render.
 */
export async function enrichListingsWithRatings(listings: Listing[]): Promise<Listing[]> {
  if (listings.length === 0) return listings;
  try {
    const stats = await fetchOwnerRatings(listings.map((l) => l.owner.id));
    return listings.map((l) => {
      const s = stats.get(l.owner.id);
      if (!s || s.count === 0) return l;
      return {
        ...l,
        rating: s.rating,
        reviewCount: s.count,
        rentalCount: s.count,
        owner: { ...l.owner, rating: s.rating, rentals: s.count, missedAuctionDecisionCount: s.missedDecisionCount },
      };
    });
  } catch (error) {
    console.warn('Could not load owner ratings; listing verification is unchanged.', error);
    return listings;
  }
}

export async function createDraftListing(ownerId: string, categoryId: string): Promise<string> {
  const { data, error } = await supabase
    .from('listings')
    .insert({ owner_id: ownerId, category_id: categoryId, title: '', price_per_day: 1, status: 'draft' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function uploadListingPhoto(
  listingId: string,
  file: File,
  sortOrder: number,
  replaceUrl?: string,
): Promise<{ url: string; warning?: string }> {
  const path = `${listingId}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from('listing-images').upload(path, file);
  if (uploadError) throw uploadError;
  const { data: signed, error: signError } = await supabase.storage.from('listing-images').createSignedUrl(path, 3600);
  if (signError) {
    const cleanup = await supabase.storage.from('listing-images').remove([path]);
    if (cleanup.error) throw new Error(`Could not prepare the photo preview and storage cleanup also failed: ${cleanup.error.message}`);
    throw signError;
  }
  const { data } = supabase.storage.from('listing-images').getPublicUrl(path);
  try {
    if (replaceUrl) {
      const { data: replaced, error } = await supabase.from('listing_images').update({ url: data.publicUrl })
        .eq('listing_id', listingId).eq('url', storedListingImageUrl(replaceUrl)).select('url').maybeSingle();
      if (error) throw error;
      if (!replaced) throw new Error('The photo being replaced is no longer on this listing. Reload and try again.');
    } else {
      await addListingImageUrl(listingId, data.publicUrl, sortOrder);
    }
  } catch (error) {
    const cleanup = await supabase.storage.from('listing-images').remove([path]);
    if (cleanup.error) throw new Error(`Could not attach the photo; storage cleanup also failed: ${cleanup.error.message}`);
    throw error;
  }
  let warning: string | undefined;
  const previousPath = replaceUrl ? listingImagePath(replaceUrl) : null;
  if (previousPath) {
    const { error: removeError } = await supabase.storage.from('listing-images').remove([previousPath]);
    if (removeError) warning = `Photo replaced, but the old image file could not be deleted: ${removeError.message}`;
  }
  return { url: signed.signedUrl, warning };
}

export async function addListingImageUrl(listingId: string, url: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.from('listing_images').insert({ listing_id: listingId, url, sort_order: sortOrder });
  if (error) throw error;
}

export async function removeListingImageUrl(listingId: string, url: string): Promise<void> {
  const storedUrl = storedListingImageUrl(url);
  const { error } = await supabase.from('listing_images').delete().eq('listing_id', listingId).eq('url', storedUrl);
  if (error) throw error;
  const path = listingImagePath(url);
  if (path) {
    const { error: storageError } = await supabase.storage.from('listing-images').remove([path]);
    if (storageError) throw new Error(`Photo record removed but its storage object could not be deleted: ${storageError.message}`);
  }
}

export async function saveListingImageOrder(listingId: string, urls: string[]): Promise<void> {
  const { error } = await supabase.rpc('owner_reorder_listing_images', {
    p_listing_id: listingId, p_urls: urls.map(storedListingImageUrl),
  });
  if (error) throw error;
}

export interface ListingDetailsUpdate {
  title: string;
  category_id: string;
  price_per_day: number;
  description: string;
  deposit: number;
  estimated_value?: number | null;
  item_condition?: string | null;
  availability_start?: string | null;
  availability_end?: string | null;
  delivery_fee?: number;
  location_label: string;
  instant_booking?: boolean;
  protection_eligible?: boolean;
  delivery_available?: boolean;
  owner_verified?: boolean;
  available_quantity?: number;
}

export interface CategoryDepositRule { category_id: string; suggested_pct: number; minimum_amount: number; maximum_amount: number }
export async function fetchDepositRules(): Promise<CategoryDepositRule[]> {
  const { data, error } = await supabase.from('category_deposit_rules').select('category_id,suggested_pct,minimum_amount,maximum_amount');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchOwnerPickup(listingId: string): Promise<ListingPickupLocation | null> {
  const { data, error } = await supabase.from('listing_pickup_locations').select('*').eq('listing_id',listingId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { formattedAddress: data.address, streetAddress: data.street_address, city: data.city,
    state: data.state, postalCode: data.postal_code, country: data.country, latitude: data.latitude,
    longitude: data.longitude, placeId: data.place_id ?? '' } : null;
}

export async function saveOwnerListing(listingId: string, revision: number, details: ListingDetailsUpdate, pickup?: ListingPickupLocation): Promise<number> {
  const { data, error } = await supabase.rpc('owner_save_listing', {
    p_listing_id: listingId,p_revision: revision,p_details: details,
    p_pickup: pickup ? { ...pickup, timeZone: pickupTimeZone(pickup.latitude, pickup.longitude) } : null,
  });
  if (error) throw new Error(error.message);
  if (!Number.isSafeInteger(data)) throw new Error('Could not verify the saved listing revision.');
  return data;
}

export async function updateListingDetails(listingId: string, details: ListingDetailsUpdate): Promise<void> {
  let { error } = await supabase.from('listings').update(details).eq('id', listingId);

  // Backward compatibility while DB migrations are rolling out.
  if (error && /owner_verified|instant_booking|protection_eligible|delivery_available|available_quantity/i.test(error.message)) {
    const legacyDetails = { ...details };
    delete legacyDetails.instant_booking;
    delete legacyDetails.protection_eligible;
    delete legacyDetails.delivery_available;
    delete legacyDetails.owner_verified;
    delete legacyDetails.available_quantity;
    ({ error } = await supabase.from('listings').update(legacyDetails).eq('id', listingId));
  }

  if (error) throw error;
}

export interface ListingPickupLocation {
  formattedAddress: string;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  placeId: string;
}

export async function saveListingPickupLocation(listingId: string, ownerId: string, location: ListingPickupLocation): Promise<void> {
  assertPlainText('Pickup address', location.formattedAddress, PICKUP_TEXT_MAX);
  assertPlainText('Street address', location.streetAddress, PICKUP_TEXT_MAX);
  assertPlainText('City', location.city, PICKUP_TEXT_MAX);
  assertPlainText('State', location.state, PICKUP_TEXT_MAX);
  assertPlainText('ZIP code', location.postalCode, PICKUP_TEXT_MAX);
  assertPlainText('Country', location.country, PICKUP_TEXT_MAX);
  const { error } = await supabase.from('listing_pickup_locations').upsert({
    listing_id: listingId,
    owner_id: ownerId,
    address: location.formattedAddress,
    street_address: location.streetAddress,
    city: location.city,
    state: location.state,
    postal_code: location.postalCode,
    country: location.country,
    latitude: location.latitude,
    longitude: location.longitude,
    time_zone: pickupTimeZone(location.latitude, location.longitude),
    place_id: location.placeId || null,
  }, { onConflict: 'listing_id' });
  if (error) throw error;
}

export async function publishListing(listingId: string): Promise<void> {
  const { data, error } = await supabase.from('listings').update({ status: 'published' }).eq('id', listingId)
    .select('id, status').single();
  if (error) throw new Error(error.message);
  if (data.status !== 'published') throw new Error('The listing has not been published. Please try again.');
}
