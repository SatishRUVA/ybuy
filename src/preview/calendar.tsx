import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { diffDays, hasBlocked, longDate, parseIso, shortDate, toIso, todayIso } from './dates';
import { EASE } from './ui';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

interface CalendarProps {
  /** range: pick start and end. toggle: owner taps days inside the window to block or open them. */
  mode?: 'range' | 'toggle';
  start: string;
  end: string;
  onRange?: (start: string, end: string) => void;
  onToggle?: (day: string) => void;
  /** Selectable bounds in range mode. */
  min?: string;
  max?: string;
  /** Days nobody can pick (range mode) or days the owner has blocked (toggle mode). */
  blocked?: Set<string>;
  /** Days promised to confirmed renters. Shown, never changeable. */
  locked?: Set<string>;
  /** Longest selectable run, counting both ends. */
  maxSpan?: number;
  twoUp?: boolean;
  /** Months stretch to fill their container instead of a fixed popover width. */
  fluid?: boolean;
}

export function Calendar({ mode = 'range', start, end, onRange, onToggle, min, max, blocked = new Set(), locked = new Set(), maxSpan, twoUp = true, fluid = false }: CalendarProps) {
  const today = todayIso();
  const floor = min && min > today ? min : today;
  const ceiling = mode === 'toggle' ? end || undefined : max;
  const firstMonth = monthStart(parseIso(mode === 'toggle' && start ? start : today));
  const lastMonth = ceiling ? monthStart(parseIso(ceiling)) : addMonths(firstMonth, 11);
  const [cursor, setCursor] = useState(() => monthStart(parseIso(start && start >= today ? start : floor)));
  const [dir, setDir] = useState(1);
  const [hover, setHover] = useState('');
  const [note, setNote] = useState('');

  const second = twoUp && addMonths(cursor, 1) <= lastMonth;
  const shown = second ? 2 : 1;
  const canPrev = cursor > firstMonth;
  const canNext = addMonths(cursor, shown) <= lastMonth;
  const move = (n: number) => { setDir(n); setCursor(addMonths(cursor, n)); };

  const isDisabled = (day: string) => mode === 'range'
    ? day < floor || (!!max && day > max) || blocked.has(day) || locked.has(day)
    : !start || !end || day < start || day > end || locked.has(day) || day < today;

  const pick = (day: string) => {
    if (mode === 'toggle') { onToggle?.(day); return; }
    if (!onRange) return;
    if (!start || end || day <= start) { onRange(day, ''); setNote(''); return; }
    if (maxSpan && diffDays(start, day) + 1 > maxSpan) { onRange(day, ''); setNote(`Up to ${maxSpan} days at a time, so we started again from ${shortDate(day)}.`); return; }
    if (hasBlocked(start, day, blocked)) { onRange(day, ''); setNote('A taken day sits in between, so we started again from here.'); return; }
    onRange(start, day);
    setNote('');
  };

  const previewEnd = mode === 'range' && start && !end && hover > start && !hasBlocked(start, hover, blocked) && !(maxSpan && diffDays(start, hover) + 1 > maxSpan) ? hover : '';
  const bandEnd = mode === 'range' ? end || previewEnd : '';
  const months = useMemo(() => (second ? [cursor, addMonths(cursor, 1)] : [cursor]), [cursor, second]);
  const monthWidth = fluid ? 'w-full' : 'w-full sm:w-[19.5rem]';

  return (
    <div className={fluid ? 'min-w-0 flex-1' : 'sm:w-max'} onMouseLeave={() => setHover('')}>
      <div>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={toIso(cursor)}
            custom={dir}
            initial={{ opacity: 0, x: dir * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -28 }}
            transition={{ duration: 0.22, ease: EASE }}
            className={`flex flex-col gap-8 ${second ? 'sm:flex-row sm:gap-10' : ''}`}
          >
            {months.map((month, index) => {
              const label = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              const last = index === months.length - 1;
              // On phones only the first month shows, so it carries both arrows.
              const nextHere = last || index === 0;
              return (
                <div key={toIso(month)} className={`${monthWidth} ${fluid ? 'sm:max-w-[24rem] sm:flex-1' : ''} ${index > 0 ? 'hidden sm:block' : ''}`}>
                  <div className="flex h-10 items-center gap-2">
                    <p className="flex min-w-0 flex-1 items-baseline gap-2" aria-live="polite">
                      <span className="font-editorial text-[1.9rem] leading-none tracking-[-0.02em]">{month.toLocaleDateString('en-US', { month: 'long' })}</span>
                      <span className="text-sm font-semibold text-sec">{month.getFullYear()}</span>
                    </p>
                    {index === 0 && <NavArrow dir={-1} disabled={!canPrev} onClick={() => move(-1)} />}
                    {nextHere && <NavArrow dir={1} disabled={!canNext} onClick={() => move(1)} className={!last ? 'sm:hidden' : ''} />}
                  </div>
                  <div className="mt-3 grid grid-cols-7 text-center text-xs font-bold text-sec" aria-hidden="true">{WEEKDAYS.map((w, i) => <span key={i} className="pb-2">{w}</span>)}</div>
                  <div className="grid grid-cols-7 gap-y-1" role="grid" aria-label={label}>
                    {Array.from({ length: month.getDay() }).map((_, i) => <span key={`b${i}`} />)}
                    {Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }).map((_, i) => {
                      const day = toIso(new Date(month.getFullYear(), month.getMonth(), i + 1));
                      return (
                        <Day
                          key={day}
                          day={day}
                          mode={mode}
                          today={today}
                          disabled={isDisabled(day)}
                          isEdge={mode === 'range' && (day === start || day === end)}
                          band={mode === 'range' && start && bandEnd && day >= start && day <= bandEnd ? (day === start ? 'start' : day === bandEnd ? 'end' : 'mid') : null}
                          previewing={Boolean(previewEnd)}
                          inWindow={mode === 'toggle' && !!start && !!end && day >= start && day <= end}
                          isBlocked={blocked.has(day)}
                          isLocked={locked.has(day)}
                          onPick={pick}
                          onHover={setHover}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {note && <motion.p role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`mt-4 rounded-[0.9rem] bg-[var(--highlight)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] ${fluid ? '' : 'sm:w-0 sm:min-w-full'}`}>{note}</motion.p>}
      </AnimatePresence>
      {mode === 'toggle' && (
        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-sec" aria-label="Legend">
          <li className="flex items-center gap-2"><span className="h-5 w-5 rounded-[0.4rem] bg-[var(--accent-soft)]" />Open</li>
          <li className="flex items-center gap-2"><span className="h-5 w-5 rounded-[0.4rem] bg-[var(--text)]" />Blocked by you</li>
          <li className="flex items-center gap-2"><span className="h-5 w-5 rounded-[0.4rem] bg-[var(--highlight)]" />Booked by a renter</li>
        </ul>
      )}
    </div>
  );
}

function NavArrow({ dir, disabled, onClick, className = '' }: { dir: 1 | -1; disabled: boolean; onClick: () => void; className?: string }) {
  const Icon = dir < 0 ? ArrowLeft : ArrowRight;
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={dir < 0 ? 'Previous month' : 'Next month'} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-subtle transition hover:bg-[var(--text)] hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30 ${className}`}>
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

function Day({ day, mode, today, disabled, isEdge, band, previewing, inWindow, isBlocked, isLocked, onPick, onHover }: {
  day: string; mode: 'range' | 'toggle'; today: string; disabled: boolean; isEdge: boolean; band: 'start' | 'mid' | 'end' | null; previewing: boolean;
  inWindow: boolean; isBlocked: boolean; isLocked: boolean; onPick: (day: string) => void; onHover: (day: string) => void;
}) {
  const past = day < today;
  let look = 'text-main hover:bg-subtle';
  if (mode === 'range') {
    if (isEdge) look = 'bg-[var(--text)] text-[var(--highlight)]';
    else if (band) look = 'text-main hover:bg-white/70';
    else if (isBlocked || isLocked) look = past ? 'text-muted opacity-40' : 'bg-subtle text-muted line-through decoration-[1.5px]';
    else if (disabled) look = 'text-muted opacity-40';
  } else if (isLocked && inWindow) look = 'bg-[var(--highlight)] text-[var(--ink)]';
  else if (inWindow && !past) look = isBlocked ? 'bg-[var(--text)] text-white/75 line-through decoration-[1.5px]' : 'bg-[var(--accent-soft)] text-main hover:bg-[var(--accent)] hover:text-white';
  else look = 'text-muted opacity-40';

  const state = isLocked ? 'booked' : isBlocked ? (mode === 'toggle' ? 'blocked' : 'not available') : band === 'start' ? 'pick up' : band === 'end' && !previewing ? 'return' : band === 'mid' && !previewing ? 'in your dates' : inWindow ? 'open' : '';
  const bandPos = band === 'start' ? 'left-1/2 right-0' : band === 'end' ? 'left-0 right-1/2' : 'inset-x-0';
  return (
    <span className="relative flex h-11 items-center justify-center">
      {band && <span aria-hidden="true" className={`absolute inset-y-0 ${bandPos} ${previewing ? 'bg-[var(--accent-soft)]/70' : 'bg-[var(--accent-soft)]'}`} />}
      <motion.button
        type="button"
        role="gridcell"
        disabled={disabled}
        onClick={() => onPick(day)}
        onMouseEnter={() => onHover(day)}
        onFocus={() => onHover(day)}
        whileTap={disabled ? undefined : { scale: 0.9 }}
        animate={isEdge ? { scale: [0.85, 1] } : { scale: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 24 }}
        aria-label={`${longDate(day)}${state ? `, ${state}` : ''}`}
        aria-pressed={mode === 'toggle' ? isBlocked : isEdge}
        className={`relative grid h-11 w-11 place-items-center rounded-[0.85rem] text-[15px] font-semibold tnum transition-colors disabled:cursor-not-allowed ${look}`}
      >
        {parseIso(day).getDate()}
        {day === today && !isEdge && <span aria-hidden="true" className="absolute bottom-1.5 h-1 w-1 rounded-full bg-[var(--accent)]" />}
      </motion.button>
    </span>
  );
}
