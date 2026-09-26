import { ShieldAlert } from 'lucide-react';
import { SectionHeader, Surface } from '@/components/ui';

// Mirrors the prohibited-items list used to prompt the AI photo-analysis Edge Function
// (supabase/functions/analyze-listing-photo/index.ts) - keep both in sync.
const PROHIBITED_ITEMS = [
  'Weapons or ammunition, including replicas and BB/airsoft guns',
  'Illegal drugs or drug paraphernalia',
  'Live animals',
  'Counterfeit or replica branded goods',
  'Hazardous materials (flammable, toxic, explosive, or radioactive substances)',
];

export function GuidelinesPage() {
  return (
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <SectionHeader
          as="h1"
          title="Community guidelines"
          subtitle="YBuy is for renting everyday items between neighbours. These items are never allowed as listings."
          className="mb-6"
        />
        <Surface className="p-5">
          <ul className="space-y-3.5">
            {PROHIBITED_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-sec leading-relaxed">
                <ShieldAlert size={16} className="text-warning shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </Surface>
        <p className="text-xs text-muted mt-5 leading-relaxed">
          Listings suspected of violating these guidelines are reviewed manually. Publishing a
          listing that violates them may result in removal and account restrictions.
        </p>
      </div>
    </div>
  );
}
