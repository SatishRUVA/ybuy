import { SearchBar } from '@/components/search';
import { ListingCard } from '@/components/listing-card';
import { Rating, VerifiedBadge } from '@/components/trust';
import { HeroCarousel } from '@/components/hero-carousel';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { useEffect, useState } from 'react';
import { auctions } from '@/data';
import type { Listing, Category } from '@/data';
import { fetchCategories, fetchPublishedListings, toUiCategory, toUiListing, enrichListingsWithRatings } from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { ListingGridSkeleton } from '@/components/skeleton';
import logo from '@/assets/logo.png';
import * as Icons from 'lucide-react';
import { ArrowRight, MapPin, Calendar, PackageCheck, Sparkles, Clock, Search } from 'lucide-react';

export function HomePage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) { setFavoriteIds(new Set()); return; }
    fetchFavoriteListingIds(user.id).then(setFavoriteIds).catch(() => {});
  }, [user]);

  async function handleToggleFavorite(listingId: string) {
    if (!user) return;
    const isFav = favoriteIds.has(listingId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(listingId); else next.add(listingId);
      return next;
    });
    try {
      if (isFav) await removeFavorite(user.id, listingId); else await addFavorite(user.id, listingId);
    } catch {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(listingId); else next.delete(listingId);
        return next;
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCategories(), fetchPublishedListings()])
      .then(([catRows, listingRows]) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const row of listingRows) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
        setCategories(catRows.map((c) => toUiCategory(c, counts)));
        setListings(listingRows.map(toUiListing));
        void enrichListingsWithRatings(listingRows.map(toUiListing)).then((enriched) => {
          if (!cancelled) setListings(enriched);
        });
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <section className="relative border-b border-app">
        <HeroCarousel />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/35 to-black/70" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-8 sm:pt-14 sm:pb-12">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent/90 border border-white/30 text-xs font-semibold text-accent-text mb-4 shadow-lg animate-fade-up">
              <Sparkles size={14} className="text-accent-text" />
              Find it nearby. Rent it safely. Return it easily.
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold text-white font-display tracking-tight leading-tight animate-fade-up">
              Get what you need<br className="hidden sm:block" /> without buying it.
            </h1>
            <p className="text-white/80 text-base mt-3 animate-fade-up">
              Rent from verified neighbors nearby. Cameras, tools, party gear, and more.
            </p>
          </div>
          <div className="relative z-[140] max-w-3xl mx-auto animate-fade-up">
            <SearchBar
              onSearch={(p) => navigate({
                name: 'search',
                q: p.keyword.trim() || undefined,
                lat: p.coords?.lat,
                lng: p.coords?.lng,
                locationLabel: p.locationLabel,
                start: p.startDate,
                end: p.endDate,
              })}
              variant="hero"
            />
          </div>
        </div>
      </section>

      {/* Available near you */}
      <Section title="Available near you" subtitle="Items ready to rent in your area" onSeeAll={() => navigate({ name: 'search' })}>
        {error && <p className="text-sm text-error">{error}</p>}
        {!error && loading && <ListingGridSkeleton count={10} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4" />}
        {!error && !loading && listings.filter((l) => l.available).length === 0 && (
          <p className="text-sm text-sec">No listings yet — be the first to list something.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 stagger animate-cross-fade">
          {!loading && listings.filter((l) => l.available).slice(0, 10).map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onClick={() => navigate({ name: 'listing', id: listing.id })}
              favorited={favoriteIds.has(listing.id)}
              onToggleFavorite={() => void handleToggleFavorite(listing.id)}
            />
          ))}
        </div>
      </Section>

      {/* Categories */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <h2 className="text-xl sm:text-2xl font-bold text-main font-display mb-5">Browse by category</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-10 gap-2.5 sm:gap-3">
          {categories.map((cat) => {
            const Icon = (Icons as unknown as Record<string, typeof Icons.Camera>)[cat.icon] ?? Icons.Box;
            return (
              <button
                key={cat.id}
                onClick={() => navigate({ name: 'search', category: cat.id })}
                className="group flex flex-col items-center gap-2 p-3 rounded-card-xl border border-app bg-card hover:shadow-card card-hover transition-all"
              >
                <div className="w-12 h-12 rounded-card-lg bg-accent-soft flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Icon size={22} className="text-accent" />
                </div>
                <span className="text-xs font-medium text-main text-center leading-tight">{cat.name}</span>
                <span className="text-[10px] text-muted">{cat.count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Rent for the weekend */}
      <Section title="Rent for the weekend" subtitle="Perfect picks for your days off" onSeeAll={() => navigate({ name: 'search' })}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 stagger">
          {listings.filter((l) => l.available).slice(0, 6).map((listing) => (
            <div
              key={listing.id}
              onClick={() => navigate({ name: 'listing', id: listing.id })}
              className="group flex gap-4 bg-card rounded-card-xl overflow-hidden border border-app shadow-card card-hover cursor-pointer p-3 animate-fade-up"
            >
              <div className="w-28 h-28 sm:w-36 sm:h-36 shrink-0 overflow-hidden rounded-card-lg">
                <img src={listing.images[0]} alt={listing.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                <div>
                  <h3 className="font-semibold text-main leading-snug">{listing.title}</h3>
                  <div className="flex items-center gap-1 text-xs text-sec mt-1">
                    <MapPin size={12} /> {listing.distance} {listing.distanceUnit} away
                  </div>
                  <div className="mt-2">
                    <Rating value={listing.rating} count={listing.reviewCount} size="sm" />
                  </div>
                  {listing.verifiedOwner && <div className="mt-2"><VerifiedBadge size="xs" /></div>}
                </div>
                <div className="flex items-baseline gap-0.5">
                  <span className="font-bold text-lg text-main">${listing.pricePerDay}</span>
                  <span className="text-xs text-sec">/day</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Live bidding */}
      {SHOW_OUT_OF_SCOPE_PAGES && (
        <Section title="Live bidding" subtitle="Bid on high-demand rental periods" onSeeAll={() => navigate({ name: 'bidding' })}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 stagger">
            {auctions.map((auction) => (
            <div
              key={auction.id}
              onClick={() => navigate({ name: 'auction', id: auction.id })}
              className="group p-3 rounded-card-xl bg-card border border-app shadow-card card-hover cursor-pointer animate-fade-up"
            >
              <div className="relative aspect-[5/3] rounded-card-lg overflow-hidden mb-3">
                <img src={auction.image} alt={auction.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute top-2 left-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent text-accent-text flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse-soft" /> LIVE
                  </span>
                </div>
              </div>
              <h3 className="font-semibold text-sm text-main line-clamp-1">{auction.title}</h3>
              <div className="flex items-center justify-between mt-2">
                <div>
                  <p className="text-[10px] text-muted">Current bid</p>
                  <p className="text-lg font-bold text-accent">${auction.currentBid}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted flex items-center gap-0.5 justify-end"><Clock size={10} /> {auction.endsIn}</p>
                  <p className="text-[10px] text-sec mt-0.5">{auction.bids.length} bids</p>
                </div>
              </div>
            </div>
            ))}
          </div>
        </Section>
      )}

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <h2 className="text-xl sm:text-2xl font-bold text-main font-display mb-6 text-center">How it works</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Search, title: 'Find it', desc: 'Search for anything you need nearby' },
            { icon: Calendar, title: 'Book it', desc: 'Pick dates and request to rent' },
            { icon: MapPin, title: 'Pick it up', desc: 'Meet the owner and check in' },
            { icon: PackageCheck, title: 'Return it', desc: 'Check out and get deposit back' },
          ].map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={i} className="text-center p-5 rounded-card-xl bg-card border border-app">
                <div className="w-14 h-14 rounded-full bg-accent-soft flex items-center justify-center mx-auto mb-3">
                  <Icon size={24} className="text-accent" />
                </div>
                <div className="text-xs font-semibold text-muted mb-1">Step {i + 1}</div>
                <h3 className="font-semibold text-main mb-1">{step.title}</h3>
                <p className="text-xs text-sec leading-relaxed">{step.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Trust banner */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row items-center gap-4 p-6 rounded-card-xl bg-card border border-app">
          <ShieldCheck size={40} className="text-accent shrink-0" />
          <div className="flex-1 text-center sm:text-left">
            <h3 className="font-bold text-main text-lg">You don't have to trust a stranger.</h3>
            <p className="text-sec text-sm mt-1">We verify, document, protect, and provide a fair process for every rental.</p>
          </div>
          <button
            onClick={() => navigate({ name: 'protection' })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-card-lg border border-accent text-accent text-sm font-semibold hover:bg-accent-soft transition-colors shrink-0"
          >
            Learn how <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {/* List your stuff CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="relative overflow-hidden rounded-card-xl bg-accent p-8 sm:p-12 text-center">
          <div className="absolute inset-0 opacity-10 bg-gradient-to-br from-white to-transparent" />
          <div className="relative">
            <h2 className="text-2xl sm:text-3xl font-bold text-accent-text font-display mb-2">Turn things you already own into income.</h2>
            <p className="text-accent-text/80 text-base mb-6 max-w-md mx-auto">List your gear in under 60 seconds. We handle identity verification, payments, and protection.</p>
            <button
              onClick={() => navigate({ name: 'create-listing' })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-card-lg bg-card text-accent font-semibold hover:scale-105 transition-transform"
            >
              List your stuff <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-app mt-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src={logo} alt="YBuy" className="w-8 h-8 rounded-card object-cover shadow-card" />
              <span className="font-bold text-main font-display">YBuy</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-sec">
              <button onClick={() => navigate({ name: 'protection' })} className="hover:text-main transition-colors">Protection</button>
              <button onClick={() => navigate({ name: 'trust-profile' })} className="hover:text-main transition-colors">Trust</button>
              <span className="text-muted">© {new Date().getFullYear()} YBuy</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, subtitle, children, onSeeAll }: { title: string; subtitle?: string; children: React.ReactNode; onSeeAll?: () => void }) {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-main font-display">{title}</h2>
          {subtitle && <p className="text-sec text-sm mt-0.5">{subtitle}</p>}
        </div>
        {onSeeAll && (
          <button onClick={onSeeAll} className="flex items-center gap-1 text-sm font-medium text-accent hover:gap-2 transition-all shrink-0">
            See all <ArrowRight size={15} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
