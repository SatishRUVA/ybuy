import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CalendarDays, ChevronDown, LocateFixed, MapPin, Target, X } from 'lucide-react';
import { Calendar } from './calendar';
import { CITIES, RADII, addDays, hasBlocked, radiusLabel, rangeLabel, rentalDays, todayIso, parseIso, toIso, type Radius } from './dates';
import { Btn, EASE } from './ui';

/** Dropdown on desktop, bottom sheet on phones. `anchor="parent"` aligns the panel to the nearest positioned ancestor. */
export function Popover({ trigger, title, children, triggerClass = '', width = 'sm:w-[min(44rem,calc(100vw-2rem))]', align = 'left', anchor = 'self' }: {
  trigger: ReactNode; title: string; children: (close: () => void) => ReactNode; triggerClass?: string; width?: string; align?: 'left' | 'right'; anchor?: 'self' | 'parent';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); button.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!wrap.current?.contains(event.target as Node) && window.matchMedia('(min-width: 640px)').matches) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrap} className={anchor === 'self' ? 'relative' : ''}>
      <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={triggerClass}>{trigger}</button>
      {open && (
        <>
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-[70] bg-[var(--text)]/45 sm:hidden" />
          <motion.div
            role="dialog"
            aria-label={title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className={`fixed inset-x-0 bottom-0 z-[75] max-h-[88dvh] overflow-y-auto rounded-t-[1.75rem] bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-pop sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:z-50 sm:mt-2 sm:max-h-none sm:overflow-visible sm:rounded-[1.5rem] sm:p-6 ${align === 'right' ? 'sm:right-0' : 'sm:left-0'} ${width}`}
          >
            <div className="mb-3 flex items-center justify-between sm:hidden">
              <p className="font-display text-lg font-bold">{title}</p>
              <button type="button" onClick={close} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full bg-subtle"><X size={18} aria-hidden="true" /></button>
            </div>
            {children(close)}
          </motion.div>
        </>
      )}
    </div>
  );
}

const PILL = 'inline-flex h-11 items-center gap-2 rounded-full bg-subtle px-4 text-sm font-semibold hover:bg-[var(--border)]';

export function LocationField({ value, onChange, triggerClass = PILL, anchor = 'parent' }: { value: string; onChange: (city: string) => void; triggerClass?: string; anchor?: 'self' | 'parent' }) {
  const [filter, setFilter] = useState('');
  const cities = Object.keys(CITIES).filter((c) => c.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <Popover
      title="Choose a place"
      width="sm:w-80"
      anchor={anchor}
      triggerClass={triggerClass}
      trigger={<><MapPin size={16} aria-hidden="true" className="text-accent" /><span className="sr-only">Place: </span>{value}<ChevronDown size={14} aria-hidden="true" className="text-sec" /></>}
    >
      {(close) => (
        <div>
          <label className="block text-sm font-semibold">City or ZIP
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Try Dallas" className="mt-1 h-12 w-full rounded-[0.9rem] border border-[var(--border-strong)] bg-card px-4 text-base" />
          </label>
          <ul className="mt-2">
            <li><button type="button" onClick={() => { onChange('Irving, TX'); close(); }} className="flex min-h-11 w-full items-center gap-3 rounded-[0.9rem] px-3 text-left text-sm font-semibold hover:bg-subtle"><LocateFixed size={16} aria-hidden="true" className="text-accent" />Use my current location</button></li>
            {cities.map((city) => (
              <li key={city}><button type="button" aria-current={city === value} onClick={() => { onChange(city); close(); }} className={`flex min-h-11 w-full items-center gap-3 rounded-[0.9rem] px-3 text-left text-sm hover:bg-subtle ${city === value ? 'bg-[var(--accent-soft)] font-bold' : ''}`}><MapPin size={16} aria-hidden="true" className="text-sec" />{city}</button></li>
            ))}
            {cities.length === 0 && <li className="px-3 py-3 text-sm text-sec">No match. Try another city.</li>}
          </ul>
        </div>
      )}
    </Popover>
  );
}

export function RadiusField({ value, onChange, className = PILL }: { value: Radius; onChange: (radius: Radius) => void; className?: string }) {
  return (
    <label className={`relative ${className}`}>
      <Target size={16} aria-hidden="true" className="text-accent" />
      <span className="sr-only">Search radius</span>
      <select
        value={value === null ? 'any' : String(value)}
        onChange={(event) => onChange(event.target.value === 'any' ? null : (Number(event.target.value) as Radius))}
        className="cursor-pointer appearance-none bg-transparent pr-5 font-semibold outline-none"
      >
        {RADII.map((r) => <option key={String(r)} value={r === null ? 'any' : String(r)}>{radiusLabel(r)}</option>)}
      </select>
      <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-4 text-sec" />
    </label>
  );
}

