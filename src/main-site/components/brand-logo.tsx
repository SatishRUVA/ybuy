import logo from '@/assets/ybuy-logo.png';
import icon from '@/assets/ybuy-icon.png';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <span className="inline-flex shrink-0 items-center" role="img" aria-label="YBuy">
    {compact && <img src={icon} alt="" width={36} height={36} className="h-9 w-9 object-contain sm:hidden" />}
    <span className={compact ? 'hidden sm:block' : 'block'}>
      <img src={logo} alt="" width={144} height={53} className="h-12 w-36 rounded-card object-contain [.dark_&]:bg-white [.dark_&]:px-1" />
    </span>
  </span>;
}
