import { supabase } from '@/lib/supabase';
import { ADMIN_PORTAL } from '@/lib/admin-portal';
import type { Paged } from '@/admin/api';

export const formText = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export async function operationRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type CaseKind = 'dispute' | 'support';
export interface CaseRow {
  id: string;
  kind: CaseKind;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  booking_id: string | null;
  created_by: string;
  participant_id: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  proposed_amount?: number | null;
}

export interface CaseMessage {
  id: string; author_id: string; body: string; internal: boolean; created_at: string;
}
export interface CaseEvidence {
  id: string; path: string; file_name: string; created_at: string;
}
export interface CaseEvent {
  id: string; action: string; reason: string | null; created_at: string;
}
export interface CaseDetail {
  case: CaseRow;
  messages: CaseMessage[];
  evidence: CaseEvidence[];
  events: CaseEvent[];
  booking: { status: string; start_date: string; end_date: string; created_at: string; updated_at: string } | null;
  deadline_policy_unresolved: boolean;
}
export const CASE_STATUSES = {
  dispute: ['open', 'investigating', 'awaiting_evidence', 'escalated', 'decided', 'closed'],
  support: ['open', 'in_progress', 'awaiting_user', 'resolved', 'closed'],
} as const;
export const CASE_CATEGORIES = {
  dispute: ['damaged', 'missing', 'incorrect', 'malfunction', 'late_return', 'other'],
  support: ['booking', 'cancellation', 'pickup_return', 'payment', 'refund', 'deposit_release', 'other'],
} as const;

export function listCases(kind: CaseKind, search: string, status: string, priority: string, staff: boolean, limit: number, offset: number) {
  return operationRpc<Paged<CaseRow>>(ADMIN_PORTAL && staff ? 'admin_list_cases' : 'list_my_cases', {
    p_kind: kind, p_search: search || null, p_status: status === 'all' ? null : status,
    p_priority: priority === 'all' ? null : priority, p_limit: limit, p_offset: offset,
  });
}
interface StoredCaseDetail {
  case: Omit<CaseRow, 'description'>;
  replies: { id: string; author_id: string; body: string; is_private: boolean; created_at: string }[];
  evidence: { id: string; object_path: string; created_at: string }[];
  events: { id: string; event_type: string; detail: { reason?: string }; created_at: string }[];
  booking: CaseDetail['booking'];
  deadline_policy_unresolved: boolean;
}
export async function getCase(id: string): Promise<CaseDetail> {
  const data = await operationRpc<StoredCaseDetail>('get_case_detail', { p_case_id: id });
  return {
    case: { ...data.case, description: data.replies.find((reply) => !reply.is_private)?.body ?? '' },
    messages: data.replies.map((reply) => ({ ...reply, internal: reply.is_private })),
    evidence: data.evidence.map((item) => ({ ...item, path: item.object_path, file_name: item.object_path.split('/').pop() ?? 'Evidence' })),
    events: data.events.map((event) => ({ ...event, action: event.event_type, reason: event.detail.reason ?? null })),
    booking: data.booking,
    deadline_policy_unresolved: data.deadline_policy_unresolved,
  };
}
export const createCase = (kind: CaseKind, data: FormData, staff: boolean) => operationRpc<CaseRow>(ADMIN_PORTAL && staff ? 'admin_create_case' : 'create_case', {
  p_kind: kind, p_subject: formText(data, 'subject'), p_body: formText(data, 'description'),
  p_category: formText(data, 'category'), p_booking_id: formText(data, 'booking_id') || null,
  ...(ADMIN_PORTAL && staff ? { p_participant_id: formText(data, 'participant_id'), p_reason: formText(data, 'reason') } : {}),
});

export const updateCase = (id: string, data: FormData) => operationRpc('admin_update_case', {
  p_case_id: id, p_status: formText(data, 'status'), p_priority: formText(data, 'priority'),
  p_assigned_to: formText(data, 'assigned_to') || null, p_reason: formText(data, 'reason'),
  p_proposed_amount: formText(data, 'proposed_amount') ? Number(formText(data, 'proposed_amount')) : null,
});
export const addCaseReply = (id: string, body: string, internal: boolean) =>
  operationRpc('reply_to_case', { p_case_id: id, p_body: body, p_private: internal });

