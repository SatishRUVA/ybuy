import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayIso } from '@/lib/geo';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Small month-at-a-time calendar grid. Read-only mode shows booked/blocked dates for a renter;
 * editable mode (owner-only, backed by `listing_availability` RLS) lets an owner toggle a date
 * between available/blocked by clicking it.
 */
export function AvailabilityCalendar({
  bookedDates, blockedDates, editable = false, onToggleDate, monthsAhead = 6, today: todayStr = todayIso(),
}: {
  bookedDates: Set<string>;
  blockedDates: Set<string>;
  editable?: boolean;
  onToggleDate?: (date: string) => void;
  monthsAhead?: number;
  today?: string;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const today = new Date(`${todayStr}T12:00:00`);
  const viewMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstWeekday = viewMonth.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();

  const cells: (string | null)[] = [...Array(firstWeekday).fill(null)];
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }

  return (
    <div className="w-full max-w-md p-3 sm:p-4 rounded-card-xl bg-card border border-app shadow-xs">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
          disabled={monthOffset === 0}
          className="grid place-items-center h-11 w-11 rounded-card text-sec hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft size={15} />
        </button>
        <span aria-live="polite" className="text-sm font-bold text-main">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.min(monthsAhead - 1, o + 1))}
          disabled={monthOffset >= monthsAhead - 1}
          className="grid place-items-center h-11 w-11 rounded-card text-sec hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next month"
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-sec mb-2">
        {WEEKDAY_LABELS.map((w, i) => <div key={i}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isPast = date < todayStr;
          const isBooked = bookedDates.has(date);
          const isBlocked = blockedDates.has(date);
          const canClick = editable && !isPast && !isBooked;
          const dayNum = Number(date.slice(-2));
          let tone = 'text-main hover:bg-subtle';
          if (isPast) tone = 'text-muted opacity-40';
          else if (isBooked) tone = 'bg-accent-soft text-accent font-semibold cursor-default';
          else if (isBlocked) tone = 'bg-warning-soft text-warning font-semibold';
          return (
            <button
              key={date}
              type="button"
              disabled={!canClick}
              aria-label={`${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${isBooked ? 'booked' : isBlocked ? 'blocked' : 'available'}`}
              aria-pressed={isBlocked}
              aria-current={date === todayStr ? 'date' : undefined}
              onClick={() => canClick && onToggleDate?.(date)}
              title={isBooked ? 'Booked' : isBlocked ? 'Blocked by owner' : undefined}
              className={`aspect-square min-h-11 rounded-full text-sm transition-colors ${tone} ${canClick ? 'cursor-pointer' : ''}`}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-app text-xs text-sec">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-soft border border-accent" /> Booked</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning-soft border border-warning" /> Blocked</span>
        {editable && <span className="ml-auto">Click a date to block/unblock it</span>}
      </div>
    </div>
  );
}
