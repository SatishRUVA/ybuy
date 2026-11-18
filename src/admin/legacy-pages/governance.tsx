import { useState } from 'react';
import { Pencil, Plus, RefreshCw } from 'lucide-react';
import { Alert, Badge, Button } from '@/components/ui';
import { fieldClass } from '@/components/form-classes';
import { Skeleton } from '@/components/skeleton';
import {
  fetchSystemHealth, listAdmins, listAudit, upsertAdmin,
  type AdminPermission, type AdminUserAccess, type AuditRow,
} from '@/admin/api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/shadcn/dialog';
import { Switch } from '@/components/shadcn/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card';
import { fmtDate, useLoad, usePagedQuery } from '@/components/operations/query-utils';
import { PageHeader, PagedTable, StatusFilter } from '@/components/operations/shared';

const PERMISSION_LABELS: Record<string, string> = {
  'analytics.view': 'Overview and analytics',
  'users.manage': 'Users (restrict / reinstate)',
  'fraud.investigate': 'Private Customer ID investigations',
  'listings.moderate': 'Listings (suspend / reinstate)',
  'bookings.view': 'Bookings (read)',
  'payments.view': 'Payments (read)',
  'payouts.view': 'Payouts (read)',
  'reviews.moderate': 'Reviews (remove)',
  'categories.manage': 'Categories',
  'audit.view': 'Audit log (read)',
  'integrations.view': 'Integrations and system health',
  'disputes.manage': 'Disputes and claims',
  'support.manage': 'Support tickets',
  'promotions.manage': 'Platform-funded promotions (test only)',
  'credits.manage': 'Wallet grants (test only)',
  'refunds.issue': 'Refund requests (execution disabled)',
  'refunds.approve': 'Refund second approval',
  'refunds.senior': 'High-value refund senior approval',
};
const GRANTABLE = Object.keys(PERMISSION_LABELS) as AdminPermission[];
const PRESETS: { label: string; permissions: AdminPermission[] }[] = [
  { label: 'Operations', permissions: ['analytics.view', 'users.manage', 'listings.moderate', 'bookings.view', 'reviews.moderate'] },
  { label: 'Support', permissions: ['bookings.view', 'support.manage'] },
  { label: 'Disputes', permissions: ['bookings.view', 'disputes.manage'] },
  { label: 'Finance', permissions: ['payments.view', 'payouts.view', 'refunds.issue'] },
];

interface AdminDraft { email: string; role: 'admin' | 'super_admin'; permissions: AdminPermission[]; active: boolean; existing: boolean }

