// Real Dallas-area city centers (the only metro this deployment currently serves) used to power
// the search bar's location picker without needing a geocoding API for Part 1.
export const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  'Irving, TX': { lat: 32.814, lng: -96.949 },
  'Dallas, TX': { lat: 32.7767, lng: -96.797 },
  'Las Colinas, TX': { lat: 32.885, lng: -96.95 },
  'Coppell, TX': { lat: 32.9546, lng: -96.9903 },
  'Plano, TX': { lat: 33.0198, lng: -96.6989 },
  'Grapevine, TX': { lat: 32.9343, lng: -97.0781 },
};

/** Great-circle distance between two coordinates, in miles. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Configurable via .env.local; defaults to a 30-day booking horizon.
const parsedMaxRange = Number(import.meta.env.VITE_MAX_BOOKING_RANGE_DAYS);
export const MAX_BOOKING_RANGE_DAYS = Number.isFinite(parsedMaxRange) && parsedMaxRange > 0 ? parsedMaxRange : 30;

function toIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export const todayIso = () => toIsoLocal(new Date());
export const addDaysIso = (iso: string, days: number) => {
  const d = parseIsoLocal(iso);
  d.setDate(d.getDate() + days);
  return toIsoLocal(d);
};
