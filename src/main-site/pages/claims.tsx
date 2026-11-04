import { CasesSection } from '@/main-site/components/operations/cases';

export function ClaimsPage() {
  return <div className="max-w-4xl mx-auto px-4 py-8"><CasesSection kind="dispute" /></div>;
}

export function ClaimDetailPage({ id }: { id: string }) {
  return <div className="max-w-4xl mx-auto px-4 py-8"><CasesSection key={id} kind="dispute" initialId={id} /></div>;
}
