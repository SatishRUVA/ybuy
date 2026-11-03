import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-[200] bg-black/50 animate-cross-fade', className)} {...props} />
));
DialogOverlay.displayName = 'DialogOverlay';

const CloseButton = () => (
  <DialogPrimitive.Close
    className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-card-sm text-sec transition-colors duration-fast hover:bg-subtle hover:text-main"
    aria-label="Close"
  >
    <X size={16} />
  </DialogPrimitive.Close>
);

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'p1 !min-h-0 fixed left-1/2 top-1/2 z-[201] w-[calc(100%_-_2rem)] max-w-lg max-h-[calc(100dvh_-_2rem)] overflow-y-auto overscroll-contain',
        '-translate-x-1/2 -translate-y-1/2 bg-card border border-app rounded-card-xl shadow-pop p-5 sm:p-6 animate-cross-fade [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    >
      {children}
      <CloseButton />
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

/** Left-edge sheet used for the mobile admin navigation. */
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn('fixed inset-y-0 left-0 z-[201] w-72 max-w-[85vw] overflow-y-auto bg-card border-r border-app shadow-pop animate-slide-right', className)}
      {...props}
    >
      {children}
      <CloseButton />
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 pr-9', className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('sticky -bottom-5 sm:-bottom-6 z-10 mt-5 flex flex-col-reverse gap-2 border-t border-app bg-card py-4 sm:flex-row sm:justify-end', className)} {...props} />
);

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('font-display text-lg font-semibold text-main', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-sec', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';
