import { useState } from 'react';
import { Alert, Badge, Button } from '@/main-site/components/ui';
import { listAdminItemRequests, moderateItemRequest, type AdminItemRequest } from '@/lib/marketplace';
import { fmtDate, fmtDay, usePagedQuery } from '@/main-site/components/operations/query-utils';
import { PageHeader, PagedTable, ReasonDialog, SearchBox, StatusBadge, StatusFilter } from '@/main-site/components/operations/shared';

export function ItemRequestsSection() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [target, setTarget] = useState<AdminItemRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = usePagedQuery((limit, offset) => listAdminItemRequests({ search, status, limit, offset }), [search, status]);

  return <>
    <PageHeader title="Item requests" subtitle="Review active renter requests. Closing a request cancels pending offers and records an audit reason." />
    <div className="flex flex-col sm:flex-row gap-2 mb-4">
      <SearchBox onChange={setSearch} placeholder="Search item or location" />
      <StatusFilter label="Filter by status" value={status} onChange={setStatus} options={['open', 'responses_received', 'negotiating']} />
    </div>
    {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
    <PagedTable query={query} rowKey={(row) => row.id} emptyTitle="No active requests found"
      emptyDescription="No active renter requests match the current search and status filters."
      columns={[
        { header: 'Request', cell: (row) => <div className="min-w-[220px] max-w-[360px]">
          <span className="font-medium">{row.title}</span>
          <span className="block text-xs text-muted">{row.categories?.name ?? 'Uncategorized'} · {row.location_label}</span>
          <span className="mt-1 block text-xs text-sec line-clamp-3">{row.description}</span>
        </div> },
        { header: 'Dates', cell: (row) => <span className="whitespace-nowrap">{fmtDay(row.preferred_start_date)} → {fmtDay(row.preferred_end_date)}</span> },
        { header: 'Status', cell: (row) => <div className="space-y-1"><StatusBadge status={row.status} /><Badge tone="neutral">expires {fmtDate(row.expires_at)}</Badge></div> },
        { header: 'Created', cell: (row) => fmtDate(row.created_at) },
        { header: '', className: 'text-right', cell: (row) => <Button size="sm" variant="danger" onClick={() => setTarget(row)}>Close request</Button> },
      ]} />
    <ReasonDialog
      open={target !== null}
      onOpenChange={(open) => { if (!open) setTarget(null); }}
      title={`Close "${target?.title ?? 'item request'}"?`}
      description="The request will no longer be visible to owners. Existing bookings remain unchanged."
      confirmLabel="Close request"
      danger
      onConfirm={async (reason) => {
        await moderateItemRequest(target!.id, reason);
        setNotice('Item request closed and moderation reason recorded.');
        query.reload();
      }}
    />
  </>;
}