export async function uploadCaseEvidence(caseId: string, file: File) {
  if (!file.size || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('Use a JPEG, PNG, WebP or PDF file no larger than 10 MB.');
  }
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error('Sign in again to upload evidence.');
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  const path = `${caseId}/${session.user.id}/${crypto.randomUUID()}-${filename}`;
  const { error } = await supabase.storage.from('admin-case-evidence').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  try {
    await operationRpc('register_case_evidence', { p_case_id: caseId, p_object_path: path });
  } catch (e) {
    throw new Error(`Evidence registration failed: ${e instanceof Error ? e.message : 'Unknown error'}. The upload remains private; contact support with reference ${path}.`);
  }
}
export async function viewCaseEvidence(evidence: CaseEvidence) {
  const { data, error } = await supabase.storage.from('admin-case-evidence').createSignedUrl(evidence.path, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export interface Promotion {
  id: string; code: string; name: string; discount_type: 'percentage' | 'fixed';
  value: number; min_spend: number; max_discount: number | null;
  starts_at: string; ends_at: string; active: boolean;
  usage_limit: number | null; per_user_limit: number;
  category_ids: string[]; listing_ids: string[];
  redemptions: number; discount_total: number;
}
export interface CreditEntry {
  id: string; user_id: string; amount: number; kind: string; reason: string;
  created_at: string; expires_at: string | null;
}
export interface Wallet {
  available: number; balance: number; reserved: number; entries: CreditEntry[];
}
export interface RefundRequest {
  id: string; payment_id: string; amount: number; currency: string; status: string;
  requested_by: string; approved_by: string | null; reason: string; created_at: string;
}
interface StoredPromotion extends Omit<Promotion, 'name' | 'discount_type' | 'value' | 'min_spend' | 'usage_limit'> {
  description: string; discount_type: 'percent' | 'fixed'; discount_value: number; min_subtotal: number; max_redemptions: number | null;
}
export async function listPromotions(limit: number, offset: number): Promise<Paged<Promotion>> {
  const data = await operationRpc<Paged<StoredPromotion>>('admin_list_promotions', { p_limit: limit, p_offset: offset });
  return { total: data.total, rows: data.rows.map((promo) => ({ ...promo, name: promo.description,
    discount_type: promo.discount_type === 'percent' ? 'percentage' : 'fixed', value: promo.discount_value,
    min_spend: promo.min_subtotal, usage_limit: promo.max_redemptions })) };
}
export const savePromotion = (id: string | null, form: FormData) => operationRpc('admin_save_promotion', {
  p_id: id, p_values: {
    code: formText(form, 'code'), description: formText(form, 'name'), discount_type: formText(form, 'discount_type') === 'percentage' ? 'percent' : 'fixed',
    discount_value: Number(formText(form, 'value')), min_subtotal: Number(formText(form, 'min_spend')),
    max_discount: formText(form, 'max_discount') ? Number(formText(form, 'max_discount')) : null,
    starts_at: new Date(formText(form, 'starts_at')).toISOString(), ends_at: new Date(formText(form, 'ends_at')).toISOString(),
    active: formText(form, 'active') === 'true',
    max_redemptions: formText(form, 'usage_limit') ? Number(formText(form, 'usage_limit')) : null,
    per_user_limit: Number(formText(form, 'per_user_limit')),
    category_ids: formText(form, 'category_ids').split(',').map((id) => id.trim()).filter(Boolean),
    listing_ids: formText(form, 'listing_ids').split(',').map((id) => id.trim()).filter(Boolean),
  }, p_reason: formText(form, 'reason'),
});
export async function getWallet(userId?: string): Promise<Wallet> {
  if (ADMIN_PORTAL && userId) {
    const data = await operationRpc<Omit<Wallet, 'entries'> & { rows: CreditEntry[] }>('admin_credit_history', { p_user_id: userId, p_limit: 100, p_offset: 0 });
    return { available: data.available, balance: data.balance, reserved: data.reserved, entries: data.rows };
  }
  const data = await operationRpc<Omit<Wallet, 'entries'> & { history: CreditEntry[] }>('get_my_credits');
  return { available: data.available, balance: data.balance, reserved: data.reserved, entries: data.history };
}
export const grantCredits = (form: FormData, key: string) => operationRpc('admin_grant_credit', {
  p_user_id: formText(form, 'user_id'), p_amount: Number(formText(form, 'amount')),
  p_reason: formText(form, 'reason'), p_idempotency_key: key, p_kind: formText(form, 'kind'),
});
export const listRefundRequests = (limit: number, offset: number) => operationRpc<Paged<RefundRequest>>('admin_list_refund_requests', { p_limit: limit, p_offset: offset });
export const requestRefund = (form: FormData, key: string) => operationRpc('admin_request_refund', {
  p_payment_id: formText(form, 'payment_id'), p_amount: Number(formText(form, 'amount')),
  p_reason: formText(form, 'reason'), p_idempotency_key: key,
});
export const approveRefund = (id: string, reason: string) =>
  operationRpc('admin_approve_refund', { p_refund_id: id, p_reason: reason });

export interface OperationNotification {
  id: string; case_id: string; body: string; created_at: string; read_at: string | null;
}
export async function listOperationNotifications(limit: number, offset: number): Promise<Paged<OperationNotification>> {
  const data = await operationRpc<Paged<Omit<OperationNotification, 'body'> & { event_type: string }>>('list_my_notifications', { p_limit: limit, p_offset: offset });
  return { total: data.total, rows: data.rows.map((item) => ({ ...item, body: `Case update: ${item.event_type.replace(/_/g, ' ')}` })) };
}
export const readOperationNotification = (id: string) => operationRpc('mark_notification_read', { p_notification_id: id });

export interface RefundEvent {
  event_id: string; provider_ref: string; amount: number; currency: string; status: string;
  processing_status: string; exception_reason: string | null; created_at: string;
}
export const listRefundEvents = (limit: number, offset: number) =>
  operationRpc<Paged<RefundEvent>>('admin_list_refund_events', { p_limit: limit, p_offset: offset });

export interface BookingCancellationCase {
  cancellation_id: string;
  booking_id: string;
  refund_case_id: string | null;
  initiator_role: string;
  cancellation_type: string;
  reason: string;
  cancellation_created_at: string;
  refund_status: string | null;
  currency: string | null;
  original_payment_amount: number | null;
  eligible_amount: number | null;
  refund_amount: number | null;
  payment_id: string | null;
  payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  payment_status: string | null;
  provider_refund_id: string | null;
  provider_status: string | null;
  policy_version: number | null;
  decision_reason: string | null;
  attempt: number | null;
  booking_reference: string;
  booking_status: string;
  listing_title: string;
}

export interface BookingCancellationPolicy {
  id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  renter_cutoff_hours: number;
  renter_rental_refund_percent: number;
  owner_cutoff_hours: number;
  owner_rental_refund_percent: number;
  automatic_processing: boolean;
}

export interface BookingCancellationEvent {
  id: number;
  actor_id: string | null;
  actor_role: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export function listBookingCancellations(filters: {
  refundStatus: string;
  initiatorRole: string;
  bookingStatus: string;
  reason: string;
  from: string;
  to: string;
}, limit: number, offset: number) {
  return operationRpc<Paged<BookingCancellationCase>>('admin_list_booking_cancellations', {
    p_refund_status: filters.refundStatus === 'all' ? null : filters.refundStatus,
    p_initiator_role: filters.initiatorRole === 'all' ? null : filters.initiatorRole,
    p_booking_status: filters.bookingStatus === 'all' ? null : filters.bookingStatus,
    p_reason: filters.reason || null,
    p_from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : null,
    p_to: filters.to ? new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86400000).toISOString() : null,
    p_limit: limit,
    p_offset: offset,
  });
}

export const listBookingCancellationPolicies = () =>
  operationRpc<BookingCancellationPolicy[]>('admin_list_booking_cancellation_policies');

export function saveBookingCancellationPolicy(form: FormData) {
  const effectiveFrom = new Date(formText(form, 'effective_from'));
  const effectiveToValue = formText(form, 'effective_to');
  const effectiveTo = effectiveToValue ? new Date(effectiveToValue) : null;
  if (!Number.isFinite(effectiveFrom.getTime()) || effectiveTo && !Number.isFinite(effectiveTo.getTime())) {
    throw new Error('Enter valid policy dates.');
  }
  const number = (name: string) => {
    const value = formText(form, name);
    const parsed = Number(value);
    if (!value || !Number.isFinite(parsed)) throw new Error('Enter all policy cutoffs and refund percentages.');
    return parsed;
  };
  const checked = (name: string) => form.get(name) === 'on';
  return operationRpc('admin_save_booking_cancellation_policy', {
    p_effective_from: effectiveFrom.toISOString(),
    p_effective_to: effectiveTo?.toISOString() ?? null,
    p_renter_cutoff_hours: number('renter_cutoff_hours'),
    p_renter_rental_refund_percent: number('renter_rental_refund_percent'),
    p_renter_refund_service_fee: checked('renter_refund_service_fee'),
    p_renter_refund_delivery_fee: checked('renter_refund_delivery_fee'),
    p_renter_refund_tax: checked('renter_refund_tax'),
    p_renter_refund_insurance: checked('renter_refund_insurance'),
    p_renter_refund_deposit: checked('renter_refund_deposit'),
    p_owner_cutoff_hours: number('owner_cutoff_hours'),
    p_owner_rental_refund_percent: number('owner_rental_refund_percent'),
    p_owner_refund_service_fee: checked('owner_refund_service_fee'),
    p_owner_refund_delivery_fee: checked('owner_refund_delivery_fee'),
    p_owner_refund_tax: checked('owner_refund_tax'),
    p_owner_refund_insurance: checked('owner_refund_insurance'),
    p_owner_refund_deposit: checked('owner_refund_deposit'),
    p_automatic_processing: checked('automatic_processing'),
    p_reason: formText(form, 'reason'),
  });
}

export const decideBookingCancellationRefund = (
  id: string, action: 'approve' | 'reject', amount: number | null, reason: string, override = false,
) => operationRpc('admin_decide_cancellation_refund', {
  p_refund_case_id: id, p_action: action, p_amount: amount, p_reason: reason, p_override: override,
});

export const getBookingCancellationAudit = (bookingId: string) =>
  operationRpc<BookingCancellationEvent[]>('get_booking_cancellation_audit', { p_booking_id: bookingId });

export interface PromotionRedemption {
  id: string; booking_id: string; user_id: string; discount_amount: number; created_at: string;
}
export const listPromotionRedemptions = (id: string, limit: number, offset: number) =>
  operationRpc<Paged<PromotionRedemption>>('admin_promotion_redemptions', { p_promotion_id: id, p_limit: limit, p_offset: offset });
