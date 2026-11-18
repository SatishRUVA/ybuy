import { Gift } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { Badge, Button } from '@/main-site/components/ui';

export function SignupRewardOffer({ compact = false }: { compact?: boolean }) {
  const { user, openSignIn } = useAuth();
  const { navigate } = useRouter();
  if (!import.meta.env.DEV || !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return null;
  const Heading = compact ? 'h3' : 'h2';
  return <div className={compact ? undefined : 'max-w-[1400px] mx-auto px-4 sm:px-6 pt-6'}>
    <section aria-label="YBuy signup reward"
    className={`rounded-card-lg border border-app bg-subtle ${compact ? 'p-4 mb-5' : 'p-5 sm:p-7 flex flex-col md:flex-row md:items-center gap-5 md:gap-8'}`}>
    <div className="flex-1 min-w-0">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sec">
        <Gift size={16} aria-hidden="true" /> Welcome to YBuy <span className="font-normal normal-case tracking-normal">/ Local preview</span>
      </p>
      <Heading className={`mt-2 font-bold font-display text-main ${compact ? 'text-lg' : 'text-xl sm:text-2xl'}`}>Get rewarded just for joining!</Heading>
      <p className="mt-2 text-sm text-sec">Sign up, verify your email and phone, and get <strong className="text-main">500 YBuy Points</strong> for your rentals.</p>
      <p className="mt-1 text-xs text-sec">New accounts only. One signup reward per verified account. Free to join. No subscription.</p>
      <p className="mt-2 text-xs text-sec">Test preview only. Rewards are not live; SMS verification and payment discounts are unavailable.</p>
    </div>
    <div className={`shrink-0 ${compact ? 'mt-3' : 'flex flex-wrap items-center md:items-start md:flex-col gap-3'}`}>
      <Badge tone="neutral">500 PTS = $5</Badge>
      {!compact && <Button onClick={() => user ? navigate({ name: 'wallet' }) : openSignIn()}>
        {user ? 'View my points' : 'Join YBuy'}
      </Button>}
    </div>
    </section>
  </div>;
}
