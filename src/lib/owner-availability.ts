import { supabase } from '@/lib/supabase';

export async function saveOwnerAvailability(listingId: string, revision: number, start: string, end: string, blocked: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('owner_save_listing_availability', {
    p_listing_id: listingId, p_revision: revision, p_start: start, p_end: end, p_blocked: blocked,
    p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  if (error) throw new Error(error.message);
  if (!data || !Number.isSafeInteger(data.revision) || !Array.isArray(data.blocked)
    || data.blocked.length !== blocked.length || blocked.some(date => !data.blocked.includes(date))) {
    throw new Error('Could not verify the saved availability. Reload before continuing.');
  }
  return data.revision;
}
