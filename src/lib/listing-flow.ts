import { supabase } from '@/lib/supabase';
import type { CategoryDepositRule, ListingPickupLocation } from '@/lib/listings';
import type { ListingItemDetails } from '@/lib/listing-item-details';
import type { ListingAuctionPreferences } from '@/lib/listing-auctions';
import { pickupTimeZone } from '@/lib/pickup-timezone';

export type ListingFlowStatus = 'draft' | 'pending_approval' | 'published' | 'archived' | 'suspended';

export interface ListingFlowPolicy {
  listing_duration_days: number;
  max_quantity: number;
  max_photos: number;
  max_photo_bytes: number;
  min_photo_dimension: number;
  max_delivery_fee: number;
  high_value_threshold: number | null;
  max_estimated_value: number;
  deposit_rules: CategoryDepositRule[];
}

export interface ListingFlowDetails {
  title?: string;
  description?: string;
  category_id?: string;
  price_per_day?: number;
  weekly_discount_enabled?: boolean;
  weekly_discount_percent?: number;
  monthly_discount_enabled?: boolean;
  monthly_discount_percent?: number;
  estimated_value?: number | null;
  item_condition?: string | null;
  location_label?: string;
  instant_booking?: boolean;
  protection_eligible?: boolean;
  delivery_available?: boolean;
  available_quantity?: number;
  availability_start?: string | null;
  availability_end?: string | null;
  delivery_fee?: number;
  item_details?: ListingItemDetails;
  auction_preferences?: ListingAuctionPreferences;
}

export interface ListingFlowResult {
  revision: number;
  status: ListingFlowStatus;
  deposit: number;
}

function result(data: unknown): ListingFlowResult {
  const value = data as ListingFlowResult | null;
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !['draft', 'pending_approval', 'published', 'archived', 'suspended'].includes(value.status)
    || !Number.isFinite(value.deposit) || value.deposit < 0) {
    throw new Error('Could not verify the saved listing. Reload before continuing.');
  }
  return value;
}

export async function getListingFlowPolicy(): Promise<ListingFlowPolicy> {
  const { data, error } = await supabase.rpc('get_listing_flow_policy');
  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data.deposit_rules)
    || ['listing_duration_days', 'max_quantity', 'max_photos', 'max_photo_bytes', 'min_photo_dimension']
      .some(key => !Number.isSafeInteger(data[key]) || data[key] < 1)
    || !Number.isFinite(data.max_delivery_fee)
    || !Number.isFinite(data.max_estimated_value) || data.max_estimated_value <= 0) {
    throw new Error('Listing policy is unavailable. Please try again later.');
  }
  return data as ListingFlowPolicy;
}

export async function saveListingFlow(
  listingId: string,
  revision: number,
  details: ListingFlowDetails,
  pickup?: ListingPickupLocation | null,
  publish = false,
): Promise<ListingFlowResult> {
  const args = {
    p_listing_id: listingId, p_revision: revision,
    p_pickup: pickup ? { ...pickup, timeZone: pickupTimeZone(pickup.latitude, pickup.longitude) } : null,
    p_publish: publish,
  };
  const { data, error } = await supabase.rpc('owner_save_listing_flow', {
    ...args, p_details: { ...details, availability_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  if (error) throw new Error(error.message);
  const saved = result(data);
  if (publish && saved.status === 'published' && details.auction_preferences?.enabled) {
    window.dispatchEvent(new Event('ybuy-auction-published'));
  }
  return saved;
}

export async function saveAuctionPreferences(
  listingId: string, revision: number, auction: ListingAuctionPreferences,
): Promise<ListingFlowResult> {
  const { data, error } = await supabase.rpc('owner_configure_listing_negotiation', {
    p_listing_id: listingId, p_revision: revision,
    p_offers: { negotiation_enabled: false, offer_minimum_daily: null, offer_maximum_daily: null,
      offer_target_daily: null, offer_start_date: null, offer_end_date: null, offer_expiration_hours: null },
    p_auction: { ...auction, availability_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
  });
  if (error) throw new Error(error.message);
  const saved = result(data);
  window.dispatchEvent(new Event('ybuy-auction-published'));
  return saved;
}

export async function saveDurationDiscount(
  listingId: string, revision: number, weeklyEnabled: boolean, weeklyPercent: number, monthlyEnabled: boolean, monthlyPercent: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('owner_save_rental_discounts', {
    p_listing_id: listingId, p_revision: revision,
    p_weekly_enabled: weeklyEnabled, p_weekly_discount_percent: weeklyPercent,
    p_monthly_enabled: monthlyEnabled, p_monthly_discount_percent: monthlyPercent,
  });
  if (error) throw new Error(error.message);
  if (!Number.isSafeInteger(data) || data < 1) throw new Error('Could not verify the saved discount settings.');
  return data;
}
