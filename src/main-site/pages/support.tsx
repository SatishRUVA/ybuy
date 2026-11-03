import { CasesSection } from '@/main-site/pages/admin/cases';

export function SupportPage({ id }: { id?: string }) {
  return <div className="max-w-4xl mx-auto px-4 py-8"><CasesSection key={id ?? 'queue'} kind="support" staff={false} initialId={id} /></div>;
}
