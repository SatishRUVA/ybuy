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

/** Verified Connect transfers only; legacy manual bookkeeping is not proof of money movement. */
export async function fetchPayoutsByOwner(ownerId: string): Promise<Map<string, DbPayoutRow>> {
  const { data, error } = await supabase.from('rental_settlements')
    .select('booking_id,owner_amount,transfer_status,transfer_confirmed_at,bookings!inner(owner_id)')
    .eq('bookings.owner_id', ownerId);
  if (error) throw error;
  const map = new Map<string, DbPayoutRow>();
  for (const row of data ?? []) map.set(row.booking_id, {
    id: row.booking_id, booking_id: row.booking_id, owner_id: ownerId, amount: Number(row.owner_amount),
    status: row.transfer_status === 'succeeded' ? 'paid' : 'pending',
    paid_at: row.transfer_status === 'succeeded' ? row.transfer_confirmed_at : null,
    notes: 'Stripe Connect transfer, not a bank payout',
  });
  return map;
}

export interface RentalSettlement {
  booking_id: string;
  deposit_amount: number;
  owner_amount: number;
  refund_status: string;
  transfer_status: string;
  last_error: string | null;
}

export interface BankPayoutStatus {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  arrival_date: number | null;
  failure_code: string | null;
  method: string;
  type: string;
}

export async function fetchBankPayoutStatus(): Promise<{ connected: boolean; payouts: BankPayoutStatus[] }> {
  const { data, error } = await supabase.functions.invoke<{ error?: string; connected?: boolean; payouts?: BankPayoutStatus[] }>(
    'owner-payout-status', { body: {} },
  );
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const details: unknown = await error.context.json().catch(() => null);
      if (details && typeof details === 'object' && 'error' in details && typeof details.error === 'string') {
        throw new Error(details.error);
      }
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  if (typeof data?.connected !== 'boolean' || !Array.isArray(data.payouts)) throw new Error('Invalid Stripe payout status response.');
  return { connected: data.connected, payouts: data.payouts };
}

export async function fetchRentalSettlement(bookingId: string): Promise<RentalSettlement | null> {
  const { data, error } = await supabase.from('rental_settlements')
    .select('booking_id,deposit_amount,owner_amount,refund_status,transfer_status,last_error').eq('booking_id', bookingId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function invokeSettlement(body: { action: 'settle'; bookingId: string } | { action: 'onboard' }) {
  const { data, error } = await supabase.functions.invoke<{ error?: string; url?: string }>('settle-rental', { body });
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const details: unknown = await error.context.json();
      if (details && typeof details === 'object' && 'error' in details && typeof details.error === 'string') throw new Error(details.error);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function processRentalSettlement(bookingId: string): Promise<void> {
  await invokeSettlement({ action: 'settle', bookingId });
}

export async function startConnectOnboarding(): Promise<string> {
  const data = await invokeSettlement({ action: 'onboard' });
  if (!data?.url || !['https://connect.stripe.com', 'https://accounts.stripe.com'].includes(new URL(data.url).origin)) throw new Error('Stripe Connect did not return a valid onboarding link.');
  return data.url;
}
