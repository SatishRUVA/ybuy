import { plainTextError } from '@/lib/text-safety';

export const HANDOFF_WINDOWS = ['morning', 'afternoon', 'evening'] as const;
export type HandoffWindow = (typeof HANDOFF_WINDOWS)[number];
export const RETURN_RULE_OPTIONS = [
  'Return all accessories',
  'Clean and dry before return',
  'Empty any stored contents',
  'Recharge batteries before return',
  'Repack in the original case',
] as const;

export interface ListingItemDetails {
  brand: string;
  model: string;
  included_items: string[];
  additional_details: string;
  delivery_radius_miles: number | null;
  pickup_windows: HandoffWindow[];
  return_windows: HandoffWindow[];
  return_rules: string[];
  return_note: string;
}

export const EMPTY_ITEM_DETAILS: ListingItemDetails = {
  brand: '', model: '', included_items: [], additional_details: '', delivery_radius_miles: null,
  pickup_windows: [...HANDOFF_WINDOWS], return_windows: [...HANDOFF_WINDOWS], return_rules: [], return_note: '',
};

export function listingItemDetailsError(details: ListingItemDetails): string | null {
  const textError = plainTextError('Brand', details.brand, 80) || plainTextError('Model', details.model, 80)
    || plainTextError('Additional details', details.additional_details, 500)
    || plainTextError('Return note', details.return_note, 240);
  if (textError) return textError;
  if (details.included_items.length > 12 || details.included_items.some(item => !item.trim() || plainTextError('Included item', item, 60))
    || new Set(details.included_items.map(item => item.trim().toLowerCase())).size !== details.included_items.length) {
    return 'Choose up to 12 unique included items, each 1 to 60 plain-text characters.';
  }
  const pickupWindows = new Set(details.pickup_windows);
  const returnWindows = new Set(details.return_windows);
  if (pickupWindows.size === 0 || returnWindows.size === 0
    || pickupWindows.size !== details.pickup_windows.length || returnWindows.size !== details.return_windows.length
    || [...pickupWindows].some((window) => !HANDOFF_WINDOWS.includes(window))
    || [...returnWindows].some((window) => !HANDOFF_WINDOWS.includes(window))) {
    return 'Choose at least one valid pickup and return time window.';
  }
  if (details.return_rules.length > RETURN_RULE_OPTIONS.length || new Set(details.return_rules).size !== details.return_rules.length
    || details.return_rules.some((rule) => !RETURN_RULE_OPTIONS.includes(rule as (typeof RETURN_RULE_OPTIONS)[number]))) {
    return 'Choose valid return rules.';
  }
  if (details.delivery_radius_miles !== null && ![5, 10, 25, 50].includes(details.delivery_radius_miles)) return 'Choose a delivery radius of 5, 10, 25 or 50 miles.';
  return null;
}
