import { supabase } from '@/lib/supabase';
import type { DeliveryTrip } from '@/lib/delivery-checkout';

export interface ListingPriceQuote {
  days: number;
  quantity: number;
  daily_rate: number;
  package_kind: 'monthly' | 'weekly' | null;
  package_days: number;
  package_rate: number;
  package_amount: number;
  extra_days: number;
  extra_days_amount: number;
  discount_amount: number;
  rental_subtotal: number;
  renter_service_fee_amount?: number;
  owner_service_fee_amount?: number;
  tax_rate?: number;
  tax_amount?: number;
  renter_checkout_total?: number;
  expected_owner_net?: number;
  owner_service_fee_pct?: number;
  estimated_owner_net?: number;
}

export interface ListingPricingQuotes {
  quotes: ListingPriceQuote[];
  service_fee_total_pct: number;
  renter_share_percent: number;
  owner_share_percent: number;
  renter_service_fee_pct: number;
  owner_service_fee_pct: number;
}

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export async function fetchListingPricingQuotes(
  listingId: string,
  days: number[],
  quantity = 1,
): Promise<ListingPricingQuotes> {
  const { data, error } = await supabase.rpc('get_listing_pricing_quotes', {
    p_listing_id: listingId, p_days: days, p_quantity: quantity,
  });
  if (error) throw new Error(error.message);
  const value = data as ListingPricingQuotes | null;
  if (!value || !Array.isArray(value.quotes) || value.quotes.some(quote =>
    !isMoney(quote.rental_subtotal) || !isMoney(quote.daily_rate)
      || (quote.renter_checkout_total !== undefined && !isMoney(quote.renter_checkout_total))
      || (quote.expected_owner_net !== undefined && !isMoney(quote.expected_owner_net)))) {
    throw new Error('The server returned an invalid rental price quote.');
  }
  return value;
}

export async function fetchOwnerEarningsQuote(input: {
  listingId: string;
  dailyRate: number;
  weeklyRate: number | null;
  monthlyRate: number | null;
  weeklyDiscountEnabled: boolean;
  weeklyDiscountPercent: number;
  monthlyDiscountEnabled: boolean;
  monthlyDiscountPercent: number;
  days: number;
  quantity?: number;
}): Promise<ListingPriceQuote> {
  const { data, error } = await supabase.rpc('get_owner_listing_earnings_quote', {
    p_listing_id: input.listingId,
    p_daily_rate: input.dailyRate,
    p_weekly_rate: input.weeklyRate,
    p_monthly_rate: input.monthlyRate,
    p_weekly_discount_enabled: input.weeklyDiscountEnabled,
    p_weekly_discount_percent: input.weeklyDiscountPercent,
    p_monthly_discount_enabled: input.monthlyDiscountEnabled,
    p_monthly_discount_percent: input.monthlyDiscountPercent,
    p_days: input.days,
    p_quantity: input.quantity ?? 1,
  });
  if (error) throw new Error(error.message);
  const quote = data as ListingPriceQuote | null;
  if (!quote || !isMoney(quote.rental_subtotal) || !isMoney(quote.owner_service_fee_amount)
    || !isMoney(quote.estimated_owner_net)) {
    throw new Error('The server returned an invalid earnings estimate.');
  }
  return quote;
}

export interface CheckoutPriceQuote extends ListingPriceQuote {
  renter_service_fee_amount: number;
  owner_service_fee_amount: number;
  delivery_fee_amount: number;
  delivery_setup_amount?: number;
  insurance_amount: number;
  tax_rate: number;
  tax_amount: number;
  deposit: number;
  renter_checkout_total: number;
  expected_owner_net: number;
  service_fee_total_pct: number;
  service_fee_renter_share_pct: number;
  service_fee_renter_pct: number;
  service_fee_owner_pct: number;
}

export async function fetchCheckoutPriceQuote(input: {
  listingId: string;
  startDate: string;
  endDate: string;
  quantity: number;
  deliveryMode: 'pickup' | 'delivery';
  insuranceSelected: boolean;
  deliveryTrip?: DeliveryTrip;
  setupSelected?: boolean;
}): Promise<CheckoutPriceQuote> {
  const args = {
    p_listing_id: input.listingId,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_quantity: input.quantity,
    p_delivery_mode: input.deliveryMode,
    p_insurance_selected: input.insuranceSelected,
  };
  const { data, error } = input.deliveryTrip
    ? await supabase.rpc('get_checkout_delivery_quote', {
      ...args, p_delivery_trip: input.deliveryTrip, p_setup_selected: input.setupSelected === true,
    })
    : await supabase.rpc('get_checkout_price_quote', args);
  if (error) throw new Error(error.message);
  const quote = data as CheckoutPriceQuote | null;
  if (!quote || !isMoney(quote.rental_subtotal) || !isMoney(quote.renter_service_fee_amount)
    || !isMoney(quote.owner_service_fee_amount) || !isMoney(quote.delivery_fee_amount)
    || !isMoney(quote.insurance_amount) || !isMoney(quote.tax_amount)
    || (input.deliveryTrip && !isMoney(quote.delivery_setup_amount))
    || !isMoney(quote.renter_checkout_total) || !isMoney(quote.expected_owner_net)) {
    throw new Error('The server returned an invalid checkout price quote.');
  }
  return quote;
}
