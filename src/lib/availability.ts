import { supabase } from '@/lib/supabase';

const ACTIVE_BOOKING_STATUSES = ['requested', 'pending_payment', 'confirmed', 'active', 'return_pending'];

/** Dates a listing can't be booked for: owner-blocked dates, unioned with dates already covered by an active booking. */
export async function fetchUnavailableDates(listingId: string, quantity = 1): Promise<{ blocked: Set<string>; booked: Set<string> }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new Error('Choose between 1 and 100 units before checking availability.');
  }
  const { data,error }=quantity > 1
    ? await supabase.rpc('get_listing_unavailable_dates_for_quantity',{p_listing_id:listingId,p_quantity:quantity})
    : await supabase.rpc('get_listing_unavailable_dates',{p_listing_id:listingId});
  if(error)throw new Error(error.message);
  if(!data || !Array.isArray(data.blocked) || !Array.isArray(data.booked)
    || !data.blocked.every((date:unknown)=>typeof date==='string') || !data.booked.every((date:unknown)=>typeof date==='string')) {
    throw new Error('Could not verify listing availability.');
  }
  return { blocked:new Set<string>(data.blocked),booked:new Set<string>(data.booked) };
}

/** Toggles a single date's availability for a listing the current user owns (enforced by RLS). */
export async function setDateAvailability(listingId: string, date: string, isAvailable: boolean): Promise<void> {
  const { error } = await supabase
    .from('listing_availability')
    .upsert({ listing_id: listingId, date, is_available: isAvailable }, { onConflict: 'listing_id,date' });
  if (error) throw new Error(error.message);
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
