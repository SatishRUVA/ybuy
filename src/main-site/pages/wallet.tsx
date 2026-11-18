import { Alert } from '@/main-site/components/ui';
import { WalletPanel } from '@/main-site/components/operations/wallet';
import { RewardsPanel } from '@/main-site/components/rewards';

export function WalletPage() {
  return <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
    <h1 className="text-2xl font-bold font-display text-main">Wallet</h1>
    <RewardsPanel />
    <details className="text-sm text-sec">
      <summary className="min-h-11 cursor-pointer py-3">Legacy test credits (separate from points)</summary>
      <Alert tone="warning">Test credits only. These are separate from YBuy Points and cannot pay fees or deposits. Live redemption is disabled.</Alert>
      <WalletPanel />
    </details>
  </div>;
}
