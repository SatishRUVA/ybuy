import { supabase } from '@/lib/supabase';

/** Calls the create-checkout-session Edge Function and returns the Stripe-hosted Checkout URL. */
export async function createCheckoutSession(bookingId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
    'create-checkout-session',
    { body: { bookingId } },
  );
  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error(data?.error ?? 'Could not start checkout.');
  return data.url;
}
