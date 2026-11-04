import { useState } from 'react';
import { ADMIN_PORTAL as staff } from '@/lib/admin-portal';
import { ArrowLeft, Paperclip, Plus } from 'lucide-react';
import { Alert, Badge, Button } from '@/main-site/components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/main-site/components/shadcn/card';
import { Skeleton } from '@/main-site/components/skeleton';
import { useRouter } from '@/router';
import {
  addCaseReply, CASE_CATEGORIES, CASE_STATUSES, createCase, formText, getCase, listCases, operationRpc,
  updateCase, uploadCaseEvidence, viewCaseEvidence,
  type CaseKind,
} from '@/lib/operations';
import { fmtDate, useLoad, usePagedQuery } from '@/main-site/components/operations/query-utils';
import { ChoiceField, LongField, OperationDialog, TextField } from '@/main-site/components/operations/operation-form';
import { PageHeader, PagedTable, SearchBox, StatusBadge, StatusFilter } from '@/main-site/components/operations/shared';

export function CasesSection({ kind, initialId }: { kind: CaseKind; initialId?: string }) {
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const { navigate } = useRouter();
  const selectCase = (id: string) => {
    if (staff) setSelected(id);
    else navigate(kind === 'dispute' ? { name: 'claim-detail', id } : { name: 'support', id });
  };
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const query = usePagedQuery((limit, offset) => listCases(kind, search, status, priority, staff, limit, offset), [kind, search, status, priority, staff]);
  const title = kind === 'dispute' ? 'Disputes & claims' : 'Support tickets';
  if (selected) return <CasePanel key={selected} id={selected} kind={kind} onBack={() => {
    if (!staff) navigate(kind === 'dispute' ? { name: 'claims' } : { name: 'support' });
    else { setSelected(null); query.reload(); }
  }} />;
  return (
    <>
      <PageHeader title={title} subtitle={staff ? 'Persistent cases, private evidence and recorded activity. Financial decisions do not move money.' : 'Get help with your bookings and keep track of replies.'}
        action={<Button size="sm" icon={<Plus size={15} />} onClick={() => setCreating(true)}>New {kind === 'dispute' ? 'claim' : 'ticket'}</Button>} />
      {kind === 'dispute' && <Alert className="mb-4" tone="warning">Filing deadline policy is unresolved. No automatic filing deadline is enforced. Payment questions belong in Support tickets.</Alert>}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <SearchBox onChange={setSearch} placeholder="Search subject or case reference" />
        <StatusFilter label="Case status" value={status} onChange={setStatus} options={[...CASE_STATUSES[kind]]} />
        <StatusFilter label="Case priority" value={priority} onChange={setPriority} options={['low', 'normal', 'high', 'urgent']} />
      </div>
      <PagedTable query={query} rowKey={(row) => row.id} emptyTitle={`No ${kind === 'dispute' ? 'claims' : 'tickets'} found`}
        columns={[
          { header: 'Case', cell: (row) => <Button variant="ghost" size="sm" onClick={() => selectCase(row.id)}>{row.subject}</Button> },
          { header: 'Category', cell: (row) => row.category.replace(/_/g, ' ') },
          { header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
          { header: 'Priority', cell: (row) => row.priority },
          { header: 'Updated', cell: (row) => fmtDate(row.updated_at) },
        ]} />
      <OperationDialog key={creating ? 'new' : 'closed'} open={creating} onClose={() => setCreating(false)} title={`New ${kind === 'dispute' ? 'claim' : 'support ticket'}`}
        description="Only authorized booking participants and staff can view this record."
        onSave={async (data) => { const created = await createCase(kind, data, staff); query.reload(); selectCase(created.id); }}>
        <TextField name="subject" label="Subject" maxLength={160} />
        <ChoiceField name="category" label="Category" options={CASE_CATEGORIES[kind]} />
        <TextField name="booking_id" label={`Booking ID${kind === 'support' ? ' (optional)' : ''}`} required={kind === 'dispute'} maxLength={36} />
        <LongField name="description" label="Describe the issue" />
        {staff && <>
          <TextField name="participant_id" label="Affected user ID" maxLength={36} />
          <LongField name="reason" label="Creation reason" maxLength={500} />
        </>}
      </OperationDialog>
    </>
  );
}

function CasePanel({ id, kind, onBack }: { id: string; kind: CaseKind; onBack: () => void }) {
  const { data, loading, error, reload } = useLoad(() => getCase(id), [id]);
  const [dialog, setDialog] = useState<'reply' | 'update' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exceptionKind, setExceptionKind] = useState<'pickup' | 'return'>('pickup');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionBusy, setExceptionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={onBack}>Back to queue</Button>
      {loading && <Skeleton className="h-48 w-full" />}
      {error && <Alert tone="error">{error}<Button variant="secondary" size="sm" onClick={reload}>Try again</Button></Alert>}
      {actionError && <Alert tone="error">{actionError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {data && <>
        <PageHeader title={data.case.subject} subtitle={`Case ${data.case.id}`} action={<StatusBadge status={data.case.status} />} />
        {data.deadline_policy_unresolved && <Alert tone="warning">Filing deadline policy remains unresolved. Booking dates below are not proof of pickup or return.</Alert>}
        <Card><CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2"><Badge>{data.case.category.replace(/_/g, ' ')}</Badge><Badge>{data.case.priority}</Badge></div>
          <p className="text-sm whitespace-pre-wrap text-main">{data.case.description}</p>
          <dl className="grid sm:grid-cols-2 gap-3 text-sm text-sec">
            <div><dt>Booking</dt><dd className="break-all">{data.case.booking_id ?? 'Not linked'}</dd></div>
            <div><dt>Assignee</dt><dd className="break-all">{data.case.assigned_to ?? 'Unassigned'}</dd></div>
            <div><dt>Created</dt><dd>{fmtDate(data.case.created_at)}</dd></div>
            <div><dt>Updated</dt><dd>{fmtDate(data.case.updated_at)}</dd></div>
            {data.booking && <>
              <div><dt>Booking dates</dt><dd>{fmtDate(data.booking.start_date)} - {fmtDate(data.booking.end_date)}</dd></div>
              <div><dt>Booking status</dt><dd>{data.booking.status}</dd></div>
              <div><dt>Booking created</dt><dd>{fmtDate(data.booking.created_at)}</dd></div>
              <div><dt>Booking last updated</dt><dd>{fmtDate(data.booking.updated_at)}</dd></div>
            </>}
            {data.case.proposed_amount != null && <div><dt>Proposed outcome (USD, not executed)</dt><dd>{data.case.proposed_amount.toFixed(2)}</dd></div>}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDialog('reply')}>Add reply{staff ? ' or note' : ''}</Button>
            {staff && <Button variant="secondary" size="sm" onClick={() => setDialog('update')}>Manage case</Button>}
          </div>
        </CardContent></Card>
        {staff && kind === 'support' && data.case.booking_id && !['resolved', 'closed'].includes(data.case.status) && (
          <Card><CardHeader><CardTitle>Record a handoff exception</CardTitle></CardHeader><CardContent className="space-y-3">
            <Alert tone="warning">Use only after reviewing this open support case. An exception bypasses OTP verification and is permanently recorded in the booking audit history.</Alert>
            <label className="block text-sm font-semibold text-main">Handoff
              <select value={exceptionKind} onChange={(event) => setExceptionKind(event.target.value === 'return' ? 'return' : 'pickup')}
                className="mt-1.5 h-11 w-full rounded-card border border-app bg-card px-3 text-sm font-normal text-main">
                <option value="pickup">Pickup</option><option value="return">Return</option>
              </select>
            </label>
            <label className="block text-sm font-semibold text-main">Support decision and reason
              <textarea required minLength={10} maxLength={1000} rows={3} value={exceptionReason}
                onChange={(event) => setExceptionReason(event.target.value)}
                className="mt-1.5 w-full rounded-card border border-app bg-card px-3 py-2 text-sm font-normal text-main" />
            </label>
            <Button size="sm" loading={exceptionBusy} disabled={exceptionReason.trim().length < 10} onClick={async () => {
              setExceptionBusy(true); setActionError(null); setNotice(null);
              try {
                await operationRpc('support_complete_booking_handoff_exception', {
                  p_booking_id: data.case.booking_id, p_kind: exceptionKind, p_reason: exceptionReason,
                });
                setExceptionReason('');
                setNotice('Support exception recorded and the booking updated.');
                reload();
              } catch (reason) {
                setActionError(reason instanceof Error ? reason.message : 'The handoff exception could not be recorded.');
              } finally {
                setExceptionBusy(false);
              }
            }}>Record support exception</Button>
          </CardContent></Card>
        )}
        <Card><CardHeader><CardTitle>Replies and notes</CardTitle></CardHeader><CardContent className="space-y-3">
          {data.messages.length === 0 && <p className="text-sm text-sec">No replies yet.</p>}
          {data.messages.map((message) => <article key={message.id} className="rounded-card border border-app p-3">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>{message.internal ? 'Staff-only note' : 'Participant-visible reply'}</span><time>{fmtDate(message.created_at)}</time></div>
            <p className="text-sm text-main whitespace-pre-wrap mt-2">{message.body}</p>
          </article>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Private evidence</CardTitle></CardHeader><CardContent className="space-y-3">
          <p className="text-xs text-sec">JPEG, PNG, WebP or PDF, up to 10 MB. Evidence is never stored in a public bucket.</p>
          <label className="block text-sm font-semibold text-main">{uploading ? 'Uploading evidence...' : 'Upload evidence'}
            <input type="file" disabled={uploading} accept="image/jpeg,image/png,image/webp,application/pdf" className="block mt-2 max-w-full text-sm" onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              setUploading(true); setActionError(null); setNotice(null);
              try { await uploadCaseEvidence(id, file); setNotice('Evidence uploaded.'); reload(); }
              catch (e) { setActionError(e instanceof Error ? e.message : 'Evidence upload failed.'); }
              finally { setUploading(false); }
            }} />
          </label>
          {data.evidence.map((evidence) => <Button key={evidence.id} size="sm" variant="secondary" icon={<Paperclip size={14} />} onClick={async () => {
            setActionError(null);
            try { const url = await viewCaseEvidence(evidence); window.open(url, '_blank', 'noopener,noreferrer'); }
            catch (e) { setActionError(e instanceof Error ? e.message : 'Evidence could not be opened.'); }
          }}>{evidence.file_name}</Button>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Activity history</CardTitle></CardHeader><CardContent>
          <ul className="space-y-3">{data.events.map((event) => <li key={event.id} className="text-sm text-sec"><span className="font-semibold text-main">{event.action.replace(/_/g, ' ')}</span> - {fmtDate(event.created_at)}{event.reason && <p className="whitespace-pre-wrap">{event.reason}</p>}</li>)}</ul>
        </CardContent></Card>
        <OperationDialog key={dialog ?? 'closed'} open={dialog !== null} onClose={() => setDialog(null)}
          title={staff && dialog === 'update' ? 'Manage case' : 'Add reply'}
          description={staff && dialog === 'update' ? 'Changes require a reason and are recorded. A proposed monetary outcome does not execute a refund.' : 'Replies are visible to authorized participants and staff.'}
          onSave={async (form) => {
            if (staff && dialog === 'update') await updateCase(id, form);
            else await addCaseReply(id, formText(form, 'body'), staff && formText(form, 'visibility') === 'internal');
            setNotice('Case saved.'); reload();
          }}>
          {staff && dialog === 'update' ? <>
            <ChoiceField name="status" label="Status" options={CASE_STATUSES[kind]} value={data.case.status} />
            <ChoiceField name="priority" label="Priority" options={['low', 'normal', 'high', 'urgent']} value={data.case.priority} />
            <TextField name="assigned_to" label="Administrator user ID (blank to unassign)" required={false} value={data.case.assigned_to ?? ''} maxLength={36} />
            <LongField name="reason" label="Reason / decision" maxLength={2000} />
            {kind === 'dispute' && <TextField name="proposed_amount" label="Proposed monetary amount, USD (not executed)" type="number" min={0} step="0.01" required={false} />}
          </> : <>
            {staff && <ChoiceField name="visibility" label="Visibility" options={['public', 'internal']} />}
            <LongField name="body" label="Message" />
          </>}
        </OperationDialog>
      </>}
    </div>
  );
}
