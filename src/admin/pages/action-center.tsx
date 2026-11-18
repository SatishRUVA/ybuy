import { Alert, Badge, Button, EmptyState } from '@/main-site/components/ui';
import { Skeleton } from '@/main-site/components/skeleton';
import { listCheckoutExceptions, listListings, type AdminAccess } from '@/admin/api';
import { listCases, listRefundRequests, type CaseKind } from '@/lib/operations';
import { fmtDate, useLoad } from '@/main-site/components/operations/query-utils';
import { PageHeader } from '@/main-site/components/operations/shared';
import { Inbox } from 'lucide-react';

interface ActionItem {
  id: string;
  section: string;
  type: string;
  title: string;
  detail: string;
  status: string;
  priority: string;
  createdAt: string;
  assignee: string | null;
  nextAction: string;
}

interface ActionFeed {
  label: string;
  items: ActionItem[];
  error: string | null;
}

async function loadCases(kind: CaseKind, statuses: string[], section: string): Promise<ActionItem[]> {
  const feeds = await Promise.all(statuses.map((status) => listCases(kind, '', status, 'all', true, 8, 0)));
  return feeds.flatMap(({ rows }) => rows.map((item) => ({
    id: item.id,
    section,
    type: kind === 'dispute' ? 'Dispute' : 'Support',
    title: item.subject,
    detail: `Case ${item.id}`,
    status: item.status,
    priority: item.priority,
    createdAt: item.created_at,
    assignee: item.assigned_to,
    nextAction: kind === 'dispute' ? 'Review case and record a human decision' : 'Review and respond to the customer',
  })));
}

async function loadFeeds(access: AdminAccess): Promise<ActionFeed[]> {
  const permissions = access.permissions;
  const tasks: Promise<ActionFeed>[] = [];
  const addFeed = (label: string, load: () => Promise<ActionItem[]>) => {
    tasks.push(load().then((items) => ({ label, items, error: null }))
      .catch((error: unknown) => ({
        label, items: [], error: error instanceof Error ? error.message : 'Queue could not be loaded.',
      })));
  };

  if (permissions.includes('listings.moderate')) {
    addFeed('Listing moderation', async () => {
      const { rows } = await listListings({ status: 'pending_approval', limit: 20, offset: 0 });
      return rows.map((item) => ({
        id: item.id, section: 'listings', type: 'Listing', title: item.title,
        detail: `Owner: ${item.owner_name}`, status: item.status, priority: 'normal',
        createdAt: item.created_at, assignee: null, nextAction: 'Review publication',
      }));
    });
  }
  if (permissions.includes('disputes.manage')) {
    addFeed('Disputes', () => loadCases('dispute', ['open', 'investigating', 'awaiting_evidence', 'escalated'], 'disputes'));
  }
  if (permissions.includes('support.manage')) {
    addFeed('Support', () => loadCases('support', ['open', 'in_progress', 'awaiting_user'], 'support'));
  }
  if (permissions.includes('payments.view')) {
    addFeed('Checkout exceptions', async () => {
      const { rows } = await listCheckoutExceptions(20, 0);
      return rows.map((item) => ({
        id: item.id, section: 'payments', type: 'Payment exception',
        title: item.reason.replace(/_/g, ' '), detail: `Booking ${item.booking_id}`,
        status: item.status, priority: 'normal', createdAt: item.created_at,
        assignee: null, nextAction: 'Investigate the payment and booking state',
      }));
    });
  }
  if (permissions.some((permission) => ['refunds.issue', 'refunds.approve', 'refunds.senior'].includes(permission))) {
    addFeed('Manual refund requests', async () => {
      const { rows } = await listRefundRequests(20, 0);
      return rows.filter((item) => item.status === 'requested').map((item) => ({
        id: item.id, section: 'refunds', type: 'Refund request',
        title: item.reason, detail: `Payment ${item.payment_id}`,
        status: item.status, priority: 'normal', createdAt: item.created_at,
        assignee: null, nextAction: 'Review authorization; execution remains disabled',
      }));
    });
  }

  return Promise.all(tasks);
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function ageDays(createdAt: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
}

export function ActionCenter({ access, onSelect }: { access: AdminAccess; onSelect: (section: string) => void }) {
  const { data, loading, error, reload } = useLoad(() => loadFeeds(access), [access]);
  const items = (data ?? []).flatMap((feed) => feed.items)
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
      || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const hasFailedFeed = data?.some((feed) => feed.error);

  return <>
    <PageHeader title="Action Center" subtitle="Recent records requiring review across queues you are authorized to access." />
    {error && <Alert tone="error" title="Could not load action queues">{error}<Button size="sm" variant="secondary" className="mt-2" onClick={reload}>Try again</Button></Alert>}
    {loading && !data && <div className="space-y-2" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
    {data?.filter((feed) => feed.error).map((feed) => (
      <Alert key={feed.label} tone="error" title={`${feed.label} unavailable`} className="mb-3">{feed.error}</Alert>
    ))}
    {data && items.length > 0 && <div className="overflow-hidden rounded-card-lg border border-app bg-card">
      <ul className="divide-y divide-[var(--border)]">
        {items.map((item) => (
          <li key={`${item.type}:${item.id}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={item.priority === 'urgent' || item.priority === 'high' ? 'error' : 'neutral'}>{item.priority}</Badge>
                <Badge>{item.type}</Badge>
                <span className="text-xs text-muted">{item.status.replace(/_/g, ' ')}</span>
              </div>
              <p className="mt-1 truncate text-sm font-semibold text-main">{item.title}</p>
              <p className="truncate text-xs text-sec">{item.detail} · {item.assignee ? 'Assigned' : 'Unassigned'}</p>
              <p className="mt-1 text-xs text-muted">{item.nextAction} · Created {fmtDate(item.createdAt)} · Age {ageDays(item.createdAt)}d</p>
            </div>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => onSelect(item.section)}>Open queue</Button>
          </li>
        ))}
      </ul>
      {hasFailedFeed && <p className="border-t border-app px-4 py-3 text-xs text-muted">Some queues could not be included. Retry them in their section before considering the queue complete.</p>}
    </div>}
    {data && items.length === 0 && !hasFailedFeed && <EmptyState icon={<Inbox size={20} />} title="No open actions"
      description="There are no actionable records in the queues available to your administrator account." />}
    <p className="mt-3 text-xs text-muted">Aging is shown from record creation time. Shared due dates are not shown because no common SLA policy is configured.</p>
  </>;
}
