import { plainTextError } from '@/lib/text-safety';

export interface ListingItemDetails {
  brand: string;
  model: string;
  included_items: string[];
  additional_details: string;
  delivery_radius_miles: number | null;
}

export const EMPTY_ITEM_DETAILS: ListingItemDetails = {
  brand: '', model: '', included_items: [], additional_details: '', delivery_radius_miles: null,
};

export function listingItemDetailsError(details: ListingItemDetails): string | null {
  const textError = plainTextError('Brand', details.brand, 80) || plainTextError('Model', details.model, 80)
    || plainTextError('Additional details', details.additional_details, 500);
  if (textError) return textError;
  if (details.included_items.length > 12 || details.included_items.some(item => !item.trim() || plainTextError('Included item', item, 60))
    || new Set(details.included_items.map(item => item.trim().toLowerCase())).size !== details.included_items.length) {
    return 'Choose up to 12 unique included items, each 1 to 60 plain-text characters.';
  }
  if (details.delivery_radius_miles !== null && ![5, 10, 25, 50].includes(details.delivery_radius_miles)) return 'Choose a delivery radius of 5, 10, 25 or 50 miles.';
  return null;
}
