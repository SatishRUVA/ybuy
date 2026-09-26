import { supabase } from '@/lib/supabase';

export interface DbPayoutRow {
  id: string;
  booking_id: string;
  owner_id: string;
  amount: number;
  status: 'pending' | 'paid';
  paid_at: string | null;
  notes: string | null;
}

/** One payout row per booking, keyed by booking_id, for the given owner. */
export async function fetchPayoutsByOwner(ownerId: string): Promise<Map<string, DbPayoutRow>> {
  const { data, error } = await supabase.from('payouts').select('*').eq('owner_id', ownerId);
  if (error) throw error;
  const map = new Map<string, DbPayoutRow>();
  for (const row of (data ?? []) as DbPayoutRow[]) map.set(row.booking_id, row);
  return map;
}

/**
 * Records a booking as manually paid out (spec §6: owner payouts are manual for Part 1).
 * Amount is the owner's earnings - the rental subtotal, excluding the platform service fee and
 * the security deposit (which isn't the owner's money to keep absent a damage claim).
 */
export async function markBookingPaidOut(bookingId: string, ownerId: string, amount: number): Promise<void> {
  const { error } = await supabase.from('payouts').insert({
    booking_id: bookingId,
    owner_id: ownerId,
    amount,
    status: 'paid',
    paid_at: new Date().toISOString(),
  });
  if (error) throw error;
}
