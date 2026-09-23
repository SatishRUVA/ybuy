import { supabase } from '@/lib/supabase';
import { type DbListingRow, LISTING_SELECT } from '@/lib/listings';

/** Fetches the set of listing ids the current user has favorited (for toggling heart icons). */
export async function fetchFavoriteListingIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('favorites').select('listing_id').eq('user_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.listing_id as string));
}

/** Fetches the full listing rows the user has favorited, most recently favorited first. */
export async function fetchFavoriteListings(userId: string): Promise<DbListingRow[]> {
  const { data, error } = await supabase
    .from('favorites')
    .select(`created_at, listing:listings(${LISTING_SELECT})`)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { listing: DbListingRow | null }[])
    .map((r) => r.listing)
    .filter((l): l is DbListingRow => l != null);
}

export async function addFavorite(userId: string, listingId: string): Promise<void> {
  const { error } = await supabase.from('favorites').insert({ user_id: userId, listing_id: listingId });
  if (error) throw error;
}

export async function removeFavorite(userId: string, listingId: string): Promise<void> {
  const { error } = await supabase.from('favorites').delete().eq('user_id', userId).eq('listing_id', listingId);
  if (error) throw error;
}
