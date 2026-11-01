import { ShieldAlert } from 'lucide-react';
import { WorkspaceHeader } from '@/components/account-workspace';

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
    <div className="p1-container p1-page p1-account">
      <div>
        <WorkspaceHeader title="Good gear. Good neighbours." description="YBuy is for renting everyday items between neighbours. These items are never allowed as listings." />
        <section className="p1-panel account-panel" aria-labelledby="prohibited-items-title">
          <h2 id="prohibited-items-title">Community guidelines</h2>
          <ul className="account-guidelines-list">
            {PROHIBITED_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-sec leading-relaxed">
                <ShieldAlert size={16} className="text-warning shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </section>
        <p className="text-xs text-muted mt-5 leading-relaxed">
          Listings suspected of violating these guidelines are reviewed manually. Publishing a
          listing that violates them may result in removal and account restrictions.
        </p>
      </div>
    </div>
  );
}
