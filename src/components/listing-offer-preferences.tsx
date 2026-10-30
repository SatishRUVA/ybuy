import { Handshake } from 'lucide-react';
import { Button, Field } from '@/components/ui';
import { Switch } from '@/components/shadcn/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select';
import { fieldClass } from '@/components/form-classes';
import type { ListingFlowPolicy, ListingOfferForm } from '@/lib/listing-flow';

export function ListingOfferPreferences({ value, askingPrice, startDate, endDate, policy, disabled, error, onChange }: {
  value: ListingOfferForm;
  askingPrice: number | null;
  startDate: string;
  endDate: string;
  policy: ListingFlowPolicy;
  disabled?: boolean;
  error?: string;
  onChange: (value: ListingOfferForm) => void;
}) {
  const configured = policy.offer_below_pct !== null && policy.offer_above_pct !== null;
  const minimumDaily = askingPrice === null ? 0 : Math.max(0.01, Math.round(askingPrice * (1 - (policy.offer_below_pct ?? 0)) * 100) / 100);
  const maximumDaily = askingPrice === null ? 0 : Math.min(100000, Math.round(askingPrice * (1 + (policy.offer_above_pct ?? 0)) * 100) / 100);
  const expirationOptions = [6, 12, 24, 48, 72, 168];
  const currentExpiry = Number(value.expirationHours);
  const expiryLabel = (hours: number) => hours % 24 === 0 ? `${hours / 24} ${hours === 24 ? 'day' : 'days'}` : `${hours} hours`;
  const hasValidCustomExpiry = Number.isInteger(currentExpiry) && currentExpiry >= 1 && currentExpiry <= 168;
  const visibleExpiryOptions = expirationOptions.includes(currentExpiry) || !hasValidCustomExpiry
    ? expirationOptions : [...expirationOptions, currentExpiry].sort((a, b) => a - b);

  return <section id="listing-offers" tabIndex={-1} aria-labelledby="listing-offers-title" aria-describedby={error ? 'listing-offers-error' : undefined}
    className="space-y-4 rounded-card-lg border border-app bg-card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Handshake size={19} aria-hidden="true" /></span>
      <div className="flex-1">
        <h3 id="listing-offers-title" className="text-base font-semibold text-main">Private offers</h3>
        <p id="listing-offers-help" className="text-sm text-sec mt-1">A renter sends you a private price. You can accept, counter, or decline.</p>
      </div>
      <div className="flex min-h-11 items-center">
        <Switch aria-label="Allow rental offers" aria-describedby="listing-offers-help" checked={value.enabled}
          disabled={disabled || (!configured && !value.enabled)}
          onCheckedChange={enabled => onChange({
            ...value, enabled,
            minimumDaily: value.minimumDaily || String(minimumDaily),
            maximumDaily: value.maximumDaily || String(maximumDaily),
            expirationHours: value.expirationHours || '24',
          })} />
      </div>
    </div>
    {!configured && <p role="status" className="text-xs text-sec">Offers are unavailable until an administrator approves the price boundaries. You can still publish your listing.</p>}
    {value.enabled && <fieldset disabled={disabled} className="space-y-5">
      <fieldset>
        <legend className="text-sm font-semibold text-main mb-1">Set your acceptable daily price range</legend>
        <p className="text-xs text-sec mb-3">Your listing is ${askingPrice?.toFixed(2) ?? '—'} per day. You’ll only receive offers in the range you set.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <label htmlFor="offer-minimum-daily" className="mb-1.5 block text-xs font-medium text-sec">From</label>
            <span aria-hidden="true" className="pointer-events-none absolute left-3 inset-y-0 flex items-center pt-6 text-sm text-sec">$</span>
            <input id="offer-minimum-daily" type="number" inputMode="decimal" min={minimumDaily} max={maximumDaily} step="0.01"
              value={value.minimumDaily} onChange={event => onChange({ ...value, minimumDaily: event.target.value })}
              aria-invalid={Boolean(error)} aria-describedby="offer-range-help" required
              className={fieldClass('pl-7 tnum')} />
          </div>
          <div className="relative">
            <label htmlFor="offer-maximum-daily" className="mb-1.5 block text-xs font-medium text-sec">Up to</label>
            <span aria-hidden="true" className="pointer-events-none absolute left-3 inset-y-0 flex items-center pt-6 text-sm text-sec">$</span>
            <input id="offer-maximum-daily" type="number" inputMode="decimal" min={minimumDaily} max={maximumDaily} step="0.01"
              value={value.maximumDaily} onChange={event => onChange({ ...value, maximumDaily: event.target.value })}
              aria-invalid={Boolean(error)} aria-describedby="offer-range-help" required
              className={fieldClass('pl-7 tnum')} />
          </div>
        </div>
        <p id="offer-range-help" className="text-xs text-sec mt-2 leading-relaxed">Allowed: ${minimumDaily.toFixed(2)} to ${maximumDaily.toFixed(2)} per day.</p>
      </fieldset>
      <Field htmlFor="offer-expiration" label="Offer reply time">
        <Select required value={value.expirationHours} onValueChange={expirationHours => onChange({ ...value, expirationHours })}>
          <SelectTrigger id="offer-expiration" aria-describedby="offer-expiration-help" className="h-11">
            <SelectValue placeholder="Choose a reply window" />
          </SelectTrigger>
          <SelectContent>
            {visibleExpiryOptions.map(hours => <SelectItem key={hours} value={String(hours)}>{expiryLabel(hours)}</SelectItem>)}
          </SelectContent>
        </Select>
        <p id="offer-expiration-help" className="mt-2 text-xs text-sec">An offer expires after this long if you haven’t responded.</p>
      </Field>
      {value.startDate || value.endDate ? <div className="text-xs text-sec">
        <p>Saved offer dates: {value.startDate || startDate} to {value.endDate || endDate}.</p>
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...value, startDate: '', endDate: '' })}>Use full listing availability</Button>
      </div> : null}
      <p className="text-xs leading-relaxed text-sec">Payment and availability are checked before any booking is confirmed.</p>
    </fieldset>}
    {error && <p id="listing-offers-error" role="alert" className="text-sm text-error">{error}</p>}
  </section>;
}
