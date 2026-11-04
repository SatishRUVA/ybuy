import { supabase } from '@/lib/supabase';
import { assertUuid } from '@/lib/text-safety';

export interface BookingPickupSlot {
  starts_at: string;
  ends_at: string;
  time_zone: string;
  status: 'proposed' | 'approved' | 'declined';
}

export interface BookingPrecheckin {
  payment_first: boolean;
  slot: BookingPickupSlot | null;
  server_now: string;
  can_authorize: boolean;
  handoff_ready: boolean;
  deposit_ready: boolean;
  consented: boolean;
  delivery_mode: 'pickup' | 'delivery';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isPrecheckin(value: unknown): value is BookingPrecheckin {
  if (!isRecord(value)) return false;
  const slot = value.slot;
  return typeof value.payment_first === 'boolean' && typeof value.can_authorize === 'boolean'
    && typeof value.handoff_ready === 'boolean' && typeof value.deposit_ready === 'boolean'
    && typeof value.consented === 'boolean' && isTimestamp(value.server_now)
    && (value.delivery_mode === 'pickup' || value.delivery_mode === 'delivery')
    && (slot === null || (isRecord(slot) && isTimestamp(slot.starts_at) && isTimestamp(slot.ends_at)
      && typeof slot.time_zone === 'string' && slot.time_zone.length > 0
      && ['proposed', 'approved', 'declined'].includes(String(slot.status))));
}

export async function fetchBookingPrecheckin(bookingId: string): Promise<BookingPrecheckin> {
  assertUuid(bookingId, 'booking id');
  const { data, error } = await supabase.rpc('get_booking_precheckin', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
  if (!isPrecheckin(data)) {
    throw new Error('The server returned invalid pre-check-in details.');
  }
  return data;
}

export async function proposeBookingPickupSlot(bookingId: string, startsAt: string, timeZone: string): Promise<void> {
  assertUuid(bookingId, 'booking id');
  if (!Number.isFinite(Date.parse(startsAt)) || !timeZone) throw new Error('Choose a valid handoff time.');
  const { error } = await supabase.rpc('propose_booking_pickup_slot', {
    p_booking_id: bookingId, p_starts_at: startsAt, p_time_zone: timeZone,
  });
  if (error) throw new Error(error.message);
}

export async function respondToBookingPickupSlot(bookingId: string, startsAt: string, approve: boolean): Promise<void> {
  assertUuid(bookingId, 'booking id');
  const { error } = await supabase.rpc('respond_to_booking_pickup_slot', {
    p_booking_id: bookingId, p_starts_at: startsAt, p_approve: approve,
  });
  if (error) throw new Error(error.message);
}
