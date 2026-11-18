import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync('src\\lib\\listing-availability.ts', 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export /gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const { listingAvailabilityError: validate } = runInNewContext(`${compiled}\n({ listingAvailabilityError });`, {
  MAX_BOOKING_RANGE_DAYS: 30,
  todayIso: () => '2026-10-28',
  addDaysIso: (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10),
}) as { listingAvailabilityError: (start: string, end: string) => string | undefined };

test('owner availability accepts up to thirty calendar days within the scheduling horizon', () => {
  expect(validate('2026-10-28', '2026-11-27')).toBeUndefined();
  expect(validate('2027-03-27', '2027-04-26')).toBeUndefined();
  expect(validate('2027-04-25', '2027-04-26')).toBeUndefined();
});

test('listing expiry uses the exclusive end date and preserves undated legacy listings', () => {
  const { listingAvailabilityExpired } = runInNewContext(`${compiled}\n({ listingAvailabilityExpired });`, {
    MAX_BOOKING_RANGE_DAYS: 30,
  }) as { listingAvailabilityExpired: (end: string | null | undefined, today: string) => boolean };
  expect(listingAvailabilityExpired('2026-11-01', '2026-11-02')).toBe(true);
  expect(listingAvailabilityExpired('2026-11-02', '2026-11-02')).toBe(true);
  expect(listingAvailabilityExpired('2026-11-03', '2026-11-02')).toBe(false);
  expect(listingAvailabilityExpired(null, '2026-11-02')).toBe(false);
});

test('owner availability rejects thirty-one days even within the scheduling horizon', () => {
  expect(validate('2026-10-28', '2026-11-28')).toContain('30 consecutive');
  expect(validate('2027-03-01', '2027-04-01')).toContain('30 consecutive');
});

test('owner availability rejects past, day 181, reversed and invalid dates', () => {
  expect(validate('2026-10-27', '2026-11-01')).toContain('180 days');
  expect(validate('2027-04-26', '2027-04-27')).toContain('180 days');
  expect(validate('2026-11-02', '2026-11-02')).toBeTruthy();
  expect(validate('2026-11-02', '2026-11-01')).toBeTruthy();
  expect(validate('2027-02-30', '2027-03-05')).toBeTruthy();
});
