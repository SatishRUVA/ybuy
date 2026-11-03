import { CasesSection } from '@/main-site/pages/admin/cases';

export function ClaimsPage() {
  return <div className="max-w-4xl mx-auto px-4 py-8"><CasesSection kind="dispute" staff={false} /></div>;
}

export function ClaimDetailPage({ id }: { id: string }) {
  return <div className="max-w-4xl mx-auto px-4 py-8"><CasesSection key={id} kind="dispute" staff={false} initialId={id} /></div>;
}
