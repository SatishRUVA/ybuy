// Estimate only: checkout charges the immutable database booking total.
export function bookingTaxCents(rental: number, serviceFee = 0): number {
  const rentalCents = Math.round(rental * 100);
  const feeCents = Math.round(serviceFee * 100);
  const cents = rentalCents + feeCents;
  if (!Number.isFinite(rental) || rental < 0 || !Number.isFinite(serviceFee) || serviceFee < 0
    || !Number.isSafeInteger(rentalCents) || !Number.isSafeInteger(feeCents) || !Number.isSafeInteger(cents)) {
    throw new Error('Tax requires valid rental and service fee amounts.');
  }
  return Number((BigInt(cents) * 7n + 50n) / 100n);
}
