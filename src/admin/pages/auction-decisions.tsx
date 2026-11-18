import { useState } from 'react';
import { listAuctionDecisions } from '@/admin/api';
import { Button } from '@/main-site/components/ui';
import { fmtDate, usePagedQuery } from '@/main-site/components/operations/query-utils';
import { PageHeader, PagedTable, SearchBox } from '@/main-site/components/operations/shared';

export function AuctionDecisionsSection({ ownerId }: { ownerId?: string }) {
  const [search, setSearch] = useState('');
  const query = usePagedQuery((limit, offset) => listAuctionDecisions(limit, offset, { search, ownerId }), [search, ownerId]);
  return <div className="space-y-4">
    <PageHeader title="Missed bidding decisions"
      subtitle="Private audit records for auctions that closed without an owner decision. Review stars are unchanged."
      action={<Button size="sm" variant="secondary" disabled={query.loading} onClick={query.reload}>Refresh decisions</Button>} />
    <SearchBox onChange={setSearch} placeholder="Owner, email, Customer ID or listing" />
    <PagedTable query={query} rowKey={row => row.id}
      emptyTitle="No missed bidding decisions"
      emptyDescription={search ? 'No records match this search.' : 'No recorded owner nondecisions in this environment. Localhost and hosted test data are separate.'}
      columns={[
        { header: 'Owner', cell: row => <div><p className="font-semibold">{row.owner_name}</p><p className="text-xs text-sec">{row.customer_id}</p><p className="break-all text-xs text-sec">{row.owner_id}</p></div> },
        { header: 'Listing', cell: row => <div><p>{row.listing_title}</p><p className="break-all text-xs text-sec">{row.listing_id}</p></div> },
        { header: 'Bidding closed', cell: row => fmtDate(row.deadline_at) },
        { header: 'Recorded', cell: row => fmtDate(row.detected_at) },
        { header: 'Eligible bids', cell: row => row.eligible_bid_count },
        { header: 'Owner missed decisions', cell: row => row.owner_missed_decision_count },
        { header: 'Audit status', cell: row => row.rating_eligible ? 'Recorded' : <div>Excluded<p className="text-xs text-sec">{row.exclusion_detail ?? row.exclusion_reason}</p></div> },
      ]} />
  </div>;
}
