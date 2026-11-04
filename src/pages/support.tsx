import { CasesSection } from '@/components/operations/cases';
import { Button } from '@/components/ui';
import { useRouter } from '@/router';
import { WorkspaceHeader } from '@/components/account-workspace';

export function SupportPage({ id }: { id?: string }) {
  const { navigate } = useRouter();
  return <div className="p1-work-page p1-account"><div>
    <WorkspaceHeader title="A clear path to help." description="Account, rental or payment questions. Keep the details and replies in one place." />
    <div className="account-detail-layout">
      <div className="account-cases min-w-0"><CasesSection key={id ?? 'queue'} kind="support" initialId={id} /></div>
      <aside className="p1-panel account-context" aria-label="Support guidance">
        <h2 className="text-lg font-semibold text-main">A clear path to help.</h2>
        <p className="text-sm text-sec mt-3">Open a ticket for account, booking or payment questions. Include your booking reference when your question is about a rental.</p>
        <p className="text-sm text-sec mt-3">Replies and attachments stay with the ticket. You can return here to review its status; no response time is promised.</p>
        <Button variant="secondary" className="mt-5" onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>View my rentals</Button>
        <Button variant="ghost" className="mt-2" onClick={() => navigate({ name: 'claims' })}>Report a rental dispute</Button>
      </aside>
    </div>
  </div></div>;
}
