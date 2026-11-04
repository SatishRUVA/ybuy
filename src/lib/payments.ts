import { supabase } from '@/lib/supabase';

export interface ConfirmedPayment {
  /** Amount in major currency units, matching bookings.total. */
  amount: number;
  currency: string;
}

export interface CheckoutReservation {
  status: string;
  expires_at: string | null;
  expired_at: string | null;
  server_now: string;
  confirmation_gate: string;
  payment_received: boolean;
  authorization_status: string | null;
  capture_before: string | null;
}
export async function fetchCheckoutReservation(bookingId: string): Promise<CheckoutReservation> {
  const { data,error } = await supabase.rpc('get_checkout_reservation', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
  if (!data || typeof data.status!=='string' || typeof data.confirmation_gate!=='string'
    || typeof data.payment_received!=='boolean' || !Number.isFinite(Date.parse(data.server_now))) {
    throw new Error('Invalid checkout reservation response.');
  }
  return data;
}

export async function fetchCheckoutException(bookingId: string): Promise<{ reason: string; status: string } | null> {
  const { data,error } = await supabase.from('checkout_payment_exceptions').select('reason,status').eq('booking_id',bookingId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Only webhook-written, RLS-protected records qualify; never read redirect parameters. */
export async function fetchConfirmedPayment(bookingId: string, bookingTotal: number): Promise<ConfirmedPayment | null> {
  const { data, error } = await supabase.from('payments')
    .select('amount, currency, status')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.status !== 'succeeded') throw new Error('Payment is not confirmed. Check your booking status again before continuing.');
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount < 0 || !/^[a-z]{3}$/i.test(data.currency)) {
    throw new Error('The confirmed payment details are invalid. Please refresh to retry.');
  }
  if (!Number.isFinite(bookingTotal) || bookingTotal < 0 || data.currency.toUpperCase() !== 'USD'
    || Math.round(amount * 100) !== Math.round(bookingTotal * 100)) {
    throw new Error('Payment could not be verified against this booking. Check status again before continuing.');
  }
  return { amount, currency: data.currency.toUpperCase() };
}

/** Calls the create-checkout-session Edge Function and returns the Stripe-hosted Checkout URL. */
export async function createCheckoutSession(bookingId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
    'create-checkout-session',
    { body: { bookingId } },
  );
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const details: unknown = await error.context.json();
      if (details && typeof details === 'object' && 'error' in details && typeof details.error === 'string') {
        throw new Error(details.error);
      }
    }
    throw new Error(error.message);
  }
  if (!data?.url) throw new Error(data?.error ?? 'Could not start checkout.');
  return data.url;
}
