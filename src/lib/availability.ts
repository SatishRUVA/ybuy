import { supabase } from '@/lib/supabase';

const ACTIVE_BOOKING_STATUSES = ['requested', 'pending_payment', 'confirmed', 'active', 'return_pending'];

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function toIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Every ISO date string in [startIso, endIso) - half-open, matching how booking ranges are stored. */
function datesInRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  for (let d = parseIsoLocal(startIso); toIsoLocal(d) < endIso; d.setDate(d.getDate() + 1)) {
    dates.push(toIsoLocal(d));
  }
  return dates;
}

/** Dates a listing can't be booked for: owner-blocked dates, unioned with dates already covered by an active booking. */
export async function fetchUnavailableDates(listingId: string): Promise<{ blocked: Set<string>; booked: Set<string> }> {
  const [availabilityResult, bookingsResult] = await Promise.all([
    supabase.from('listing_availability').select('date, is_available').eq('listing_id', listingId).eq('is_available', false),
    supabase.from('bookings').select('start_date, end_date').eq('listing_id', listingId).in('status', ACTIVE_BOOKING_STATUSES),
  ]);
  if (availabilityResult.error) throw availabilityResult.error;
  if (bookingsResult.error) throw bookingsResult.error;

  const blocked = new Set((availabilityResult.data ?? []).map((r) => r.date as string));
  const booked = new Set<string>();
  for (const b of bookingsResult.data ?? []) {
    for (const d of datesInRange(b.start_date as string, b.end_date as string)) booked.add(d);
  }
  return { blocked, booked };
}

/** Toggles a single date's availability for a listing the current user owns (enforced by RLS). */
export async function setDateAvailability(listingId: string, date: string, isAvailable: boolean): Promise<void> {
  const { error } = await supabase
    .from('listing_availability')
    .upsert({ listing_id: listingId, date, is_available: isAvailable }, { onConflict: 'listing_id,date' });
  if (error) throw error;
}

/**
 * Among the given listing ids, which are unavailable at any point in [startIso, endIso)? Used to
 * filter search results by the picked date range without scanning the whole catalog.
 * ponytail: scoped to the currently-loaded page of listing ids, not the full table - fine for
 * Part 1's small catalog/page size; a large catalog would push this into the search RPC instead.
 */
export async function fetchUnavailableListingIds(listingIds: string[], startIso: string, endIso: string): Promise<Set<string>> {
  if (listingIds.length === 0 || !startIso || !endIso || endIso <= startIso) return new Set();
  const [availabilityResult, bookingsResult] = await Promise.all([
    supabase.from('listing_availability').select('listing_id').in('listing_id', listingIds).eq('is_available', false).gte('date', startIso).lt('date', endIso),
    supabase.from('bookings').select('listing_id').in('listing_id', listingIds).in('status', ACTIVE_BOOKING_STATUSES).lt('start_date', endIso).gt('end_date', startIso),
  ]);
  if (availabilityResult.error) throw availabilityResult.error;
  if (bookingsResult.error) throw bookingsResult.error;
  const ids = new Set<string>();
  for (const r of availabilityResult.data ?? []) ids.add(r.listing_id as string);
  for (const r of bookingsResult.data ?? []) ids.add(r.listing_id as string);
  return ids;
}
