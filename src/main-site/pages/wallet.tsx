import { Alert } from '@/main-site/components/ui';
import { WalletPanel } from '@/main-site/components/operations/wallet';

export function WalletPage() {
  return <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
    <h1 className="text-2xl font-bold font-display text-main">Wallet</h1>
    <Alert tone="warning">Test wallet only. Credits are not cash and cannot pay fees or deposits. Production rewards and live redemption are disabled.</Alert>
    <WalletPanel />
  </div>;
}