interface DateFieldProps {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  blocked?: Set<string>;
  min?: string;
  max?: string;
  maxSpan?: number;
  label?: string;
  placeholder?: string;
  triggerClass?: string;
  align?: 'left' | 'right';
  anchor?: 'self' | 'parent';
  presets?: boolean;
  /** Shown above the calendar, e.g. when the owner is only open for part of the month. */
  hint?: ReactNode;
}

export function DateRangeField({ start, end, onChange, blocked, min, max, maxSpan, label = 'Dates', placeholder = 'Add dates', triggerClass = PILL, align = 'left', anchor = 'parent', presets = true, hint }: DateFieldProps) {
  const has = Boolean(start && end);
  const days = has ? rentalDays(start, end) : 0;
  const nextSat = () => { const d = parseIso(todayIso()); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return toIso(d); };
  const quick = [
    ['This weekend', nextSat(), addDays(nextSat(), 2)],
    ['Next 7 days', addDays(todayIso(), 1), addDays(todayIso(), 8)],
    ['Next 2 weeks', addDays(todayIso(), 1), addDays(todayIso(), 15)],
  ].filter(([, s, e]) => !(min && s < min) && !(max && e > max) && !(blocked && hasBlocked(s, e, blocked)));
  const fit = 'sm:w-0 sm:min-w-full';

  return (
    <Popover
      title="Choose your dates"
      align={align}
      anchor={anchor}
      width="sm:w-max sm:max-w-[calc(100vw-2rem)]"
      triggerClass={triggerClass}
      trigger={<><CalendarDays size={16} aria-hidden="true" className="shrink-0 text-accent" /><span className="sr-only">{label}: </span><span className="min-w-0 truncate">{has ? `${rangeLabel(start, end)} · ${days} ${days === 1 ? 'day' : 'days'}` : placeholder}</span><ChevronDown size={14} aria-hidden="true" className="shrink-0 text-sec" /></>}
    >
      {(close) => (
        <div>
          <div className={`grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 ${fit}`} aria-live="polite">
            <DateStub label="Pick up" day={start} active={!start || Boolean(end)} />
            <span aria-hidden="true" className="grid place-items-center text-sec"><ArrowRight size={18} /></span>
            <DateStub label="Return" day={end} active={Boolean(start) && !end} />
          </div>
          {hint && <p className={`mt-3 text-sm text-sec ${fit}`}>{hint}</p>}
          {presets && quick.length > 0 && (
            <div className={`mt-4 flex flex-wrap gap-2 ${fit}`} role="group" aria-label="Quick picks">
              {quick.map(([name, s, e]) => {
                const on = start === s && end === e;
                return <button key={name} type="button" aria-pressed={on} onClick={() => onChange(s, e)} className={`h-10 rounded-full px-4 text-sm font-semibold transition active:scale-95 ${on ? 'bg-[var(--text)] text-[var(--highlight)]' : 'bg-subtle hover:bg-[var(--border)]'}`}>{name}</button>;
              })}
            </div>
          )}
          <div className="mt-5"><Calendar start={start} end={end} onRange={onChange} min={min} max={max} blocked={blocked} maxSpan={maxSpan} twoUp /></div>
          <div className={`mt-5 flex items-center justify-between gap-3 ${fit}`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={days} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}               className={`inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-bold ${has ? 'bg-[var(--highlight)] text-[var(--ink)]' : 'bg-subtle text-sec'}`}>
                              {has ? `${days} ${days === 1 ? 'day' : 'days'}` : start ? 'Pick return' : 'Pick up day'}
              </motion.span>
            </AnimatePresence>
            <div className="flex shrink-0 gap-2">
              <Btn size="sm" tone="ghost" onClick={() => onChange('', '')} disabled={!start && !end}>Clear</Btn>
              <Btn size="sm" onClick={close} disabled={Boolean(start) && !end}>Done</Btn>
            </div>
          </div>
        </div>
      )}
    </Popover>
  );
}

export function DateStub({ label, day, active }: { label: string; day: string; active: boolean }) {
  const d = day ? parseIso(day) : null;
  return (
    <div className={`rounded-[1.1rem] px-4 py-3 transition-colors ${active ? 'bg-card ring-2 ring-[var(--text)]' : 'bg-subtle'}`}>
      <p className="text-sm font-semibold text-sec">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 whitespace-nowrap">
        <span className={`font-editorial text-[1.75rem] leading-none tracking-[-0.02em] ${d ? '' : 'text-muted'}`}>{d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Add date'}</span>
        {d && <span className="text-sm font-semibold text-sec">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>}
      </p>
    </div>
  );
}
