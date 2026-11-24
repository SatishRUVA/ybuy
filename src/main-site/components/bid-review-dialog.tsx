import { useEffect, useRef } from 'react';
import { Alert, Button } from '@/main-site/components/ui';

const money = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function BidReviewDialog({ open, onClose, onConfirm, busy, error, start, end, rate, subtotal, deposit }: {
  open: boolean; onClose: () => void; onConfirm: () => void; busy: boolean; error: string | null;
  start: string; end: string; rate: number; subtotal: number; deposit: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return <dialog ref={ref} aria-labelledby="bid-review-title" onClose={onClose}
    onCancel={event => { if (busy) event.preventDefault(); }}
    className="bid-review-dialog rounded-card-lg border border-app bg-card p-5 text-main">
    <h2 id="bid-review-title" className="text-xl font-bold">Review your bid</h2>
    <p className="mt-2 text-sm text-sec">Check the details before submitting. The owner chooses whether to select your bid.</p>
    {open && <dl className="mt-4 space-y-3 text-sm">
      <div className="flex justify-between gap-4"><dt>Rental dates</dt><dd className="text-right font-semibold">{dateLabel(start)} – {dateLabel(end)}</dd></div>
      <div className="flex justify-between gap-4"><dt>Daily bid</dt><dd className="font-semibold">{money(rate)}</dd></div>
      <div className="flex justify-between gap-4"><dt>Rental subtotal</dt><dd className="font-semibold">{money(subtotal)}</dd></div>
      {deposit > 0 && <div className="flex justify-between gap-4"><dt>Security hold if selected</dt><dd className="font-semibold">{money(deposit)}</dd></div>}
    </dl>}
    <p className="mt-4 text-xs text-sec">Subtotal excludes taxes, fees and optional insurance. No payment is taken when you bid; payment is due only if selected.</p>
    {error && <Alert tone="error" title="Could not submit bid" className="mt-4">{error}</Alert>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <Button type="button" variant="secondary" autoFocus disabled={busy} onClick={onClose}>Go back and edit</Button>
      <Button type="button" disabled={busy} loading={busy} loadingLabel="Submitting bid..." onClick={onConfirm}>Confirm and submit bid</Button>
    </div>
  </dialog>;
}
