import { expect, test } from '@playwright/test';
import { isBookingReference, isRentalAgreementReference } from '../src/lib/customer-references';

test('recognizes padded and expanded booking and agreement references', () => {
  expect(isBookingReference('YB-26-000123')).toBe(true);
  expect(isBookingReference('YB-26-1000000')).toBe(true);
  expect(isRentalAgreementReference('RA-26-000123')).toBe(true);
  expect(isRentalAgreementReference('RA-26-1000000')).toBe(true);
});

test('rejects UUIDs, short sequences and mismatched reference prefixes', () => {
  expect(isBookingReference('8a231f4d-b92e-40a8-93a4-94e08f259d01')).toBe(false);
  expect(isBookingReference('YB-26-12345')).toBe(false);
  expect(isRentalAgreementReference('YB-26-000123')).toBe(false);
  expect(isRentalAgreementReference(null)).toBe(false);
});
