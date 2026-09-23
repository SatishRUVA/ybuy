import { ShieldAlert } from 'lucide-react';

// Mirrors the prohibited-items list used to prompt the AI photo-analysis Edge Function
// (supabase/functions/analyze-listing-photo/index.ts) — keep both in sync.
const PROHIBITED_ITEMS = [
  'Weapons or ammunition, including replicas and BB/airsoft guns',
  'Illegal drugs or drug paraphernalia',
  'Live animals',
  'Counterfeit or replica branded goods',
  'Hazardous materials (flammable, toxic, explosive, or radioactive substances)',
];

export function GuidelinesPage() {
  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-main font-display mb-2">Community Guidelines</h1>
        <p className="text-sec text-sm mb-6">
          YBuy is for renting everyday items between neighbors. To keep the marketplace safe, the
          following items are never allowed as listings:
        </p>
        <div className="rounded-card-xl bg-card border border-app p-5 space-y-3">
          {PROHIBITED_ITEMS.map((item) => (
            <div key={item} className="flex items-start gap-2.5 text-sm text-sec">
              <ShieldAlert size={16} className="text-warning shrink-0 mt-0.5" />
              {item}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-5">
          Listings suspected of violating these guidelines are reviewed manually. Publishing a
          listing that violates these guidelines may result in removal and account restrictions.
        </p>
      </div>
    </div>
  );
}
