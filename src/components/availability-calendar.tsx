import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayIso } from '@/lib/geo';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Small month-at-a-time calendar grid. Read-only mode shows booked/blocked dates for a renter;
 * editable mode (owner-only, backed by `listing_availability` RLS) lets an owner toggle a date
 * between available/blocked by clicking it.
 */
export function AvailabilityCalendar({
  bookedDates, blockedDates, editable = false, onToggleDate, monthsAhead = 6,
}: {
  bookedDates: Set<string>;
  blockedDates: Set<string>;
  editable?: boolean;
  onToggleDate?: (date: string) => void;
  monthsAhead?: number;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const today = new Date();
  const viewMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstWeekday = viewMonth.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const todayStr = todayIso();

  const cells: (string | null)[] = [...Array(firstWeekday).fill(null)];
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }

  return (
    <div className="p-4 rounded-card-xl bg-card border border-app">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
          disabled={monthOffset === 0}
          className="p-1.5 rounded-card text-sec hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-main">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.min(monthsAhead - 1, o + 1))}
          disabled={monthOffset >= monthsAhead - 1}
          className="p-1.5 rounded-card text-sec hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-muted mb-1">
        {WEEKDAY_LABELS.map((w, i) => <div key={i}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
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
              onClick={() => canClick && onToggleDate?.(date)}
              title={isBooked ? 'Booked' : isBlocked ? 'Blocked by owner' : undefined}
              className={`aspect-square rounded-card text-xs transition-colors ${tone} ${canClick ? 'cursor-pointer' : ''}`}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-app text-[11px] text-sec">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-accent-soft border border-accent" /> Booked</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-warning-soft border border-warning" /> Blocked</span>
        {editable && <span className="ml-auto">Click a date to block/unblock it</span>}
      </div>
    </div>
  );
}
