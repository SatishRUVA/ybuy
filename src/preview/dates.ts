import type { Listing } from '@/data';

/** Owners can open a listing for at most this many days at a time. */
export const MAX_WINDOW_DAYS = 30;

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayIso = () => toIso(new Date());
export const addDays = (s: string, n: number) => { const d = parseIso(s); d.setDate(d.getDate() + n); return toIso(d); };
export const diffDays = (a: string, b: string) => Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86400000);
function ymd(s: string): [number, number, number] { const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d]; }

export const eachDay = (start: string, end: string) => {
  const out: string[] = [];
  for (let day = start, guard = 0; day <= end && guard < 400; day = addDays(day, 1), guard++) out.push(day);
  return out;
};
export const shortDate = (s: string) => parseIso(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const longDate = (s: string) => parseIso(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const rentalDays = (start: string, end: string) => Math.max(1, diffDays(start, end));
export const rangeLabel = (start: string, end: string) => (start && end ? `${shortDate(start)} – ${shortDate(end)}` : start ? `${shortDate(start)} – …` : '');
export const hasBlocked = (start: string, end: string, blocked: Set<string>) => eachDay(start, end).some((day) => blocked.has(day));

/* ───── Availability (owner-controlled) ───── */

export interface Avail { start: string; end: string; blocked: string[] }

/** Days already promised to confirmed renters. Owners cannot unblock or move these. */
export function lockedDays(listingId: string): string[] {
  const seed = listingId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const first = addDays(todayIso(), 9 + (seed % 5));
  return [first, addDays(first, 1)];
}

export function defaultAvail(listingId: string): Avail {
  const today = todayIso();
  const seed = listingId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const gap = 4 + (seed % 4);
  return { start: today, end: addDays(today, MAX_WINDOW_DAYS - 1), blocked: [addDays(today, gap), addDays(today, gap + 1), addDays(today, 20)] };
}

export const unavailableSet = (listingId: string, avail: Avail) => new Set([...avail.blocked, ...lockedDays(listingId)]);

/** True when the whole range sits inside the open window and no day in it is blocked. */
export function isOpen(listingId: string, avail: Avail, start: string, end: string) {
  if (!start || !end) return true;
  if (start < avail.start || end > avail.end) return false;
  return !hasBlocked(start, end, unavailableSet(listingId, avail));
}

/** First free run of `length` days starting no earlier than `from`. */
export function firstFree(listingId: string, avail: Avail, length = 2, from = addDays(todayIso(), 1)): { start: string; end: string } | null {
  const blocked = unavailableSet(listingId, avail);
  for (let start = from > avail.start ? from : avail.start; start <= avail.end; start = addDays(start, 1)) {
    const end = addDays(start, length);
    if (end <= avail.end && !hasBlocked(start, end, blocked)) return { start, end };
  }
  return null;
}

/* ───── Location and distance ───── */

export const CITIES: Record<string, { lat: number; lng: number }> = {
  'Irving, TX': { lat: 32.814, lng: -96.949 },
  'Dallas, TX': { lat: 32.7767, lng: -96.797 },
  'Plano, TX': { lat: 33.0198, lng: -96.6989 },
  'Fort Worth, TX': { lat: 32.7555, lng: -97.3308 },
  'Frisco, TX': { lat: 33.1507, lng: -96.8236 },
};

export function distanceMi(listing: Pick<Listing, 'lat' | 'lng'>, city: string) {
  const from = CITIES[city] ?? CITIES['Irving, TX'];
  const rad = (v: number) => (v * Math.PI) / 180;
  const a = Math.sin(rad(listing.lat - from.lat) / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(listing.lat)) * Math.sin(rad(listing.lng - from.lng) / 2) ** 2;
  const miles = 3958.8 * 2 * Math.asin(Math.sqrt(a));
  return Math.max(0.3, Math.round(miles * 10) / 10);
}

export const RADII = [5, 10, 25, 50, null] as const;
export type Radius = (typeof RADII)[number];
export const radiusLabel = (radius: Radius) => (radius === null ? 'Any distance' : `Within ${radius} mi`);
