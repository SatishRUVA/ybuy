import { useMemo, useState } from 'react';
import { CalendarCheck2, Lock } from 'lucide-react';
import { Calendar } from './calendar';
import { MAX_WINDOW_DAYS, addDays, eachDay, lockedDays, parseIso, rangeLabel, shortDate, todayIso, type Avail } from './dates';
import { Btn } from './ui';

/**
 * Owner-side availability: choose a window of up to 30 days, then block individual days inside it.
 * Used when creating a listing and again from "Edit listing".
 */
export function AvailabilityEditor({ listingId, value, onChange, confirmedDays }: {
  listingId?: string;
  value: Avail;
  onChange: (next: Avail) => void;
  /** Days already promised to renters (editing an existing listing). */
  confirmedDays?: string[];
}) {
  const locked = useMemo(() => new Set(confirmedDays ?? (listingId ? lockedDays(listingId) : [])), [confirmedDays, listingId]);
  const [draftStart, setDraftStart] = useState(value.start);
  const [draftEnd, setDraftEnd] = useState(value.end);
  const [problem, setProblem] = useState('');
  const blocked = useMemo(() => new Set(value.blocked), [value.blocked]);

  const windowDays = value.start && value.end ? eachDay(value.start, value.end) : [];
  const openCount = windowDays.filter((d) => !blocked.has(d) && !locked.has(d)).length;
  const maxEnd = draftStart && !draftEnd ? addDays(draftStart, MAX_WINDOW_DAYS - 1) : undefined;

  const setWindow = (start: string, end: string) => {
    setDraftStart(start);
    setDraftEnd(end);
    if (!start || !end) return;
    const outside = [...locked].filter((d) => d < start || d > end);
    if (outside.length) {
      setProblem(`Confirmed bookings on ${outside.map(shortDate).join(' and ')} have to stay inside your window.`);
      setDraftStart(value.start);
      setDraftEnd(value.end);
      return;
    }
    setProblem('');
    onChange({ start, end, blocked: value.blocked.filter((d) => d >= start && d <= end) });
  };

  const toggle = (day: string) => {
    if (locked.has(day)) return;
    onChange({ ...value, blocked: blocked.has(day) ? value.blocked.filter((d) => d !== day) : [...value.blocked, day] });
  };
  const blockWeekends = () => {
    const weekends = windowDays.filter((d) => [0, 6].includes(parseIso(d).getDay()) && !locked.has(d));
    onChange({ ...value, blocked: [...new Set([...value.blocked, ...weekends])] });
  };

  return (
    <div className="space-y-10">
      <section aria-labelledby="win">
        <h3 id="win" className="font-display text-xl font-bold">1. When can people rent it?</h3>
        <p className="mt-1 text-sec">Open it for up to {MAX_WINDOW_DAYS} days at a time. You can extend it later from Edit listing.</p>
        <div className="mt-4 rounded-[1.5rem] bg-card p-4 sm:p-6">
          <Calendar mode="range" start={draftStart} end={draftEnd} onRange={setWindow} min={todayIso()} max={maxEnd} maxSpan={MAX_WINDOW_DAYS} twoUp fluid />
        </div>
        <p role="status" className={`mt-3 text-sm font-semibold ${problem ? 'text-error' : 'text-sec'}`}>
          {problem || (value.start && value.end && draftEnd ? `Open ${rangeLabel(value.start, value.end)} · ${windowDays.length} of ${MAX_WINDOW_DAYS} days` : draftStart ? `Pick your last open day (up to ${shortDate(addDays(draftStart, MAX_WINDOW_DAYS - 1))}).` : 'Pick your first open day.')}
        </p>
      </section>

      <section aria-labelledby="blk" aria-disabled={!value.start || !value.end}>
        <h3 id="blk" className="font-display text-xl font-bold">2. Block days you can’t lend it</h3>
        <p className="mt-1 text-sec">Tap any open day to block it, or tap it again to open it back up. Trips, family time, anything.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn size="sm" tone="soft" onClick={blockWeekends} disabled={!windowDays.length}>Block weekends</Btn>
          <Btn size="sm" tone="ghost" onClick={() => onChange({ ...value, blocked: [] })} disabled={!value.blocked.length}>Clear blocked days</Btn>
          <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-4 py-2 text-sm font-semibold"><CalendarCheck2 size={16} aria-hidden="true" className="text-accent" />{openCount} open · {value.blocked.length} blocked</span>
        </div>
        <div className="mt-4 rounded-[1.5rem] bg-card p-4 sm:p-6">
          {windowDays.length ? (
            <Calendar mode="toggle" key={`${value.start}-${value.end}`} start={value.start} end={value.end} blocked={blocked} locked={locked} onToggle={toggle} twoUp fluid />
          ) : <p className="py-10 text-center text-sec">Choose your window above to start blocking days.</p>}
        </div>
        {locked.size > 0 && (
          <p className="mt-3 flex items-start gap-2 text-sm text-sec"><Lock size={15} aria-hidden="true" className="mt-0.5 shrink-0" />{[...locked].map(shortDate).join(' and ')} are booked by a renter, so they can’t be changed. Message them if you need to cancel.</p>
        )}
      </section>
    </div>
  );
}
