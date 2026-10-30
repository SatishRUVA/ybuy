import { countryIsAllowed, fetchMarketplaceCountries, type MarketplaceCountry } from '@/lib/marketplace-countries';

export type LocationSource = 'USER_SELECTED' | 'BROWSER' | 'IP' | 'NONE';

export interface MarketplaceLocation {
  city: string;
  state: string;
  country: string;
  source: LocationSource;
  latitude?: number;
  longitude?: number;
  postalCode?: string;
}

export const NO_LOCATION: MarketplaceLocation = { city: '', state: '', country: '', source: 'NONE' };

export function locationLabel(location: MarketplaceLocation): string {
  return location.city ? [location.city, [location.state, location.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : 'Set your location';
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

async function geocode(query: string, types: string, signal?: AbortSignal, proximity?: { latitude: number; longitude: number }, countries?: MarketplaceCountry[]): Promise<MapTilerFeature[]> {
  const key = import.meta.env.VITE_MAP_API_KEY;
  if (!key) throw new Error('City search is unavailable right now.');
  const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json`);
  url.searchParams.set('key', key);
  url.searchParams.set('types', types);
  url.searchParams.set('limit', '5');
  if (proximity) url.searchParams.set('proximity', `${proximity.longitude},${proximity.latitude}`);
  const allowed = countries ?? await fetchMarketplaceCountries();
  if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(query)) {
    url.searchParams.set('country', allowed.map(country => country.code.toLowerCase()).join(','));
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not look up that location.');
  const data: { features?: MapTilerFeature[] } = await response.json();
  return (data.features ?? []).filter(feature => {
    const country = feature.context?.find(item => item.id.startsWith('country.'))?.text ?? '';
    return countryIsAllowed(country, allowed);
  });
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
    ...(feature.place_type.includes('postal_code') ? { postalCode: feature.text } : {}),
  };
}

export async function findCities(query: string, signal?: AbortSignal, proximity?: { latitude: number; longitude: number }): Promise<MarketplaceLocation[]> {
  if (query.trim().length < 2) return [];
  const results = await geocode(query.trim(), 'municipality,postal_code', signal, proximity);
  const unique = new Map<string, MarketplaceLocation>();
  for (const feature of results) {
    const city = cityFromFeature(feature);
    if (city) unique.set(`${city.city}|${city.state}|${city.country}|${city.postalCode ?? ''}`, city);
  }
  return [...unique.values()];
}

export async function cityForCoordinates(latitude: number, longitude: number): Promise<MarketplaceLocation | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Choose a valid location.');
  }
  const results = await geocode(`${longitude},${latitude}`, 'municipality');
  const city = results.map(cityFromFeature).find((result) => result !== null);
  if (!city || haversineMiles(latitude, longitude, city.latitude!, city.longitude!) > 100) {
    throw new Error('Your location is outside the enabled marketplace countries. Choose another city.');
  }
  return { ...city, latitude, longitude, source: 'BROWSER' };
}

export async function estimateCityFromIp(signal?: AbortSignal): Promise<MarketplaceLocation | null> {
  const key = import.meta.env.VITE_MAP_API_KEY;
  if (!key) return null;
  const url = new URL('https://api.maptiler.com/geolocation/ip.json');
  url.searchParams.set('key', key);
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const data: { city?: string; region?: string; country?: string; latitude?: number; longitude?: number } = await response.json();
  if (!data.city || !data.country) return null;
  const countries = await fetchMarketplaceCountries();
  if (!countryIsAllowed(data.country, countries)) return null;
  let latitude = data.latitude;
  let longitude = data.longitude;
  let hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(data.latitude!) <= 90 && Math.abs(data.longitude!) <= 180;
  if (!hasCoordinates) {
    const city = await geocode([data.city, data.region].filter(Boolean).join(', '), 'municipality', signal, undefined, countries);
    const center = city.map(cityFromFeature).find((result) => result !== null);
    if (center) { latitude = center.latitude; longitude = center.longitude; hasCoordinates = true; }
  }
  return {
    city: data.city, state: data.region ?? '', country: data.country, source: 'IP',
    ...(hasCoordinates ? { latitude, longitude } : {}),
  };
}

/** Great-circle distance between two coordinates, in miles. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Match the server's maximum rental period; allow local deployments to choose a shorter horizon.
const parsedMaxRange = Number(import.meta.env.VITE_MAX_BOOKING_RANGE_DAYS);
export const MAX_BOOKING_RANGE_DAYS = Number.isFinite(parsedMaxRange) && parsedMaxRange > 0
  ? Math.min(366, Math.floor(parsedMaxRange))
  : 366;

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
