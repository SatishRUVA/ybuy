import { useEffect, useState } from 'react';
import { Alert, Button, Field, Surface } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { fetchListingById } from '@/lib/listings';
import { saveDurationDiscount } from '@/lib/listing-flow';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { calculateRentalPricing } from '@/lib/rental-pricing';

export function DurationDiscountControl({ listingId, onSaved }: { listingId: string; onSaved: () => void }) {
  const flag = useFeatureFlag('duration_discounts');
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [dailyRate, setDailyRate] = useState(0);
  const [weeklyEnabled, setWeeklyEnabled] = useState(false);
  const [weeklyPercent, setWeeklyPercent] = useState('');
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [monthlyPercent, setMonthlyPercent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || !flag.enabled) return;
    let active = true;
    setLoading(true);
    setError(null);
    void fetchListingById(listingId).then((row) => {
      if (!row || !Number.isSafeInteger(row.revision)) throw new Error('Could not load listing discount settings. Reload the page and try again.');
      if (!active) return;
      setRevision(row.revision!);
      setDailyRate(Number(row.price_per_day));
      setWeeklyEnabled(row.weekly_discount_enabled === true);
      setWeeklyPercent(String(row.weekly_discount_enabled && Number(row.weekly_discount_percent) <= 0 ? 20 : row.weekly_discount_percent ?? 20));
      setMonthlyEnabled(row.monthly_discount_enabled === true);
      setMonthlyPercent(String(row.monthly_discount_enabled && Number(row.monthly_discount_percent) <= 0 ? 30 : row.monthly_discount_percent ?? 30));
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load discount settings.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, flag.enabled, listingId]);

  async function save() {
    setError(null); setSaved(false);
    const weekly = weeklyPercent.trim() ? Number(weeklyPercent) : 0;
    const monthly = monthlyPercent.trim() ? Number(monthlyPercent) : 0;
    if (![weekly, monthly].every(value => Number.isFinite(value) && value >= 0 && value <= 50)) {
      setError('Choose discounts from 0% to 50%.');
      return;
    }
    if (revision === null) { setError('Reload the listing before saving.'); return; }
    setSaving(true);
    try {
      setRevision(await saveDurationDiscount(listingId, revision, weeklyEnabled, weekly, monthlyEnabled, monthly));
      setSaved(true);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the discount.');
    } finally { setSaving(false); }
  }

  return <div className="mt-2">
    <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      {open ? 'Close discounts' : 'Rental discounts'}
    </Button>
    {open && <Surface className="mt-3 p-4 space-y-3">
      <div><h5 className="text-sm font-semibold text-main">Weekly and monthly rentals</h5>
        <p className="text-xs text-sec mt-1">You fund these discounts; renters pay less. Extra days are charged at your daily price. Changes apply to new bookings only.</p></div>
      {!flag.enabled && <Alert tone="info">Rental packages are currently turned off for this test environment.</Alert>}
      {flag.error && <Alert tone="warning">{flag.error}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <p role="status" className="text-sm text-accent">Rental discounts saved.</p>}
      <fieldset disabled={!flag.enabled || loading || saving} className="space-y-3">
        <div className="border-b border-app pb-3">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-semibold text-main">
            <span>Offer Weekly rentals</span>
            <input type="checkbox" role="switch" checked={weeklyEnabled} onChange={(event) => { if (event.target.checked && Number(weeklyPercent) <= 0) setWeeklyPercent('20'); setWeeklyEnabled(event.target.checked); }} aria-label="Offer Weekly rentals" className="h-5 w-5 accent-[var(--accent)]" />
          </label>
          {weeklyEnabled && <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-end">
            <Field label="Weekly discount" htmlFor={`weekly-discount-${listingId}`}>
              <input id={`weekly-discount-${listingId}`} type="number" min={0} max={50} step="0.5" value={weeklyPercent} onChange={(event) => setWeeklyPercent(event.target.value)} className={fieldClass()} />
            </Field>
            <p className="pb-2 text-xs text-sec">7-day price: <strong className="text-main">${calculateRentalPricing(dailyRate, 7, { weeklyEnabled: true, weeklyPercent: Number(weeklyPercent) || 0 }).subtotal.toFixed(2)}</strong><span className="block mt-1">Save ${calculateRentalPricing(dailyRate, 7, { weeklyEnabled: true, weeklyPercent: Number(weeklyPercent) || 0 }).discountAmount.toFixed(2)}</span></p>
          </div>}
        </div>
        <div>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-semibold text-main">
            <span>Offer Monthly rentals</span>
            <input type="checkbox" role="switch" checked={monthlyEnabled} onChange={(event) => { if (event.target.checked && Number(monthlyPercent) <= 0) setMonthlyPercent('30'); setMonthlyEnabled(event.target.checked); }} aria-label="Offer Monthly rentals" className="h-5 w-5 accent-[var(--accent)]" />
          </label>
          {monthlyEnabled && <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-end">
            <Field label="Monthly discount" htmlFor={`monthly-discount-${listingId}`}>
              <input id={`monthly-discount-${listingId}`} type="number" min={0} max={50} step="0.5" value={monthlyPercent} onChange={(event) => setMonthlyPercent(event.target.value)} className={fieldClass()} />
            </Field>
            <p className="pb-2 text-xs text-sec">30-day price: <strong className="text-main">${calculateRentalPricing(dailyRate, 30, { monthlyEnabled: true, monthlyPercent: Number(monthlyPercent) || 0 }).subtotal.toFixed(2)}</strong><span className="block mt-1">Save ${calculateRentalPricing(dailyRate, 30, { monthlyEnabled: true, monthlyPercent: Number(monthlyPercent) || 0 }).discountAmount.toFixed(2)}</span></p>
          </div>}
        </div>
      </fieldset>
      <Button size="sm" loading={saving || loading} disabled={!flag.enabled || revision === null} onClick={() => void save()}>Save discount</Button>
    </Surface>}
  </div>;
}
