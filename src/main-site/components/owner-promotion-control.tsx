import { useEffect, useState } from 'react';
import { Alert, Button, Field, Surface } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { fetchOwnerPromotion, saveOwnerPromotion, type OwnerPromotion } from '@/lib/owner-promotions';
import { useFeatureFlag } from '@/lib/use-feature-flags';

export function OwnerPromotionControl({ listingId, onSaved }: { listingId: string; onSaved: () => void }) {
  const flag = useFeatureFlag('owner_promotions');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<OwnerPromotion | null>(null);
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState('10');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!open || !flag.enabled) return;
    let alive = true;
    void fetchOwnerPromotion(listingId).then((result) => {
      if (!alive) return;
      setValue(result);
      if (result) { setCode(result.code); setPercent(String(result.discount_percent)); setActive(result.active); }
    }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load promo settings.'); });
    return () => { alive = false; };
  }, [open, flag.enabled, listingId]);
  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try { setValue(await saveOwnerPromotion({ listingId, code, discountPercent: Number(percent), active })); setSaved(true); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this promo.'); }
    finally { setBusy(false); }
  }
  return <div className="mt-2">
    <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((item) => !item)}>{open ? 'Close promo' : 'Promo code'}</Button>
    {open && <Surface className="mt-3 p-4 space-y-3">
      <div><h5 className="text-sm font-semibold text-main">Owner-funded promotion</h5><p className="text-xs text-sec mt-1">One promo or weekly/monthly package discount can apply to each booking. Discounts do not stack.</p></div>
      {!flag.enabled && <Alert tone="info">Promotions are disabled for this test environment. Enable the owner_promotions feature flag to configure one.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}{saved && <p role="status" className="text-sm text-accent">Promo saved.</p>}
      <fieldset disabled={!flag.enabled || busy} className="grid sm:grid-cols-2 gap-3">
        <Field label="Code (3–24 characters)" htmlFor={`promo-code-${listingId}`}><input id={`promo-code-${listingId}`} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={24} className={fieldClass()} placeholder="SUMMER10" /></Field>
        <Field label="Discount (1–50%)" htmlFor={`promo-percent-${listingId}`}><input id={`promo-percent-${listingId}`} type="number" min={1} max={50} step="0.01" value={percent} onChange={(event) => setPercent(event.target.value)} className={fieldClass()} /></Field>
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-sec"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={!flag.enabled || busy} /> Promotion active</label>
      {value && <p className="text-xs text-sec">{value.redemptions} completed or pending redemption(s).</p>}
      <Button size="sm" loading={busy} disabled={!flag.enabled || !code.trim() || !Number(percent)} onClick={() => void save()}>Save promo</Button>
    </Surface>}
  </div>;
}
