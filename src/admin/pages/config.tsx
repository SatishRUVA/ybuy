import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Alert, Badge, Button, EmptyState } from '@/main-site/components/ui';
import { fieldClass,textareaClass } from '@/main-site/components/form-classes';
import { Skeleton } from '@/main-site/components/skeleton';
import {
  listCategories, listSettings, listCountryOptions, setFeatureFlag, updateSetting, upsertCategory,
  saveDepositRule,
  getAgreementTerms,publishAgreementTerms,publishTestDummyAgreementTerms,
  type AdminCategory, type AdminSetting, type FeatureFlag,
} from '@/admin/api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/main-site/components/shadcn/dialog';
import { Switch } from '@/main-site/components/shadcn/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/main-site/components/shadcn/card';
import { fmtDate, useLoad } from '@/main-site/components/operations/query-utils';
import { PageHeader, ReasonDialog } from '@/main-site/components/operations/shared';
import { useFeatureFlags } from '@/lib/use-feature-flags';
import { fetchDepositRules } from '@/lib/listings';
import { parseMoney } from '@/lib/listing-rules';

function LoadState({ loading, error, reload, rows }: { loading: boolean; error: string | null; reload: () => void; rows: number }) {
  if (error) {
    return (
      <Alert tone="error" title="Could not load this page">
        <p>{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={reload}>Try again</Button>
      </Alert>
    );
  }
  return loading ? <div className="space-y-2" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div> : null;
}

interface CategoryDraft { id: string | null; name: string; icon: string; active: boolean; sort_order: string }
const blankCategory: CategoryDraft = { id: null, name: '', icon: '', active: true, sort_order: '0' };

export function CategoriesSection() {
  const { data, loading, error, reload } = useLoad(listCategories);
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rules = useLoad(fetchDepositRules);
  const [ruleTarget,setRuleTarget] = useState<AdminCategory | null>(null);
  const [ruleValues,setRuleValues] = useState({ percentage: '30',minimum: '0',maximum: '10000' });

  function open(c: AdminCategory | null) {
    setDraft(c ? { id: c.id, name: c.name, icon: c.icon ?? '', active: c.active, sort_order: String(c.sort_order) } : blankCategory);
    setReason('');
    setFormError(null);
  }

  async function save() {
    if (!draft) return;
    const sort = Number(draft.sort_order);
    if (!Number.isInteger(sort)) { setFormError('Sort order must be a whole number.'); return; }
    setBusy(true);
    setFormError(null);
    try {
      await upsertCategory({ id: draft.id, name: draft.name, icon: draft.icon.trim() || null, active: draft.active, sort_order: sort }, reason);
      setNotice(draft.id ? 'Category updated.' : 'Category created.');
      setDraft(null);
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Categories" subtitle="Inactive categories disappear from the marketplace but keep their existing listings." action={<Button size="sm" icon={<Plus size={14} />} onClick={() => open(null)}>New category</Button>} />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      {rules.error && <Alert tone="error" className="mb-4">{rules.error}<Button size="sm" variant="secondary" onClick={rules.reload}>Retry deposit rules</Button></Alert>}
      <LoadState loading={loading} error={error} reload={reload} rows={5} />
      {data && data.length === 0 && <EmptyState title="No categories" description="Create the first category to organise listings." />}
      {data && data.length > 0 && (
        <ul className="bg-card border border-app rounded-card-lg divide-y divide-[var(--border)]">
          {data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-main [overflow-wrap:anywhere]">{c.name}</p>
                <p className="text-xs text-muted [overflow-wrap:anywhere]">Order {c.sort_order}{c.icon ? ` · icon ${c.icon}` : ''}</p>
              </div>
              <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'active' : 'inactive'}</Badge>
              <Button size="sm" variant="secondary" disabled={rules.loading || Boolean(rules.error)} onClick={() => {
                const rule=rules.data?.find((value) => value.category_id===c.id);
                setRuleValues({ percentage: String(Number(rule?.suggested_pct ?? 0.30)*100),minimum: String(rule?.minimum_amount ?? 0),maximum: String(rule?.maximum_amount ?? 10000) });
                setRuleTarget(c);
              }} aria-label={`Deposit rules for ${c.name}`}>Deposit rules</Button>
              <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => open(c)} aria-label={`Edit ${c.name}`}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={draft !== null} onOpenChange={(o) => { if (!o && !busy) setDraft(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit category' : 'New category'}</DialogTitle>
            <DialogDescription>Changes apply immediately and are recorded in the audit log.</DialogDescription>
          </DialogHeader>
          {draft && (
            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label className="block text-[13px] font-semibold text-main">Name
                <input className={fieldClass('mt-1.5 font-normal')} value={draft.name} maxLength={60} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[13px] font-semibold text-main">Icon name
                  <input className={fieldClass('mt-1.5 font-normal')} value={draft.icon} maxLength={40} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
                </label>
                <label className="block text-[13px] font-semibold text-main">Sort order
                  <input className={fieldClass('mt-1.5 font-normal')} inputMode="numeric" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} />
                </label>
              </div>
              <label className="flex items-center justify-between text-[13px] font-semibold text-main">Active
                <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} aria-label="Active" />
              </label>
              <label className="block text-[13px] font-semibold text-main">Reason (recorded in the audit log)
                <input className={fieldClass('mt-1.5 font-normal')} value={reason} maxLength={500} required minLength={3} onChange={(e) => setReason(e.target.value)} />
              </label>
              {formError && <p role="alert" className="text-xs text-error">{formError}</p>}
              <DialogFooter>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
                <Button type="submit" loading={busy} disabled={draft.name.trim().length < 2 || reason.trim().length < 3}>Save category</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ReasonDialog open={Boolean(ruleTarget)} onOpenChange={(open) => { if (!open) setRuleTarget(null); }}
        title={`Deposit rules: ${ruleTarget?.name ?? ''}`} description="Applies to future listings and changed deposits. Existing booking prices and deposits remain unchanged. No automatic risk scoring or deductions."
        confirmLabel="Save deposit rule" onConfirm={async (reason) => {
          const percentage=parseMoney(ruleValues.percentage),minimum=parseMoney(ruleValues.minimum),maximum=parseMoney(ruleValues.maximum);
          if (percentage===null || minimum===null || maximum===null || percentage>100 || maximum>10000 || minimum>maximum) throw new Error('Use a percentage from 0 to 100 and valid deposit limits from 0 to 10000.');
          await saveDepositRule(ruleTarget!.id,percentage,minimum,maximum,reason);
          rules.reload();setRuleTarget(null);setNotice('Category deposit rule saved. Existing bookings are unchanged.');
        }}>
        <label className="block text-sm font-semibold">Suggested percentage<input className={fieldClass('mt-1')} inputMode="decimal" value={ruleValues.percentage} onChange={(event) => setRuleValues({ ...ruleValues,percentage: event.target.value })} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">Minimum deposit (USD)<input className={fieldClass('mt-1')} inputMode="decimal" value={ruleValues.minimum} onChange={(event) => setRuleValues({ ...ruleValues,minimum: event.target.value })} /></label>
          <label className="block text-sm font-semibold">Maximum deposit (USD)<input className={fieldClass('mt-1')} inputMode="decimal" value={ruleValues.maximum} onChange={(event) => setRuleValues({ ...ruleValues,maximum: event.target.value })} /></label>
        </div>
      </ReasonDialog>
    </>
  );
}

const asPercent = (s: AdminSetting) => (s.key.endsWith('_pct') && typeof s.value === 'number' ? ` (${(s.value * 100).toFixed(1)}%)` : '');

export function SettingsSection() {
  const { data, loading, error, reload } = useLoad(listSettings);
  const countries = useLoad(listCountryOptions);
  const [target, setTarget] = useState<AdminSetting | null>(null);
  const [value, setValue] = useState('');
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Global settings" subtitle="Business rules stored in the database. Deployments never overwrite these values; secrets are never shown here." />
      <AgreementTermsSettings />
      <Alert tone="info" className="mb-4">Listing policy settings below are authoritative. Set both offer percentage fractions before enabling listing_offers_configured; bidding must also be enabled. A zero high-value threshold means all publications await review in Listings. Delivery fees are stored terms, not an additional checkout charge. Photo dimensions are browser-validated; byte limits are enforced by storage.</Alert>
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      <LoadState loading={loading} error={error} reload={reload} rows={2} />
      <div className="grid gap-4">
        {data?.map((s) => (
          <Card key={s.key}>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle><code className="text-sm [overflow-wrap:anywhere]">{s.key}</code></CardTitle>
                <CardDescription className="mt-1">{s.description}</CardDescription>
              </div>
              <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => {
                setTarget(s); setValue(String(s.value)); setCountryCodes(Array.isArray(s.value) ? s.value : []);
              }}>Change</Button>
            </CardHeader>
            <CardContent className="text-sm text-sec">
              <span className="text-main font-semibold tnum">{Array.isArray(s.value)
                ? s.value.map(code => countries.data?.find(country => country.code === code)?.name ?? code).join(', ')
                : String(s.value)}{asPercent(s)}</span>
              {s.min_value != null && s.max_value != null && <span> · allowed {s.min_value}–{s.max_value}</span>}
              <span> · updated {fmtDate(s.updated_at)}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      <ReasonDialog
        open={target !== null} onOpenChange={(o) => !o && setTarget(null)}
        title={`Change ${target?.key ?? 'setting'}`}
        description={target?.value_type === 'country_codes'
          ? 'Controls city search, location detection, new pickup addresses and new item requests. Existing rentals and historical addresses remain unchanged.'
          : 'The new value applies to future activity only. Existing bookings keep their price snapshot.'}
        confirmLabel="Save change"
        onConfirm={async (reason) => {
          const parsed = target!.value_type === 'country_codes' ? countryCodes
            : target!.value_type === 'boolean' ? value === 'true' : Number(value);
          if (target!.value_type === 'country_codes') {
            if (countries.loading || countries.error) throw new Error('Load the country options before saving.');
            if (countryCodes.length === 0) throw new Error('Choose at least one country.');
          } else if (target!.value_type !== 'boolean' && (value.trim() === '' || !Number.isFinite(parsed))) throw new Error('Enter a valid number.');
          const res = await updateSetting(target!.key, parsed, reason);
          if (!res.ok) throw new Error(res.error ?? 'The change was rejected.');
          setNotice(`${target!.key} updated.`);
          reload();
        }}
      >
        {target?.value_type === 'country_codes' ? <fieldset>
          <legend className="text-sm font-semibold text-main">Enabled marketplace countries</legend>
          <LoadState loading={countries.loading} error={countries.error} reload={countries.reload} rows={2} />
          <div className="mt-2 max-h-64 overflow-auto rounded-card border border-app">
            {countries.data?.map(country => <label key={country.code} className="flex items-center gap-3 px-3 min-h-11 text-sm text-main">
              <input type="checkbox" checked={countryCodes.includes(country.code)} onChange={event => {
                setCountryCodes(current => event.target.checked ? [...current, country.code] : current.filter(code => code !== country.code));
              }} />
              {country.name}
            </label>)}
          </div>
        </fieldset> : <label className="block text-[13px] font-semibold text-main">New value
          {target?.value_type === 'boolean' ? (
            <select className={fieldClass('mt-1.5 font-normal')} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="true">true</option><option value="false">false</option>
            </select>
          ) : (
            <input className={fieldClass('mt-1.5 font-normal tnum')} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </label>}
      </ReasonDialog>
    </>
  );
}

function AgreementTermsSettings() {
  const current=useLoad(getAgreementTerms);
  const dummyFlag=useFeatureFlags().data?.find(flag=>flag.key==='test_dummy_legal_terms')?.enabled===true;
  const [terms,setTerms]=useState('');
  const [reference,setReference]=useState('');
  const [reason,setReason]=useState('');
  const [approved,setApproved]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  return <Card className="mb-5"><CardHeader><CardTitle>Rental agreement policies</CardTitle><CardDescription>Publish only externally reviewed and approved legal terms. No binding policy text is generated automatically. New versions apply to future agreement snapshots only.</CardDescription></CardHeader>
    <CardContent>
      <LoadState loading={current.loading} error={current.error} reload={current.reload} rows={1}/>
      {!current.loading&&!current.error&&<p className="text-sm text-sec mb-3">{current.data?`${current.data.approval_reference.startsWith('TEST ONLY:')?'Latest test-only sample':'Latest approved policy'}: version ${current.data.version}. Reference: ${current.data.approval_reference}`:'No approved legal policy is configured. Booking snapshots are labeled approval pending and cannot be accepted.'}</p>}
      {dummyFlag&&<div className="rounded-card border border-warning bg-warning-soft p-3 mb-3"><p className="text-sm font-semibold text-main">Test-only dummy terms are enabled</p><p className="text-xs text-sec mt-1">Publishing sample terms enables acceptance for test bookings. They are fictional, not legally reviewed, and must never be used for real rentals.</p><Button size="sm" variant="secondary" className="mt-2" onClick={async()=>{setBusy(true);setError(null);setNotice(null);try{const version=await publishTestDummyAgreementTerms('Enable isolated booking lifecycle tests with fictional terms');setNotice(`Test-only dummy terms version ${version} published.`);current.reload();}catch(reason){setError(reason instanceof Error?reason.message:'Could not publish test-only terms.');}finally{setBusy(false);}}} loading={busy}>Publish test-only dummy terms</Button></div>}
      {current.data&&<details className="mb-3"><summary className="text-sm font-semibold text-accent cursor-pointer">View current policy</summary><p className="mt-2 whitespace-pre-wrap text-sm text-sec">{current.data.terms}</p></details>}
      <details><summary className="text-sm font-semibold text-accent cursor-pointer">Publish a new approved policy version</summary>
        <form className="space-y-3 mt-3" onSubmit={async event=>{
          event.preventDefault();setBusy(true);setError(null);setNotice(null);
          try{
            if(!approved)throw new Error('Confirm that these exact terms have legal approval.');
            const version=await publishAgreementTerms(terms,reference,reason);
            setNotice(`Approved policy version ${version} published. Existing snapshots are unchanged.`);
            setTerms('');setReference('');setReason('');setApproved(false);current.reload();
          }catch(error){setError(error instanceof Error?error.message:'Could not publish the approved policy.');}
          finally{setBusy(false);}
        }}>
          <label className="block text-sm font-semibold">Approved legal terms<textarea required minLength={20} maxLength={20000} rows={8} className={textareaClass('mt-1')} value={terms} onChange={event=>setTerms(event.target.value)}/></label>
          <label className="block text-sm font-semibold">Legal approval reference<input required minLength={3} maxLength={500} className={fieldClass('mt-1')} value={reference} onChange={event=>setReference(event.target.value)}/></label>
          <label className="block text-sm font-semibold">Publication reason<input required minLength={3} maxLength={500} className={fieldClass('mt-1')} value={reason} onChange={event=>setReason(event.target.value)}/></label>
          <label className="flex items-start gap-2 text-sm text-sec"><input type="checkbox" required checked={approved} onChange={event=>setApproved(event.target.checked)} className="mt-1"/>These exact terms have been legally approved for the applicable marketplace and jurisdictions.</label>
          {error&&<p role="alert" className="text-sm text-error">{error}</p>}
          <Button type="submit" loading={busy} disabled={!approved}>Publish approved terms</Button>
        </form>
      </details>
      {notice&&<p role="status" className="text-sm text-success mt-3">{notice}</p>}
    </CardContent>
  </Card>;
}

export function FlagsSection() {
  const { data, loading, error, reload } = useFeatureFlags();
  const [target, setTarget] = useState<FeatureFlag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Feature flags" subtitle="Changes sync to open pages over a live connection without refreshing. Only implemented flag consumers are affected; unavailable modules remain unavailable." />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      <LoadState loading={loading} error={error} reload={reload} rows={4} />
      {data && (
        <ul className="bg-card border border-app rounded-card-lg divide-y divide-[var(--border)]">
          {data.map((f) => (
            <li key={f.key} className="flex items-center gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-main"><code className="text-sm [overflow-wrap:anywhere]">{f.key}</code></p>
                <p className="text-sm text-sec leading-relaxed [overflow-wrap:anywhere]">{f.description}</p>
              </div>
              <Switch checked={f.enabled} disabled={loading || !!error} onCheckedChange={() => setTarget(f)} aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${f.key}`} />
            </li>
          ))}
        </ul>
      )}
      <ReasonDialog
        open={target !== null} onOpenChange={(o) => !o && setTarget(null)} danger={target?.enabled === true}
        title={`${target?.enabled ? 'Disable' : 'Enable'} ${target?.key ?? 'flag'}?`}
        description="This saves the flag setting. Only implemented modules that read this flag are affected; it does not activate unavailable features."
        confirmLabel={target?.enabled ? 'Disable flag' : 'Enable flag'}
        onConfirm={async (reason) => {
          if (loading || error) throw new Error('Wait for the live feature settings connection to recover.');
          const current = data?.find((flag) => flag.key === target!.key);
          if (!current || current.enabled !== target!.enabled) throw new Error('This flag changed while the dialog was open. Close it and review the current value.');
          await setFeatureFlag(target!.key, !target!.enabled, reason);
          setNotice(`${target!.key} saved as ${target!.enabled ? 'disabled' : 'enabled'}. Unavailable modules remain unavailable.`);
          reload();
        }}
      />
    </>
  );
}
