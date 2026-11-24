import tzLookup from 'tz-lookup';

export function pickupTimeZone(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Choose a pickup location with valid coordinates.');
  }
  return tzLookup(latitude, longitude);
}

export function pickupToday(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export async function pickupMidnight(date: string, timeZone: string): Promise<string> {
  const native = (globalThis as typeof globalThis & { Temporal?: typeof import('temporal-polyfill').Temporal }).Temporal;
  const temporal = native ?? (await import('temporal-polyfill')).Temporal;
  const midnight = temporal.ZonedDateTime.from(`${date}T00:00[${timeZone}]`, { disambiguation: 'reject' });
  return midnight.toInstant().toString({ smallestUnit: 'millisecond' });
}
