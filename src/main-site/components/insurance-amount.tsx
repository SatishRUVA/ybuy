import { useId } from 'react';
import { insuranceAmountCents } from '@/lib/insurance-pricing';
import { Switch } from '@/main-site/components/shadcn/switch';

export function InsuranceAmount({ days, replacementValue, quantity = 1, selected, onSelectionChange, disabled }: {
  days: number;
  replacementValue: number;
  quantity?: number;
  selected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  disabled?: boolean;
}) {
  const switchId = useId();
  const descriptionId = useId();
  const amount = insuranceAmountCents(replacementValue, days, quantity) / 100;
  if (onSelectionChange) {
    return (
      <div className="flex min-h-11 items-center gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={switchId} className="block font-semibold text-main">Add rental protection</label>
          <p id={descriptionId} className="text-xs text-sec">
            Accidental damage and theft. Priced at 1% of declared item value per rental day and unit.{' '}
            <a href="/protection" className="font-medium text-accent underline underline-offset-2">See coverage</a>
          </p>
        </div>
        <span className="shrink-0 text-sm font-medium text-main tnum">+${amount.toFixed(2)}</span>
        <Switch id={switchId} checked={selected === true} disabled={disabled}
          aria-describedby={descriptionId}
          onCheckedChange={onSelectionChange}
          className="relative before:absolute before:-inset-x-1 before:-inset-y-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2" />
      </div>
    );
  }
  return (
    <div className="flex justify-between gap-3 text-sec">
      <span>Optional insurance (if selected at checkout)</span>
      <span className="text-main font-medium tnum">+${amount.toFixed(2)}</span>
    </div>
  );
}