import { supabase } from '@/lib/supabase';

export type CancellationRefundStatus =
  | 'not_applicable' | 'pending_policy_review' | 'pending_review' | 'approved' | 'processing'
  | 'partially_refunded' | 'refunded' | 'failed' | 'rejected';

export interface CancellationRefundDetails {
  reason: string;
  cancelledAt: string;
  status: CancellationRefundStatus;
  currency: string;
  originalPaymentAmount: number;
  eligibleAmount: number;
  refundAmount: number;
  providerRefundId: string | null;
  decisionReason: string | null;
}

/** Reads the existing participant-visible cancellation and refund records under RLS. */
export async function fetchCancellationRefundDetails(bookingIds: string[]): Promise<Map<string, CancellationRefundDetails>> {
  if (bookingIds.length === 0) return new Map();
  const [cancellations, refunds] = await Promise.all([
    supabase.from('booking_cancellations')
      .select('booking_id,reason,created_at').in('booking_id', bookingIds),
    supabase.from('cancellation_refund_cases')
      .select('booking_id,status,currency,original_payment_amount,eligible_amount,refund_amount,provider_refund_id,decision_reason')
      .in('booking_id', bookingIds),
  ]);
  if (cancellations.error) throw new Error(cancellations.error.message);
  if (refunds.error) throw new Error(refunds.error.message);

  const refundsByBooking = new Map((refunds.data ?? []).map((row) => [row.booking_id, row]));
  const result = new Map<string, CancellationRefundDetails>();
  for (const cancellation of cancellations.data ?? []) {
    const refund = refundsByBooking.get(cancellation.booking_id);
    if (!refund) continue;
    result.set(cancellation.booking_id, {
      reason: cancellation.reason,
      cancelledAt: cancellation.created_at,
      status: refund.status as CancellationRefundStatus,
      currency: refund.currency,
      originalPaymentAmount: Number(refund.original_payment_amount),
      eligibleAmount: Number(refund.eligible_amount),
      refundAmount: Number(refund.refund_amount),
      providerRefundId: refund.provider_refund_id,
      decisionReason: refund.decision_reason,
    });
  }
  return result;
}
