import type { HandoffWindow } from '@/lib/listing-item-details';
import { pickupToday } from '@/lib/pickup-timezone';

export const HANDOFF_HOURS: Record<HandoffWindow, readonly number[]> = {
  morning: [7, 8, 9, 10, 11],
  afternoon: [12, 13, 14, 15, 16],
  evening: [17, 18, 19],
};

export const HANDOFF_WINDOW_LABELS: Record<HandoffWindow, string> = {
  morning: 'Morning (7-11 am)',
  afternoon: 'Afternoon (noon-4 pm)',
  evening: 'Evening (5-7 pm)',
};

export function handoffHourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour < 12 ? 'am' : 'pm'}`;
}

export function availableHandoffHours(date: string, window: HandoffWindow, timeZone: string, now: Date): readonly number[] {
  const today = pickupToday(timeZone, now);
  if (date < today) return [];
  if (date > today) return HANDOFF_HOURS[window];
  const localHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', hourCycle: 'h23',
  }).format(now));
  return HANDOFF_HOURS[window].filter(hour => hour > localHour);
}
