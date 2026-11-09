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
        <Surface className="p-5 mt-4">
          <h2 className="font-semibold text-main">Photo requirements</h2>
          <p className="text-sm text-sec leading-relaxed mt-2">
            Add up to four clear, relevant photos of the item. Use JPEG, PNG, or WebP files no larger
            than 3 MB, with both dimensions at least 320 pixels. Do not upload duplicates or images
            containing personal information. Photo metadata is removed during upload. If a photo
            needs correction, replace the highlighted image and recheck it; uncertain cases can be
            sent to support for review. Editing listing text does not repeat the photo review.
          </p>
        </Surface>
        <p className="text-sm text-sec mt-4 leading-relaxed">
          Keep contact information inside YBuy messaging. Phone numbers and email addresses in
          listing details are removed when you continue. Review the corrected text before proceeding.
          Street addresses and PO boxes do not belong in public listing details; use the private
          pickup address in Location. Flagged photos must be corrected before leaving Photos.
        </p>
        <p className="text-xs text-muted mt-5 leading-relaxed">
          Listings suspected of violating these guidelines are reviewed manually. Publishing a
          listing that violates them may result in removal and account restrictions.
        </p>
      </div>
    </div>
  );
}
