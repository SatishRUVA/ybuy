import { createElement, useState } from 'react';
import { InsuranceAmount } from '@/main-site/components/insurance-amount';

export function CheckoutInsuranceHarness() {
  const [selected, setSelected] = useState(false);
  return createElement('div', null,
    createElement(InsuranceAmount, {
      days: 2, replacementValue: 200, selected, onSelectionChange: setSelected,
    }),
    createElement('output', { 'data-testid': 'insurance-choice' }, String(selected)));
}
