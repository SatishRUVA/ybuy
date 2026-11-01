import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fieldClass } from '@/components/form-classes';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger ref={ref} className={cn(fieldClass('p1-dropdown-trigger group flex items-center justify-between gap-2 text-left data-[placeholder]:text-muted [&>span]:truncate'), className)} {...props}>
    {children}
    <SelectPrimitive.Icon asChild><ChevronDown size={16} aria-hidden="true" className="text-sec shrink-0 transition-transform duration-fast group-data-[state=open]:rotate-180 motion-reduce:transition-none" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={6}
      collisionPadding={16}
      className={cn('p1 p1-dropdown-menu relative z-[210] max-h-[min(18rem,var(--radix-select-content-available-height))] min-w-[8rem] max-w-[calc(100vw_-_2rem)] overflow-y-auto overscroll-contain rounded-card-lg border border-app bg-card text-main shadow-pop animate-scale-in motion-reduce:animate-none', className)}
      {...props}
    >
      <SelectPrimitive.Viewport className={cn('p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]')}>
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn('p1-dropdown-option relative flex min-h-11 w-full cursor-pointer select-none items-center rounded-card py-2.5 pl-3 pr-9 text-sm outline-none transition-colors duration-fast data-[highlighted]:bg-subtle data-[state=checked]:bg-accent-soft data-[state=checked]:font-semibold data-[state=checked]:text-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 motion-reduce:transition-none', className)}
    {...props}
  >
    <span className="absolute right-3 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator><Check size={15} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

export function Dropdown<T extends string>({
  value, onChange, options, placeholder = 'Choose an option', className, name, required, ...props
}: Omit<React.ComponentPropsWithoutRef<typeof SelectTrigger>, 'value' | 'onChange' | 'children'> & {
  value: T | '';
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(next) => {
      const option = options.find((item) => item.value === next && !item.disabled);
      if (option) onChange(option.value);
    }} disabled={props.disabled} name={name} required={required}>
      <SelectTrigger {...props} className={cn('group', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
