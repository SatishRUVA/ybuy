export type LocationSource = 'USER_SELECTED' | 'BROWSER' | 'IP' | 'NONE';

export interface MarketplaceLocation {
  city: string;
  state: string;
  country: string;
  source: LocationSource;
  latitude?: number;
  longitude?: number;
}

export const NO_LOCATION: MarketplaceLocation = { city: '', state: '', country: '', source: 'NONE' };

export function locationLabel(location: MarketplaceLocation): string {
  return location.city ? [location.city, location.state].filter(Boolean).join(', ') : 'Set your location';
}

export function listingIsInCity(pickup: string, city: string): boolean {
  return pickup.split(',')[0].trim().toLowerCase() === city.trim().toLowerCase();
}

interface MapTilerFeature {
  text: string;
  center: [number, number];
  place_type: string[];
  context?: { id: string; text: string }[];
}

async function geocode(query: string, types: string, signal?: AbortSignal): Promise<MapTilerFeature[]> {
  const key = import.meta.env.VITE_MAP_API_KEY;
  if (!key) throw new Error('City search is unavailable right now.');
  const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json`);
  url.searchParams.set('key', key);
  url.searchParams.set('types', types);
  url.searchParams.set('limit', '5');
  if (/^\d{5}$/.test(query.trim())) url.searchParams.set('country', 'us');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not look up that location.');
  const data: { features?: MapTilerFeature[] } = await response.json();
  return data.features ?? [];
}

function cityFromFeature(feature: MapTilerFeature): MarketplaceLocation | null {
  const context = feature.context ?? [];
  const city = feature.place_type.includes('postal_code')
    ? context.find((item) => item.id.startsWith('municipality.'))?.text
    : feature.text;
  if (!city || !Array.isArray(feature.center) || !Number.isFinite(feature.center[0]) || !Number.isFinite(feature.center[1])) return null;
  return {
    city,
    state: context.find((item) => item.id.startsWith('region.'))?.text ?? '',
    country: context.find((item) => item.id.startsWith('country.'))?.text ?? '',
    longitude: feature.center[0],
    latitude: feature.center[1],
    source: 'USER_SELECTED',
  };
}

export async function findCities(query: string, signal?: AbortSignal): Promise<MarketplaceLocation[]> {
  if (query.trim().length < 2) return [];
  const results = await geocode(query.trim(), 'municipality,postal_code', signal);
  const unique = new Map<string, MarketplaceLocation>();
  for (const feature of results) {
    const city = cityFromFeature(feature);
    if (city) unique.set(`${city.city}|${city.state}|${city.country}`, city);
  }
  return [...unique.values()];
}

export async function cityForCoordinates(latitude: number, longitude: number): Promise<MarketplaceLocation | null> {
  const results = await geocode(`${longitude},${latitude}`, 'municipality');
  const city = results.map(cityFromFeature).find((result) => result !== null);
  return city ? { ...city, latitude, longitude, source: 'BROWSER' } : null;
}

export async function estimateCityFromIp(signal?: AbortSignal): Promise<MarketplaceLocation | null> {
  const key = import.meta.env.VITE_MAP_API_KEY;
  if (!key) return null;
  const url = new URL('https://api.maptiler.com/geolocation/ip.json');
  url.searchParams.set('key', key);
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const data: { city?: string; region?: string; country?: string } = await response.json();
  if (!data.city || !data.country) return null;
  return { city: data.city, state: data.region ?? '', country: data.country, source: 'IP' };
}

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
