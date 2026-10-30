export function insuranceAmountCents(valuePerItem: number, days: number, quantity = 1): number {
  if (!Number.isSafeInteger(days) || days < 1 || !Number.isSafeInteger(quantity) || quantity < 1
    || !Number.isFinite(valuePerItem) || valuePerItem < 0) {
    throw new Error('Insurance pricing requires a valid item value, rental duration, and quantity.');
  }

  const valueCents = Math.round(valuePerItem * 100);
  if (!Number.isSafeInteger(valueCents)) throw new Error('Item value exceeds the supported insurance calculation range.');

  const amountCents = (BigInt(valueCents) * BigInt(days) * BigInt(quantity) + 50n) / 100n;
  if (amountCents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Insurance amount exceeds the supported range.');
  return Number(amountCents);
}