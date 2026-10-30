import { supabase } from '@/lib/supabase';
import type { CategoryDepositRule, ListingPickupLocation } from '@/lib/listings';
import type { ListingItemDetails } from '@/lib/listing-item-details';
import type { ListingAuctionPreferences } from '@/lib/listing-auctions';

export type ListingFlowStatus = 'draft' | 'pending_approval' | 'published' | 'archived' | 'suspended';

export interface ListingFlowPolicy {
  listing_duration_days: number;
  max_quantity: number;
  max_photos: number;
  max_photo_bytes: number;
  min_photo_dimension: number;
  max_delivery_fee: number;
  offer_below_pct: number | null;
  offer_above_pct: number | null;
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
  /** Used transiently during the save transaction to align date-only checks with the owner’s calendar. */
  availability_timezone?: string;
  delivery_fee?: number;
  offer_preferences?: ListingOfferPreferences;
  item_details?: ListingItemDetails;
  auction_preferences?: ListingAuctionPreferences;
}

export const roundOfferPrice = (value: number) => Math.round((value + Number.EPSILON * Math.max(1, value)) * 100) / 100;

export interface ListingOfferForm {
  enabled: boolean;
  minimumDaily: string;
  maximumDaily: string;
  expirationHours: string;
  startDate: string;
  endDate: string;
  targetDaily: number | null;
}

export const EMPTY_LISTING_OFFERS: ListingOfferForm = {
  enabled: false, minimumDaily: '', maximumDaily: '', expirationHours: '',
  startDate: '', endDate: '', targetDaily: null,
};

export function listingOfferPreferences(form: ListingOfferForm, price: number, start: string, end: string): ListingOfferPreferences {
  const minimum = roundOfferPrice(Number(form.minimumDaily));
  const maximum = roundOfferPrice(Number(form.maximumDaily));
  return {
    negotiation_enabled: form.enabled,
    offer_minimum_daily: form.enabled ? minimum : null,
    offer_maximum_daily: form.enabled ? maximum : null,
    offer_target_daily: form.enabled && form.targetDaily !== null && form.targetDaily >= minimum && form.targetDaily <= maximum ? form.targetDaily : null,
    offer_start_date: form.enabled ? form.startDate || start : null,
    offer_end_date: form.enabled ? form.endDate || end : null,
    offer_expiration_hours: form.enabled ? Number(form.expirationHours) : null,
  };
}

export function listingOfferError(form: ListingOfferForm, price: number | null, policy: ListingFlowPolicy | null, start: string, end: string): string | null {
  if (!form.enabled) return null;
  if (!policy || policy.offer_below_pct === null || policy.offer_above_pct === null) return 'Offer setup is unavailable until an administrator approves the price boundaries.';
  if (price === null || price <= 0) return 'Enter a valid daily rental price before configuring offers.';
  const preferences = listingOfferPreferences(form, price, start, end);
  const minimum = preferences.offer_minimum_daily!;
  const maximum = preferences.offer_maximum_daily!;
  const floor = Math.max(0.01, roundOfferPrice(price * (1 - policy.offer_below_pct)));
  const ceiling = Math.min(100000, roundOfferPrice(price * (1 + policy.offer_above_pct)));
  if (![form.minimumDaily, form.maximumDaily].every(value => /^\d+(\.\d{1,2})?$/.test(value))
    || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < floor || maximum > ceiling || minimum > maximum) {
    return `Keep the offer range between $${floor.toFixed(2)} and $${ceiling.toFixed(2)} per day, with the minimum no higher than the maximum.`;
  }
  if (!/^\d+$/.test(form.expirationHours) || !Number.isInteger(preferences.offer_expiration_hours)
    || preferences.offer_expiration_hours! < 1 || preferences.offer_expiration_hours! > 168) return 'Choose an offer expiry between 1 and 168 whole hours.';
  if (preferences.offer_start_date! < start || preferences.offer_end_date! > end || preferences.offer_end_date! <= preferences.offer_start_date!) {
    return 'Offer dates must fit your listing availability. Use the full listing availability or restore dates that contain the saved offer window.';
  }
  return null;
}

export interface ListingOfferPreferences {
  negotiation_enabled: boolean;
  offer_minimum_daily: number | null;
  offer_maximum_daily: number | null;
  offer_target_daily: number | null;
  offer_start_date: string | null;
  offer_end_date: string | null;
  offer_expiration_hours: number | null;
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
    p_listing_id: listingId, p_revision: revision, p_pickup: pickup ?? null, p_publish: publish,
  };
  let { data, error } = await supabase.rpc('owner_save_listing_flow', { ...args, p_details: details });
  // Older hosted databases reject the transient timezone key until the migration is deployed.
  if (error?.message === 'Unsupported listing changes' && details.availability_timezone) {
    const compatibleDetails = { ...details };
    delete compatibleDetails.availability_timezone;
    ({ data, error } = await supabase.rpc('owner_save_listing_flow', { ...args, p_details: compatibleDetails }));
    if (error?.message === 'Choose a current listing availability range before publishing') {
      throw new Error('Your selected dates are valid in your local timezone, but the connected listing database still validates dates in UTC. Apply migration 20261027000009_listing_availability_local_dates.sql to the hosted Supabase project, then retry.');
    }
  }
  if (error) throw new Error(error.message);
  return result(data);
}

export async function saveOfferPreferences(
  listingId: string,
  revision: number,
  preferences: ListingOfferPreferences,
): Promise<ListingFlowResult> {
  const { data, error } = await supabase.rpc('owner_save_offer_preferences', {
    p_listing_id: listingId, p_revision: revision, p_preferences: preferences,
  });
  if (error) throw new Error(error.message);
  return result(data);
}

export async function saveListingNegotiation(
  listingId: string, revision: number, offers: ListingOfferPreferences, auction: ListingAuctionPreferences,
): Promise<ListingFlowResult> {
  const { data, error } = await supabase.rpc('owner_configure_listing_negotiation', {
    p_listing_id: listingId, p_revision: revision, p_offers: offers,
    p_auction: { ...auction, availability_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
  });
  if (error) throw new Error(error.message);
  return result(data);
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
