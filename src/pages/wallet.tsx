import { Alert, Button } from '@/components/ui';
import { WalletPanel } from '@/components/operations/wallet';
import { WorkspaceHeader } from '@/components/account-workspace';
import { useRouter } from '@/router';

export function WalletPage() {
  const { navigate } = useRouter();
  return <div className="p1-work-page p1-account"><div>
    <WorkspaceHeader title="Your wallet, clearly explained." description="Review test credits and their recorded activity. Real rental payments and owner payouts remain separate."
      action={<Button variant="secondary" onClick={() => navigate({ name: 'dashboard', tab: 'lending' })}>Owner payments & payouts</Button>} />
    <div className="account-detail-layout">
      <div className="account-wallet min-w-0 space-y-5">
        <Alert tone="warning">Test wallet only. Credits are not cash and cannot pay fees or deposits. Production rewards and live redemption are disabled.</Alert>
        <WalletPanel />
      </div>
      <aside className="p1-panel account-context" aria-label="Wallet limits">
        <h2 className="text-lg font-semibold text-main">Credits are not a payment method.</h2>
        <p className="text-sm text-sec mt-3">Book rentals through the regular booking or competitive bidding flow. Payment is confirmed only by YBuy’s verified payment integration.</p>
        <p className="text-sm text-sec mt-3">For an owner’s Stripe transfers or bank payout status, open the lending dashboard.</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate({ name: 'support' })}>Ask a payment question</Button>
      </aside>
    </div>
  </div></div>;
}
