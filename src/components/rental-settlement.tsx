import { useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { fetchRentalSettlement, processRentalSettlement, type RentalSettlement as Settlement } from '@/lib/payouts';

export function RentalSettlement({ bookingId, isOwner, autoProcess = false }: {
  bookingId: string; isOwner: boolean; autoProcess?: boolean;
}) {
  const [row, setRow] = useState<Settlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError(null);
      try {
        const current = await fetchRentalSettlement(bookingId);
        if (cancelled) return;
        setRow(current);
        if (current && (attempt > 0 || (autoProcess && isOwner))
          && (current.refund_status === 'pending' || current.refund_status === 'processing'
            || current.transfer_status === 'pending' || current.transfer_status === 'processing')) {
          try { await processRentalSettlement(bookingId); }
          finally {
            const latest = await fetchRentalSettlement(bookingId);
            if (!cancelled) setRow(latest);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not verify settlement status.');
      } finally { if (!cancelled) setBusy(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [bookingId, isOwner, autoProcess, attempt]);
  return (
    <div className="space-y-2 text-xs text-sec" aria-live="polite">
      {row && <>
        <p>Deposit ${Number(row.deposit_amount).toFixed(2)}: {row.refund_status.split('_').join(' ')}</p>
        {isOwner && <p>Owner transfer ${Number(row.owner_amount).toFixed(2)}: {row.transfer_status}</p>}
        {isOwner && <p>Transfers go to your Stripe balance. Bank payout timing and status are managed by Stripe.</p>}
      </>}
      {!row && !busy && !error && <p>No automatic settlement is recorded for this rental.</p>}
      {error && <Alert tone="error">{error}</Alert>}
      {!error && row?.last_error && <Alert tone="warning">{row.last_error}</Alert>}
      <Button size="sm" variant="ghost" loading={busy} loadingLabel="Checking settlement..."
        onClick={() => setAttempt((value) => value + 1)}>
        {isOwner ? 'Process / refresh settlement' : 'Refresh deposit refund'}
      </Button>
    </div>
  );
}
