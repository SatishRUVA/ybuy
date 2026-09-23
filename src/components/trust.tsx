import { Star, ShieldCheck, BadgeCheck, Lock, Shield } from 'lucide-react';
import type { ReactNode } from 'react';

export function Rating({ value, count, size = 'sm' }: { value: number; count?: number; size?: 'sm' | 'md' | 'lg' }) {
  const starSize = size === 'lg' ? 18 : size === 'md' ? 16 : 14;
  const textSize = size === 'lg' ? 'text-lg' : size === 'md' ? 'text-sm' : 'text-xs';
  return (
    <div className="flex items-center gap-1.5">
      <Star size={starSize} className="fill-[var(--star)] text-[var(--star)]" />
      <span className={`font-semibold text-main ${textSize}`}>{value.toFixed(1)}</span>
      {count !== undefined && (
        <span className={`text-sec ${textSize}`}>({count})</span>
      )}
    </div>
  );
}

export function VerifiedBadge({ label = 'Verified owner', size = 'sm' }: { label?: string; size?: 'sm' | 'xs' }) {
  const iconSize = size === 'xs' ? 12 : 14;
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs';
  return (
    <span className={`inline-flex items-center gap-1 ${textSize} font-medium text-success`}>
      <BadgeCheck size={iconSize} className="text-success" />
      {label}
    </span>
  );
}

export function TrustChip({ icon, label, tone = 'default' }: { icon: ReactNode; label: string; tone?: 'default' | 'success' | 'warning' | 'accent' }) {
  const toneClass = {
    default: 'bg-subtle text-sec border-app',
    success: 'bg-success-soft text-success border-app',
    warning: 'bg-warning-soft text-warning border-app',
    accent: 'bg-accent-soft text-accent border-app',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${toneClass}`}>
      {icon}
      {label}
    </span>
  );
}

export function ProtectionBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const iconSize = size === 'md' ? 18 : 14;
  const textSize = size === 'md' ? 'text-sm' : 'text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 ${textSize} font-semibold text-accent`}>
      <Shield size={iconSize} className="text-accent" />
      Rental Protection
    </span>
  );
}

export function SecurityHoldNote({ amount }: { amount: number }) {
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-card border border-warning-soft bg-warning-soft">
      <Lock size={18} className="text-warning shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold text-main">${amount} refundable security hold</p>
        <p className="text-sec mt-0.5 text-xs leading-relaxed">
          Not a rental fee. Released according to rental terms after successful return and inspection.
        </p>
      </div>
    </div>
  );
}

export function TrustChecklist({ items }: { items: { icon: ReactNode; label: string }[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5 text-sm">
          <span className="text-success shrink-0">{item.icon}</span>
          <span className="text-sec">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function ShieldStamp() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-accent-soft border border-app">
      <ShieldCheck size={20} className="text-accent shrink-0" />
      <div className="text-xs">
        <p className="font-semibold text-accent">Identity verified owner</p>
        <p className="text-sec">Secure payment · Rental protection</p>
      </div>
    </div>
  );
}
