import { useState } from 'react';
import { Alert, Badge, Button } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { fetchOverview } from '@/admin/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shadcn/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select';
import { fmtDate, money, useLoad } from '@/components/operations/query-utils';
import { PageHeader } from '@/components/operations/shared';

const RANGES = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' } as const;
const PENDING_MODULES = ['Open disputes', 'Open support tickets', 'Active item requests', 'Active bidding sessions'];

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent>
        <p className="font-display text-2xl font-bold text-main tnum leading-tight">{value}</p>
        <p className="text-xs text-muted mt-1">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewSection() {
  const [days, setDays] = useState<keyof typeof RANGES>('30');
  const { data, loading, error, reload } = useLoad(() => {
    const to = new Date();
    return fetchOverview(new Date(to.getTime() - Number(days) * 86_400_000), to);
  }, [days]);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Period metrics use booking and payment creation dates; snapshot metrics are as of now."
        action={
          <Select value={days} onValueChange={(v) => setDays(v as keyof typeof RANGES)}>
            <SelectTrigger aria-label="Period" className="!h-10 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(RANGES).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        }
      />
      {error && <Alert tone="error" title="Could not load the overview"><p>{error}</p><Button size="sm" variant="secondary" className="mt-2" onClick={reload}>Try again</Button></Alert>}
      {loading && !data && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28 w-full" rounded="rounded-card-lg" />)}
        </div>
      )}
      {data && (
        <div className="space-y-6">
          <section aria-label="Marketplace" className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Metric label="Users" value={data.users_total.toLocaleString()} hint={`${data.users_new.toLocaleString()} joined in period`} />
            <Metric label="Published listings" value={data.listings_published.toLocaleString()} hint={`${data.listings_suspended} suspended`} />
            <Metric label="Gross rental (GMV excl. fees)" value={money(data.gross_rental)} hint="Paid bookings, excludes deposits" />
            <Metric label="Platform fees" value={money(data.platform_fees)} hint="Paid bookings in period" />
            <Metric label="Refunds" value={money(data.refunds)} hint="Full refunds plus verified deposit refunds" />
            <Metric label="Deposit liability" value={money(data.deposit_liability)} hint="Charged deposits not yet refunded (snapshot)" />
            <Metric label="Owner payables outstanding" value={money(data.payables_outstanding)} hint="Completed bookings without transfer or legacy payout (snapshot)" />
            <Metric label="GMV incl. fees" value={money(data.gross_rental + data.platform_fees)} hint="Rental + fees, deposits excluded" />
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Bookings by status</CardTitle><CardDescription>Created in the selected period</CardDescription></CardHeader>
              <CardContent>
                {Object.keys(data.bookings_by_status).length === 0
                  ? <p className="text-sm text-sec">No bookings in this period.</p>
                  : <ul className="divide-y divide-[var(--border)]">
                      {Object.entries(data.bookings_by_status).map(([s, n]) => (
                        <li key={s} className="flex items-center justify-between py-2 text-sm"><span className="capitalize text-main">{s.replace(/_/g, ' ')}</span><span className="tnum font-semibold">{n}</span></li>
                      ))}
                    </ul>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Recent administrative actions</CardTitle></CardHeader>
              <CardContent>
                {data.recent_actions.length === 0
                  ? <p className="text-sm text-sec">Nothing recorded yet.</p>
                  : <ul className="divide-y divide-[var(--border)]">
                      {data.recent_actions.map((a) => (
                        <li key={a.id} className="py-2 text-sm flex items-center justify-between gap-3">
                          <div className="min-w-0"><code className="text-xs">{a.action}</code><p className="text-xs text-muted truncate">{a.actor_email} · {fmtDate(a.created_at)}</p></div>
                          <Badge tone={a.outcome === 'success' ? 'success' : 'error'}>{a.outcome}</Badge>
                        </li>
                      ))}
                    </ul>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Awaiting their modules</CardTitle><CardDescription>These counters appear once the underlying feature exists — they are not reported as zero.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2">{PENDING_MODULES.map((m) => <Badge key={m}>{m}</Badge>)}</CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
