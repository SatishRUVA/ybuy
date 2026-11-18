import { insuranceAmountCents } from '@/lib/insurance-pricing';

export function InsuranceAmount({ days, replacementValue, quantity = 1, selected, onSelectionChange, disabled }: {
  days: number;
  replacementValue: number;
  quantity?: number;
  selected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  disabled?: boolean;
}) {
  const amount = insuranceAmountCents(replacementValue, days, quantity) / 100;
  if (onSelectionChange) {
    return (
      <div className="space-y-1">
        <label className="flex min-h-11 items-center justify-between gap-3 text-sec">
          <span className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={selected === true} disabled={disabled}
              onChange={event => onSelectionChange(event.currentTarget.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
            <span>Optional insurance</span>
          </span>
          <span className="text-main font-medium tnum">{selected ? `$${amount.toFixed(2)}` : '$0.00'}</span>
        </label>
        <p className="text-xs text-sec">Adds ${amount.toFixed(2)} at 1% of declared item value per rental day and unit. Not included unless selected.</p>
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