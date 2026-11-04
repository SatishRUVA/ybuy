import { useState } from 'react';
import { ChevronLeft, ChevronRight, Gavel } from 'lucide-react';
import { Switch } from '@/components/shadcn/switch';
import { MonthGrid } from '@/components/date-range-picker';
import { fieldClass } from '@/components/form-classes';
import { addDaysIso, todayIso } from '@/lib/geo';
import type { ListingAuctionPreferences as Preferences } from '@/lib/listing-auctions';

const NO_DATES = new Set<string>();
const parseDate = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
const label = (value: string) => value ? parseDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Choose date';
const twoHoursBeforePickup = (date: string) => {
  const previous = parseDate(date); previous.setDate(previous.getDate() - 1);
  previous.setHours(22, 0, 0, 0);
  return previous.toISOString();
};
const localInputValue = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : '';
};
const toIso = (value: string) => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export function ListingAuctionPreferences({ value, start, end, disabled, error, onChange }: {
  value: Preferences; start: string; end: string; disabled?: boolean; error?: string;
  onChange: (value: Preferences) => void;
}) {
  const today = todayIso();
  const [month, setMonth] = useState(() => {
    const initial = value.start_date || (start > today ? start : today);
    const date = parseDate(initial); return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [choosingReturn, setChoosingReturn] = useState(Boolean(value.start_date));
  const pickup = value.start_date ?? '';
  const returnDate = value.end_date ?? '';
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const minStart = start > today ? start : today;
  const minDate = choosingReturn && pickup ? addDaysIso(pickup, 1) : minStart;
  const maxDate = end;
  const validStart = Boolean(start && end && minStart < end);

  function pick(date: string) {
    if (!choosingReturn || !pickup || date <= pickup) {
      const next = addDaysIso(date, 1);
      onChange({
        ...value,
        start_date: date,
        end_date: next,
        bidding_starts_at: value.bidding_starts_at ?? new Date(Date.now() + 5 * 60_000).toISOString(),
        bidding_ends_at: twoHoursBeforePickup(date),
      });
      setChoosingReturn(true);
      return;
    }
    onChange({ ...value, end_date: date });
    setChoosingReturn(false);
  }

  return <section id="listing-auction" tabIndex={-1} aria-labelledby="listing-auction-title" className="space-y-4 rounded-card-lg border border-app bg-card p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Gavel size={19} aria-hidden="true" /></span>
      <div className="flex-1 pt-0.5"><h3 id="listing-auction-title" className="text-base font-semibold text-main">Live bidding</h3>
        <p id="auction-preferences-help" className="mt-1 text-sm leading-relaxed text-sec">Choose the rental dates and bidding schedule. You must select an eligible bidder before bidding closes. Keep the required payment buffer before pickup.</p></div>
      <div className="flex min-h-11 items-center"><Switch aria-label="Enable live bidding" aria-describedby="auction-preferences-help" checked={value.enabled}
        disabled={disabled} onCheckedChange={enabled => onChange({
          ...value,
          enabled,
          bidding_starts_at: enabled ? value.bidding_starts_at ?? new Date(Date.now() + 5 * 60_000).toISOString() : value.bidding_starts_at,
          bidding_ends_at: enabled ? value.bidding_ends_at ?? (pickup ? twoHoursBeforePickup(pickup) : null) : value.bidding_ends_at,
        })} /></div>
    </div>
    {value.enabled && <fieldset disabled={disabled} className="space-y-4 border-t border-app pt-4">
      <p className="text-sm text-sec">Owners can select any eligible bidder while bidding is open. Selection closes bidding and gives the winner one hour to pay. The platform sets the minimum bid increase. Bids in the final 2 minutes can extend closing by up to 10 minutes.</p>
      <div className="grid grid-cols-2 gap-3" aria-label="Auction rental dates">
        <button type="button" aria-pressed={!choosingReturn} onClick={() => setChoosingReturn(false)} className={`rounded-xl border p-3 text-left transition ${!choosingReturn ? 'border-accent bg-accent-soft' : 'border-app bg-card hover:border-accent/50'}`}>
          <span className="block text-xs font-semibold uppercase tracking-wide text-sec">Pickup</span><span className="mt-1 block text-sm font-bold text-main">{label(pickup)}</span>
        </button>
        <button type="button" aria-pressed={choosingReturn} onClick={() => setChoosingReturn(true)} className={`rounded-xl border p-3 text-left transition ${choosingReturn ? 'border-accent bg-accent-soft' : 'border-app bg-card hover:border-accent/50'}`}>
          <span className="block text-xs font-semibold uppercase tracking-wide text-sec">Return</span><span className="mt-1 block text-sm font-bold text-main">{label(returnDate)}</span>
        </button>
      </div>
      {validStart ? <>
        <div className="flex items-center justify-between gap-3">
          <button type="button" aria-label="Previous month" disabled={month.getFullYear() === parseDate(minDate).getFullYear() && month.getMonth() <= parseDate(minDate).getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid h-11 w-11 place-items-center rounded-full text-sec hover:bg-subtle disabled:opacity-35"><ChevronLeft size={18} /></button>
          <p role="status" aria-live="polite" className="text-center"><span className="block text-sm font-semibold text-main">{choosingReturn ? 'Choose the return date' : 'Choose the pickup date'}</span><span className="text-xs text-sec">Dates must fit your listing availability</span></p>
          <button type="button" aria-label="Next month" disabled={month.getFullYear() === parseDate(maxDate).getFullYear() && month.getMonth() >= parseDate(maxDate).getMonth()} onClick={() => setMonth(nextMonth)} className="grid h-11 w-11 place-items-center rounded-full text-sec hover:bg-subtle disabled:opacity-35"><ChevronRight size={18} /></button>
        </div>
        <div className="rounded-xl border border-app bg-card p-2"><MonthGrid monthDate={month} todayStr={today} minDate={minDate} maxDate={maxDate} draftStart={pickup || null} draftEnd={returnDate || null} bookedDates={NO_DATES} blockedDates={NO_DATES} onPick={pick} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-main" htmlFor="auction-opens-at">Bidding opens
            <input id="auction-opens-at" type="datetime-local" required min={localInputValue(new Date(Date.now() + 60_000).toISOString())}
              value={value.bidding_starts_at ? localInputValue(value.bidding_starts_at) : ''}
              onChange={event => onChange({ ...value, bidding_starts_at: toIso(event.target.value) })}
              className={`${fieldClass()} mt-1`} />
          </label>
          <label className="block text-sm font-medium text-main" htmlFor="auction-closes-at">Bidding closes
            <input id="auction-closes-at" type="datetime-local" required
              min={value.bidding_starts_at ? localInputValue(new Date(Date.parse(value.bidding_starts_at) + 10 * 60_000).toISOString()) : undefined}
              max={localInputValue(new Date(parseDate(pickup || start).getTime() - 2 * 60 * 60_000).toISOString())}
              value={value.bidding_ends_at ? localInputValue(value.bidding_ends_at) : ''}
              onChange={event => onChange({ ...value, bidding_ends_at: toIso(event.target.value) })}
              className={`${fieldClass()} mt-1`} />
          </label>
        </div>
        <p className="text-xs text-sec">Bidding must close at least 2 hours before pickup. Late bids may extend closing by up to 10 minutes.</p>
      </> : <p className="text-sm text-sec">Set listing availability before enabling bidding.</p>}
      {pickup && returnDate && <p role="status" className="rounded-xl bg-accent-soft p-3 text-sm text-main">Bids cover <strong>{label(pickup)} – {label(returnDate)}</strong>. The rest of your listing dates stay available for regular bookings.</p>}
    </fieldset>}
    {error && <p id="listing-auction-error" role="alert" className="text-xs text-error">{error}</p>}
  </section>;
}
