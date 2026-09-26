import { supabase } from '@/lib/supabase';
import type { Listing, Category } from '@/data';
import { fetchOwnerRatings } from '@/lib/reviews';

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
  location_lat: number | null;
  location_lng: number | null;
  location_label: string | null;
  instant_booking: boolean;
  protection_eligible: boolean;
  delivery_available: boolean;
  owner_verified: boolean;
  status: 'draft' | 'published' | 'archived';
  created_at: string;
  listing_images: DbListingImage[];
  owner: DbListingOwner | null;
  categories: { name: string } | null;
}

export const LISTING_SELECT =
  '*, listing_images(url, sort_order), owner:profiles!owner_id(id, full_name, avatar_url), categories(name)';

export async function fetchCategories(): Promise<DbCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, icon, active, sort_order')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

// ponytail: O(n) scan over published listings is sufficient for Part 1's small dataset.
// Upgrade to a DB view/RPC count(*) group by category_id if listing volume grows materially.
export async function fetchCategoryCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('listings').select('category_id').eq('status', 'published');
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  return counts;
}

export async function fetchPublishedListings(): Promise<DbListingRow[]> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('status', 'published')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as DbListingRow[];
}

/**
 * One representative photo per category, for the home category rail.
 * ponytail: a single bounded scan of the newest listings covers every category in practice and
 * costs one request. Swap for a `category_cover_url` column if a category ever renders coverless.
 */
export async function fetchCategoryCovers(limit = 240): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('listings')
    .select('category_id, listing_images(url, sort_order)')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const covers = new Map<string, string>();
  for (const row of (data ?? []) as unknown as { category_id: string; listing_images: { url: string; sort_order: number }[] }[]) {
    if (covers.has(row.category_id)) continue;
    const first = [...(row.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
    if (first) covers.set(row.category_id, first.url);
  }
  return covers;
}

export async function fetchListingById(id: string): Promise<DbListingRow | null> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as DbListingRow | null;
}

