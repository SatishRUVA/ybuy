export type BookingReference = `YB-${string}-${string}`;
export type RentalAgreementReference = `RA-${string}-${string}`;

export function isBookingReference(value: unknown): value is BookingReference {
  return typeof value === 'string' && /^YB-\d{2}-\d{6,}$/.test(value);
}

export function isRentalAgreementReference(value: unknown): value is RentalAgreementReference {
  return typeof value === 'string' && /^RA-\d{2}-\d{6,}$/.test(value);
}
