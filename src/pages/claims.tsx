import { CasesSection } from '@/components/operations/cases';
import { Button } from '@/components/ui';
import { useRouter } from '@/router';
import { WorkspaceHeader } from '@/components/account-workspace';

function ClaimWorkspace({ id }: { id?: string }) {
  const { navigate } = useRouter();
  return <div className="p1-work-page p1-account"><div>
    <WorkspaceHeader title="A fair process starts with the facts." description="Report a rental issue, share evidence, and follow the case with the people involved." />
    <div className="account-detail-layout">
      <div className="account-cases min-w-0"><CasesSection key={id ?? 'queue'} kind="dispute" initialId={id} /></div>
      <aside className="p1-panel account-context" aria-label="Claims guidance">
        <h2 className="text-lg font-semibold text-main">Keep the facts together.</h2>
        <p className="text-sm text-sec mt-3">Use your booking reference, describe what happened, and attach relevant evidence to the case.</p>
        <p className="text-sm text-sec mt-3">Only authorized booking participants and staff can view the record. Checklist answers from pickup or return are not saved as evidence.</p>
        <p className="text-sm text-sec mt-3">A case outcome does not itself move money. Review your booking’s verified settlement status for payment or deposit changes.</p>
        <Button variant="secondary" className="mt-5" onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>Find my booking reference</Button>
        <Button variant="ghost" className="mt-2" onClick={() => navigate({ name: 'support' })}>Payment question? Get support</Button>
      </aside>
    </div>
  </div></div>;
}

export function ClaimsPage() {
  return <ClaimWorkspace />;
}

export function ClaimDetailPage({ id }: { id: string }) {
  return <ClaimWorkspace id={id} />;
}
