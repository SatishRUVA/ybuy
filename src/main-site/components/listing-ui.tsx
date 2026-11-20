import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, LoaderCircle } from 'lucide-react';
import './listing-ui.css';

type ActionVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ActionSize = 'sm' | 'md' | 'lg';

export interface ListingActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionVariant;
  size?: ActionSize;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function ListingAction({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  fullWidth = false,
  icon,
  trailingIcon,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ListingActionProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`listing-action listing-action--${variant} listing-action--${size} ${fullWidth ? 'listing-action--full' : ''} ${className}`}
    >
      {loading ? <LoaderCircle size={16} aria-hidden="true" className="listing-action-spinner" /> : icon}
      {loading ? (loadingLabel ?? children) : children}
      {!loading && trailingIcon}
    </button>
  );
}

export function ListingIconAction({
  label,
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: Omit<ListingActionProps, 'icon' | 'trailingIcon' | 'loading' | 'loadingLabel' | 'fullWidth'> & { label: string }) {
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      aria-label={label}
      className={`listing-action listing-action--${variant} listing-action--icon listing-action--${size} ${className}`}
    >
      {children}
    </button>
  );
}

export function ListingNotice({
  tone = 'warning',
  title,
  children,
  className = '',
}: {
  tone?: 'warning' | 'error' | 'success' | 'info';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const notices = {
    warning: { Icon: AlertTriangle, role: 'status' as const },
    error: { Icon: AlertTriangle, role: 'alert' as const },
    success: { Icon: CheckCircle2, role: 'status' as const },
    info: { Icon: Info, role: 'status' as const },
  };
  const { Icon, role } = notices[tone];

  return (
    <div role={role} className={`listing-notice listing-notice--${tone} ${className}`}>
      <Icon size={17} aria-hidden="true" />
      <div>
        {title && <p className="listing-notice-title">{title}</p>}
        <div className="listing-notice-copy">{children}</div>
      </div>
    </div>
  );
}

export function ListingField({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="listing-field">
      <label htmlFor={htmlFor}>{label}</label>
      {hint && <div className="listing-field-hint">{hint}</div>}
      {children}
      {error && <p id={htmlFor ? `${htmlFor}-error` : undefined} className="listing-field-error">{error}</p>}
    </div>
  );
}

export function ListingSkeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`listing-skeleton ${className}`} />;
}

export function ListingAiSkeleton() {
  return (
    <div className="listing-ai-skeleton" aria-hidden="true">
      <ListingSkeleton className="listing-skeleton--title" />
      <ListingSkeleton className="listing-skeleton--line" />
      <ListingSkeleton className="listing-skeleton--field" />
      <ListingSkeleton className="listing-skeleton--field" />
    </div>
  );
}
