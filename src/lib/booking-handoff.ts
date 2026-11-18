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
  revision?: number;
  publication_status?: 'draft' | 'published';
  published_at?: string | null;
  workflow_version?: number;
}

export interface HandoffPhoto {
  id: string;
  object_path: string;
  created_at: string;
  signedUrl?: string;
  loadError?: string;
}

interface HandoffInspectionDetail {
  inspection: HandoffInspection | null;
  photos: HandoffPhoto[];
  history?: { inspection: HandoffInspection; photos: HandoffPhoto[] }[];
  review_reason?: string | null;
}

export interface HandoffWorkflow {
  version: number;
  kind: HandoffKind;
  stage: 'arrange' | 'inspection' | 'review' | 'verify' | 'active' | 'returned' | 'cancelled';
  next_actor: 'owner' | 'renter' | 'support' | null;
  action: string | null;
  allowed_actions: string[];
  blockers: string[];
  payment_ready: boolean;
  deposit_ready: boolean;
  scheduling_ready: boolean;
  condition_status: 'pending' | 'agreed' | 'disputed' | 'correction_requested';
  physical_return_verified: boolean;
  financially_closed: boolean;
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

export interface WorkflowBookingHandoff extends BookingHandoff {
  workflow: HandoffWorkflow;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function fetchBookingHandoff(bookingId: string, kind: HandoffKind = 'pickup'): Promise<WorkflowBookingHandoff> {
  assertUuid(bookingId, 'booking id');
  const handoff = await rpc<WorkflowBookingHandoff>('get_booking_handoff_workflow', { p_booking_id: bookingId, p_kind: kind });
  if (!handoff?.workflow || !Number.isSafeInteger(handoff.workflow.version)
    || handoff.workflow.kind !== kind
    || !['arrange', 'inspection', 'review', 'verify', 'active', 'returned', 'cancelled'].includes(handoff.workflow.stage)
    || !Array.isArray(handoff.workflow.allowed_actions) || !handoff.workflow.allowed_actions.every(action => typeof action === 'string')
    || !Array.isArray(handoff.workflow.blockers) || !handoff.workflow.blockers.every(blocker => typeof blocker === 'string')
    || !['pending', 'agreed', 'disputed', 'correction_requested'].includes(handoff.workflow.condition_status)
    || ![handoff.workflow.payment_ready, handoff.workflow.deposit_ready, handoff.workflow.scheduling_ready,
      handoff.workflow.physical_return_verified, handoff.workflow.financially_closed].every(value => typeof value === 'boolean')) {
    throw new Error('The server returned invalid handoff readiness. Reload or contact support.');
  }
  async function signPhotos(photos: HandoffPhoto[]) {
    return Promise.all(photos.map(async (photo) => {
      const { data, error } = await supabase.storage
        .from('booking-inspection-evidence').createSignedUrl(photo.object_path, 60 * 30);
      if (error) return { ...photo, loadError: `Could not load this evidence photo: ${error.message}` };
      return { ...photo, signedUrl: data.signedUrl };
    }));
  }
  for (const detail of [handoff.pickup, handoff.return]) {
    if (!detail) continue;
    detail.photos = await signPhotos(detail.photos);
    for (const revision of detail.history ?? []) revision.photos = await signPhotos(revision.photos);
  }
  return handoff;
}

export async function beginBookingHandoff(bookingId: string, kind: HandoffKind, version: number): Promise<void> {
  assertUuid(bookingId, 'booking id');
  await rpc('begin_booking_handoff', { p_booking_id: bookingId, p_kind: kind, p_expected_version: version });
}

export async function publishBookingInspection(bookingId: string, kind: HandoffKind, version: number): Promise<void> {
  assertUuid(bookingId, 'booking id');
  await rpc('publish_booking_inspection', { p_booking_id: bookingId, p_kind: kind, p_expected_version: version });
}

export async function reviewBookingInspection(input: {
  bookingId: string; kind: HandoffKind; revision: number; version: number;
  decision: 'agree' | 'request_correction' | 'dispute'; reason: string;
}): Promise<void> {
  assertUuid(input.bookingId, 'booking id');
  await rpc('review_booking_inspection', {
    p_booking_id: input.bookingId, p_kind: input.kind, p_revision: input.revision,
    p_expected_version: input.version, p_decision: input.decision, p_reason: input.reason,
  });
}

export async function reportBookingReturnReceipt(bookingId: string, version: number, reason: string): Promise<void> {
  assertUuid(bookingId, 'booking id');
  await rpc('report_booking_return_receipt', { p_booking_id: bookingId, p_expected_version: version, p_reason: reason });
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

export async function saveBookingInspectionDraft(input: {
  bookingId: string; kind: HandoffKind; version: number;
  appearanceCondition: string; existingDamage: string; includedAccessories: string[];
  functionalCondition: string; serialNumber: string;
}): Promise<HandoffInspection> {
  assertUuid(input.bookingId, 'booking id');
  return rpc('save_booking_inspection_draft', {
    p_booking_id: input.bookingId, p_kind: input.kind, p_expected_version: input.version,
    p_appearance_condition: input.appearanceCondition, p_existing_damage: input.existingDamage,
    p_included_accessories: input.includedAccessories, p_functional_condition: input.functionalCondition,
    p_serial_number: input.serialNumber,
  });
}

export interface PendingInspectionPhoto {
  file: File;
  objectPath: string | null;
  uploaded: boolean;
}

export async function uploadBookingInspectionPhoto(
  bookingId: string,
  kind: HandoffKind,
  inspectionId: string,
  file: File,
  progress?: PendingInspectionPhoto,
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
  const path = progress?.objectPath ?? `${bookingId}/${session.user.id}/${kind}/${crypto.randomUUID()}-${filename}`;
  if (progress) progress.objectPath = path;
  if (!progress?.uploaded) {
    const { error } = await supabase.storage.from('booking-inspection-evidence')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error && !('statusCode' in error && String(error.statusCode) === '409')) throw new Error(error.message);
    if (progress) progress.uploaded = true;
  }
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
