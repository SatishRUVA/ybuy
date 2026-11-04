import { useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { useAuth } from '@/auth-context';
import { useAdminAccess } from '@/admin/api';
import { approveRefund, listRefundEvents, listRefundRequests, requestRefund } from '@/lib/operations';
import { fmtDate, money, usePagedQuery } from '@/components/operations/query-utils';
import { LongField, OperationDialog, TextField } from '@/components/operations/operation-form';
import { PageHeader, PagedTable, ReasonDialog, StatusBadge } from '@/components/operations/shared';

export function RefundsSection() {
  const { user } = useAuth();
  const { access } = useAdminAccess();
  const query = usePagedQuery(listRefundRequests, []);
  const events = usePagedQuery(listRefundEvents, []);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canIssue = access?.permissions.includes('refunds.issue');
  const canApprove = canIssue || access?.permissions.includes('refunds.approve') || access?.permissions.includes('refunds.senior');
  return <div className="space-y-4">
    <PageHeader title="Manual refund requests & reconciliation" subtitle="Cancellation and claim refunds remain disabled pending policy. Automatic return-deposit refunds are shown under Payouts."
      action={canIssue ? <Button size="sm" onClick={() => setRequestKey(crypto.randomUUID())}>Request refund</Button> : undefined} />
    <Alert tone="warning">These manual requests do not move funds. Test approval defaults: up to $250 single authorization, over $250 second approval, over $1,000 senior approval. Approval never means provider completion.</Alert>
    {notice && <Alert tone="success">{notice}</Alert>}
    <PagedTable query={query} rowKey={(row) => row.id} emptyTitle="No refund requests" columns={[
      { header: 'Payment / request', cell: (row) => <div className="break-all text-xs">{row.payment_id}<p>{row.id}</p></div> },
      { header: 'Amount', cell: (row) => `${money(row.amount)} ${row.currency.toUpperCase()}` },
      { header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
      { header: 'Reason', cell: (row) => row.reason },
      { header: 'Created', cell: (row) => fmtDate(row.created_at) },
      { header: 'Actions', cell: (row) => canApprove && row.requested_by !== user?.id && row.status === 'requested' ? <Button size="sm" onClick={() => setApprovalId(row.id)}>Review and approve</Button> : 'Execution disabled' },
    ]} />
    <h2 className="text-lg font-semibold text-main">Provider receipts & reconciliation exceptions</h2>
    <PagedTable query={events} rowKey={(row) => row.event_id} emptyTitle="No refund provider receipts" columns={[
      { header: 'Provider reference', cell: (row) => row.provider_ref },
      { header: 'Amount', cell: (row) => `${money(row.amount)} ${row.currency.toUpperCase()}` },
      { header: 'Provider status', cell: (row) => <StatusBadge status={row.status} /> },
      { header: 'Reconciliation', cell: (row) => <div>{row.processing_status}<p className="text-xs">{row.exception_reason}</p></div> },
      { header: 'Received', cell: (row) => fmtDate(row.created_at) },
    ]} />
    <OperationDialog key={requestKey ?? 'closed'} open={requestKey !== null} onClose={() => setRequestKey(null)} title="Request a refund"
      description="The server validates captured balance and cumulative requests. Refund execution is disabled."
      onSave={async (data) => { if (!requestKey) return; await requestRefund(data, requestKey); setNotice('Refund request recorded; no money moved.'); query.reload(); }}>
      <TextField name="payment_id" label="Original payment ID" maxLength={36} />
      <TextField name="amount" label="Requested refund (USD)" type="number" min={0.01} step="0.01" />
      <LongField name="reason" label="Reason" maxLength={500} />
    </OperationDialog>
    <ReasonDialog open={approvalId !== null} onOpenChange={(open) => { if (!open) setApprovalId(null); }} title="Approve refund request"
      description="This records your independent approval only. Execution remains disabled; the payment will not be marked refunded." confirmLabel="Record approval"
      onConfirm={async (reason) => { if (!approvalId) return; await approveRefund(approvalId, reason); setNotice('Approval recorded; no money moved.'); query.reload(); }} />
  </div>;
}
