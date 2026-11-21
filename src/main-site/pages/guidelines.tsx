import { ShieldAlert } from 'lucide-react';
import { SectionHeader, Surface } from '@/main-site/components/ui';

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
          subtitle="Help keep YBuy safe. These items cannot be listed."
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
        <Surface className="p-5 mt-4">
          <h2 className="font-semibold text-main">Photo requirements</h2>
          <p className="text-sm text-sec leading-relaxed mt-2">
            Add up to four clear photos of your item. Use JPEG, PNG, or WebP files up to 3 MB,
            at least 320 pixels wide and tall. Avoid duplicates and personal information.
            Replace flagged photos or contact support if you disagree with the review.
          </p>
        </Surface>
        <p className="text-sm text-sec mt-4 leading-relaxed">
          Keep conversations in YBuy messaging. Phone numbers and email addresses are removed from
          listing details. Keep street addresses and PO boxes out of public listings; add your
          private pickup address in Location instead.
        </p>
        <p className="text-xs text-muted mt-5 leading-relaxed">
          Listings that violate these guidelines may be removed and accounts restricted.
        </p>
      </div>
    </div>
  );
}