export async function fetchListingsByOwner(ownerId: string): Promise<DbListingRow[]> {
  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('owner_id', ownerId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as DbListingRow[];
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

export type SearchSortBy = 'recommended' | 'newest' | 'price-low' | 'price-high';

export interface SearchListingsParams {
  keyword?: string;
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

/** Strips PostgREST filter-syntax separators so a keyword can't inject extra `.or()` clauses. */
function sanitizeKeyword(keyword: string): string {
  return keyword.replace(/[,()%]/g, '').trim();
}

/** Real server-side search: keyword/category/price filter, sort, and pagination via Supabase. */
export async function searchListings(params: SearchListingsParams): Promise<SearchListingsResult> {
  const pageSize = params.pageSize ?? SEARCH_PAGE_SIZE;
  const page = params.page ?? 0;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('listings')
    .select(LISTING_SELECT, { count: 'exact' })
    .eq('status', 'published');

  if (params.categoryId) query = query.eq('category_id', params.categoryId);
  if (params.maxPrice != null) query = query.lte('price_per_day', params.maxPrice);
  if (params.verifiedOnly) query = query.eq('owner_verified', true);
  if (params.instantOnly) query = query.eq('instant_booking', true);
  if (params.protectionOnly) query = query.eq('protection_eligible', true);
  if (params.deliveryOnly) query = query.eq('delivery_available', true);

  const keyword = params.keyword ? sanitizeKeyword(params.keyword) : '';
  if (keyword) query = query.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);

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

  let { data, error, count } = await query.range(from, to);

  // Backward compatibility while local/staging DB is catching up with migrations:
  // if any new filter/sort column is missing, retry with baseline searchable fields.
  if (error && /owner_verified|instant_booking|protection_eligible|delivery_available/i.test(error.message)) {
    let fallback = supabase
      .from('listings')
      .select(LISTING_SELECT, { count: 'exact' })
      .eq('status', 'published');

    if (params.categoryId) fallback = fallback.eq('category_id', params.categoryId);
    if (params.maxPrice != null) fallback = fallback.lte('price_per_day', params.maxPrice);
    if (keyword) fallback = fallback.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);

    if (params.sortBy === 'price-low') fallback = fallback.order('price_per_day', { ascending: true });
    else if (params.sortBy === 'price-high') fallback = fallback.order('price_per_day', { ascending: false });
    else fallback = fallback.order('created_at', { ascending: false });

    ({ data, error, count } = await fallback.range(from, to));
  }

  if (error) throw error;
  const rows = (data ?? []) as unknown as DbListingRow[];
  const total = count ?? rows.length;
  return { rows, total, hasMore: from + rows.length < total };
}


/** Maps a real DB category row to the UI's decorative `Category` shape (image/count are cosmetic). */
export function toUiCategory(row: DbCategory, listingCountByCategoryId: Map<string, number>): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? 'Package',
    image: '',
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
  return {
    id: row.id,
    title: cleanText(row.title),
    category: cleanText(row.categories?.name),
    images: images.length > 0 ? images : [FALLBACK_IMAGE],
    pricePerDay: Number(row.price_per_day),
    distance: 0,
    distanceUnit: 'mi',
    owner: {
      id: row.owner?.id ?? row.owner_id,
      name: row.owner?.full_name ?? 'Owner',
      avatar: row.owner?.avatar_url ?? FALLBACK_AVATAR,
      rating: 0,
      rentals: 0,
      responseRate: 0,
      verified: false,
      joinedYear: new Date(row.created_at).getFullYear(),
      bio: '',
      onTimeReturns: 0,
      unresolvedClaims: 0,
    },
    rating: 0,
    reviewCount: 0,
    rentalCount: 0,
    available: row.status === 'published',
    instantBooking: row.instant_booking,
    verifiedOwner: row.owner_verified,
    protectionEligible: row.protection_eligible,
    deliveryAvailable: row.delivery_available,
    condition: '',
    description: cleanText(row.description),
    whatsIncluded: [],
    components: [],
    declaredValue: 0,
    assetId: '',
    serialPartial: '',
    ownershipVerified: false,
    rentalHistory: 0,
    damageHistory: '',
    pickup: cleanText(row.location_label),
    delivery: '',
    cancellation: '',
    reviews: [],
    deposit: Number(row.deposit),
    lat: row.location_lat ?? 0,
    lng: row.location_lng ?? 0,
  };
}

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/4498362/pexels-photo-4498362.jpeg?auto=compress&cs=tinysrgb&w=600&h=450&fit=crop';
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
        verifiedOwner: true,
        owner: { ...l.owner, rating: s.rating, rentals: s.count, verified: true },
      };
    });
  } catch {
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

export async function uploadListingPhoto(listingId: string, file: File, sortOrder: number): Promise<string> {
  const path = `${listingId}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from('listing-images').upload(path, file);
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('listing-images').getPublicUrl(path);
  await addListingImageUrl(listingId, data.publicUrl, sortOrder);
  return data.publicUrl;
}

export async function addListingImageUrl(listingId: string, url: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.from('listing_images').insert({ listing_id: listingId, url, sort_order: sortOrder });
  if (error) throw error;
}

export async function removeListingImageUrl(listingId: string, url: string): Promise<void> {
  const { error } = await supabase.from('listing_images').delete().eq('listing_id', listingId).eq('url', url);
  if (error) throw error;
}

export interface ListingDetailsUpdate {
  title: string;
  category_id: string;
  price_per_day: number;
  description: string;
  deposit: number;
  location_label: string;
  instant_booking?: boolean;
  protection_eligible?: boolean;
  delivery_available?: boolean;
  owner_verified?: boolean;
}

export async function updateListingDetails(listingId: string, details: ListingDetailsUpdate): Promise<void> {
  let { error } = await supabase.from('listings').update(details).eq('id', listingId);

  // Backward compatibility while DB migrations are rolling out.
  if (error && /owner_verified|instant_booking|protection_eligible|delivery_available/i.test(error.message)) {
    const legacyDetails = { ...details };
    delete legacyDetails.instant_booking;
    delete legacyDetails.protection_eligible;
    delete legacyDetails.delivery_available;
    delete legacyDetails.owner_verified;
    ({ error } = await supabase.from('listings').update(legacyDetails).eq('id', listingId));
  }

  if (error) throw error;
}

export async function publishListing(listingId: string): Promise<void> {
  const { error } = await supabase.from('listings').update({ status: 'published' }).eq('id', listingId);
  if (error) throw error;
}
