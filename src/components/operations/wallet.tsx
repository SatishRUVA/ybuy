import { Alert, Button } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { getWallet } from '@/lib/operations';
import { fmtDate, money, useLoad } from './query-utils';

export function WalletPanel({ userId }: { userId?: string }) {
  const { data, loading, error, reload } = useLoad(() => getWallet(userId), [userId]);
  return <div className="space-y-3">
    {loading && <Skeleton className="h-20 w-full" />}
    {error && <Alert tone="error">{error}<Button size="sm" variant="secondary" onClick={reload}>Try again</Button></Alert>}
    {data && <>
      <p className="text-lg font-semibold text-main">Available test credits: {money(data.available)}</p>
      <p className="text-sm text-sec">Unexpired balance {money(data.balance)}; reserved {money(data.reserved)}. Latest 100 ledger entries shown.</p>
      {data.entries.length === 0 && <p className="text-sm text-sec">No credit transactions.</p>}
      <ul className="divide-y divide-[var(--border)]">{data.entries.map((entry) => <li key={entry.id} className="py-3 text-sm text-main">
        <div className="flex justify-between gap-2"><span>{entry.kind.replace(/_/g, ' ')}</span><span>{money(entry.amount)}</span></div>
        <p className="text-xs text-sec">{entry.reason} - {fmtDate(entry.created_at)}</p>
        {entry.expires_at && <p className="text-xs text-muted">Expires {fmtDate(entry.expires_at)}</p>}
      </li>)}</ul>
    </>}
  </div>;
}
