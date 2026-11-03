import { useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/shadcn/dialog';
import { Button, IconButton } from '@/components/ui';
import { MonthGrid } from '@/components/date-range-picker';
import { addDaysIso, todayIso, MAX_BOOKING_RANGE_DAYS } from '@/lib/geo';
import { fieldClass } from '@/components/form-classes';

const NO_DATES = new Set<string>();
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function DatePicker({ value, onChange, label, id, min, max, required = false, disabled = false, windowDays, invalid, describedBy, className = '' }: {
  value: string;
  onChange: (date: string) => void;
  label: string;
  id?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  windowDays?: number;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const [month, setMonth] = useState(() => new Date(`${value || min || todayIso()}T12:00:00`));
  const trigger = useRef<HTMLButtonElement>(null);
  const minimum = min || todayIso();
  const maximum = max || addDaysIso(todayIso(), MAX_BOOKING_RANGE_DAYS);
  const firstMonth = new Date(`${minimum}T12:00:00`);
  const lastMonth = new Date(`${maximum}T12:00:00`);
  const canPrevious = month.getFullYear() * 12 + month.getMonth() > firstMonth.getFullYear() * 12 + firstMonth.getMonth();
  const canNext = month.getFullYear() * 12 + month.getMonth() < lastMonth.getFullYear() * 12 + lastMonth.getMonth();
  const valid = Boolean(selected && selected >= minimum && selected <= maximum);
  const end = selected && windowDays ? addDaysIso(selected, windowDays) : selected;

  return <Dialog open={open} onOpenChange={(next) => {
    if (next) {
      setSelected(value);
      const initial = value >= minimum && value <= maximum ? value : minimum;
      const date = new Date(`${initial}T12:00:00`);
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
    setOpen(next);
  }}>
    <DialogTrigger asChild>
      <button ref={trigger} id={id} type="button" disabled={disabled} aria-label={label} aria-required={required}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        className={fieldClass(`flex items-center justify-between gap-2 text-left font-normal ${className}`)}>
        <CalendarDays aria-hidden="true" size={18} className="shrink-0 text-accent" />
        <span className={`min-w-0 flex-1 truncate ${value ? 'text-main' : 'text-muted'}`}>{value ? dateLabel(value) : 'Choose date'}</span>
        <ChevronDown aria-hidden="true" size={15} className="shrink-0 text-sec" />
      </button>
    </DialogTrigger>
    {required && <input aria-hidden="true" tabIndex={-1} className="sr-only" value={value} required disabled={disabled}
      onChange={() => {}} onInvalid={(event) => { event.preventDefault(); trigger.current?.focus(); trigger.current?.click(); }} />}
    <DialogContent className="flex flex-col w-[calc(100vw_-_1rem)] max-w-[440px] overflow-hidden rounded-[24px] border border-app bg-card p-0 shadow-pop">
      <div className="shrink-0 border-b border-app bg-subtle px-5 py-5 sm:px-6">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><CalendarDays size={20} aria-hidden="true" /></span>
          <div className="min-w-0">
            <DialogTitle className="text-lg font-bold tracking-tight text-main">{label}</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-sec">{windowDays ? `Choose the first day of your ${windowDays}-day listing window.` : 'Choose a day. Earlier dates are unavailable.'}</DialogDescription>
          </div>
        </DialogHeader>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pt-4 sm:px-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-base font-bold tracking-tight text-main">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
          <div className="flex items-center gap-1">
            <IconButton label="Previous month" variant="ghost" disabled={!canPrevious} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft aria-hidden="true" size={19} /></IconButton>
            <IconButton label="Next month" variant="ghost" disabled={!canNext} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight aria-hidden="true" size={19} /></IconButton>
          </div>
        </div>
        <MonthGrid monthDate={month} todayStr={todayIso()} minDate={minimum} maxDate={maximum} draftStart={selected}
          draftEnd={windowDays ? end : null} bookedDates={NO_DATES} blockedDates={NO_DATES} onPick={setSelected} showMonthLabel={false} />
      </div>
      <div className="shrink-0 mt-4 border-t border-app px-5 py-4 sm:px-6">
        <div className="mb-4 flex min-h-11 items-center justify-between gap-3" role="status" aria-live="polite">
          <div className="min-w-0"><p className="text-xs font-medium text-sec">Selected day</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-main">{selected ? `${dateLabel(selected)}${windowDays ? ` – ${dateLabel(end)}` : ''}` : 'Choose a day'}</p></div>
          {!required && <Button size="sm" variant="ghost" onClick={() => { onChange(''); setOpen(false); }}>Clear</Button>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { if (valid) { onChange(selected); setOpen(false); } }}>Use this date</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
