import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox, Search } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, SectionHeader } from '@/components/ui';
import { fieldClass, textareaClass } from '@/components/form-classes';
import { Skeleton } from '@/components/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/shadcn/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from '@/components/shadcn/alert-dialog';
import { PAGE_SIZE, type PagedQuery } from '@/components/operations/query-utils';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <SectionHeader as="h1" title={title} subtitle={subtitle} action={action} className="mb-5 [&_h1]:!text-2xl" />;
}

const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'success' | 'warning' | 'error'> = {
  published: 'success', confirmed: 'success', completed: 'success', succeeded: 'success', paid: 'success', active: 'success',
  requested: 'warning', pending_payment: 'warning', pending: 'warning', pending_approval: 'warning', return_pending: 'warning', draft: 'neutral',
  cancelled: 'neutral', rejected: 'error', failed: 'error', suspended: 'error', refunded: 'warning', archived: 'neutral',
  open: 'warning', investigating: 'accent', in_progress: 'accent', awaiting_evidence: 'warning',
  awaiting_user: 'warning', escalated: 'error', decided: 'accent', resolved: 'success', closed: 'neutral',
  awaiting_approval: 'warning', approved: 'accent', reconciliation_required: 'error',
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted">—</span>;
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Badge>;
}

export function SearchBox({ onChange, placeholder }: { onChange: (v: string) => void; placeholder: string }) {
  const [local, setLocal] = useState('');
  useEffect(() => {
    const t = setTimeout(() => onChange(local.trim()), 300);
    return () => clearTimeout(t);
  }, [local, onChange]);
  return (
    <div className="relative w-full sm:w-72">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        type="search" value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder}
        aria-label={placeholder} maxLength={100} className={fieldClass('pl-9 !h-10')}
      />
    </div>
  );
}

export interface Column<T> { header: string; cell: (row: T) => ReactNode; className?: string }

/** `all` is the sentinel for "no filter" because Radix Select does not accept an empty value. */
export function StatusFilter({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="!h-10 w-full sm:w-48"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All statuses</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o.replace(/_/g, ' ')}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function PagedTable<T>({ query, columns, rowKey, emptyTitle, emptyDescription }: {
  query: PagedQuery<T>; columns: Column<T>[]; rowKey: (row: T) => string; emptyTitle: string; emptyDescription?: string;
}) {
  const { data, loading, error, page, setPage, reload } = query;
  if (error) {
    return (
      <Alert tone="error" title="Could not load this list">
        <p>{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={reload}>Try again</Button>
      </Alert>
    );
  }
  if (!data && loading) {
    return <div className="space-y-2" aria-busy="true" aria-label="Loading">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (!data || data.rows.length === 0) {
    return <EmptyState icon={<Inbox size={20} />} title={emptyTitle} description={emptyDescription} />;
  }
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  return (
    <div className="bg-card border border-app rounded-card-lg overflow-hidden" aria-busy={loading}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => <TableHead key={c.header} className={c.className}>{c.header}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody className={loading ? 'opacity-60 transition-opacity duration-standard' : 'transition-opacity duration-standard'}>
          {data.rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((c) => <TableCell key={c.header} className={c.className}>{c.cell(row)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app px-3 py-2.5 text-[13px] text-sec">
        <span className="tnum">{data.total.toLocaleString()} total · page {page + 1} of {pages}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" icon={<ChevronLeft size={14} />} disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>Prev</Button>
          <Button size="sm" variant="secondary" trailingIcon={<ChevronRight size={14} />} disabled={page + 1 >= pages || loading} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

/** Irreversible or sensitive action: requires a recorded reason, which the server stores in the audit log. */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, danger = false, onConfirm, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; confirmLabel: string;
  danger?: boolean; onConfirm: (reason: string) => Promise<void>; children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 3;

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) { setReason(''); setError(null); }
    onOpenChange(next);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {children && <div className="mt-4 space-y-3">{children}</div>}
        <label htmlFor="admin-reason" className="block text-[13px] font-semibold text-main mt-4 mb-1.5">Reason (recorded in the audit log)</label>
        <textarea
          id="admin-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500}
          className={textareaClass()} aria-invalid={Boolean(error)} aria-describedby={error ? 'admin-reason-error' : undefined}
        />
        {error && <p id="admin-reason-error" role="alert" className="text-xs text-error mt-1.5">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>Cancel</Button></AlertDialogCancel>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!valid} loading={busy} onClick={() => void submit()}>{confirmLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
