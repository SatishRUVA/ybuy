import { expect, test } from '@playwright/test';
import { auctionCountdown } from '../src/lib/auction-countdown';

test('auction countdown uses readable units at duration boundaries', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const cases: [number, string][] = [
    [-1, '0h 00m 00s'],
    [0, '0h 00m 00s'],
    [0.1, '0h 00m 01s'],
    [3602, '1h 00m 02s'],
    [86399, '23h 59m 59s'],
    [86400, '1 day 0h'],
    [6 * 86400 + 23 * 3600, '6 days 23h'],
    [7 * 86400, '1 week'],
    [29 * 86400, '4 weeks 1 day'],
    [30 * 86400, 'About 1 month'],
    [1117 * 3600 + 19 * 60 + 32, 'About 1 month 2 weeks 2 days'],
    [60 * 86400, 'About 2 months'],
  ];
  for (const [seconds, expected] of cases) {
    expect(auctionCountdown(new Date(now + seconds * 1000).toISOString(), now)).toBe(expected);
  }
});
