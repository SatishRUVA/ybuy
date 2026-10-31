import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown, Lock } from 'lucide-react';
import { addDays, diffDays, eachDay, longDate, parseIso, rangeLabel, shortDate, toIso, todayIso, type Avail } from '../preview/dates';
import { availabilityProblem } from './state';
import { Button, ErrorNote, Modal, Tag } from './ui';

const startOfMonth = (date: string) => { const d = parseIso(date); return new Date(d.getFullYear(), d.getMonth(), 1); };
const shiftMonth = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
interface CalendarProps {
  start: string; end: string; onChange: (s: string, e: string) => void; min?: string; max?: string;
  blocked?: Set<string>; locked?: Set<string>; maxDays?: number; toggle?: (day: string) => void;
}
export function RangeCalendar({ start, end, onChange, min = todayIso(), max = addDays(todayIso(), 365), blocked = new Set(), locked = new Set(), maxDays, toggle }: CalendarProps) {
  const [month, setMonth] = useState(() => startOfMonth(start || min));
  const [hover, setHover] = useState('');
  const [error, setError] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const monthId = useId();
  const disabled = (d: string) => d < min || d > max || locked.has(d) || (!toggle && blocked.has(d));
  const inside = (s: string, e: string) => !eachDay(s, e).some((d) => blocked.has(d) || locked.has(d));
  const ghost = start && !end && hover > start && inside(start, hover) && (!maxDays || diffDays(start, hover) + 1 <= maxDays) ? hover : '';
  const last = end || ghost;
  const pick = (d: string) => {
    setError('');
    if (toggle) { toggle(d); return; }
    if (!start || end || d <= start) { onChange(d, ''); return; }
    if (maxDays && diffDays(start, d) + 1 > maxDays) { setError(`Choose a window of ${maxDays} calendar days or less.`); return; }
    if (!inside(start, d)) { setError('There is a blocked or booked day between these dates. Choose another return day.'); return; }
    onChange(start, d);
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, d: string) => {
    const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    let next = addDays(d, offsets[event.key]);
    for (let i = 0; i < 31 && disabled(next); i++) next = addDays(next, offsets[event.key]);
    if (next < min || next > max) return;
    const target = grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`);
    if (target) target.focus();
    else {
      setMonth(startOfMonth(next));
      requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
    }
  };
  return <div className="p1-calendar" onMouseLeave={() => setHover('')}>
    <div className="p1-calendar-head">
      <div id={monthId}><strong>{month.toLocaleDateString('en-US', { month: 'long' })}</strong><span>{month.getFullYear()}</span></div>
      <div className="p1-actions">
        <button type="button" className="p1-icon" aria-label="Previous month" disabled={month <= startOfMonth(min)} onClick={() => setMonth(shiftMonth(month, -1))}><ArrowLeft size={17} aria-hidden="true" /></button>
        <button type="button" className="p1-icon" aria-label="Next month" disabled={shiftMonth(month, 1) > startOfMonth(max)} onClick={() => setMonth(shiftMonth(month, 1))}><ArrowRight size={17} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="p1-weekdays" aria-hidden="true">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d}>{d}</span>)}</div>
    <div className="p1-day-grid" ref={grid} role="group" aria-labelledby={monthId}>
      {Array.from({ length: month.getDay() }, (_, i) => <span key={`blank-${i}`} />)}
      {Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, i) => {
        const d = toIso(new Date(month.getFullYear(), month.getMonth(), i + 1));
        const edge = !toggle && (d === start || d === end);
        const band = !toggle && start && last && d >= start && d <= last;
        const state = locked.has(d) ? 'booked' : blocked.has(d) ? 'blocked' : edge ? (d === start ? 'pick up' : 'return') : 'available';
        return <span className={`p1-day-cell ${band ? 'p1-date-band' : ''} ${band && d === start ? 'band-start' : ''} ${band && d === last ? 'band-end' : ''}`} key={d}>
          <button type="button" data-day={d} aria-label={`${longDate(d)}, ${state}`} aria-pressed={toggle ? blocked.has(d) : edge}
            disabled={disabled(d)} onClick={() => pick(d)} onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)} onKeyDown={(e) => onKey(e, d)}
            className={`p1-day ${edge ? 'selected' : ''} ${blocked.has(d) ? 'blocked' : ''} ${locked.has(d) ? 'locked' : ''} ${toggle && !disabled(d) && !blocked.has(d) ? 'open' : ''}`}>
            {i + 1}{d === todayIso() && <span className="p1-today-dot" />}
          </button>
        </span>;
      })}
    </div>
    {error && <ErrorNote>{error}</ErrorNote>}
    {toggle && <div className="p1-calendar-legend"><span><i className="open" />Open</span><span><i className="blocked" />Blocked</span><span><i className="locked" />Booked</span></div>}
  </div>;
}

export function DateSummary({ start, end }: { start: string; end: string }) {
  return <div className="p1-date-summary"><div><span>Pick up</span><strong>{start ? shortDate(start) : 'Add date'}</strong></div><ArrowRight size={18} aria-hidden="true" /><div><span>Return</span><strong>{end ? shortDate(end) : 'Add date'}</strong></div></div>;
}
export function DateField({ start, end, onChange, min, max, blocked, label = 'Dates', optional = false }: Omit<CalendarProps, 'toggle' | 'locked' | 'maxDays'> & { label?: string; optional?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ start, end });
  const show = () => { setDraft({ start, end }); setOpen(true); };
  return <>
    <button type="button" className="p1-date-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={show}><CalendarDays size={19} aria-hidden="true" /><span><small>{label}</small><strong>{start && end ? rangeLabel(start, end) : optional ? 'Any dates' : 'Choose dates'}</strong></span><ChevronDown size={15} aria-hidden="true" /></button>
    <Modal open={open} onClose={() => setOpen(false)} title="When do you need it?" description="Choose your pick-up day, then your return day. Shaded days are unavailable.">
      <DateSummary {...draft} />
      {optional && <div className="p1-actions p1-date-presets">{[2, 7, 14].map((n) => {
        const s = addDays(todayIso(), 1), e = addDays(s, n);
        const valid = (!min || s >= min) && (!max || e <= max) && !eachDay(s, e).some((d) => blocked?.has(d));
        return <Button key={n} variant="secondary" disabled={!valid} onClick={() => setDraft({ start: s, end: e })}>{n === 2 ? 'A short break' : `${n} days`}</Button>;
      })}</div>}
      <RangeCalendar {...{ min, max, blocked }} start={draft.start} end={draft.end} onChange={(s, e) => setDraft({ start: s, end: e })} />
      <div className="p1-dialog-footer"><Button variant="quiet" onClick={() => setDraft({ start: '', end: '' })}>Clear dates</Button><Button disabled={Boolean(draft.start) !== Boolean(draft.end) || (!optional && !draft.end)} onClick={() => { onChange(draft.start, draft.end); setOpen(false); }}>Apply dates</Button></div>
    </Modal>
  </>;
}

export function Availability({ value, onChange, locked }: { value: Avail; onChange: (a: Avail) => void; locked: string[] }) {
  const [tab, setTab] = useState<'window' | 'blocked'>('window');
  const [draft, setDraft] = useState({ start: value.start, end: value.end });
  const [error, setError] = useState('');
  const blocked = new Set(value.blocked);
  const lockedSet = new Set(locked);
  const selectWindow = (s: string, e: string) => {
    setDraft({ start: s, end: e });
    setError('');
    if (!e) { onChange({ ...value, start: s, end: '' }); return; }
    const next = { start: s, end: e, blocked: value.blocked.filter((d) => d >= s && d <= e) };
    const problem = availabilityProblem(next, locked);
    if (problem) { setError(problem); onChange(next); return; }
    onChange(next);
  };
  const updateBlocked = (days: string[]) => {
    const next = { ...value, blocked: days };
    const problem = availabilityProblem(next, locked);
    if (problem) { setError(problem); return; }
    setError(''); onChange(next);
  };
  return <div className="p1-availability">
    <div className="p1-section-head"><div><h3>Availability</h3><p>A maximum 30-day window. Change it any time.</p></div><Tag tone="blue">{value.end ? eachDay(value.start, value.end).length : '—'} / 30 days</Tag></div>
    <div className="p1-tabs" role="group" aria-label="Availability editor"><button type="button" aria-pressed={tab === 'window'} onClick={() => setTab('window')}>Open window</button><button type="button" disabled={!value.end || Boolean(availabilityProblem(value, locked))} aria-pressed={tab === 'blocked'} onClick={() => setTab('blocked')}>Block individual days</button></div>
    {tab === 'window' ? <>
      <DateSummary {...draft} />
      <RangeCalendar start={draft.start} end={draft.end} onChange={selectWindow} maxDays={30} />
      <p className="p1-muted">{draft.start && !draft.end ? 'Choose the last open day to finish changing your window.' : `Open ${rangeLabel(value.start, value.end)}`}</p>
    </> : <>
      <div className="p1-actions p1-wrap"><Button variant="secondary" onClick={() => updateBlocked([...new Set([...value.blocked, ...eachDay(value.start, value.end).filter((d) => [0, 6].includes(parseIso(d).getDay()) && !lockedSet.has(d))])])}>Block weekends</Button><Button variant="quiet" onClick={() => updateBlocked([])}>Clear blocked days</Button></div>
      <RangeCalendar key={`${value.start}-${value.end}`} start={value.start} end={value.end} min={value.start > todayIso() ? value.start : todayIso()} max={value.end}
        onChange={() => undefined} blocked={blocked} locked={lockedSet} toggle={(d) => updateBlocked(blocked.has(d) ? value.blocked.filter((x) => x !== d) : [...value.blocked, d])} />
    </>}
    {error && <ErrorNote>{error}</ErrorNote>}
    {locked.length > 0 && <p className="p1-locked-note"><Lock size={15} aria-hidden="true" />Confirmed rental days stay locked, even when you edit your window.</p>}
  </div>;
}
