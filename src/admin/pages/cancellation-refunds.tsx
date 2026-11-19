import { useCallback, useState } from 'react';
import { useAdminAccess } from '@/admin/api';
import { Alert, Button } from '@/main-site/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/main-site/components/shadcn/dialog';
import { fieldClass } from '@/main-site/components/form-classes';
import { OperationDialog, TextField } from '@/main-site/components/operations/operation-form';
import { fmtDate, money, useLoad, usePagedQuery } from '@/main-site/components/operations/query-utils';
import { PagedTable, ReasonDialog, SearchBox, StatusBadge, StatusFilter } from '@/main-site/components/operations/shared';
import {
  decideBookingCancellationRefund, getBookingCancellationAudit, listBookingCancellationPolicies,
  listBookingCancellations, saveBookingCancellationPolicy, type BookingCancellationCase,
  type BookingCancellationEvent,
} from '@/lib/operations';
import { processCancellationRefund } from '@/lib/bookings';

const REFUND_STATUSES = [
  'not_applicable', 'pending_policy_review', 'pending_review', 'approved',
  'processing', 'partially_refunded', 'refunded', 'failed', 'rejected',
];

function PolicyFlag({ name, label }: { name: string; label: string }) {
  return <label className="flex items-center gap-2 text-sm text-main">
    <input type="checkbox" name={name} className="accent-accent" /> {label}
  </label>;
}

