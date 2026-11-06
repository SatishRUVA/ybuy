import { expect, test } from '@playwright/test';
import { appUrl } from './test-url';

test('listing handoff details enforce slot and return-rule validation', async ({ page }) => {
  await page.goto(appUrl);
  const result = await page.evaluate(async () => {
    const details = await import('/src/lib/listing-item-details.ts');
    const valid = {
      ...details.EMPTY_ITEM_DETAILS,
      pickup_windows: ['morning'],
      return_windows: ['afternoon', 'evening'],
      return_rules: ['Return all accessories'],
      return_note: 'Please place the charger in the case.',
    };
    const invalid = { ...valid, pickup_windows: [], return_rules: ['Unexpected rule'] };
    return {
      valid: details.listingItemDetailsError(valid),
      invalid: details.listingItemDetailsError(invalid),
    };
  });

  expect(result.valid).toBeNull();
  expect(result.invalid).toContain('pickup and return time window');
});

test('same-day dates use the pickup calendar across UTC midnight and DST', async ({ page }) => {
    await page.goto(appUrl);
    const result = await page.evaluate(async () => {
      const { pickupToday } = await import('/src/lib/pickup-timezone.ts');
      const { listingAvailabilityError, listingAvailabilityExpired } = await import('/src/lib/listing-availability.ts');
      const instant = new Date('2026-11-05T00:30:00Z');
      const today = pickupToday('America/Chicago', instant);
      return {
        chicago: today,
        sydney: pickupToday('Australia/Sydney', instant),
        dst: pickupToday('America/New_York', new Date('2027-03-14T07:30:00Z')),
        todayAllowed: listingAvailabilityError(today, '2026-11-05', today) === undefined,
        yesterdayError: listingAvailabilityError('2026-11-03', '2026-11-05', today),
        sameDayReturnError: listingAvailabilityError(today, today, today),
        expired: listingAvailabilityExpired('2026-11-05', today),
      };
    });
    expect(result).toEqual({
      chicago: '2026-11-04', sydney: '2026-11-05', dst: '2027-03-14',
      todayAllowed: true, yesterdayError: 'Choose dates from today through 180 days from today.',
      sameDayReturnError: 'Choose a start date and an end date for your availability.',
      expired: false,
    });
});

test('pickup timezones follow coordinates, including split-state locations, not the browser', async ({ page }) => {
  await page.goto(appUrl);
  const result = await page.evaluate(async () => {
    const { pickupTimeZone } = await import('/src/lib/pickup-timezone.ts');
    let invalid = '';
    try { pickupTimeZone(Number.NaN, 0); } catch (error) { invalid = (error as Error).message; }
    return {
      dallas: pickupTimeZone(32.8, -96.8),
      elPaso: pickupTimeZone(31.7619, -106.485),
      sydney: pickupTimeZone(-33.8688, 151.2093),
      kathmandu: pickupTimeZone(27.7172, 85.324),
      invalid,
    };
  });
  expect(result).toEqual({ dallas: 'America/Chicago', elPaso: 'America/Denver',
    sydney: 'Australia/Sydney', kathmandu: 'Asia/Kathmandu',
    invalid: 'Choose a pickup location with valid coordinates.' });
});
