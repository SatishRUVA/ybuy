import { supabase } from '@/lib/supabase';
import { assertPlainText, assertUuid, sanitizeFilterValue } from '@/lib/text-safety';
import { todayIso } from '@/lib/geo';
import { requireMarketplaceCountry } from '@/lib/marketplace-countries';

export type ItemRequestStatus =
  | 'open' | 'responses_received' | 'negotiating' | 'matched' | 'cancelled' | 'expired' | 'closed';

export interface ItemRequest {
  id: string;
  renter_id: string;
  category_id: string;
  title: string;
  description: string;
  intended_use: string | null;
  preferred_start_date: string;
  preferred_end_date: string;
  location_label: string;
  location_lat?:number|null;
  location_lng?:number|null;
  radius_miles?:number|null;
  max_daily_budget: number | null;
  requested_quantity: number;
  specifications: string | null;
  additional_notes: string | null;
  visibility: 'public' | 'private';
  status: ItemRequestStatus;
  reference_image_paths: string[];
  expires_at: string;
  created_at: string;
  categories?: { name: string } | null;
}

export interface CreateRequestInput {
  id: string;
  idempotencyKey: string;
  categoryId: string;
  title: string;
  description: string;
  intendedUse: string;
  startDate: string;
  endDate: string;
  location: string;
  country: string;
  latitude?:number;
  longitude?:number;
  radiusMiles?:number|null;
  maxDailyBudget: number | null;
  quantity: number;
  specifications: string;
  notes: string;
  images: File[];
  mainSitePreferences?: { notifyMatches: boolean };
}

export interface OwnerListing {
  id: string;
  title: string;
  price_per_day: number;
  category_id: string;
  available_quantity: number;
  status: string;
  location_label: string | null;
}

export interface AdminItemRequest extends Pick<ItemRequest,
  'id' | 'title' | 'description' | 'status' | 'location_label' | 'preferred_start_date'
  | 'preferred_end_date' | 'created_at' | 'expires_at'> {
  categories: { name: string } | null;
}

export async function listAdminItemRequests(params: {
  search: string; status: string; limit: number; offset: number;
}): Promise<{ rows: AdminItemRequest[]; total: number }> {
  let query = supabase.from('item_requests')
    .select('id,title,description,status,location_label,preferred_start_date,preferred_end_date,created_at,expires_at,categories(name)', { count: 'exact' })
    .in('status', ['open', 'responses_received', 'negotiating'])
    .order('created_at', { ascending: false });
  if (params.status !== 'all') query = query.eq('status', params.status);
  const search = sanitizeFilterValue(params.search);
  if (search) query = query.or(`title.ilike.%${search}%,location_label.ilike.%${search}%`);
  const { data, count, error } = await query.range(params.offset, params.offset + params.limit - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as AdminItemRequest[], total: count ?? 0 };
}

