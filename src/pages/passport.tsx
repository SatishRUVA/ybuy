import { useRouter } from '@/router';
import { listings } from '@/data';
import { Rating, VerifiedBadge } from '@/components/trust';
import { ArrowLeft, CheckCircle2, Shield, Package, Clock, Award, FileText, MapPin, AlertCircle } from 'lucide-react';

export function ItemPassportPage({ id }: { id: string }) {
  const { back, navigate } = useRouter();
  const listing = listings.find((l) => l.id === id);
  if (!listing) return <div className="p-8 text-center text-sec">Listing not found.</div>;

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors">
          <ArrowLeft size={18} /> Back
        </button>

        {/* Passport header */}
        <div className="relative overflow-hidden rounded-card-xl bg-card border border-app p-6 mb-6">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent-soft rounded-full -translate-y-12 translate-x-12 opacity-50" />
          <div className="relative flex items-start gap-4">
            <img src={listing.images[0]} alt="" className="w-20 h-20 rounded-card-lg object-cover shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <FileText size={16} className="text-accent" />
                <span className="text-xs font-semibold text-accent uppercase tracking-wide">Item Passport</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-main font-display">{listing.title}</h1>
              <p className="text-sm text-sec mt-1">Asset ID: <span className="font-mono font-semibold text-main">{listing.assetId}</span></p>
            </div>
          </div>
        </div>

        {/* Passport fields grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <PassportField icon={FileText} label="Asset ID" value={listing.assetId} />
          <PassportField icon={Shield} label="Declared value" value={`$${listing.declaredValue.toLocaleString()}`} />
          <PassportField icon={CheckCircle2} label="Ownership" value="Verified" tone="success" />
          <PassportField icon={Package} label="Components" value={`${listing.components.filter((c) => c.present).length} / ${listing.components.length}`} />
          <PassportField icon={Clock} label="Rental history" value={`${listing.rentalHistory} completed`} />
          <PassportField icon={Award} label="Condition" value={listing.condition} tone="success" />
          <PassportField icon={AlertCircle} label="Damage history" value={listing.damageHistory} tone={listing.damageHistory === 'None' ? 'success' : 'warning'} />
          <PassportField icon={FileText} label="Serial" value={listing.serialPartial} />
          <PassportField icon={MapPin} label="Location" value="Approximate" />
        </div>

        {/* Owner */}
        <div className="p-5 rounded-card-xl bg-card border border-app mb-6">
          <h3 className="font-semibold text-main mb-3">Owner</h3>
          <div className="flex items-center gap-3">
            <img src={listing.owner.avatar} alt="" className="w-12 h-12 rounded-full object-cover" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-main">{listing.owner.name}</span>
                {listing.owner.verified && <VerifiedBadge size="xs" />}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Rating value={listing.owner.rating} size="sm" />
                <span className="text-xs text-sec">{listing.owner.rentals} rentals</span>
              </div>
            </div>
          </div>
        </div>

        {/* Components */}
        <div className="p-5 rounded-card-xl bg-card border border-app mb-6">
          <h3 className="font-semibold text-main mb-3">Component tracking</h3>
          <div className="grid grid-cols-2 gap-2">
            {listing.components.map((c, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 rounded-card-lg bg-subtle border border-app">
                <CheckCircle2 size={16} className="text-success shrink-0" />
                <span className="text-sm text-main">{c.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rental history timeline */}
        <div className="p-5 rounded-card-xl bg-card border border-app">
          <h3 className="font-semibold text-main mb-4">Rental history</h3>
          <div className="space-y-3">
            {[
              { date: 'Aug 15, 2026', renter: 'Mike T.', status: 'Completed', rating: 5 },
              { date: 'Aug 3, 2026', renter: 'Jessica L.', status: 'Completed', rating: 5 },
              { date: 'Jul 22, 2026', renter: 'Tom B.', status: 'Completed', rating: 4 },
              { date: 'Jul 10, 2026', renter: 'Nina K.', status: 'Completed', rating: 5 },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-3 pb-3 border-b border-app last:border-0 last:pb-0">
                <div className="w-8 h-8 rounded-full bg-success-soft flex items-center justify-center shrink-0">
                  <CheckCircle2 size={16} className="text-success" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-main">{r.renter}</p>
                  <p className="text-xs text-sec">{r.date}</p>
                </div>
                <span className="text-xs text-success font-medium">{r.status}</span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={() => navigate({ name: 'listing', id: listing.id })} className="mt-6 w-full py-3 rounded-card-lg border border-app text-main font-semibold text-sm hover:bg-subtle transition-colors">
          Back to listing
        </button>
      </div>
    </div>
  );
}

function PassportField({ icon: Icon, label, value, tone = 'default' }: { icon: typeof FileText; label: string; value: string; tone?: 'default' | 'success' | 'warning' }) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-main';
  return (
    <div className="p-3.5 rounded-card-lg bg-card border border-app">
      <div className="flex items-center gap-1.5 text-xs text-muted font-medium uppercase tracking-wide">
        <Icon size={12} />
        {label}
      </div>
      <div className={`text-sm font-semibold mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}
