import type { ProtectionProvider } from './renter-protection.ts';
import type { TaxProvider, TaxQuote, TaxLine, TaxAddress } from './tax-provider.ts';

export function moneyToCents(value: string | number): number {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Expected a nonnegative USD amount with at most two decimal places');
  const [whole, fraction = ''] = text.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Money amount exceeds the supported range');
  return Number(cents);
}

function sumCents(values: number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Checkout total exceeds the supported range');
  return Number(total);
}

export interface ServerBookingPrice {
  bookingId: string;
  quantity: number;
  startDate: string;
  endDate: string;
  categoryId: string;
  rentalSubtotal: string | number;
  serviceFee: string | number;
  deliveryFee: string | number;
  capturedDeposit: string | number;
  replacementValuePerUnit: string | number;
}

export interface SandboxPricingPolicy {
  taxReviewApproved: boolean;
  taxCodes: Record<'rental' | 'service_fee' | 'delivery' | 'captured_deposit', string>;
  protectionRequired: boolean;
}

export interface SandboxCheckoutQuote {
  bookingId: string;
  currency: 'usd';
  sandbox: true;
  payable: false;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  tax: TaxQuote;
  protection: { status: 'unavailable'; premiumCents: 0 };
  proposedHold: {
    amountCents: number;
    basis: 'replacement_value_times_quantity';
    percentage: 40;
    status: 'not_authorized';
  };
}

// Only call with a database-derived booking snapshot, never a request body.
export async function quoteSandboxCheckout(
  booking: ServerBookingPrice,
  address: TaxAddress,
  policy: SandboxPricingPolicy,
  providers: { tax: TaxProvider; protection: ProtectionProvider },
): Promise<SandboxCheckoutQuote> {
  if (!policy.taxReviewApproved) throw new Error('Tax sourcing, registrations, liability and rental tax codes require approval');
  if (!booking.bookingId || !booking.categoryId || !Number.isSafeInteger(booking.quantity) || booking.quantity < 1) {
    throw new Error('Invalid server booking identity or quantity');
  }
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!validDate(booking.startDate) || !validDate(booking.endDate) || booking.endDate <= booking.startDate) {
    throw new Error('Invalid server rental dates');
  }
  const protection = await providers.protection.quote({
    bookingId: booking.bookingId, categoryId: booking.categoryId,
    startDate: booking.startDate, endDate: booking.endDate, quantity: booking.quantity,
    replacementValueCents: moneyToCents(booking.replacementValuePerUnit),
  });
  if (policy.protectionRequired) throw new Error('Required renter protection is unavailable; checkout cannot proceed');
  const amounts = {
    rental: moneyToCents(booking.rentalSubtotal),
    service_fee: moneyToCents(booking.serviceFee),
    delivery: moneyToCents(booking.deliveryFee),
    captured_deposit: moneyToCents(booking.capturedDeposit),
  };
  if (amounts.rental <= 0) throw new Error('Rental subtotal must be positive');
  const lines: TaxLine[] = Object.entries(amounts)
    .filter(([, amount]) => amount > 0)
    .map(([reference, amountCents]) => ({
      reference, amountCents, taxCode: policy.taxCodes[reference as keyof typeof amounts],
    }));
  const subtotalCents = sumCents(lines.map(line => line.amountCents));
  const tax = await providers.tax.calculate({ currency: 'usd', address, lines });
  if (tax.currency !== 'usd' || tax.subtotalCents !== subtotalCents || !Number.isSafeInteger(tax.taxCents)
    || tax.taxCents < 0 || tax.totalCents !== sumCents([subtotalCents, tax.taxCents])
    || !Number.isFinite(Date.parse(tax.expiresAt)) || Date.parse(tax.expiresAt) <= Date.now()) {
    throw new Error('Tax quote does not match the server booking');
  }
  const replacement = BigInt(moneyToCents(booking.replacementValuePerUnit)) * BigInt(booking.quantity);
  const hold = (replacement * 40n + 50n) / 100n;
  if (hold > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Proposed hold exceeds the supported range');
  return {
    bookingId: booking.bookingId, currency: 'usd', sandbox: true, payable: false,
    subtotalCents, taxCents: tax.taxCents, totalCents: tax.totalCents, tax, protection,
    proposedHold: { amountCents: Number(hold), basis: 'replacement_value_times_quantity', percentage: 40, status: 'not_authorized' },
  };
}