export async function moderateItemRequest(requestId: string, reason: string): Promise<void> {
  assertUuid(requestId, 'request id');
  assertPlainText('Moderation reason', reason.trim(), 500);
  if (reason.trim().length < 3) throw new Error('Enter a moderation reason of at least 3 characters.');
  const { error } = await supabase.rpc('admin_moderate_item_request', {
    p_request_id: requestId,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function listRequestCategories() {
  const { data, error } = await supabase.from('categories').select('id, name').eq('active', true).order('sort_order');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createItemRequest(input: CreateRequestInput, userId: string): Promise<ItemRequest> {
  assertUuid(userId, 'user id');
  assertUuid(input.id, 'request id');
  assertUuid(input.idempotencyKey, 'idempotency key');
  assertPlainText('Item name', input.title.trim(), 120);
  assertPlainText('Description', input.description.trim(), 1200);
  assertPlainText('Intended use', input.intendedUse.trim(), 500);
  assertPlainText('Location', input.location.trim(), 200);
  assertPlainText('Specifications', input.specifications.trim(), 500);
  assertPlainText('Additional notes', input.notes.trim(), 1200);
  if (input.title.trim().length < 3 || input.description.trim().length < 10 || input.location.trim().length < 2) {
    throw new Error('Enter an item name, a description of at least 10 characters, and a location.');
  }
  if (!input.categoryId || !input.startDate || !input.endDate
    || input.startDate < todayIso() || input.endDate <= input.startDate) {
    throw new Error('Choose a category and a valid rental date range.');
  }
  assertUuid(input.categoryId, 'category id');
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) {
    throw new Error('Quantity must be between 1 and 100.');
  }
  if (input.maxDailyBudget !== null && (!Number.isFinite(input.maxDailyBudget) || input.maxDailyBudget <= 0 || input.maxDailyBudget > 100000)) {
    throw new Error('Enter a positive daily budget no greater than $100,000.');
  }
  if (input.images.length > 4) throw new Error('Choose no more than four reference images.');
  if (input.latitude === undefined || input.longitude === undefined) throw new Error('Select a city or postal code before posting.');
  const countryCode = await requireMarketplaceCountry(input.country ?? '');

  const referenceImagePaths: string[] = [];
  for (const [index, file] of input.images.entries()) {
    const extension = await getValidatedImageExtension(file);
    const path = `${userId}/${input.id}/${index + 1}.${extension}`;
    const { error } = await supabase.storage.from('item-request-images').upload(path, file, {
      contentType: file.type,
      upsert: true,
    });
    if (error) {
      throw new Error(`Could not upload a reference image: ${error.message}`);
    }
    referenceImagePaths.push(path);
  }

  const payload = {
    p_id: input.id,
    p_idempotency_key: input.idempotencyKey,
    p_category_id: input.categoryId,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_intended_use: input.intendedUse.trim() || null,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_location_label: input.location.trim(),
    p_max_daily_budget: input.maxDailyBudget,
    p_quantity: input.quantity,
    p_specifications: input.specifications.trim() || null,
    p_additional_notes: input.notes.trim() || null,
    p_visibility: 'public',
    p_reference_image_paths: referenceImagePaths,
    p_country_code: countryCode,
  };
  const args = { p_request: payload, p_latitude: input.latitude, p_longitude: input.longitude, p_radius_miles: input.radiusMiles === undefined ? 5 : input.radiusMiles };
  const { data, error } = input.mainSitePreferences
    ? await supabase.rpc('create_main_item_request', { ...args,
      p_open_for_offers: false, p_notify_matches_in_app: input.mainSitePreferences.notifyMatches })
    : await supabase.rpc('create_located_item_request', args);
  if (error) throw new Error(error.message);
  return data as ItemRequest;
}

export async function fetchRequestListingMatches(requestIds:string[]):Promise<Record<string,OwnerListing[]>> {
  const result:Record<string,OwnerListing[]>={};
  for(let start=0;start<requestIds.length;start+=50){
    const {data,error}=await supabase.rpc('get_request_listing_matches',{p_request_ids:requestIds.slice(start,start+50)});
    if(error)throw new Error(error.message);
    Object.assign(result,data);
  }
  return result;
}

export async function linkItemRequestListing(requestId: string, listingId: string): Promise<void> {
  assertUuid(requestId, 'request id');
  assertUuid(listingId, 'listing id');
  const { error } = await supabase.rpc('link_item_request_listing', {
    p_request_id: requestId, p_listing_id: listingId,
  });
  if (error) throw new Error(error.message);
}

async function getValidatedImageExtension(file: File): Promise<string> {
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Each reference image must be no larger than 5 MB.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Reference images must be JPEG, PNG or WebP files.');
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if ((file.type === 'image/jpeg' && isJpeg) || (file.type === 'image/png' && isPng) || (file.type === 'image/webp' && isWebp)) {
    return file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
  }
  throw new Error('A selected file does not match its JPEG, PNG or WebP image type.');
}

export async function fetchOpenItemRequests(params: {
  categoryId?: string;
  location?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  maxDailyBudget?: number | null;
  sort?: 'newest' | 'earliest' | 'budget';
  page: number;
  pageSize?: number;
}): Promise<{ rows: ItemRequest[]; total: number }> {
  const orderColumn = params.sort === 'earliest' ? 'preferred_start_date'
    : params.sort === 'budget' ? 'max_daily_budget' : 'created_at';
  let query = supabase.from('item_requests')
    .select('*, categories(name)', { count: 'exact' })
    .in('status', ['open', 'responses_received', 'negotiating'])
    .eq('visibility', 'public')
    .gt('preferred_end_date', todayIso())
    .gt('expires_at', new Date().toISOString())
    .order(orderColumn, { ascending: params.sort !== 'newest', nullsFirst: false })
    .order('id');
  if (params.categoryId) query = query.eq('category_id', params.categoryId);
  if (params.location?.trim()) query = query.ilike('location_label', `%${params.location.trim().replace(/[%_,]/g, ' ')}%`);
  if (params.search?.trim()) query = query.ilike('title', `%${params.search.trim().replace(/[%_,]/g, ' ')}%`);
  if (params.startDate) query = query.lte('preferred_start_date', params.endDate ?? params.startDate);
  if (params.endDate) query = query.gte('preferred_end_date', params.startDate ?? params.endDate);
  if (params.maxDailyBudget !== null && params.maxDailyBudget !== undefined && Number.isFinite(params.maxDailyBudget)) {
    query = query.or(`max_daily_budget.is.null,max_daily_budget.lte.${Math.max(0, params.maxDailyBudget)}`);
  }
  const pageSize = params.pageSize ?? 12;
  const from = Math.max(params.page, 0) * pageSize;
  const { data, count, error } = await query.range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as ItemRequest[], total: count ?? 0 };
}

export async function fetchMyItemRequests(userId: string): Promise<ItemRequest[]> {
  assertUuid(userId, 'user id');
  const { data, error } = await supabase.from('item_requests').select('*, categories(name)')
    .eq('renter_id', userId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ItemRequest[];
}

export async function fetchMyOwnerListings(ownerId: string): Promise<OwnerListing[]> {
  assertUuid(ownerId, 'user id');
  const { data, error } = await supabase.from('listings')
    .select('id,title,price_per_day,category_id,available_quantity,status,location_label')
    .eq('owner_id', ownerId).eq('status', 'published').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface MarketplaceNotification {
  id: string;
  item_request_id: string | null;
  event_type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface MarketplaceRequestEvent {
  id: string;
  event_type: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export async function fetchMarketplaceRequestEvents(requestId: string): Promise<MarketplaceRequestEvent[]> {
  assertUuid(requestId, 'request id');
  const { data, error } = await supabase.from('marketplace_events')
    .select('id,event_type,detail,created_at')
    .eq('item_request_id', requestId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MarketplaceRequestEvent[];
}

export async function fetchMarketplaceNotifications(limit = 25, offset = 0): Promise<MarketplaceNotification[]> {
  const { data, error } = await supabase.from('marketplace_notifications')
    .select('id,item_request_id,event_type,title,body,created_at,read_at')
    .is('negotiation_id', null)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit) - 1);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function markMarketplaceNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_marketplace_notification_read', { p_notification_id: notificationId });
  if (error) throw new Error(error.message);
}

export async function markAllMarketplaceNotificationsRead(): Promise<void> {
  const { error } = await supabase.from('marketplace_notifications')
    .update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (error) throw new Error(error.message);
}

export async function requestImageUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('item-request-images').createSignedUrl(path, 60 * 30);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function closeItemRequest(requestId: string, action: 'cancel' | 'close' = 'cancel'): Promise<void> {
  const { error } = await supabase.rpc('close_item_request', { p_request_id: requestId, p_action: action });
  if (error) throw new Error(error.message);
}

export async function updateItemRequest(request: ItemRequest): Promise<void> {
  assertUuid(request.id, 'request id');
  assertUuid(request.category_id, 'category id');
  assertPlainText('Item name', request.title.trim(), 120);
  assertPlainText('Description', request.description.trim(), 1200);
  assertPlainText('Intended use', request.intended_use?.trim() ?? '', 500);
  assertPlainText('Location', request.location_label.trim(), 200);
  assertPlainText('Specifications', request.specifications?.trim() ?? '', 500);
  assertPlainText('Additional notes', request.additional_notes?.trim() ?? '', 1200);
  if (request.title.trim().length < 3 || request.description.trim().length < 10 || request.location_label.trim().length < 2) {
    throw new Error('Enter an item name, a description of at least 10 characters, and a location.');
  }
  if (request.preferred_start_date < todayIso() || request.preferred_end_date <= request.preferred_start_date) {
    throw new Error('Choose a valid future date range.');
  }
  if (!Number.isInteger(request.requested_quantity) || request.requested_quantity < 1 || request.requested_quantity > 100) {
    throw new Error('Quantity must be between 1 and 100.');
  }
  if (request.max_daily_budget !== null && (!Number.isFinite(request.max_daily_budget) || request.max_daily_budget <= 0 || request.max_daily_budget > 100000)) {
    throw new Error('Enter a positive daily budget no greater than $100,000.');
  }
  const { error } = await supabase.rpc('update_item_request', {
    p_request_id: request.id,
    p_title: request.title,
    p_category_id: request.category_id,
    p_description: request.description,
    p_intended_use: request.intended_use,
    p_start_date: request.preferred_start_date,
    p_end_date: request.preferred_end_date,
    p_location_label: request.location_label,
    p_max_daily_budget: request.max_daily_budget,
    p_quantity: request.requested_quantity,
    p_specifications: request.specifications,
    p_additional_notes: request.additional_notes,
    p_visibility: request.visibility,
  });
  if (error) throw new Error(error.message);
}

export async function expireMarketplaceActivity(): Promise<void> {
  const { error } = await supabase.rpc('expire_marketplace_activity');
  if (error) throw new Error(error.message);
}
