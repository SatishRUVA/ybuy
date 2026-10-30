import { PICKUP_TEXT_MAX, plainTextError, UNSAFE_TEXT } from '@/lib/text-safety';

// Listing field rules. Limits default to the same values the database trigger enforces
// (supabase/migrations/20261018000002_listing_field_validation.sql). The env overrides only
// tighten what the form accepts; the database remains the hard ceiling.
const envNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isFinite(parsed) ? parsed : fallback;
};

export const LISTING_RULES = {
  currency: 'USD',
  title: { min: 3, max: 100 },
  description: {
    min: 10,
    max: 2000,
  },
  price: {
    min: envNumber(import.meta.env.VITE_LISTING_MIN_PRICE, 1),
    max: envNumber(import.meta.env.VITE_LISTING_MAX_PRICE, 5000),
  },
  deposit: {
    min: envNumber(import.meta.env.VITE_LISTING_MIN_DEPOSIT, 0),
    max: envNumber(import.meta.env.VITE_LISTING_MAX_DEPOSIT, 10000),
  },
};

export type ListingField = 'photos' | 'title' | 'category' | 'description' | 'pickup' | 'price' | 'deposit' | 'value' | 'condition';

/** DOM id to focus for each field. */
export const LISTING_FIELD_IDS: Record<ListingField, string> = {
  photos: 'listing-add-photo',
  title: 'listing-title',
  category: 'listing-category-group',
  description: 'listing-description',
  pickup: 'pickup-address',
  price: 'listing-price',
  deposit: 'listing-deposit',
  value: 'listing-value',
  condition: 'listing-condition',
};

export const ITEM_STEP_FIELDS: ListingField[] = ['photos', 'title', 'category', 'description', 'value', 'condition'];
export const TERMS_STEP_FIELDS: ListingField[] = ['pickup', 'price', 'deposit'];

// Titles and descriptions are plain text; see text-safety.ts for the injection rules.

/** Parses a whole-dollar or two-decimal amount; rejects exponents, signs, symbols and NaN/Infinity. */
export function parseMoney(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,7}(\.\d{1,2})?$/.test(trimmed) ? Number(trimmed) : null;
}

const usd = (amount: number) => `$${amount.toLocaleString('en-US')}`;

function moneyError(label: string, text: string, min: number, max: number, emptyMeansZero: boolean): string | null {
  if (!text.trim()) return emptyMeansZero && min === 0 ? null : `Enter ${label.toLowerCase()}.`;
  const amount = parseMoney(text);
  if (amount === null) return `${label} must be an amount in ${LISTING_RULES.currency}, like 25 or 25.50 (no negatives, symbols or more than two decimals).`;
  if (amount < min || amount > max) return `${label} must be between ${usd(min)} and ${usd(max)}.`;
  return null;
}

export interface ListingFormValues {
  photoCount: number;
  title: string;
  categoryId: string;
  description: string;
  pickupConfirmed: boolean;
  /** Typed/selected pickup address parts, checked as plain text before they are saved. */
  pickupFields: string[];
  priceText: string;
  depositText: string;
  valueText?: string;
  maxValue?: number;
  condition?: string;
}

export function validateListing(v: ListingFormValues): Partial<Record<ListingField, string>> {
  const errors: Partial<Record<ListingField, string>> = {};
  const { title, description, price, deposit } = LISTING_RULES;

  if (v.photoCount === 0) errors.photos = 'Add at least one photo.';

  const titleText = v.title.trim();
  if (!titleText) errors.title = 'Enter a title.';
  else if (titleText.length < title.min) errors.title = `Title must be at least ${title.min} characters.`;
  else if (titleText.length > title.max) errors.title = `Title must be ${title.max} characters or fewer.`;
  else if (UNSAFE_TEXT.test(titleText)) errors.title = 'Title can only contain plain text (no HTML or scripts).';

  if (!v.categoryId) errors.category = 'Choose a category.';
  if (v.valueText !== undefined) {
    const valueError = moneyError('Estimated replacement value',v.valueText,0,v.maxValue ?? 1000000,false);
    if (valueError) errors.value=valueError;
  }
  if (v.condition !== undefined && !['new','like_new','good','fair'].includes(v.condition)) errors.condition='Choose the item condition.';

  const descriptionText = v.description.trim();
  if (!descriptionText) errors.description = 'Describe what is included and the condition it is in.';
  else if (descriptionText.length < description.min) errors.description = `Description must be at least ${description.min} characters.`;
  else if (descriptionText.length > description.max) errors.description = `Description must be ${description.max.toLocaleString('en-US')} characters or fewer.`;
  else if (UNSAFE_TEXT.test(descriptionText)) errors.description = 'Description can only contain plain text (no HTML, scripts or hidden characters).';

  if (!v.pickupConfirmed) errors.pickup = 'Choose a complete pickup address from the search results. Your exact address stays private until the booking is confirmed.';
  else {
    const unsafePickup = v.pickupFields.map((field) => plainTextError('Pickup location', field, PICKUP_TEXT_MAX)).find(Boolean);
    if (unsafePickup) errors.pickup = unsafePickup;
  }

  const priceError = moneyError('Price per day', v.priceText, price.min, price.max, false);
  if (priceError) errors.price = priceError;
  const depositError = moneyError('Security deposit', v.depositText, deposit.min, deposit.max, true);
  if (depositError) errors.deposit = depositError;

  return errors;
}
