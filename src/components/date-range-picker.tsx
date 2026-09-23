import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { todayIso, addDaysIso, MAX_BOOKING_RANGE_DAYS } from '@/lib/geo';

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
function fmt(iso: string) { return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtSlash(iso: string) { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; }
function fmtRangeShort(start: string, end: string) {
  const s = formatIsoLocal(start, { month: 'short', day: 'numeric' });
  const e = formatIsoLocal(end, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s} – ${e}`;
}
function fmtRangeTiny(start: string, end: string) {
  const s = formatIsoLocal(start, { month: 'short', day: 'numeric' });
  const e = formatIsoLocal(end, { month: 'short', day: 'numeric' });
  return `${s} – ${e}`;
}

function MonthGrid({
  monthDate, todayStr, draftStart, draftEnd, maxDate, onPick,
}: {
  monthDate: Date; todayStr: string; draftStart: string | null; draftEnd: string | null; maxDate: string; onPick: (iso: string) => void;
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
          const disabled = date < todayStr || date > maxDate;
          const isStart = date === draftStart;
          const isEnd = date === draftEnd;
          const inRange = draftStart && draftEnd && date > draftStart && date < draftEnd;
          let tone = 'text-main hover:bg-subtle';
          if (disabled) tone = 'text-muted opacity-30 cursor-not-allowed';
          else if (isStart || isEnd) tone = 'bg-accent text-accent-text font-semibold';
          else if (inRange) tone = 'bg-accent-soft text-accent';
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              onClick={() => onPick(date)}
              className={`aspect-square rounded-card text-xs transition-colors ${tone}`}
            >
              {Number(date.slice(-2))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Premium dual-month date-range picker with quick presets, replacing plain native date inputs. */
export function DateRangePicker({
  startDate, endDate, onChange,
  mode = 'dual',
}: {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  mode?: 'dual' | 'range';
}) {
  const [open, setOpen] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState<string | null>(endDate);
  const [activePreset, setActivePreset] = useState<PresetKey>('custom');
  const ref = useRef<HTMLDivElement>(null);
  const todayStr = todayIso();
  const maxDate = addDaysIso(todayStr, MAX_BOOKING_RANGE_DAYS);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function openPicker() {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setMonthOffset(0);
    setOpen(true);
  }

  function handlePick(date: string) {
    setActivePreset('custom');
    if (!draftStart || (draftStart && draftEnd)) { setDraftStart(date); setDraftEnd(null); return; }
    if (date <= draftStart) { setDraftStart(date); setDraftEnd(null); return; }
    setDraftEnd(date > maxDate ? maxDate : date);
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
    const range = presetRange('today');
    setDraftStart(range.start);
    setDraftEnd(range.end);
    setActivePreset('today');
  }

  const leftMonth = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const rightMonth = new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1);
  const nights = draftStart && draftEnd ? daysBetweenIso(draftStart, draftEnd) : 0;

  return (
    <div ref={ref} className="relative z-[90]">
      {mode === 'range' ? (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="w-full flex items-center justify-between gap-2 px-0 py-1 text-sm text-main"
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
          className="flex items-center gap-2 px-3 py-2 rounded-card-lg border border-accent/35 bg-card text-sm text-main hover:bg-subtle transition-colors whitespace-nowrap"
        >
          <Calendar size={16} className="text-accent shrink-0" />
          <span>{fmtRangeShort(startDate, endDate)}</span>
          <ChevronDown size={14} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {open && (
        <div className="absolute top-full mt-2 right-0 left-auto z-[110] w-[min(90vw,560px)] max-w-[90vw] bg-card border border-app rounded-card-xl shadow-hover animate-scale-in overflow-hidden">
          <div className="p-2.5 border-b border-app">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-semibold text-main">Select dates</h4>
              <button type="button" onClick={handleClear} className="text-xs text-accent font-medium hover:underline">Clear dates</button>
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

          <div className="p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted"> </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setMonthOffset((o) => Math.max(0, o - 1))} disabled={monthOffset === 0} className="p-1 rounded-card text-sec hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Previous month">
                  <ChevronLeft size={15} />
                </button>
                <button type="button" onClick={() => setMonthOffset((o) => o + 1)} className="p-1 rounded-card text-sec hover:bg-subtle" aria-label="Next month">
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            <div className="flex flex-col xl:flex-row gap-4">
              <div className="lg:hidden">
                <MonthGrid monthDate={leftMonth} todayStr={todayStr} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} onPick={handlePick} />
              </div>
              <div className="hidden xl:block xl:flex-1">
                <MonthGrid monthDate={leftMonth} todayStr={todayStr} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} onPick={handlePick} />
              </div>
              <div className="hidden xl:block xl:flex-1">
                <MonthGrid monthDate={rightMonth} todayStr={todayStr} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} onPick={handlePick} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 p-3 border-t border-app bg-subtle/40">
            <div className="text-sm text-sec min-w-0">
              <p className="text-xs font-medium text-muted">Selected dates</p>
              <p className="font-medium text-main truncate">
                {draftStart && draftEnd ? `${fmtRangeTiny(draftStart, draftEnd)} (${nights} night${nights === 1 ? '' : 's'})` : '—'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={handleApply} disabled={!draftStart || !draftEnd} className="px-3.5 py-2 rounded-card-lg bg-accent text-accent-text text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">Apply dates</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