function defaultLocalDateTime() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function CancellationRefundsSection() {
  const { access } = useAdminAccess();
  const canApprove = Boolean(access?.permissions.some((permission) =>
    ['refunds.approve', 'refunds.senior'].includes(permission)));
  const isSuperAdmin = access?.role === 'super_admin';
  const [refundStatus, setRefundStatus] = useState('all');
  const [initiatorRole, setInitiatorRole] = useState('all');
  const [bookingStatus, setBookingStatus] = useState('all');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const onReasonChange = useCallback((value: string) => setReason(value), []);
  const cases = usePagedQuery(
    (limit, offset) => listBookingCancellations({
      refundStatus, initiatorRole, bookingStatus, reason, from, to,
    }, limit, offset),
    [refundStatus, initiatorRole, bookingStatus, reason, from, to],
  );
  const policies = useLoad(listBookingCancellationPolicies, []);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ row: BookingCancellationCase; action: 'approve' | 'reject' } | null>(null);
  const [decisionAmount, setDecisionAmount] = useState('');
  const [override, setOverride] = useState(false);
  const [historyCase, setHistoryCase] = useState<BookingCancellationCase | null>(null);
  const [history, setHistory] = useState<BookingCancellationEvent[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function openHistory(row: BookingCancellationCase) {
    setHistoryCase(row);
    setHistory(null);
    setHistoryError(null);
    try { setHistory(await getBookingCancellationAudit(row.booking_id)); }
    catch (error) { setHistoryError(error instanceof Error ? error.message : 'Could not load cancellation history.'); }
  }

  async function saveDecision(reasonText: string) {
    if (!decision?.row.refund_case_id) return;
    const amount = decision.action === 'approve' ? Number(decisionAmount) : null;
    await decideBookingCancellationRefund(decision.row.refund_case_id, decision.action, amount, reasonText, override);
    cases.reload();
    if (decision.action === 'approve') {
      try {
        await processCancellationRefund(decision.row.refund_case_id);
        setNotice('Refund approved and submitted to the payment provider; final status awaits provider confirmation.');
      } catch {
        setNotice('Refund approval was saved, but provider processing could not be confirmed. The case is available for safe reconciliation.');
      }
    } else {
      setNotice('Refund rejected. No payment-provider refund was issued.');
    }
  }

  async function processApprovedCase(row: BookingCancellationCase) {
    if (!row.refund_case_id) return;
    setNotice(null);
    try {
      await processCancellationRefund(row.refund_case_id);
      setNotice('Refund request sent for safe provider reconciliation. Check the case status for the confirmed outcome.');
      cases.reload();
    } catch (error) {
      setNotice(error instanceof Error
        ? `Provider processing was not confirmed: ${error.message}`
        : 'Provider processing was not confirmed. The case remains available for safe reconciliation.');
    }
  }

  return <section className="space-y-4">
    <div>
      <h2 className="text-xl font-semibold text-main">Cancellations & refunds</h2>
      <p className="mt-1 text-sm text-sec">Booking cancellation and payment refunds are tracked independently. Refunds are complete only after Stripe confirms them.</p>
    </div>
    {notice && <Alert tone="success">{notice}</Alert>}
    <div className="flex flex-wrap items-end gap-3">
      <StatusFilter value={refundStatus} onChange={setRefundStatus} label="Filter by refund status" options={REFUND_STATUSES} />
      <label className="text-xs font-semibold text-sec">Cancellation initiator
        <select value={initiatorRole} onChange={(event) => setInitiatorRole(event.target.value)} className={fieldClass('mt-1')}>
          {['all', 'renter', 'owner', 'system'].map((value) => <option key={value} value={value}>{value === 'all' ? 'All initiators' : value}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold text-sec">Booking status
        <select value={bookingStatus} onChange={(event) => setBookingStatus(event.target.value)} className={fieldClass('mt-1')}>
          {['all', 'cancelled', 'confirmed', 'pending_payment', 'requested'].map((value) => <option key={value} value={value}>{value === 'all' ? 'All booking statuses' : value.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs font-semibold text-sec">From<input aria-label="From date" type="date" value={from}
          onChange={(event) => setFrom(event.target.value)} className={fieldClass('mt-1')} /></label>
        <label className="text-xs font-semibold text-sec">Through<input aria-label="Through date" type="date" value={to}
          onChange={(event) => setTo(event.target.value)} className={fieldClass('mt-1')} /></label>
      </div>
      <SearchBox onChange={onReasonChange} placeholder="Filter cancellation reason" />
    </div>
    <PagedTable query={cases} rowKey={(row) => row.cancellation_id} emptyTitle="No cancelled bookings match these filters"
      columns={[
        { header: 'Booking', cell: (row) => <div className="min-w-36"><strong>{row.booking_reference}</strong><p className="text-xs text-sec">{row.listing_title}</p><p className="text-xs text-sec">{row.booking_status}</p></div> },
        { header: 'Initiator / reason', cell: (row) => <div className="max-w-64"><StatusBadge status={row.initiator_role} /><p className="mt-1 text-xs">{row.reason}</p></div> },
        { header: 'Payment / refund', cell: (row) => <div className="min-w-36 text-xs">
          <p>Original: {money(row.original_payment_amount)} {row.currency?.toUpperCase()}</p>
          <p>Eligible: {money(row.eligible_amount)}</p>
          <p>Refund: {money(row.refund_amount)}</p>
          <p className="break-all">{row.payment_intent_id ?? row.stripe_checkout_session_id ?? row.payment_id ?? 'No captured payment'}</p>
        </div> },
        { header: 'Refund status', cell: (row) => <div><StatusBadge status={row.refund_status} />
          {row.provider_refund_id && <p className="mt-1 break-all text-xs text-sec">{row.provider_refund_id}</p>}</div> },
        { header: 'Cancelled', cell: (row) => fmtDate(row.cancellation_created_at) },
        { header: 'Actions', cell: (row) => <div className="flex min-w-40 flex-wrap gap-1">
          {canApprove && row.refund_case_id && ['pending_policy_review', 'pending_review', 'failed'].includes(row.refund_status ?? '')
            && <Button size="sm" onClick={() => {
              setDecision({ row, action: 'approve' });
              setDecisionAmount(row.eligible_amount && row.eligible_amount > 0 ? String(row.eligible_amount) : '');
              setOverride(false);
            }}>{row.refund_status === 'failed' ? 'Review / retry' : 'Review refund'}</Button>}
          {canApprove && row.refund_case_id && ['approved', 'processing'].includes(row.refund_status ?? '')
            && <Button size="sm" variant="secondary" onClick={() => void processApprovedCase(row)}>Process / reconcile</Button>}
          {row.refund_case_id && ['pending_policy_review', 'pending_review'].includes(row.refund_status ?? '')
            && canApprove && <Button size="sm" variant="ghost" onClick={() => setDecision({ row, action: 'reject' })}>Reject</Button>}
          <Button size="sm" variant="ghost" onClick={() => void openHistory(row)}>History</Button>
        </div> },
      ]} />

    {isSuperAdmin && <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app pt-4">
        <div><h3 className="text-lg font-semibold text-main">Cancellation policy</h3>
          <p className="text-sm text-sec">New versions are effective-dated and retained for historical cases.</p></div>
        <Button size="sm" onClick={() => setPolicyOpen(true)}>Schedule policy</Button>
      </div>
      {policies.error && <Alert tone="error">{policies.error}</Alert>}
      {policies.data?.length ? <div className="space-y-2">
        {policies.data.map((policy) => <div key={policy.id} className="rounded-card border border-app p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>Version {policy.version}</strong>
            <StatusBadge status={policy.automatic_processing ? 'approved' : 'pending_review'} /></div>
          <p className="mt-1 text-sec">Effective {fmtDate(policy.effective_from)}{policy.effective_to ? ` – ${fmtDate(policy.effective_to)}` : ' onward'}</p>
          <p className="text-sec">Renter: {policy.renter_rental_refund_percent}% rental refund, {policy.renter_cutoff_hours}h cutoff · Owner: {policy.owner_rental_refund_percent}% rental refund, {policy.owner_cutoff_hours}h cutoff</p>
        </div>)}
      </div> : !policies.loading && <Alert tone="warning">No cancellation policy is configured. Paid cancellations remain Pending Policy Review; no refund amount is estimated.</Alert>}
    </>}

    <OperationDialog open={policyOpen} onClose={() => setPolicyOpen(false)} title="Schedule cancellation policy"
      description="Policy versions cannot overlap. Refunds without an effective policy stay Pending Policy Review."
      onSave={async (form) => {
        await saveBookingCancellationPolicy(form);
        setPolicyNotice('Cancellation policy scheduled.');
        setPolicyOpen(false);
        policies.reload();
      }}>
      <TextField name="effective_from" label="Effective from" type="datetime-local" value={defaultLocalDateTime()} />
      <TextField name="effective_to" label="Effective until (optional)" type="datetime-local" required={false} />
      <fieldset className="space-y-3 rounded-card border border-app p-3">
        <legend className="px-1 font-semibold text-main">Renter cancellation</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="renter_cutoff_hours" label="Cutoff before pickup (hours)" type="number" min={0} step="0.5" />
          <TextField name="renter_rental_refund_percent" label="Rental subtotal refund (%)" type="number" min={0} max={100} step="0.01" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <PolicyFlag name="renter_refund_service_fee" label="Refund platform service fee" />
          <PolicyFlag name="renter_refund_delivery_fee" label="Refund delivery fee" />
          <PolicyFlag name="renter_refund_tax" label="Refund tax" />
          <PolicyFlag name="renter_refund_insurance" label="Refund insurance" />
          <PolicyFlag name="renter_refund_deposit" label="Refund captured security deposit" />
        </div>
      </fieldset>
      <fieldset className="space-y-3 rounded-card border border-app p-3">
        <legend className="px-1 font-semibold text-main">Owner cancellation</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="owner_cutoff_hours" label="Cutoff before pickup (hours)" type="number" min={0} step="0.5" />
          <TextField name="owner_rental_refund_percent" label="Rental subtotal refund (%)" type="number" min={0} max={100} step="0.01" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <PolicyFlag name="owner_refund_service_fee" label="Refund platform service fee" />
          <PolicyFlag name="owner_refund_delivery_fee" label="Refund delivery fee" />
          <PolicyFlag name="owner_refund_tax" label="Refund tax" />
          <PolicyFlag name="owner_refund_insurance" label="Refund insurance" />
          <PolicyFlag name="owner_refund_deposit" label="Refund captured security deposit" />
        </div>
      </fieldset>
      <PolicyFlag name="automatic_processing" label="Automatically process refunds that qualify under this policy" />
      <TextField name="reason" label="Policy version reason" maxLength={500} />
    </OperationDialog>
    {policyNotice && <Alert tone="success">{policyNotice}</Alert>}

    <ReasonDialog open={decision !== null} onOpenChange={(open) => {
      if (!open) { setDecision(null); setOverride(false); }
    }} title={decision?.action === 'reject' ? 'Reject cancellation refund' : 'Approve cancellation refund'}
      description={decision?.action === 'reject'
        ? 'This decision is audited and will not issue a payment-provider refund.'
        : 'Approval starts a real Stripe refund. The case is not complete until Stripe confirms the result.'}
      confirmLabel={decision?.action === 'reject' ? 'Reject refund' : decision?.row.refund_status === 'failed' ? 'Approve retry' : 'Approve refund'}
      danger={decision?.action === 'reject'}
      onConfirm={saveDecision}>
      {decision?.action === 'approve' && <>
        <label className="block text-sm font-semibold text-main">Refund amount (USD)
          <input name="refund-amount" type="number" min={0.01} max={decision.row.original_payment_amount ?? undefined}
            step="0.01" value={decisionAmount} onChange={(event) => setDecisionAmount(event.target.value)}
            className={fieldClass('mt-1 font-normal')} required />
        </label>
        {decision.row.policy_version === null && <Alert tone="warning">No policy was configured. A Senior Admin must authorize a policy override before this case can be approved.</Alert>}
        <label className="flex items-center gap-2 text-sm text-main">
          <input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} className="accent-accent" />
          Authorize policy override (Senior Admin only)
        </label>
        <label className="block text-xs text-sec">Amount not to exceed original payment: {money(decision.row.original_payment_amount)}</label>
      </>}
    </ReasonDialog>

    <Dialog open={historyCase !== null} onOpenChange={(open) => { if (!open) setHistoryCase(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancellation and refund history</DialogTitle>
          <DialogDescription>{historyCase?.booking_reference} · {historyCase?.listing_title}</DialogDescription>
        </DialogHeader>
        {historyError && <Alert tone="error">{historyError}</Alert>}
        {!history && !historyError && <p role="status" className="mt-4 text-sm text-sec">Loading history…</p>}
        {history && <ol className="mt-4 space-y-3">
          {history.map((event) => <li key={event.id} className="border-l-2 border-app pl-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm font-medium text-main">
              <span>{event.event_type.replace(/_/g, ' ')} · {event.actor_role}</span><time className="text-xs text-sec">{fmtDate(event.created_at)}</time>
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-sec">{JSON.stringify(event.details, null, 2)}</pre>
          </li>)}
        </ol>}
      </DialogContent>
    </Dialog>
  </section>;
}
