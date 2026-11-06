import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MonthGrid } from '@/main-site/components/date-range-picker';
import { IconButton } from '@/main-site/components/ui';
import { addDaysIso, todayIso } from '@/lib/geo';
import { LISTING_MAX_AVAILABLE_DAYS, LISTING_SCHEDULING_DAYS, listingAvailabilityError } from '@/lib/listing-availability';

const NO_DATES = new Set<string>();
const label = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function ListingAvailabilityPicker({ start, end, onChange, error, today = todayIso() }: {
  start: string; end: string; onChange: (start: string, end: string) => void; error?: string; today?: string;
}) {
  const horizon = addDaysIso(today, LISTING_SCHEDULING_DAYS);
  const lastStart = addDaysIso(horizon, -1);
  const initial = new Date(`${start >= today && start <= lastStart ? start : today}T12:00:00`);
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [choosingEnd, setChoosingEnd] = useState(false);
  const [monthDirection, setMonthDirection] = useState(1);
  const [selectionError, setSelectionError] = useState<string>();
  const reducedMotion = useReducedMotion();
  const minimum = choosingEnd ? start || today : today;
  const lastAvailable = end ? addDaysIso(end, -1) : '';
  const rangeEnd = start ? addDaysIso(start, LISTING_MAX_AVAILABLE_DAYS - 1) : lastStart;
  const maximum = choosingEnd ? (rangeEnd < lastStart ? rangeEnd : lastStart) : lastStart;
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const firstMonth = new Date(`${minimum}T12:00:00`);
  const lastMonth = new Date(`${maximum}T12:00:00`);
  const monthNumber = (date: Date) => date.getFullYear() * 12 + date.getMonth();
  const days = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) : 0;
  const currentError = selectionError || error;

  function pick(date: string) {
    setSelectionError(undefined);
    if (!choosingEnd) {
      onChange(date, addDaysIso(date, 1));
      setChoosingEnd(true);
      return;
    }
    const exclusiveEnd = addDaysIso(date, 1);
    const invalid = listingAvailabilityError(start, exclusiveEnd, today);
    if (invalid) { setSelectionError(invalid); return; }
    onChange(start, exclusiveEnd);
    setChoosingEnd(false);
  }

  return <section id="listing-availability" tabIndex={-1} aria-label="Listing availability" aria-describedby={currentError ? 'listing-availability-error' : undefined} className="space-y-4">
    <p className="text-sm text-sec">Choose the first and last days your item can be rented, including both dates. Select the same date for one day, or up to 30 days. Then block any unavailable days.</p>
    <div className="grid grid-cols-2 gap-3" aria-label="Selected availability dates">
      <button type="button" aria-pressed={!choosingEnd} onClick={() => { setChoosingEnd(false); const date = new Date(`${start || today}T12:00:00`); setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }}
        className={`rounded-card-lg border p-3 text-left transition ${!choosingEnd ? 'border-accent bg-accent-soft ring-1 ring-accent/20' : 'border-app bg-card hover:border-accent/50'}`}>
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-sec">Available from</span>
        <span className="mt-1 block text-sm font-bold text-main">{start ? label(start) : 'Choose date'}</span>
      </button>
      <button type="button" aria-pressed={choosingEnd} onClick={() => { setChoosingEnd(true); const date = new Date(`${lastAvailable && lastAvailable <= lastStart ? lastAvailable : start || today}T12:00:00`); setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }}
        className={`rounded-card-lg border p-3 text-left transition ${choosingEnd ? 'border-accent bg-accent-soft ring-1 ring-accent/20' : 'border-app bg-card hover:border-accent/50'}`}>
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-sec">Available through</span>
        <span className="mt-1 block text-sm font-bold text-main">{lastAvailable ? label(lastAvailable) : 'Choose date'}</span>
      </button>
    </div>
    <div className="flex items-center justify-between gap-3">
      <IconButton label="Previous availability month" variant="ghost" disabled={monthNumber(month) <= monthNumber(firstMonth)}
        onClick={() => { setMonthDirection(-1); setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); }}><ChevronLeft size={18} aria-hidden="true" /></IconButton>
      <motion.p key={choosingEnd ? 'return-date' : 'pickup-date'} initial={reducedMotion ? false : { y: 4 }} animate={{ y: 0 }}
        className="text-center" role="status" aria-live="polite">
        <span className="block text-sm font-semibold text-main">{choosingEnd ? 'Choose the last available day' : 'Choose the first available day'}</span>
        <span className="block text-xs text-sec">{`${label(minimum)} through ${label(maximum)}`}</span>
      </motion.p>
      <IconButton label="Next availability month" variant="ghost" disabled={monthNumber(month) >= monthNumber(lastMonth)}
        onClick={() => { setMonthDirection(1); setMonth(nextMonth); }}><ChevronRight size={18} aria-hidden="true" /></IconButton>
    </div>
      <motion.div key={`${month.getFullYear()}-${month.getMonth()}`} initial={reducedMotion ? false : { x: monthDirection * 14 }}
        animate={{ x: 0 }} transition={{ duration: 0.15, ease: 'easeOut' }}
        className="owner-availability-months grid sm:grid-cols-2 gap-3 rounded-card-lg border border-app bg-card p-2 sm:p-3">
        {[month, nextMonth].map((date, index) => <div key={date.toISOString()} className={index ? 'hidden sm:block' : ''}>
          <MonthGrid monthDate={date} todayStr={today} minDate={minimum} maxDate={maximum}
            draftStart={start} draftEnd={lastAvailable} bookedDates={NO_DATES} blockedDates={NO_DATES} onPick={pick} />
        </div>)}
      </motion.div>
    {currentError && <p id="listing-availability-error" role="alert" className="text-sm text-error mt-3">{currentError}</p>}
    <div className="rounded-card bg-accent-soft p-3 mt-3" role="status">
      <p className="text-xs font-semibold text-accent">Selected availability</p>
      <p className="mt-1 text-sm font-semibold text-main">{start && end ? `Available ${label(start)} through ${label(lastAvailable)}` : 'Choose your dates'} {days > 0 && <span className="block text-xs font-normal text-sec mt-1">{days} available {days === 1 ? 'day' : 'days'}, including both dates. Renters return the item by {label(end)}.</span>}</p>
    </div>
  </section>;
}
