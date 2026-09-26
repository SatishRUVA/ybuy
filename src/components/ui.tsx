/**
 * YBuy design-system primitives.
 *
 * Every button, badge, alert, section heading and empty state in the app renders through one of
 * these so tone, size, radius, focus ring and loading behaviour stay identical everywhere.
 * Add a variant here rather than hand-rolling classes in a page.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

/**
 * Full-screen layer for modals and sheets, rendered at the document root.
 * The route wrapper animates opacity, which creates a stacking context - anything overlay-like
 * left inside it would paint underneath the sticky header and bottom nav.
 */
export function Overlay({ children, className = '' }: { children: ReactNode; className?: string }) {
  return createPortal(
    <div className={`fixed inset-0 z-[200] ${className}`}>{children}</div>,
    document.body,
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'inverse' | 'onDark';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-card whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-fast ease-out ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-text shadow-xs hover:bg-accent-hover',
  secondary: 'bg-card text-main border border-strong hover:bg-subtle',
  ghost: 'text-sec hover:text-main hover:bg-subtle',
  danger: 'bg-card text-error border border-app hover:bg-error-soft',
  success: 'bg-success text-white shadow-xs hover:opacity-90',
  // For placement on an accent-filled panel.
  inverse: 'bg-card text-accent shadow-xs hover:bg-subtle',
  // For placement over photography.
  onDark: 'bg-white/10 text-white border border-white/35 backdrop-blur-sm hover:bg-white/20',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px]',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Text shown in place of children while `loading` - keeps the same verb as the idle label. */
  loadingLabel?: string;
  fullWidth?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant = 'primary', size = 'md', loading = false, loadingLabel,
  fullWidth = false, icon, trailingIcon, className = '', children, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin shrink-0" /> : icon}
      {loading ? (loadingLabel ?? children) : children}
      {!loading && trailingIcon}
    </button>
  );
}

/** Square icon-only control. Always pass `label` - it becomes the accessible name. */
export function IconButton({
  label, variant = 'secondary', size = 'md', className = '', children, ...rest
}: Omit<ButtonProps, 'icon' | 'trailingIcon' | 'loading' | 'fullWidth'> & { label: string }) {
  const box = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-11 w-11';
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${box} p-0 ${className}`}
    >
      {children}
    </button>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'inverse';

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-subtle text-sec border-app',
  accent: 'bg-accent-soft text-accent border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  error: 'bg-error-soft text-error border-transparent',
  inverse: 'bg-[var(--text)] text-[var(--bg-card)] border-transparent',
};

export function Badge({
  tone = 'neutral', icon, children, className = '',
}: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold leading-5 ${BADGE_TONE[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Inline, in-context feedback. Used instead of floating toasts so the message sits next to the thing it describes. */
export function Alert({
  tone = 'warning', title, children, className = '',
}: { tone?: 'warning' | 'error' | 'success' | 'info'; title?: string; children?: ReactNode; className?: string }) {
  const map = {
    warning: { cls: 'bg-warning-soft text-warning', Icon: AlertTriangle },
    error: { cls: 'bg-error-soft text-error', Icon: AlertTriangle },
    success: { cls: 'bg-success-soft text-success', Icon: CheckCircle2 },
    info: { cls: 'bg-accent-soft text-accent', Icon: Info },
  }[tone];
  const { Icon } = map;
  return (
    <div role="status" className={`flex items-start gap-2.5 p-3 rounded-card-lg ${map.cls} ${className}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div className="text-sm leading-relaxed min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** Page/section heading with an optional right-hand action. One heading rhythm across the app. */
export function SectionHeader({
  title, subtitle, action, actionLabel, onAction, as: Tag = 'h2', className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  const size = Tag === 'h1' ? 'text-[26px] sm:text-[32px]' : Tag === 'h2' ? 'text-xl sm:text-2xl' : 'text-lg';
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <Tag className={`${size} font-bold text-main font-display leading-tight`}>{title}</Tag>
        {subtitle && <p className="text-sec text-sm mt-1">{subtitle}</p>}
      </div>
      {action ??
        (actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:text-accent-hover transition-colors duration-fast"
          >
            {actionLabel}
            <ArrowRight size={15} />
          </button>
        ) : null)}
    </div>
  );
}

/** Helpful, actionable empty state - never a bare "No results". */
export function EmptyState({
  icon, title, description, actionLabel, onAction, className = '',
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center text-center py-14 px-6 rounded-card-xl border border-dashed border-strong bg-card ${className}`}>
      {icon && (
        <div className="w-12 h-12 rounded-full bg-subtle flex items-center justify-center text-sec mb-3">{icon}</div>
      )}
      <h3 className="font-semibold text-main">{title}</h3>
      {description && <p className="text-sm text-sec mt-1.5 max-w-sm leading-relaxed">{description}</p>}
      {actionLabel && onAction && (
        <Button size="sm" className="mt-5" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  );
}

/** Standard bordered surface. Pass `interactive` for cards that are clickable. */
export function Surface({
  interactive = false, className = '', children, ...rest
}: { interactive?: boolean; className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`bg-card border border-app rounded-card-lg ${interactive ? 'card-hover cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/** Form field wrapper: label, control, and inline validation message in one consistent rhythm. */
export function Field({
  label, hint, error, htmlFor, children,
}: { label: string; hint?: ReactNode; error?: string | null; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-main mb-1.5">{label}</label>
      {hint}
      {children}
      {error && <p className="text-xs text-error mt-1.5">{error}</p>}
    </div>
  );
}
