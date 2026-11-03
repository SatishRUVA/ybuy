import { supabase } from '@/lib/supabase';
import { assertUuid } from '@/lib/text-safety';

export type HandoffKind = 'pickup' | 'return';
export type HandoffStatus =
  | 'pickup_ready'
  | 'pickup_checkin_started'
  | 'pickup_inspection'
  | 'pickup_otp_pending'
  | 'rental_active'
  | 'return_initiated'
  | 'return_inspection'
  | 'return_otp_pending'
  | 'returned'
  | 'cancelled';

export interface HandoffInspection {
  id: string;
  booking_id: string;
  kind: HandoffKind;
  appearance_condition: string;
  existing_damage: string;
  included_accessories: string[];
  functional_condition: string;
  serial_number: string;
  submitted_at: string;
  owner_acknowledged_at: string | null;
  renter_acknowledged_at: string | null;
}

export interface HandoffPhoto {
  id: string;
  object_path: string;
  created_at: string;
  signedUrl?: string;
}

interface HandoffInspectionDetail {
  inspection: HandoffInspection | null;
  photos: HandoffPhoto[];
}

export interface BookingHandoff {
  booking_id: string;
  booking_status: string;
  start_date: string;
  end_date: string;
  is_owner: boolean;
  status: HandoffStatus | null;
  pickup_arrived_at: string | null;
  actual_pickup_at: string | null;
  return_initiated_at: string | null;
  actual_return_at: string | null;
  pickup: HandoffInspectionDetail | null;
  return: HandoffInspectionDetail | null;
  events: { id: number; event_type: string; created_at: string }[];
  cases: { id: string; kind: string; category: string; subject: string; status: string; created_at: string }[];
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function fetchBookingHandoff(bookingId: string): Promise<BookingHandoff> {
  assertUuid(bookingId, 'booking id');
  const handoff = await rpc<BookingHandoff>('get_booking_handoff', { p_booking_id: bookingId });
  for (const detail of [handoff.pickup, handoff.return]) {
    if (!detail) continue;
    detail.photos = await Promise.all(detail.photos.map(async (photo) => {
      const { data, error } = await supabase.storage
        .from('booking-inspection-evidence')
        .createSignedUrl(photo.object_path, 60 * 30);
      if (error) throw new Error(error.message);
      return { ...photo, signedUrl: data.signedUrl };
    }));
  }
  return handoff;
}

export async function startBookingPickup(bookingId: string): Promise<void> {
  assertUuid(bookingId, 'booking id');
  await rpc('start_booking_pickup', { p_booking_id: bookingId });
}

export async function startBookingHandoff(bookingId: string): Promise<void> {
  assertUuid(bookingId, 'booking id');
  await rpc('start_booking_handoff', { p_booking_id: bookingId });
}

export async function beginBookingReturnInspection(bookingId: string): Promise<void> {
  assertUuid(bookingId, 'booking id');
  await rpc('begin_booking_return_inspection', { p_booking_id: bookingId });
}

export async function saveBookingInspection(input: {
  bookingId: string;
  kind: HandoffKind;
  appearanceCondition: string;
  existingDamage: string;
  includedAccessories: string[];
  functionalCondition: string;
  serialNumber: string;
}): Promise<HandoffInspection> {
  assertUuid(input.bookingId, 'booking id');
  return rpc('save_booking_inspection', {
    p_booking_id: input.bookingId,
    p_kind: input.kind,
    p_appearance_condition: input.appearanceCondition,
    p_existing_damage: input.existingDamage,
    p_included_accessories: input.includedAccessories,
    p_functional_condition: input.functionalCondition,
    p_serial_number: input.serialNumber,
  });
}

export async function uploadBookingInspectionPhoto(
  bookingId: string,
  kind: HandoffKind,
  inspectionId: string,
  file: File,
): Promise<void> {
  assertUuid(bookingId, 'booking id');
  assertUuid(inspectionId, 'inspection id');
  if (!file.size || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('Use a JPEG, PNG or WebP photo no larger than 10 MB.');
  }
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error('Sign in again to upload inspection photos.');
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  const path = `${bookingId}/${session.user.id}/${kind}/${crypto.randomUUID()}-${filename}`;
  const { error } = await supabase.storage.from('booking-inspection-evidence')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  try {
    await rpc('register_booking_inspection_photo', { p_inspection_id: inspectionId, p_object_path: path });
  } catch (reason) {
    throw new Error(`Photo registration failed. The private upload is retained for support reference ${path}. ${reason instanceof Error ? reason.message : ''}`);
  }
}

export async function acknowledgeBookingInspection(bookingId: string, kind: HandoffKind): Promise<void> {
  assertUuid(bookingId, 'booking id');
  await rpc('acknowledge_booking_inspection', { p_booking_id: bookingId, p_kind: kind });
}

export async function getBookingHandoffOtp(bookingId: string, kind: HandoffKind): Promise<{
  code: string;
  expires_at: string;
  generation: number;
}> {
  assertUuid(bookingId, 'booking id');
  return rpc('get_booking_handoff_otp', { p_booking_id: bookingId, p_kind: kind });
}

export async function regenerateBookingHandoffOtp(bookingId: string, kind: HandoffKind) {
  assertUuid(bookingId, 'booking id');
  return rpc<{ code: string; expires_at: string; generation: number }>(
    'regenerate_booking_handoff_otp',
    { p_booking_id: bookingId, p_kind: kind },
  );
}

export async function verifyBookingHandoffOtp(bookingId: string, kind: HandoffKind, code: string) {
  assertUuid(bookingId, 'booking id');
  return rpc<{ verified: boolean; status?: string; error?: string; attempts_remaining?: number; idempotent?: boolean }>(
    'verify_booking_handoff_otp',
    { p_booking_id: bookingId, p_kind: kind, p_code: code },
  );
}
