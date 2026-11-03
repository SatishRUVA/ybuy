import { insuranceAmountCents } from '@/lib/insurance-pricing';
import { useFeatureFlag } from '@/lib/use-feature-flags';

export function InsuranceAmount({ days, replacementValue, quantity = 1 }: {
  days: number;
  replacementValue: number;
  quantity?: number;
}) {
  const { enabled } = useFeatureFlag('insurance');
  const amount = enabled ? insuranceAmountCents(replacementValue, days, quantity) / 100 : null;
  return (
    <div className="flex justify-between gap-3 text-sec">
      <span>Insurance</span>
      <span className={enabled ? 'text-main font-medium tnum' : 'text-xs'}>{amount === null ? 'Not included' : `$${amount.toFixed(2)}`}</span>
    </div>
  );
}