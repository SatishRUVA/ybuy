import { useState } from 'react';
import { Alert, Button } from '@/main-site/components/ui';
import { textareaClass } from '@/main-site/components/form-classes';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/main-site/components/shadcn/dialog';
import {
  cancelBooking, getBookingCancellationQuote, processCancellationRefund,
  type BookingCancellationQuote, type UiBooking,
} from '@/lib/bookings';

function refundSummary(quote: BookingCancellationQuote): string {
  if (quote.refund_status === 'pending_policy_review') {
    return 'Pending Policy Review. No refund amount is confirmed.';
  }
  if (quote.refund_status === 'pending_review') {
    return quote.refund_amount > 0
      ? `Estimated eligible refund: $${quote.refund_amount.toFixed(2)}; pending review.`
      : 'Refund eligibility requires manual review.';
  }
  if (quote.refund_status === 'approved') {
    return `Eligible refund: $${quote.refund_amount.toFixed(2)}; provider confirmation is still required.`;
  }
  return 'No payment refund currently applies.';
}

export function BookingCancellationAction({ booking, onCancelled }: {
  booking: UiBooking;
  onCancelled: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<BookingCancellationQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setQuote(null);
    setError(null);
    setLoadingQuote(true);
    try {
      setQuote(await getBookingCancellationQuote(booking.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not verify cancellation eligibility.');
    } finally {
      setLoadingQuote(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const reasonField = form.elements.namedItem('cancellation-reason');
    if (!(reasonField instanceof HTMLTextAreaElement)) return;
    reasonField.setCustomValidity(reasonField.value.trim().length < 3
      ? 'Enter a cancellation reason of at least 3 characters.' : '');
    if (!form.reportValidity() || !quote?.allowed) return;

    setBusy(true);
    setError(null);
    try {
      const result = await cancelBooking(booking.id, reasonField.value);
      let message = result.refundStatus === 'pending_policy_review'
        ? 'Booking cancelled. Refund eligibility is pending policy review; no amount is promised.'
        : result.refundStatus === 'pending_review'
          ? 'Booking cancelled. Any eligible refund is pending review.'
          : result.refundStatus === 'approved'
            ? `Booking cancelled. The $${result.refundAmount.toFixed(2)} refund is approved and awaiting provider confirmation.`
            : 'Booking cancelled. No payment refund applies.';
      if (result.refundStatus === 'approved' && quote.automatic_processing) {
        try {
          await processCancellationRefund(result.refundCaseId);
          message = `Booking cancelled. The $${result.refundAmount.toFixed(2)} refund was submitted to the payment provider; confirmation is pending.`;
        } catch {
          message = 'Booking cancelled. Refund processing could not be confirmed; the case remains available for safe reconciliation.';
        }
      }
      setOpen(false);
      onCancelled(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel this booking.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Button size="sm" variant="danger" onClick={() => void openDialog()}>Cancel booking</Button>
    <Dialog open={open} onOpenChange={(next) => {
      if (!busy) {
        setOpen(next);
        if (!next) setError(null);
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>
            This will end the booking for {booking.listingTitle}. Cancellation and payment refunds are separate.
          </DialogDescription>
        </DialogHeader>
        <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
          <dl className="grid gap-2 rounded-card bg-subtle p-3 text-sm sm:grid-cols-2">
            <div><dt className="text-sec">Rental dates</dt><dd className="font-medium text-main">{booking.startDate} – {booking.endDate}</dd></div>
            <div><dt className="text-sec">Booking reference</dt><dd className="font-medium text-main">{booking.bookingReference ?? 'Not assigned'}</dd></div>
          </dl>
          {loadingQuote ? <p role="status" className="text-sm text-sec">Checking cancellation eligibility…</p> : quote && <>
            <div className={quote.allowed ? 'rounded-card border border-app p-3 text-sm' : 'rounded-card border border-error bg-error-soft p-3 text-sm'}>
              <p className="font-semibold text-main">{quote.allowed ? 'Eligible to cancel before pickup' : 'Cancellation unavailable'}</p>
              <p className="mt-1 text-sec">{quote.allowed ? refundSummary(quote) : quote.ineligible_reason}</p>
              {quote.allowed && <p className="mt-1 text-xs text-sec">A cancellation does not guarantee a refund. A refund is complete only after payment-provider confirmation.</p>}
            </div>
          </>}
          <div className="space-y-1.5">
            <label htmlFor={`cancellation-reason-${booking.id}`} className="text-sm font-medium text-main">
              Cancellation reason <span aria-hidden="true">*</span>
            </label>
            <textarea
              id={`cancellation-reason-${booking.id}`}
              name="cancellation-reason"
              className={textareaClass()}
              rows={3}
              minLength={3}
              maxLength={500}
              required
              disabled={busy}
              onInput={(event) => event.currentTarget.setCustomValidity('')}
            />
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Keep booking</Button>
            <Button type="submit" variant="danger" loading={busy} disabled={loadingQuote || !quote?.allowed}>
              Confirm cancellation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
