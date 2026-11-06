import { addDaysIso, MAX_BOOKING_RANGE_DAYS, todayIso } from '@/lib/geo';

export const LISTING_SCHEDULING_DAYS = 180;
export const LISTING_MAX_AVAILABLE_DAYS = 30;
export const RENTAL_MAX_DAYS = Math.min(MAX_BOOKING_RANGE_DAYS, LISTING_MAX_AVAILABLE_DAYS);

export function listingAvailabilityExpired(end: string | null | undefined, today = todayIso()): boolean {
  return Boolean(end && end <= today);
}

export function listingAvailabilityError(start: string, end: string, today = todayIso()): string | undefined {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(start) || !validDate(end) || end <= start) return 'Choose a start date and an end date for your availability.';
  if (Math.round((Date.parse(end) - Date.parse(start)) / 86400000) > LISTING_MAX_AVAILABLE_DAYS) {
    return 'Choose no more than 30 consecutive available days. Blocked days do not extend this window.';
  }
  if (start < today || end > addDaysIso(today, LISTING_SCHEDULING_DAYS)) return 'Choose dates from today through 180 days from today.';
}
