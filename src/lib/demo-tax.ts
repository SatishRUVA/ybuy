// Display-only sandbox assumption, never a payable tax calculation.
export function demoTaxCents(rental: number): number {
  const cents = Math.round(rental * 100);
  if (!Number.isFinite(rental) || rental < 0 || !Number.isSafeInteger(cents)) {
    throw new Error('Demo tax requires a valid rental amount.');
  }
  return Number((BigInt(cents) * 7n + 50n) / 100n);
}
