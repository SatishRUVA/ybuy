import { CasesSection } from '@/main-site/components/operations/cases';

export function SupportPage({ id }: { id?: string }) {
  return <div className="max-w-4xl mx-auto px-4 py-8"><CasesSection key={id ?? 'queue'} kind="support" initialId={id} /></div>;
}