export function AdminsSection() {
  const { data, loading, error, reload } = useLoad(listAdmins);
  const [draft, setDraft] = useState<AdminDraft | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(a: AdminUserAccess | null) {
    setDraft(a
      ? { email: a.email, role: a.role, permissions: a.permissions, active: a.active, existing: true }
      : { email: '', role: 'admin', permissions: [], active: true, existing: false });
    setReason('');
    setFormError(null);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setFormError(null);
    try {
      await upsertAdmin({ email: draft.email, role: draft.role, permissions: draft.permissions, active: draft.active }, reason);
      setNotice('Administrator access saved.');
      setDraft(null);
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (p: AdminPermission) => setDraft((d) => d && ({
    ...d, permissions: d.permissions.includes(p) ? d.permissions.filter((x) => x !== p) : [...d.permissions, p],
  }));

  return (
    <>
      <PageHeader title="Administrators" subtitle="Grant or revoke access. The person must have an existing YBuy account. You cannot change your own access." action={<Button size="sm" icon={<Plus size={14} />} onClick={() => open(null)}>Add administrator</Button>} />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      {error && <Alert tone="error" title="Could not load administrators"><p>{error}</p><Button size="sm" variant="secondary" className="mt-2" onClick={reload}>Try again</Button></Alert>}
      {loading && <div className="space-y-2" aria-busy="true" aria-label="Loading">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
      {data && (
        <ul className="bg-card border border-app rounded-card-lg divide-y divide-[var(--border)]">
          {data.map((a) => (
            <li key={a.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-main [overflow-wrap:anywhere]">{a.full_name}</p>
                <p className="text-xs text-muted [overflow-wrap:anywhere]">{a.email}</p>
                <p className="text-xs text-sec mt-1">{a.role === 'super_admin' ? 'All permissions' : a.permissions.length ? a.permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(' · ') : 'No permissions granted'}</p>
              </div>
              <Badge tone={a.role === 'super_admin' ? 'accent' : 'neutral'}>{a.role.replace('_', ' ')}</Badge>
              <Badge tone={a.active ? 'success' : 'neutral'}>{a.active ? 'active' : 'deactivated'}</Badge>
              <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => open(a)} aria-label={`Edit ${a.full_name}`}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={draft !== null} onOpenChange={(o) => { if (!o && !busy) setDraft(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.existing ? 'Edit administrator' : 'Add administrator'}</DialogTitle>
            <DialogDescription>Super admins hold every permission, including settings, flags and administrator management.</DialogDescription>
          </DialogHeader>
          {draft && (
            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label className="block text-[13px] font-semibold text-main">Account email
                <input type="email" className={fieldClass('mt-1.5 font-normal')} value={draft.email} readOnly={draft.existing} required maxLength={254} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </label>
              <label className="block text-[13px] font-semibold text-main">Role
                <select className={fieldClass('mt-1.5 font-normal')} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as AdminDraft['role'] })}>
                  <option value="admin">Admin (selected permissions)</option>
                  <option value="super_admin">Super admin (everything)</option>
                </select>
              </label>
              {draft.role === 'admin' && (
                <fieldset className="space-y-1.5">
                  <legend className="text-[13px] font-semibold text-main mb-1">Permissions</legend>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {PRESETS.map((preset) => <Button key={preset.label} type="button" size="sm" variant="secondary" onClick={() => setDraft({ ...draft, permissions: preset.permissions })}>{preset.label} preset</Button>)}
                  </div>
                  {GRANTABLE.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm text-main">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={draft.permissions.includes(p)} onChange={() => toggle(p)} />
                      {PERMISSION_LABELS[p]}
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="flex items-center justify-between text-[13px] font-semibold text-main">Active
                <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} aria-label="Active" />
              </label>
              <label className="block text-[13px] font-semibold text-main">Reason (recorded in the audit log)
                <input className={fieldClass('mt-1.5 font-normal')} value={reason} maxLength={500} required minLength={3} onChange={(e) => setReason(e.target.value)} />
              </label>
              {formError && <p role="alert" className="text-xs text-error">{formError}</p>}
              <DialogFooter>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
                <Button type="submit" loading={busy} disabled={reason.trim().length < 3 || draft.email.trim().length < 3}>Save access</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

const ENTITY_TYPES = ['user', 'listing', 'review', 'category', 'setting', 'feature_flag', 'admin_user'];

export function AuditSection() {
  const [entity, setEntity] = useState('all');
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const query = usePagedQuery((limit, offset) => listAudit({ entityType: entity === 'all' ? undefined : entity, limit, offset }), [entity]);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of every administrative action: who, what, when, previous and new values, reason and outcome." />
      <div className="mb-4"><StatusFilter label="Filter by entity" value={entity} onChange={setEntity} options={ENTITY_TYPES} /></div>
      <PagedTable
        query={query} rowKey={(r) => r.id} emptyTitle="No administrative actions yet" emptyDescription="Actions appear here as soon as an administrator makes a change."
        columns={[
          { header: 'When', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.created_at)}</span> },
          { header: 'Actor', cell: (r) => r.actor_email ?? '—' },
          { header: 'Action', cell: (r) => <code className="text-xs">{r.action}</code> },
          { header: 'Entity', cell: (r) => <span className="text-sec">{r.entity_type}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ''}</span> },
          { header: 'Outcome', cell: (r) => <Badge tone={r.outcome === 'success' ? 'success' : 'error'}>{r.outcome}</Badge> },
          { header: '', className: 'text-right', cell: (r) => <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>Details</Button> },
        ]}
      />
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.action}</DialogTitle>
            <DialogDescription>{detail ? `${detail.actor_email ?? 'unknown'} · ${fmtDate(detail.created_at)} · ${detail.outcome}` : ''}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="mt-4 space-y-3 text-sm">
              <p><span className="font-semibold text-main">Reason: </span>{detail.reason ?? '—'}</p>
              {(['old_value', 'new_value'] as const).map((k) => (
                <div key={k}>
                  <p className="font-semibold text-main mb-1">{k === 'old_value' ? 'Previous value' : 'New value'}</p>
                  <pre className="bg-subtle rounded-card p-3 text-xs overflow-x-auto">{JSON.stringify(detail[k] ?? null, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function IntegrationsSection() {
  const { data, loading, error, reload } = useLoad(fetchSystemHealth);
  return (
    <>
      <PageHeader title="Integrations and system health" subtitle="Credential status only. Secret values are never readable from the app." action={<Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} loading={loading} onClick={reload}>Re-check</Button>} />
      {error && <Alert tone="error" title="Could not check system health"><p>{error}</p></Alert>}
      {loading && !data && <Skeleton className="h-40 w-full" rounded="rounded-card-lg" />}
      {data && (
        <Card>
          <CardHeader><CardTitle>Checked {fmtDate(data.checked_at)}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--border)]">
              <li className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-main font-medium">Database</span>
                <Badge tone={data.database.ok ? 'success' : 'error'}>{data.database.ok ? `reachable · ${data.database.latency_ms} ms` : 'unreachable'}</Badge>
              </li>
              {data.integrations.map((i) => (
                <li key={i.name} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-main font-medium">{i.name}</span>
                  <Badge tone={i.configured ? 'success' : 'warning'}>{i.configured ? 'configured' : 'not configured'}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
