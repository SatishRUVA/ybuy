import { forwardRef, type ComponentPropsWithoutRef } from 'react';

type Props = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'inputMode' | 'autoComplete' | 'maxLength'>;

export const SecurityCodeInput = forwardRef<HTMLInputElement, Props>(function SecurityCodeInput(props, ref) {
  return <div className="security-code">
    <div className="security-code-slots" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <span key={index} data-code-slot="" />)}
    </div>
    <input {...props} ref={ref} type="text" inputMode="numeric" autoComplete="one-time-code"
      maxLength={6} pattern="[0-9]{6}" className="security-code-input" />
  </div>;
});
