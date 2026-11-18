import { supabase } from '@/lib/supabase';
import { assertUuid } from '@/lib/text-safety';

export interface BookingDepositAuthorization {
  id: string;
  booking_id: string;
  attempt: number;
  authorized_amount: number;
  captured_amount: number;
  status: 'setup_required' | 'scheduled' | 'authorizing' | 'requires_action' | 'authorized' | 'releasing' | 'released' | 'capturing' | 'captured' | 'expired' | 'failed' | 'superseded';
  is_claim_authorization?: boolean;
  authorization_at: string | null;
  capture_before: string | null;
  released_at: string | null;
  captured_at: string | null;
  failure_reason: string | null;
}

export interface BookingDepositAuthorizationEvent {
  id: string;
  event_type: string;
  status: string;
  amount: number;
  detail: Record<string, unknown>;
  created_at: string;
}

export async function recordDepositHoldConsent(bookingId: string): Promise<void> {
  assertUuid(bookingId, 'booking id');
  const { error } = await supabase.rpc('record_deposit_hold_consent', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
}

export async function submitBookingDepositClaim(input: {
  bookingId: string; subject: string; description: string; requestedAmount: number;
}): Promise<string> {
  assertUuid(input.bookingId, 'booking id');
  if (!input.subject.trim() || input.subject.trim().length > 160
    || input.description.trim().length < 10 || input.description.trim().length > 2000
    || !Number.isFinite(input.requestedAmount) || input.requestedAmount <= 0) {
    throw new Error('Enter a damage reason and valid requested amount.');
  }
  const { data, error } = await supabase.rpc('submit_booking_deposit_claim', {
    p_booking_id: input.bookingId, p_subject: input.subject.trim(),
    p_description: input.description.trim(), p_requested_amount: input.requestedAmount,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data.id !== 'string') throw new Error('The server did not confirm the deposit claim.');
  return data.id;
}

export async function fetchBookingDepositAuthorization(bookingId: string): Promise<BookingDepositAuthorization | null> {
  assertUuid(bookingId, 'booking id');
  const { data, error } = await supabase.from('booking_deposit_authorizations')
    .select('id,booking_id,attempt,authorized_amount,captured_amount,status,is_claim_authorization,authorization_at,capture_before,released_at,captured_at,failure_reason')
    .eq('booking_id', bookingId).order('attempt', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as BookingDepositAuthorization | null;
}

export async function fetchBookingDepositClaim(bookingId: string): Promise<{ status: string; requested_amount: number; approved_amount: number | null } | null> {
  assertUuid(bookingId, 'booking id');
  const { data, error } = await supabase.from('booking_deposit_claims').select('status,requested_amount,approved_amount')
    .eq('booking_id', bookingId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchBookingDepositAuthorizationEvents(authorizationId: string): Promise<BookingDepositAuthorizationEvent[]> {
  assertUuid(authorizationId, 'deposit authorization id');
  const { data, error } = await supabase.from('booking_deposit_authorization_events')
    .select('id,event_type,status,amount,detail,created_at').eq('authorization_id', authorizationId)
    .order('created_at', { ascending: false }).limit(25);
  if (error) throw new Error(error.message);
  return (data ?? []) as BookingDepositAuthorizationEvent[];
}

export async function createDepositSetupSession(bookingId: string): Promise<string> {
  assertUuid(bookingId, 'booking id');
  const { data, error } = await supabase.functions.invoke<{ url?: string; setup_complete?: boolean; error?: string }>(
    'create-deposit-setup-session', { body: { bookingId } },
  );
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const details: unknown = await error.context.json();
      if (details && typeof details === 'object' && 'error' in details && typeof details.error === 'string') throw new Error(details.error);
    }
    throw new Error(error.message);
  }
  if (data?.setup_complete) return '';
  if (!data?.url || new URL(data.url).hostname !== 'checkout.stripe.com') throw new Error(data?.error ?? 'Could not open secure card setup.');
  return data.url;
}


export async function createDepositAuthorizationSession(bookingId: string): Promise<{
  url?: string; authorized?: boolean; capture_before?: string | null; pending?: boolean;
}> {
  assertUuid(bookingId, 'booking id');
  const { data, error } = await supabase.functions.invoke<{
    url?: string; authorized?: boolean; capture_before?: string | null; pending?: boolean; error?: string;
  }>('create-deposit-authorization-session', { body: { bookingId } });
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const details: unknown = await error.context.json();
      if (details && typeof details === 'object' && 'error' in details && typeof details.error === 'string') throw new Error(details.error);
    }
    throw new Error(error.message);
  }
  if (data?.url) {
    if (new URL(data.url).hostname !== 'checkout.stripe.com') throw new Error('Stripe returned an unexpected authorization URL.');
    return { url: data.url };
  }
  if (data?.authorized || data?.pending) return data;
  throw new Error(data?.error ?? 'Could not verify the deposit authorization.');
}
