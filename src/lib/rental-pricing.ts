export type RentalPackageKind = 'weekly' | 'monthly' | null;

export function validRentalRange(start: string, end: string): boolean {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return validDate(start) && validDate(end) && end > start;
}

export interface RentalPricingOptions {
  weeklyEnabled?: boolean;
  weeklyPercent?: number;
  monthlyEnabled?: boolean;
  monthlyPercent?: number;
}

export interface RentalPricing {
  days: number;
  gross: number;
  subtotal: number;
  discountAmount: number;
  discountPercent: number;
  packageKind: RentalPackageKind;
  packageDays: number;
  extraDays: number;
}

const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

/** Price one weekly or monthly package, then charge the base daily rate for extra days. */
export function calculateRentalPricing(dailyRate: number, days: number, options: RentalPricingOptions = {}): RentalPricing {
  const safeDays = Math.max(1, Math.floor(days));
  const gross = cents(Math.max(0, dailyRate) * safeDays);
  let packageKind: RentalPackageKind = null;
  let packageDays = 0;
  let discountPercent = 0;

  if (safeDays >= 30 && options.monthlyEnabled) {
    packageKind = 'monthly'; packageDays = 30; discountPercent = options.monthlyPercent ?? 30;
  } else if (safeDays >= 7 && options.weeklyEnabled) {
    packageKind = 'weekly'; packageDays = 7; discountPercent = options.weeklyPercent ?? 20;
  }

  const discountAmount = cents(Math.max(0, dailyRate) * packageDays * discountPercent / 100);
  return {
    days: safeDays, gross, subtotal: cents(gross - discountAmount), discountAmount,
    discountPercent, packageKind, packageDays, extraDays: safeDays - packageDays,
  };
}
