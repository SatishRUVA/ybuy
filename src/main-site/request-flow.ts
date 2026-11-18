import { supabase } from '@/lib/supabase';
import { assertUuid } from '@/lib/text-safety';
import { createItemRequest, type CreateRequestInput, type ItemRequest } from '@/lib/marketplace';
import { fetchListingById, searchListings, type DbListingRow } from '@/lib/listings';

export interface MainItemRequest extends ItemRequest {
  notify_matches_in_app?: boolean;
  main_site_flow?: boolean;
  distance_miles?: number | null;
}

export async function fetchMainItemRequest(id: string): Promise<MainItemRequest> {
  assertUuid(id, 'request id');
  const { data, error } = await supabase.from('item_requests').select('*, categories(name)')
    .eq('id', id).maybeSingle<MainItemRequest>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('This request is unavailable or you do not have permission to view it.');
  return data;
}

export async function createMainItemRequest(input: CreateRequestInput, userId: string, notifyMatches: boolean) {
  return createItemRequest({ ...input, mainSitePreferences: { notifyMatches } }, userId);
}

export async function saveRequestMatchPreference(id: string, enabled: boolean) {
  assertUuid(id, 'request id');
  const { error } = await supabase.rpc('update_request_match_preference', { p_request_id: id, p_enabled: enabled });
  if (error) throw new Error(error.message);
}

export async function linkMainRequestListing(requestId: string, listingId: string, notify: boolean): Promise<{ linked: true; in_app_notified: boolean }> {
  assertUuid(requestId, 'request id');
  assertUuid(listingId, 'listing id');
  const { data, error } = await supabase.rpc('link_main_request_listing', {
    p_request_id: requestId, p_listing_id: listingId, p_notify: notify,
  });
  if (error) throw new Error(error.message);
  if (data?.linked !== true || typeof data.in_app_notified !== 'boolean') throw new Error('The server did not confirm the rental link. Refresh before trying again.');
  return data;
}

export async function fetchNearbyRequests(params: {
  latitude?: number; longitude?: number; radius: number | null; search: string; categoryId: string;
  location: string; startDate: string; endDate: string; maxBudget: string;
  sort: 'newest' | 'earliest' | 'budget'; page: number;
}): Promise<{ rows: MainItemRequest[]; total: number }> {
  const { data, error } = await supabase.rpc('get_nearby_item_requests', {
    p_latitude: params.latitude ?? null, p_longitude: params.longitude ?? null,
    p_radius_miles: params.latitude === undefined ? null : params.radius,
    p_search: params.search, p_category_id: params.categoryId || null, p_location: params.location,
    p_start_date: params.startDate || null, p_end_date: params.endDate || null,
    p_max_daily_budget: params.maxBudget ? Number(params.maxBudget) : null,
    p_sort: params.sort, p_limit: 12, p_offset: params.page * 12,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data?.rows) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Nearby requests returned an invalid response. Please retry.');
  return data;
}

export async function suggestRequestCategory(title: string, categories: { id: string; name: string }[]) {
  const { rows } = await searchListings({ keyword: title.trim(), pageSize: 5 });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return null;
  return categories.find(category => category.id === ranked[0][0]) ?? null;
}

export async function fetchRequestMatches(request: MainItemRequest, page: number): Promise<{ rows: DbListingRow[]; total: number; hasMore: boolean }> {
  const { data, error } = await supabase.rpc('get_main_request_matches', { p_request_id: request.id, p_limit: 12, p_offset: page * 12 });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Matching listings returned an invalid response. Please retry.');
  const items: { listing_id: string; distance_miles: number | null }[] = data.items;
  if (!items.every(item => item && typeof item.listing_id === 'string'
    && (item.distance_miles === null || (Number.isFinite(item.distance_miles) && item.distance_miles >= 0)))) {
    throw new Error('Matching listings returned invalid distance or listing data. Please retry.');
  }
  const rows = await Promise.all(items.map(async item => {
    assertUuid(item.listing_id, 'matched listing id');
    const listing = await fetchListingById(item.listing_id);
    if (!listing) throw new Error('A matched listing is no longer available. Refresh these matches.');
    return { ...listing, distance_miles: item.distance_miles };
  }));
  return { rows, total: data.total, hasMore: (page + 1) * 12 < data.total };
}
