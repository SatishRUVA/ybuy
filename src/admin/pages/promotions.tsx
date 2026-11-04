import { WalletPanel } from '@/main-site/components/operations/wallet';
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Alert, Badge, Button } from '@/main-site/components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/main-site/components/shadcn/card';
import { grantCredits, listPromotions, listPromotionRedemptions, savePromotion, formText, type Promotion } from '@/lib/operations';
import { useAdminAccess } from '@/admin/api';
import { fmtDate, money, usePagedQuery } from '@/main-site/components/operations/query-utils';
import { ChoiceField, LongField, OperationDialog, TextField } from '@/main-site/components/operations/operation-form';
import { PageHeader, PagedTable } from '@/main-site/components/operations/shared';

function localTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function PromotionsSection() {
  const { access } = useAdminAccess();
  const [editing, setEditing] = useState<Promotion | null | undefined>(undefined);
  const [grant, setGrant] = useState<string | null>(null);
  const [walletUser, setWalletUser] = useState('');
  const [walletVersion, setWalletVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const canPromote = access?.permissions.includes('promotions.manage') ?? false;
  const canCredit = access?.permissions.includes('credits.manage') ?? false;
  const promos = usePagedQuery((limit, offset) => canPromote ? listPromotions(limit, offset) : Promise.resolve({ total: 0, rows: [] }), [canPromote]);
  return (
    <div className="space-y-5">
      <PageHeader title="Promotions & rewards" subtitle="Platform-funded campaigns and test-only wallet credits. Production activation and reward stacking are disabled."
        action={canPromote ? <Button size="sm" icon={<Plus size={15} />} onClick={() => setEditing(null)}>New campaign</Button> : undefined} />
      <Alert tone="warning">Test financial foundations only. These campaigns do not alter the existing live checkout. Fees and deposits are excluded. Cash refunds and credit restoration are disabled pending allocation policy.</Alert>
      {notice && <Alert tone="success">{notice}</Alert>}
      {canPromote && <>
        <PagedTable query={promos} rowKey={(row) => row.id} emptyTitle="No campaigns yet" columns={[
          { header: 'Campaign', cell: (promo) => <div><p className="font-semibold">{promo.name}</p><p className="font-mono text-xs">{promo.code}</p></div> },
          { header: 'Discount', cell: (promo) => <div><p>{promo.discount_type === 'percentage' ? `${promo.value}%` : money(promo.value)} off rental subtotal</p><p className="text-xs">Minimum {money(promo.min_spend)}; cap {promo.max_discount == null ? 'none' : money(promo.max_discount)}</p></div> },
          { header: 'Schedule', cell: (promo) => `${fmtDate(promo.starts_at)} - ${fmtDate(promo.ends_at)}` },
          { header: 'Status', cell: (promo) => <Badge tone={promo.active ? 'success' : 'neutral'}>{promo.active ? 'active (test only)' : 'inactive'}</Badge> },
          { header: 'Performance', cell: (promo) => <div>{promo.redemptions} / {promo.usage_limit ?? 'unlimited'} redemptions<p>{money(promo.discount_total)} total discounts</p></div> },
          { header: 'Actions', cell: (promo) => <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => setEditing(promo)}>Edit campaign</Button><Button size="sm" variant="ghost" onClick={() => setHistoryId(historyId === promo.id ? null : promo.id)}>Redemption history</Button></div> },
        ]} />
        {historyId && <PromotionHistory key={historyId} id={historyId} />}
      </>}
      {canCredit && <Card><CardHeader><CardTitle>Test credit administration</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-sec">Manual grants require a reason and an idempotency key. Proposed signup defaults are $5, 90 days, a 20% rental-subtotal cap and $1 minimum. No referrals or live signup awards.</p>
        <Button size="sm" onClick={() => setGrant(crypto.randomUUID())}>Grant test credits</Button>
        <form className="flex flex-col sm:flex-row items-end gap-2" onSubmit={(event) => { event.preventDefault(); setWalletUser(formText(new FormData(event.currentTarget), 'user_id')); }}>
          <div className="flex-1 w-full"><TextField name="user_id" label="User ID to inspect wallet" maxLength={36} /></div>
          <Button type="submit" variant="secondary">View ledger</Button>
        </form>
        {walletUser && <WalletPanel key={`${walletUser}-${walletVersion}`} userId={walletUser} />}
      </CardContent></Card>}
      <OperationDialog key={editing?.id ?? (editing === null ? 'new' : 'closed')} open={editing !== undefined} onClose={() => setEditing(undefined)}
        title={editing ? 'Edit campaign' : 'New campaign'} description="Campaigns are platform-funded and test-only. Times use your browser timezone and are stored as UTC."
        onSave={async (form) => { await savePromotion(editing?.id ?? null, form); setNotice('Campaign saved.'); promos.reload(); }}>
        <TextField name="name" label="Campaign name" value={editing?.name} maxLength={100} />
        <TextField name="code" label="Promotion code" value={editing?.code} maxLength={40} />
        <ChoiceField name="discount_type" label="Discount type" options={['percentage', 'fixed']} value={editing?.discount_type} />
        <TextField name="value" label="Discount value (% or USD)" value={editing?.value} type="number" min={0.01} step="0.01" />
        <TextField name="min_spend" label="Minimum eligible rental subtotal (USD)" value={editing?.min_spend ?? 0} type="number" min={0} step="0.01" />
        <TextField name="max_discount" label="Maximum discount (USD, optional)" value={editing?.max_discount ?? ''} type="number" min={0.01} step="0.01" required={false} />
        <TextField name="starts_at" label="Starts (local time)" value={localTime(editing?.starts_at)} type="datetime-local" />
        <TextField name="ends_at" label="Ends (local time)" value={localTime(editing?.ends_at)} type="datetime-local" />
        <TextField name="usage_limit" label="Campaign redemption limit (optional)" value={editing?.usage_limit ?? ''} type="number" min={1} step="1" required={false} />
        <TextField name="per_user_limit" label="Per-user limit" value={editing?.per_user_limit ?? 1} type="number" min={1} step="1" />
        <TextField name="category_ids" label="Eligible category IDs (comma separated, blank for all)" value={editing?.category_ids.join(', ')} required={false} maxLength={2000} />
        <TextField name="listing_ids" label="Eligible listing IDs (comma separated, blank for all)" value={editing?.listing_ids.join(', ')} required={false} maxLength={2000} />
        <ChoiceField name="active" label="Activation (test environment only)" options={['false', 'true']} value={String(editing?.active ?? false)} />
        <LongField name="reason" label="Change reason" maxLength={500} />
      </OperationDialog>
      <OperationDialog key={grant ?? 'grant-closed'} open={grant !== null} onClose={() => setGrant(null)} title="Grant test wallet credits"
        description="Test-only credits are not cash and cannot fund a live checkout." onSave={async (form) => {
          if (!grant) return;
          await grantCredits(form, grant); setWalletUser(formText(form, 'user_id')); setWalletVersion((value) => value + 1); setNotice('Test credit grant recorded.');
        }}>
        <TextField name="user_id" label="Recipient user ID" maxLength={36} />
        <ChoiceField name="kind" label="Credit type (test only)" options={['manual', 'signup']} />
        <TextField name="amount" label="Amount (USD; signup default is $5)" value={5} type="number" min={0.01} step="0.01" />
        <LongField name="reason" label="Grant reason" maxLength={500} />
      </OperationDialog>
    </div>
  );
}

function PromotionHistory({ id }: { id: string }) {
  const query = usePagedQuery((limit, offset) => listPromotionRedemptions(id, limit, offset), [id]);
  return <Card><CardHeader><CardTitle>Campaign redemption history</CardTitle></CardHeader><CardContent>
    <PagedTable query={query} rowKey={(row) => row.id} emptyTitle="No redemptions for this campaign" columns={[
      { header: 'Booking', cell: (row) => row.booking_id },
      { header: 'User', cell: (row) => row.user_id },
      { header: 'Discount', cell: (row) => money(row.discount_amount) },
      { header: 'Redeemed', cell: (row) => fmtDate(row.created_at) },
    ]} />
  </CardContent></Card>;
}
