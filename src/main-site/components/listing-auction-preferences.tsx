import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Gavel } from 'lucide-react';
import { Switch } from '@/main-site/components/shadcn/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/main-site/components/shadcn/select';
import { MonthGrid } from '@/main-site/components/date-range-picker';
import { fieldClass } from '@/main-site/components/form-classes';
import { addDaysIso, todayIso } from '@/lib/geo';
import { BIDDING_RULES_TEXT, defaultBiddingOpeningTime, enableBiddingPreferences, twoHoursBeforePickup, type ListingAuctionPreferences as Preferences } from '@/lib/listing-auctions';

const NO_DATES = new Set<string>();
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
const timeLabel = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
};
const parseDate = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
const label = (value: string) => value ? parseDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Choose date';
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

function BiddingDateTime({ label: name, value, min, max, onChange }: {
  label: string; value: string | null | undefined; min?: string; max?: string; onChange: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ? localInputValue(value) : '');
  useEffect(() => { if (value) setDraft(localInputValue(value)); }, [value]);
  const [date = '', time = ''] = draft.split('T');
  function update(nextDate: string, nextTime: string) {
    setDraft(`${nextDate}T${nextTime}`);
    onChange(nextDate && nextTime ? toIso(`${nextDate}T${nextTime}`) : null);
  }
  return <fieldset className="owner-bidding-datetime">
    <legend className="mb-2 text-sm font-medium text-main">{name}</legend>
    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2">
      <label className="owner-bidding-date-control">
        <span className="sr-only">{name} date</span>
        <CalendarDays size={16} aria-hidden="true" />
        <input type="date" required value={date} min={min?.slice(0, 10)} max={max?.slice(0, 10)}
          onChange={event => update(event.target.value, time)} />
      </label>
      <Select value={time} onValueChange={next => update(date, next)}>
        <SelectTrigger aria-label={`${name} time`} className="owner-bidding-time-trigger">
          <Clock3 size={16} aria-hidden="true" /><SelectValue placeholder="Choose time" />
        </SelectTrigger>
        <SelectContent>
          {time && !TIME_OPTIONS.includes(time) && <SelectItem value={time}>{timeLabel(time)}</SelectItem>}
          {TIME_OPTIONS.map(option => <SelectItem key={option} value={option} className="min-h-11">{timeLabel(option)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  </fieldset>;
}

export function ListingAuctionPreferences({ value, start, end, askingPrice, disabled, error, hideEnableSwitch = false, onChange }: {
  value: Preferences; start: string; end: string; askingPrice?: number | null; disabled?: boolean; error?: string;
  hideEnableSwitch?: boolean;
  onChange: (value: Preferences) => void;
}) {
  const today = todayIso();
  const immediateEligible = Boolean(start && start <= addDaysIso(today, 1));
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
        starts_immediately: immediateEligible,
        bidding_starts_at: immediateEligible ? null : value.bidding_starts_at ?? defaultBiddingOpeningTime(start),
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
      <Gavel size={20} aria-hidden="true" className="mt-2 shrink-0 text-sec" />
      <div className="flex-1 pt-0.5"><h3 id="listing-auction-title" className="text-base font-semibold text-main">Live bidding</h3>
        <p id="auction-preferences-help" className="mt-1 text-sm leading-relaxed text-sec">{hideEnableSwitch ? 'Choose dates and a starting bid, then save.' : 'Turn on, choose dates and a starting bid, then save.'}</p></div>
      {!hideEnableSwitch && <div className="flex min-h-11 items-center"><Switch aria-label="Enable live bidding" aria-describedby="auction-preferences-help" checked={value.enabled}
        disabled={disabled} onCheckedChange={enabled => onChange(enabled
          ? enableBiddingPreferences(value, start)
          : { ...value, enabled: false, starts_immediately: false })} /></div>}
    </div>
    {value.enabled && <fieldset disabled={disabled} className="space-y-4 border-t border-app pt-4">
      <p className="text-sm text-sec">{value.date_flexible === false && disabled ? 'This historical auction has fixed rental dates.' : 'Renters choose their pickup and return dates within your bidding availability window.'}</p>
      {value.starts_immediately
        ? <p role="status" className="rounded-card bg-accent-soft p-3 text-sm text-main">Bidding opens as soon as you save. Set a closing time at least 10 minutes from now and at least two hours before pickup.</p>
        : immediateEligible
          ? <p role="status" className="rounded-card bg-accent-soft p-3 text-sm text-main">This listing is available today or tomorrow. Bidding will open as soon as you save.</p>
          : null}
      <div className="owner-auction-setup">
      <div className="owner-auction-dates space-y-3">
      <div className="grid grid-cols-2 gap-3" aria-label="Auction rental dates">
        <button type="button" aria-pressed={!choosingReturn} onClick={() => setChoosingReturn(false)} className={`rounded-card border p-3 text-left transition ${!choosingReturn ? 'border-accent bg-accent-soft' : 'border-app bg-card hover:border-accent/50'}`}>
          <span className="block text-xs font-medium text-sec">{value.date_flexible ? 'Earliest pickup' : 'Pickup'}</span><span className="mt-1 block text-sm font-semibold text-main">{label(pickup)}</span>
        </button>
        <button type="button" aria-pressed={choosingReturn} onClick={() => setChoosingReturn(true)} className={`rounded-card border p-3 text-left transition ${choosingReturn ? 'border-accent bg-accent-soft' : 'border-app bg-card hover:border-accent/50'}`}>
          <span className="block text-xs font-medium text-sec">{value.date_flexible ? 'Latest return' : 'Return'}</span><span className="mt-1 block text-sm font-semibold text-main">{label(returnDate)}</span>
        </button>
      </div>
      {validStart ? <div className="owner-auction-calendar rounded-card border border-app bg-card p-2">
        <div className="flex items-center justify-between gap-2">
          <button type="button" aria-label="Previous month" disabled={month.getFullYear() === parseDate(minDate).getFullYear() && month.getMonth() <= parseDate(minDate).getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-card text-sec hover:bg-subtle disabled:opacity-35"><ChevronLeft size={18} /></button>
          <p role="status" aria-live="polite" className="text-center text-xs font-medium text-sec">{choosingReturn ? 'Choose the return date' : 'Choose the pickup date'}</p>
          <button type="button" aria-label="Next month" disabled={month.getFullYear() === parseDate(maxDate).getFullYear() && month.getMonth() >= parseDate(maxDate).getMonth()} onClick={() => setMonth(nextMonth)} className="grid h-11 w-11 shrink-0 place-items-center rounded-card text-sec hover:bg-subtle disabled:opacity-35"><ChevronRight size={18} /></button>
        </div>
        <MonthGrid monthDate={month} todayStr={today} minDate={minDate} maxDate={maxDate} draftStart={pickup || null} draftEnd={returnDate || null} bookedDates={NO_DATES} blockedDates={NO_DATES} onPick={pick} />
      </div> : <p className="text-sm text-sec">Set listing availability before enabling bidding.</p>}
      </div>
      <div className="owner-auction-schedule space-y-4">
      <label className="block text-sm font-medium text-main" htmlFor="auction-opening-rate">Starting bid per day (USD)
        <input id="auction-opening-rate" type="number" min="0.01" max="100000" step="0.01" inputMode="decimal"
          value={value.opening_daily_rate ?? askingPrice ?? ''}
          onChange={event => onChange({ ...value, opening_daily_rate: event.target.value ? Number(event.target.value) : null })}
          className={`${fieldClass()} mt-1`} />
        <span className="mt-1 block text-xs font-normal text-sec">The listing price is used when no separate starting bid is entered.</span>
      </label>
      {validStart && <>
          {!value.starts_immediately && <BiddingDateTime label="Bidding opens"
            min={localInputValue(new Date(Math.max(Date.now() + 60_000, new Date(`${start}T00:00:00`).getTime())).toISOString())}
            value={value.bidding_starts_at}
            onChange={time => onChange({ ...value, bidding_starts_at: time })} />}
          <BiddingDateTime label="Bidding closes"
              min={value.starts_immediately
                ? localInputValue(new Date(Date.now() + 11 * 60_000).toISOString())
                : value.bidding_starts_at ? localInputValue(new Date(Date.parse(value.bidding_starts_at) + 10 * 60_000).toISOString()) : undefined}
              max={localInputValue(new Date(parseDate(pickup || start).getTime() - 2 * 60 * 60_000).toISOString())}
              value={value.bidding_ends_at}
              onChange={time => onChange({ ...value, bidding_ends_at: time })} />
        <p className="text-xs leading-relaxed text-sec">Scheduled bidding opens no earlier than {label(start)}. Closing defaults to 10 pm the day before your earliest pickup ({label(pickup || start)}). Changing pickup updates closing. You can close earlier, but never less than 2 hours before pickup.</p>
      </>}
      </div>
      </div>
      {pickup && returnDate && <p role="status" className="text-xs text-sec">{value.date_flexible ? 'Bidding window: ' : 'Bids cover '}<strong className="text-main">{label(pickup)} – {label(returnDate)}</strong>. Other dates remain available for regular rentals.</p>}
      <details className="border-t border-app pt-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium text-main">How bids and deadlines work</summary>
        <p className="mt-2 text-xs leading-relaxed text-sec">{BIDDING_RULES_TEXT}</p>
      </details>
    </fieldset>}
    {error && <p id="listing-auction-error" role="alert" className="text-xs text-error">{error}</p>}
  </section>;
}
