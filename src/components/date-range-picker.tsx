import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { todayIso, addDaysIso, MAX_BOOKING_RANGE_DAYS } from '@/lib/geo';
import { Overlay } from '@/components/ui';

type PresetKey = 'custom' | 'today' | 'tomorrow' | 'weekend' | 'next7' | 'next30';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'custom', label: 'Custom dates' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'next7', label: 'Next 7 days' },
  { key: 'next30', label: `Next ${MAX_BOOKING_RANGE_DAYS} days` },
];

function presetRange(key: PresetKey): { start: string; end: string } {
  const today = todayIso();
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

function MonthGrid({
  monthDate, todayStr, draftStart, draftEnd, maxDate, bookedDates, blockedDates, onPick,
}: {
  monthDate: Date; todayStr: string; draftStart: string | null; draftEnd: string | null; maxDate: string; bookedDates: Set<string>; blockedDates: Set<string>; onPick: (iso: string) => void;
}) {
  const firstWeekday = monthDate.getDay();
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null)];
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return (
    <div className="flex-1">
      <p className="text-sm font-bold text-main mb-3 text-center">{monthLabel(monthDate)}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isBooked = bookedDates.has(date);
          const isBlocked = blockedDates.has(date);
          const disabled = date < todayStr || date > maxDate || isBooked || isBlocked;
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
          let tone = 'text-main hover:bg-subtle';
          if (isBooked) tone = 'text-muted opacity-45 cursor-not-allowed line-through';
          else if (isBlocked) tone = 'text-warning opacity-55 cursor-not-allowed';
          else if (disabled) tone = 'text-muted opacity-30 cursor-not-allowed';
          else if (isStart || isEnd) tone = 'bg-accent text-accent-text font-semibold';
          else if (inRange) tone = 'bg-accent-soft text-accent';
          else if (isToday) tone = 'text-accent font-semibold ring-1 ring-inset ring-accent hover:bg-subtle';
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              aria-label={`${accessibleDate}${selection ? `, ${selection}` : ''}${isBooked ? ', booked' : isBlocked ? ', unavailable' : ''}`}
              aria-pressed={Boolean(isStart || isEnd || inRange)}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onPick(date)}
              title={isBooked ? 'Booked' : isBlocked ? 'Blocked' : undefined}
              className={`relative aspect-square rounded-full text-xs transition-colors duration-fast ${tone}`}
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
}: {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  mode?: 'dual' | 'range';
  bookedDates?: Set<string>;
  blockedDates?: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState<string | null>(endDate);
  const [activePreset, setActivePreset] = useState<PresetKey>('custom');
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const naturalPanelHeight = useRef<number | null>(null);
  const [desktopLayout, setDesktopLayout] = useState<{ above: boolean; maxHeight: number } | null>(null);
  const todayStr = todayIso();
  const maxDate = addDaysIso(todayStr, MAX_BOOKING_RANGE_DAYS);

  useEffect(() => {
    if (mode === 'range') return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mode]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || mode === 'range') return;
    let frame = 0;
    function measure() {
      const trigger = ref.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      naturalPanelHeight.current ??= panel.scrollHeight;
      const gap = 8;
      const viewportPadding = 12;
      const below = window.innerHeight - trigger.bottom - gap - viewportPadding;
      const above = trigger.top - gap - viewportPadding;
      const naturalHeight = naturalPanelHeight.current;
      const placeAbove = naturalHeight > below && above > below;
      const availableHeight = placeAbove ? above : below;
      const comfortableHeight = Math.min(560, Math.floor(window.innerHeight * 0.72));
      const next = { above: placeAbove, maxHeight: Math.max(220, Math.min(naturalHeight, availableHeight, comfortableHeight)) };
      setDesktopLayout((current) => current?.above === next.above && current.maxHeight === next.maxHeight ? current : next);
    }
    function scheduleMeasure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [open, mode, monthOffset]);

  function openPicker() {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setMonthOffset(0);
    setDesktopLayout(null);
    naturalPanelHeight.current = null;
    setOpen(true);
  }

  function handlePick(date: string) {
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
    const range = presetRange(key);
    setDraftStart(range.start);
    setDraftEnd(range.end);
  }

  function handleApply() {
    if (draftStart && draftEnd) onChange(draftStart, draftEnd);
    setOpen(false);
  }

  function handleClear() {
    setDraftStart('');
    setDraftEnd(null);
    setActivePreset('custom');
    onChange('', '');
    setOpen(false);
  }

  const leftMonth = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const rightMonth = new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1);
  const nights = draftStart && draftEnd ? daysBetweenIso(draftStart, draftEnd) : 0;
  const datePickerPanel = open && (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={mode === 'range' ? true : undefined}
      aria-label="Select dates"
      style={mode === 'dual' && desktopLayout ? { maxHeight: desktopLayout.maxHeight } : undefined}
      className={`flex flex-col bg-card border border-app shadow-pop animate-modal overflow-hidden ${mode === 'range'
        ? 'relative w-full max-h-[88dvh] rounded-t-card-xl pb-[env(safe-area-inset-bottom)]'
        : `absolute z-[210] ${desktopLayout?.above ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 w-[min(92vw,680px)] max-w-[92vw] max-h-[min(80dvh,560px)] rounded-card-xl`
      }`}
    >
      <div className="shrink-0 p-3.5 sm:p-2.5 border-b border-app">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-semibold text-main">Select dates</h4>
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleClear} className="min-h-9 text-xs text-accent font-semibold hover:underline">Clear dates</button>
            {mode === 'range' && (
              <button type="button" onClick={() => setOpen(false)} aria-label="Close calendar" className="grid place-items-center w-9 h-9 rounded-full hover:bg-subtle">
                <X size={18} className="text-sec" />
              </button>
            )}
          </div>
        </div>
        <div className="hidden sm:flex mt-1.5 items-center gap-1 overflow-x-auto no-scrollbar">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => handlePreset(p.key)}
              className={`px-2.5 py-1 rounded-card-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activePreset === p.key ? 'bg-accent-soft text-accent' : 'text-sec hover:bg-subtle'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 sm:p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonthOffset((o) => Math.max(0, o - 1))} disabled={monthOffset === 0} className="grid place-items-center w-9 h-9 rounded-card text-sec hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Previous month">
              <ChevronLeft size={17} />
            </button>
            <button type="button" onClick={() => setMonthOffset((o) => o + 1)} className="grid place-items-center w-9 h-9 rounded-card text-sec hover:bg-subtle" aria-label="Next month">
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
        <div className="flex flex-col xl:flex-row gap-4">
          {/* xl:hidden, not lg:hidden - otherwise 1024-1279px renders no calendar at all. */}
          <div className="xl:hidden">
            <MonthGrid monthDate={leftMonth} todayStr={todayStr} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} bookedDates={bookedDates} blockedDates={blockedDates} onPick={handlePick} />
          </div>
          <div className="hidden xl:block xl:flex-1">
            <MonthGrid monthDate={leftMonth} todayStr={todayStr} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} bookedDates={bookedDates} blockedDates={blockedDates} onPick={handlePick} />
          </div>
          <div className="hidden xl:block xl:flex-1">
            <MonthGrid monthDate={rightMonth} todayStr={todayStr} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} bookedDates={bookedDates} blockedDates={blockedDates} onPick={handlePick} />
          </div>
        </div>
      </div>

      <div className={`shrink-0 gap-3 p-3.5 sm:p-3 border-t border-app bg-subtle ${mode === 'range' ? 'flex flex-col items-stretch' : 'flex items-center justify-between'}`}>
        <div className="text-sm text-sec min-w-0">
          <p className="text-xs font-medium text-muted">Selected dates</p>
          <p className="font-medium text-main truncate">
            {draftStart && draftEnd ? `${fmtRangeTiny(draftStart, draftEnd)} (${nights} night${nights === 1 ? '' : 's'})` : draftStart ? 'Choose an end date' : 'No dates selected'}
          </p>
        </div>
        <button type="button" onClick={handleApply} disabled={!draftStart || !draftEnd} className="w-full sm:w-auto shrink-0 px-6 h-10 rounded-card bg-accent text-accent-text text-sm font-semibold hover:bg-accent-hover disabled:opacity-50 transition-colors duration-fast">Apply</button>
      </div>
    </div>
  );

  return (
    // No z-index here: it would cap the panel below the shared dim Overlay (z-200).
    <div ref={ref} className="relative">
      {mode === 'range' ? (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="w-full min-h-11 flex items-center justify-between gap-2 px-0 py-1 text-sm text-main"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Calendar size={16} className="text-accent shrink-0" />
            <span className="truncate">{fmtRangeShort(startDate, endDate)}</span>
          </span>
          <ChevronDown size={14} className={`text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="flex items-center gap-2 px-3.5 h-11 rounded-full text-sm font-medium text-main hover:bg-subtle transition-colors duration-fast whitespace-nowrap"
        >
          <Calendar size={16} className="text-accent shrink-0" />
          <span>{fmtRangeShort(startDate, endDate)}</span>
          <ChevronDown size={14} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {mode === 'range' && open ? (
        <Overlay className="sm:hidden flex flex-col justify-end">
          <button type="button" className="absolute inset-0 bg-black/45 animate-fade-in" onClick={() => setOpen(false)} aria-label="Close date picker" />
          {datePickerPanel}
        </Overlay>
      ) : (
        <>
          {/* Not portaled: a portaled backdrop lives in a different stacking context than this
              panel, so its z-index can't be trusted to lose against the panel's z-[210]. Staying
              in the same local tree keeps the two comparable and the panel reliably clickable. */}
          {mode === 'dual' && open && (
            <button type="button" className="fixed inset-0 z-[200] bg-black/45 animate-fade-in" onClick={() => setOpen(false)} aria-label="Close date picker" />
          )}
          {datePickerPanel}
        </>
      )}
    </div>
  );
}
