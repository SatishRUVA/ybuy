import { useState, useRef, useEffect } from 'react';
import { Calendar, CalendarDays, ChevronLeft, ChevronRight, ChevronDown, X, ArrowRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { todayIso, addDaysIso, MAX_BOOKING_RANGE_DAYS } from '@/lib/geo';
import { Overlay } from '@/components/ui';
import { pickupToday } from '@/lib/pickup-timezone';

type PresetKey = 'custom' | 'today' | 'tomorrow' | 'weekend' | 'next7' | 'next30';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'custom', label: 'Custom dates' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'next7', label: 'Next 7 days' },
  { key: 'next30', label: 'Next 30 days' },
];

function presetRange(key: PresetKey, today = todayIso()): { start: string; end: string } {
  switch (key) {
    case 'today': return { start: today, end: addDaysIso(today, 1) };
    case 'tomorrow': { const t = addDaysIso(today, 1); return { start: t, end: addDaysIso(t, 1) }; }
    case 'weekend': {
      const dow = parseIsoLocal(today).getDay();
      const toSat = (6 - dow + 7) % 7;
      const sat = addDaysIso(today, toSat);
      return { start: sat, end: addDaysIso(sat, 2) };
    }
    case 'next7': return { start: today, end: addDaysIso(today, 7) };
    case 'next30': return { start: today, end: addDaysIso(today, Math.min(30, MAX_BOOKING_RANGE_DAYS)) };
    default: return { start: today, end: addDaysIso(today, 1) };
  }
}

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatIsoLocal(iso: string, options: Intl.DateTimeFormatOptions): string {
  return parseIsoLocal(iso).toLocaleDateString(undefined, options);
}

function daysBetweenIso(start: string, end: string): number {
  const s = parseIsoLocal(start);
  const e = parseIsoLocal(end);
  const sUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const eUtc = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.max(0, Math.round((eUtc - sUtc) / 86400000));
}

function monthLabel(d: Date) { return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function fmtRangeShort(start: string, end: string) {
  if (!start || !end) return 'Add dates';
  const s = formatIsoLocal(start, { month: 'short', day: 'numeric' });
  const e = formatIsoLocal(end, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s} – ${e}`;
}
function fmtRangeTiny(start: string, end: string) {
  const s = formatIsoLocal(start, { month: 'short', day: 'numeric' });
  const e = formatIsoLocal(end, { month: 'short', day: 'numeric' });
  return `${s} – ${e}`;
}

function rangeHasUnavailable(start: string, end: string, bookedDates: Set<string>, blockedDates: Set<string>): boolean {
  for (let date = start; date < end; date = addDaysIso(date, 1)) {
    if (bookedDates.has(date) || blockedDates.has(date)) return true;
  }
  return false;
}

export function MonthGrid({
  monthDate, todayStr, minDate, draftStart, draftEnd, maxDate, bookedDates, blockedDates, onPick, showMonthLabel = true,
}: {
  monthDate: Date; todayStr: string; minDate: string; draftStart: string | null; draftEnd: string | null; maxDate: string; bookedDates: Set<string>; blockedDates: Set<string>; onPick: (iso: string) => void; showMonthLabel?: boolean;
}) {
  const firstWeekday = monthDate.getDay();
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null)];
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return (
    <div className="flex-1">
      {showMonthLabel && <p aria-live="polite" className="text-base font-bold tracking-tight text-main mb-5 text-center">{monthLabel(monthDate)}</p>}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-x-1 gap-y-1.5 sm:gap-y-2">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isBooked = bookedDates.has(date);
          const isBlocked = blockedDates.has(date);
          const disabled = date < minDate || date > maxDate || isBooked || isBlocked;
          const isStart = date === draftStart;
          const isEnd = date === draftEnd;
          const isToday = date === todayStr;
          const inRange = draftStart && draftEnd && date > draftStart && date < draftEnd;
          const [year, month, day] = date.split('-').map(Number);
          const accessibleDate = new Date(year, month - 1, day).toLocaleDateString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          });
          const selection = isStart ? 'start date of selected range'
            : isEnd ? 'end date of selected range'
              : inRange ? 'within selected range'
                : undefined;
          let tone = 'text-main hover:bg-subtle hover:text-accent';
          if (isBooked) tone = 'text-muted opacity-45 cursor-not-allowed line-through';
          else if (isBlocked) tone = 'text-warning opacity-55 cursor-not-allowed';
          else if (disabled) tone = 'text-muted opacity-30 cursor-not-allowed';
          else if (isStart || isEnd) tone = 'bg-accent text-accent-text font-semibold shadow-sm';
          else if (inRange) tone = 'bg-accent-soft text-accent font-semibold';
          else if (isToday) tone = 'text-accent font-semibold ring-1 ring-inset ring-accent hover:bg-accent-soft';
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              aria-label={`${accessibleDate}${selection ? `, ${selection}` : ''}${isBooked ? ', booked' : isBlocked ? ', unavailable' : ''}`}
              aria-pressed={Boolean(isStart || isEnd || inRange)}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onPick(date)}
              onKeyDown={(event) => {
                const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -new Date(`${date}T12:00:00`).getDay(), End: 6 - new Date(`${date}T12:00:00`).getDay() }[event.key];
                if (offset === undefined) return;
                event.preventDefault();
                const next = addDaysIso(date, offset);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button[data-date="${next}"]:not(:disabled)`)?.focus();
              }}
              data-date={date}
              title={isBooked ? 'Booked' : isBlocked ? 'Blocked' : undefined}
              className={`relative aspect-square min-h-11 sm:min-h-12 rounded-xl text-sm sm:text-[15px] font-medium transition-[color,background-color,box-shadow] duration-fast focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${tone}`}
            >
              {Number(date.slice(-2))}
              {(isBooked || isBlocked) && <span aria-hidden="true" className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isBooked ? 'bg-muted' : 'bg-warning'}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Premium dual-month date-range picker with quick presets, replacing plain native date inputs. */
