import { insuranceAmountCents } from '@/lib/insurance-pricing';

export function InsuranceAmount({ days, replacementValue, quantity = 1 }: {
  days: number;
  replacementValue: number;
  quantity?: number;
}) {
  const amount = insuranceAmountCents(replacementValue, days, quantity) / 100;
  return (
    <div className="flex justify-between gap-3 text-sec">
      <span>Insurance</span>
      <span className="text-main font-medium tnum">${amount.toFixed(2)}</span>
    </div>
  );
}