import { useRouter } from '@/router';
import { needRequests, listings } from '@/data';
import { Rating, VerifiedBadge } from '@/components/trust';
import { Plus, MapPin, Calendar, DollarSign, Clock, ChevronRight, ArrowRight } from 'lucide-react';

export function RequestsPage() {
  const { navigate } = useRouter();
  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-main font-display">Requests</h1>
            <p className="text-sec text-sm mt-1">People nearby need things. Can you help?</p>
          </div>
          <button onClick={() => navigate({ name: 'need-something' })} className="flex items-center gap-2 px-4 py-2.5 rounded-card-lg bg-accent text-accent-text text-sm font-semibold hover:opacity-90 transition-opacity">
            <Plus size={16} /> I need something
          </button>
        </div>

        <div className="space-y-3">
          {needRequests.map((req) => (
            <div key={req.id} className="p-4 rounded-card-xl bg-card border border-app card-hover">
              <div className="flex items-start gap-3">
                <img src={req.avatar} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-main">{req.title}</h3>
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-sec">
                    <span className="flex items-center gap-1"><Calendar size={12} /> {req.when}</span>
                    <span className="flex items-center gap-1"><MapPin size={12} /> {req.location}</span>
                    <span className="flex items-center gap-1"><DollarSign size={12} /> ${req.budget}/day budget</span>
                    <span className="flex items-center gap-1 text-muted"><Clock size={12} /> {req.postedAgo}</span>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-sec">by {req.renter}</span>
                      {req.offers > 0 && <span className="text-xs text-accent font-medium">{req.offers} offer{req.offers > 1 ? 's' : ''}</span>}
                    </div>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-card-lg bg-accent text-accent-text text-xs font-semibold hover:opacity-90 transition-opacity">
                      Offer item <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Suggested items to offer */}
        <div className="mt-8">
          <h2 className="text-lg font-bold text-main font-display mb-3">Your items that match requests</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {listings.slice(0, 4).map((listing) => (
              <div key={listing.id} onClick={() => navigate({ name: 'listing', id: listing.id })} className="flex gap-3 p-3 rounded-card-xl bg-card border border-app card-hover cursor-pointer">
                <img src={listing.images[0]} alt="" className="w-16 h-16 rounded-card-lg object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-sm text-main line-clamp-1">{listing.title}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <Rating value={listing.rating} size="sm" />
                    {listing.verifiedOwner && <VerifiedBadge size="xs" />}
                  </div>
                  <p className="text-sm font-bold text-main mt-1">${listing.pricePerDay}<span className="text-xs text-sec font-normal">/day</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NeedSomethingPage() {
  const { back, navigate } = useRouter();
  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors">
          <ChevronRight size={18} className="rotate-180" /> Back
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold text-main font-display mb-2">I need something</h1>
        <p className="text-sec text-sm mb-6">Post what you need and let nearby owners come to you.</p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-sec uppercase tracking-wide">What do you need?</label>
            <input placeholder="e.g. projector, tables, drill..." className="w-full mt-1.5 px-4 py-3 rounded-card-lg border border-app bg-card text-sm text-main outline-none focus:border-accent" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-sec uppercase tracking-wide">When</label>
              <input placeholder="Saturday" className="w-full mt-1.5 px-4 py-3 rounded-card-lg border border-app bg-card text-sm text-main outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-xs font-semibold text-sec uppercase tracking-wide">Location</label>
              <input placeholder="Irving, TX" className="w-full mt-1.5 px-4 py-3 rounded-card-lg border border-app bg-card text-sm text-main outline-none focus:border-accent" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-sec uppercase tracking-wide">Budget per day</label>
            <div className="flex items-center gap-1 mt-1.5 px-4 py-3 rounded-card-lg border border-app bg-card">
              <DollarSign size={16} className="text-muted" />
              <input type="number" placeholder="40" className="flex-1 bg-transparent text-sm text-main outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-sec uppercase tracking-wide">Details (optional)</label>
            <textarea placeholder="Any specifics about what you need..." rows={3} className="w-full mt-1.5 px-4 py-3 rounded-card-lg border border-app bg-card text-sm text-main outline-none focus:border-accent resize-none" />
          </div>
        </div>

        <button onClick={() => navigate({ name: 'requests' })} className="mt-6 w-full py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm">
          Post request
        </button>
        <p className="text-xs text-sec text-center mt-3">Nearby owners will be notified and can offer their items.</p>
      </div>
    </div>
  );
}