const NO_DATES: Set<string> = new Set();

export function DateRangePicker({
  startDate, endDate, onChange,
  mode = 'dual', bookedDates = NO_DATES, blockedDates = NO_DATES,
  minimumDate, maximumDate, timeZone,
  presentation = 'dialog',
}: {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  mode?: 'dual' | 'range';
  bookedDates?: Set<string>;
  blockedDates?: Set<string>;
  minimumDate?: string | null;
  maximumDate?: string | null;
  timeZone?: string | null;
  presentation?: 'dialog' | 'listing' | 'search';
}) {
  const [open, setOpen] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState<string | null>(endDate);
  const [activePreset, setActivePreset] = useState<PresetKey>('custom');
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const reduceMotion = useReducedMotion();
  const [position, setPosition] = useState<{ left: number; top: number } | undefined>();
  const compact = presentation === 'listing';
  const todayStr = timeZone ? pickupToday(timeZone) : todayIso();
  const minDate = minimumDate && minimumDate > todayStr ? minimumDate : todayStr;
  const horizon = addDaysIso(todayStr, MAX_BOOKING_RANGE_DAYS);
  const maxDate = maximumDate && maximumDate < horizon ? maximumDate : horizon;
  const validRange = (start: string, end: string) => start >= minDate && end > start && end <= maxDate
    && !rangeHasUnavailable(start, end, bookedDates, blockedDates);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!open || !compact) return;
    function placePanel() {
      if (!window.matchMedia('(min-width: 641px)').matches) { setPosition(undefined); return; }
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!trigger || !panel) return;
      const below = trigger.bottom + 10;
      const above = trigger.top - panel.height - 10;
      setPosition({
        left: Math.max(12, Math.min(trigger.right - panel.width, window.innerWidth - panel.width - 12)),
        top: Math.max(12, Math.min(below + panel.height <= window.innerHeight - 12 ? below : above, window.innerHeight - panel.height - 12)),
      });
    }
    const frame = requestAnimationFrame(placePanel);
    window.addEventListener('resize', placePanel);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', placePanel); };
  }, [open, compact, monthOffset]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const frame = requestAnimationFrame(() => {
        const firstDate = panelRef.current?.querySelector<HTMLButtonElement>('button[data-date]:not(:disabled)');
        // The first enabled date can be several rows below the start of the month.
        // Focusing it normally scrolls both the calendar and page on smaller screens,
        // hiding the month header as soon as the dialog opens.
        firstDate?.focus({ preventScroll: true });
        const calendarBody = panelRef.current?.querySelector<HTMLElement>('.calendar-dialog-body');
        if (firstDate && calendarBody && window.matchMedia('(max-height: 600px)').matches) {
          const dateTop = firstDate.getBoundingClientRect().top;
          const bodyTop = calendarBody.getBoundingClientRect().top;
          calendarBody.scrollTop += dateTop - bodyTop - 88;
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function openPicker() {
    const safeStart = startDate >= minDate && startDate <= maxDate ? startDate : '';
    setDraftStart(safeStart);
    setDraftEnd(safeStart && endDate > safeStart && endDate <= maxDate ? endDate : null);
    const firstMonth = parseIsoLocal(safeStart || minDate);
    const currentMonth = parseIsoLocal(todayStr);
    setMonthOffset(Math.max(0, (firstMonth.getFullYear() - currentMonth.getFullYear()) * 12 + firstMonth.getMonth() - currentMonth.getMonth()));
    setOpen(true);
  }

  function handlePick(date: string) {
    if (date < minDate || date > maxDate) return;
    setActivePreset('custom');
    if (!draftStart || (draftStart && draftEnd)) { setDraftStart(date); setDraftEnd(null); return; }
    if (date <= draftStart) { setDraftStart(date); setDraftEnd(null); return; }
    const end = date > maxDate ? maxDate : date;
    // A range can't span a taken date, so restart the selection from the clicked day.
    if (rangeHasUnavailable(draftStart, end, bookedDates, blockedDates)) { setDraftStart(date); setDraftEnd(null); return; }
    setDraftEnd(end);
  }

  function handlePreset(key: PresetKey) {
    setActivePreset(key);
    if (key === 'custom') return;
    const range = presetRange(key, todayStr);
    setDraftStart(range.start);
    setDraftEnd(range.end);
  }

  function handleApply() {
    if (!draftStart || !draftEnd || !validRange(draftStart, draftEnd)) return;
    onChange(draftStart, draftEnd);
    setOpen(false);
  }

  function handleClear() {
    setDraftStart('');
    setDraftEnd(null);
    setActivePreset('custom');
    onChange('', '');
    setOpen(false);
  }

  const calendarToday = parseIsoLocal(todayStr);
  const leftMonth = new Date(calendarToday.getFullYear(), calendarToday.getMonth() + monthOffset, 1);
  const rightMonth = new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1);
  const nights = draftStart && draftEnd ? daysBetweenIso(draftStart, draftEnd) : 0;
  const triggerDateLabel = fmtRangeShort(startDate, endDate);
  const datePickerPanel = (
    <Overlay className={`flex ${compact ? 'items-center justify-center p-3 listing-calendar-layer' : 'items-end justify-center sm:items-center sm:p-5'} ${open ? '' : 'pointer-events-none'}`}>
      <AnimatePresence initial={false}>
        {open && <motion.button
          key="calendar-backdrop"
          type="button"
          aria-label="Close date picker"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 ${compact ? 'bg-black/20' : 'bg-black/50'}`}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
        />}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {open && <motion.div
          key="date-range-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Choose rental dates"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
            if (event.key === 'Tab') {
              const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)');
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}
          initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 18, scale: 0.99 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          style={compact && position ? { position: 'fixed', ...position } : undefined}
          className={`calendar-dialog relative z-[201] flex w-full max-w-[960px] flex-col overflow-hidden rounded-t-card-xl border border-app bg-card shadow-pop sm:rounded-card-xl${compact ? ' listing-calendar-popover' : ''}`}
        >
          <header className="calendar-dialog-header shrink-0">
            <div className="calendar-dialog-heading">
              <span className="calendar-dialog-icon"><CalendarDays size={20} aria-hidden="true" /></span>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-main">Choose rental dates</h2>
                <p className="mt-1 text-sm text-sec">Pick your pickup and return days.</p>
              </div>
            </div>
            <div className="calendar-range-pair" aria-live="polite">
              <div className={draftStart ? 'calendar-range-value is-selected' : 'calendar-range-value'}>
                <span>Pickup</span><strong>{draftStart ? formatIsoLocal(draftStart, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Add date'}</strong>
              </div>
              <ArrowRight size={16} className="calendar-range-arrow" aria-hidden="true" />
              <div className={draftEnd ? 'calendar-range-value is-selected' : 'calendar-range-value'}>
                <span>Return</span><strong>{draftEnd ? formatIsoLocal(draftEnd, { month: 'short', day: 'numeric', year: 'numeric' }) : draftStart ? 'Choose date' : 'Add date'}</strong>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close calendar" className="calendar-close grid h-11 w-11 place-items-center rounded-full text-sec hover:bg-subtle">
              <X size={19} />
            </button>
          </header>

          {!compact && <div className="calendar-dialog-presets shrink-0" aria-label="Quick date choices">
            {PRESETS.filter((preset) => preset.key !== 'custom').map((preset) => (
              <button
                key={preset.key}
                type="button"
                disabled={!validRange(presetRange(preset.key, todayStr).start, presetRange(preset.key, todayStr).end)}
                onClick={() => handlePreset(preset.key)}
                className={`calendar-preset${activePreset === preset.key ? ' is-active' : ''}`}
              >
                {preset.label}
              </button>
            ))}
          </div>}

          <div className="calendar-dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="calendar-dialog-toolbar">
              <span>{compact ? 'Select pickup, then return' : 'Dates before today are unavailable'}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setMonthOffset((offset) => Math.max(0, offset - 1))} disabled={monthOffset === 0} className="calendar-month-nav" aria-label="Previous month">
                  <ChevronLeft size={18} />
                </button>
                <button type="button" onClick={() => setMonthOffset((offset) => offset + 1)} disabled={new Date(rightMonth.getFullYear(), rightMonth.getMonth(), 1) > parseIsoLocal(maxDate)} className="calendar-month-nav" aria-label="Next month">
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="calendar-months">
              <MonthGrid monthDate={leftMonth} todayStr={todayStr} minDate={minDate} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} bookedDates={bookedDates} blockedDates={blockedDates} onPick={handlePick} />
              <MonthGrid monthDate={rightMonth} todayStr={todayStr} minDate={minDate} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} bookedDates={bookedDates} blockedDates={blockedDates} onPick={handlePick} />
            </div>
          </div>

          <footer className="calendar-dialog-footer shrink-0">
            <button type="button" onClick={handleClear} className="calendar-clear min-h-11 px-2 text-sm font-semibold">Clear dates</button>
            <div className="calendar-footer-summary" aria-live="polite">
              <span>{draftStart && draftEnd ? `${nights} ${compact ? `rental day${nights === 1 ? '' : 's'}` : `night${nights === 1 ? '' : 's'}`}` : draftStart ? 'Select your return date' : 'No dates selected'}</span>
              <strong>{draftStart && draftEnd ? fmtRangeTiny(draftStart, draftEnd) : draftStart ? formatIsoLocal(draftStart, { month: 'short', day: 'numeric' }) : ''}</strong>
            </div>
            <button type="button" onClick={handleApply} disabled={!draftStart || !draftEnd || !validRange(draftStart, draftEnd)} className="calendar-apply">Use these dates</button>
          </footer>
        </motion.div>}
      </AnimatePresence>
    </Overlay>
  );

  return (
    // No z-index here: it would cap the panel below the shared dim Overlay (z-200).
    <div ref={ref} className={presentation === 'search' ? 'p1-search-date relative' : 'relative'}>
      {presentation === 'search' ? (
        <button ref={triggerRef} type="button" className="p1-date-trigger w-full"
          aria-haspopup="dialog" aria-expanded={open}
          aria-label={`Choose a date range${startDate ? `, ${triggerDateLabel}` : ''}`}
          onClick={() => open ? setOpen(false) : openPicker()}>
          <CalendarDays size={20} aria-hidden="true" />
          <span><small>When?</small><strong>{triggerDateLabel}</strong></span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      ) : compact ? (
        <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open}
          aria-label={`Choose a date range${startDate ? `, ${triggerDateLabel}` : ''}`}
          onClick={() => open ? setOpen(false) : openPicker()}
          className={`listing-date-range-trigger${open ? ' is-open' : ''}`}>
          <CalendarDays size={19} aria-hidden="true" />
          <span className="listing-date-range-value"><strong>{startDate ? formatIsoLocal(startDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Add date'}</strong><span>Pickup</span></span>
          <ChevronRight size={17} aria-hidden="true" className="text-muted shrink-0" />
          <span className="listing-date-range-value"><strong>{endDate ? formatIsoLocal(endDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Add date'}</strong><span>Return</span></span>
          <ChevronDown size={16} aria-hidden="true" className="text-sec shrink-0" />
        </button>
      ) : mode === 'range' ? (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Choose a date range${startDate ? `, ${triggerDateLabel}` : ''}`}
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="calendar-trigger w-full min-h-11 flex items-center justify-between gap-2 px-0 py-1 text-sm text-main"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Calendar size={16} className="text-accent shrink-0" />
            <span className="min-w-0 text-left"><span className="calendar-trigger-kicker">Date range</span><span className="block truncate">{triggerDateLabel}</span></span>
          </span>
          <ChevronDown size={14} className={`text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Choose a date range${startDate ? `, ${triggerDateLabel}` : ''}`}
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="calendar-trigger flex min-w-0 items-center gap-2 px-3.5 min-h-12 rounded-full text-sm font-medium text-main hover:bg-subtle transition-colors duration-fast whitespace-nowrap"
        >
          <Calendar size={16} className="text-accent shrink-0" />
          <span className="min-w-0 text-left"><span className="calendar-trigger-kicker">Date range</span><span className="block truncate">{triggerDateLabel}</span></span>
          <ChevronDown size={14} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {datePickerPanel}
    </div>
  );
}
