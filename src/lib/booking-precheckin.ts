import { supabase } from '@/lib/supabase';
import { assertUuid } from '@/lib/text-safety';
import { HANDOFF_WINDOWS, type HandoffWindow } from '@/lib/listing-item-details';
import { HANDOFF_HOURS } from '@/lib/handoff-hours';

export type HandoffKind = 'pickup' | 'return';

export interface BookingPickupSlot {
  kind: HandoffKind;
  selected_date: string;
  slot_window: HandoffWindow;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  status: 'proposed' | 'approved' | 'declined';
  note: string;
  updated_at: string;
}

export interface BookingPrecheckin {
  payment_first: boolean;
  slot: BookingPickupSlot | null;
  pickup_slot: BookingPickupSlot | null;
  return_slot: BookingPickupSlot | null;
  pickup_windows: HandoffWindow[];
  return_windows: HandoffWindow[];
  return_rules: string[];
  return_note: string;
  time_zone: string | null;
  server_now: string;
  can_authorize: boolean;
  handoff_ready: boolean;
  return_handoff_ready: boolean;
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
  const hasValidSlot = (slot: unknown) => slot === null || (isRecord(slot) && isTimestamp(slot.starts_at) && isTimestamp(slot.ends_at)
    && typeof slot.time_zone === 'string' && slot.time_zone.length > 0
    && typeof slot.selected_date === 'string'
    && (slot.kind === 'pickup' || slot.kind === 'return')
    && HANDOFF_WINDOWS.includes(slot.slot_window as HandoffWindow)
    && ['proposed', 'approved', 'declined'].includes(String(slot.status))
    && typeof slot.note === 'string' && isTimestamp(slot.updated_at));
  return typeof value.payment_first === 'boolean' && typeof value.can_authorize === 'boolean'
    && typeof value.handoff_ready === 'boolean' && typeof value.return_handoff_ready === 'boolean' && typeof value.deposit_ready === 'boolean'
    && typeof value.consented === 'boolean' && isTimestamp(value.server_now)
    && Array.isArray(value.pickup_windows) && value.pickup_windows.every((window) => HANDOFF_WINDOWS.includes(window as HandoffWindow))
    && Array.isArray(value.return_windows) && value.return_windows.every((window) => HANDOFF_WINDOWS.includes(window as HandoffWindow))
    && Array.isArray(value.return_rules) && value.return_rules.every((rule) => typeof rule === 'string')
    && typeof value.return_note === 'string'
    && (value.time_zone === null || (typeof value.time_zone === 'string' && value.time_zone.length > 0))
    && (value.delivery_mode === 'pickup' || value.delivery_mode === 'delivery')
    && hasValidSlot(value.slot) && hasValidSlot(value.pickup_slot) && hasValidSlot(value.return_slot);
}

export async function fetchBookingPrecheckin(bookingId: string): Promise<BookingPrecheckin> {
  assertUuid(bookingId, 'booking id');
  const { data, error } = await supabase.rpc('get_booking_precheckin', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
  if (!isPrecheckin(data)) {
    throw new Error('The server returned invalid check-in details.');
  }
  return data;
}

export async function proposeBookingHandoffSlot(bookingId: string, kind: HandoffKind, slotWindow: HandoffWindow, hour: number, note = ''): Promise<void> {
  assertUuid(bookingId, 'booking id');
  if (!HANDOFF_WINDOWS.includes(slotWindow) || !HANDOFF_HOURS[slotWindow].includes(hour) || note.length > 240) {
    throw new Error('Choose a valid handoff time.');
  }
  const { error } = await supabase.rpc('propose_booking_handoff_slot_at_hour', {
    p_booking_id: bookingId, p_kind: kind, p_slot_window: slotWindow, p_hour: hour, p_note: note.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function respondToBookingHandoffSlot(bookingId: string, kind: HandoffKind, approve: boolean, expectedUpdatedAt: string): Promise<void> {
  assertUuid(bookingId, 'booking id');
  if (!isTimestamp(expectedUpdatedAt)) throw new Error('Refresh check-in before responding to this proposal.');
  const { error } = await supabase.rpc('respond_to_booking_handoff_slot', {
    p_booking_id: bookingId, p_kind: kind, p_approve: approve, p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw new Error(error.message);
}
