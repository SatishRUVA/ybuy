import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Calendar, CheckCircle2, Compass, CreditCard,
  PackageCheck, ShieldCheck, Sparkles, Clock,
} from 'lucide-react';
import { SearchBar } from '@/components/search';
import { ListingCard } from '@/components/listing-card';
import { HeroCarousel } from '@/components/hero-carousel';
import { Button, SectionHeader, EmptyState, Alert } from '@/components/ui';
import { ListingGridSkeleton } from '@/components/skeleton';
import { CategoryIcon } from '@/components/category-icon';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Listing, Category } from '@/data';
import { auctions } from '@/data';
import {
  fetchCategories, fetchCategoryCounts, fetchCategoryCovers, searchListings,
  toUiCategory, toUiListing, enrichListingsWithRatings,
} from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { haversineMiles, listingIsInCity, locationLabel } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import logo from '@/assets/logo.png';

/** Size of the single pool the home rails are sliced from - one request, not one per section. */
const POOL_SIZE = 24;
const RAIL_SIZE = 8;

export function HomePage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const { location } = useMarketplaceLocation();
  const [pool, setPool] = useState<Listing[]>([]);
  const [fresh, setFresh] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [covers, setCovers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) { setFavoriteIds(new Set()); return; }
    fetchFavoriteListingIds(user.id).then(setFavoriteIds).catch(() => {});
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCategories(),
      fetchCategoryCounts(),
      fetchCategoryCovers(),
      searchListings({ sortBy: 'recommended', pageSize: POOL_SIZE }),
      searchListings({ sortBy: 'newest', pageSize: RAIL_SIZE }),
    ])
      .then(([catRows, counts, coverMap, recommended, newest]) => {
        if (cancelled) return;
        setCategories(catRows.map((c) => toUiCategory(c, counts)));
        setCovers(coverMap);
        setPool(recommended.rows.map(toUiListing));
        setFresh(newest.rows.map(toUiListing));
        void enrichListingsWithRatings(recommended.rows.map(toUiListing))
          .then((rows) => { if (!cancelled) setPool(rows); });
        void enrichListingsWithRatings(newest.rows.map(toUiListing))
          .then((rows) => { if (!cancelled) setFresh(rows); });
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load listings.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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

  const available = useMemo(() => pool.filter((l) => l.available), [pool]);

  /** Real haversine distance, attached only when we have the user's position. */
  const nearby = useMemo(() => {
    if (location.source === 'NONE') return [];
    if (location.source !== 'BROWSER' || location.latitude === undefined || location.longitude === undefined) {
      return available.filter((listing) => listingIsInCity(listing.pickup, location.city)).slice(0, RAIL_SIZE);
    }
    return available.filter((listing) => listing.lat && listing.lng)
      .map((listing) => ({ ...listing, distance: Math.round(haversineMiles(location.latitude!, location.longitude!, listing.lat, listing.lng) * 10) / 10 }))
      .sort((first, second) => first.distance - second.distance).slice(0, RAIL_SIZE);
  }, [available, location]);

  const featured = useMemo(
    () => [...available].sort((first, second) => {
      if (location.source !== 'NONE') {
        const localFirst = listingIsInCity(first.pickup, location.city) ? 1 : 0;
        const localSecond = listingIsInCity(second.pickup, location.city) ? 1 : 0;
        if (localFirst !== localSecond) return localSecond - localFirst;
      }
      return second.reviewCount - first.reviewCount || second.rating - first.rating;
    }).slice(0, RAIL_SIZE),
    [available, location],
  );

  // Rails shouldn't repeat the same item twice on one page.
  const justAdded = useMemo(() => {
    const shown = new Set([...featured, ...nearby].map((l) => l.id));
    return fresh.filter((l) => !shown.has(l.id));
  }, [fresh, featured, nearby]);

  const cardProps = (listing: Listing) => ({
    listing,
    onClick: () => navigate({ name: 'listing', id: listing.id }),
    favorited: favoriteIds.has(listing.id),
    onToggleFavorite: () => void handleToggleFavorite(listing.id),
  });

  return (
    <div className="animate-fade-in">
      <Hero
        onSearch={navigate}
        categories={categories.slice(0, 6)}
      />

      {error && (
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-6">
          <Alert tone="error" title="We couldn't load listings">
            {error} - refresh the page to try again.
          </Alert>
        </div>
      )}

      {/* Categories */}
      <Shell className="pt-10 sm:pt-14">
        <SectionHeader
          title="Browse by category"
          subtitle="Browse rentals by type."
          actionLabel="See all"
          onAction={() => navigate({ name: 'search' })}
          className="mb-5"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {loading && categories.length === 0
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton rounded-card-lg aspect-[16/10]" />
              ))
            : categories.map((cat) => (
                <CategoryCard
                  key={cat.id}
                  category={cat}
                  cover={covers.get(cat.id)}
                  onClick={() => navigate({ name: 'search', category: cat.id })}
                />
              ))}
        </div>
      </Shell>

      {/* Featured */}
      <Shell className="pt-12 sm:pt-16">
        <SectionHeader
          title="Featured rentals"
          subtitle="Well-reviewed items from owners with a track record."
          actionLabel="See all"
          onAction={() => navigate({ name: 'search' })}
          className="mb-5"
        />
        {loading ? (
          <ListingGridSkeleton count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" />
        ) : featured.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={20} />}
            title="Nothing listed yet"
            description="YBuy grows one item at a time. List something you already own and it shows up right here."
            actionLabel="List your first item"
            onAction={() => navigate({ name: 'create-listing' })}
          />
        ) : (
          <Rail>
            {featured.map((listing) => (
              <RailItem key={listing.id}><ListingCard {...cardProps(listing)} /></RailItem>
            ))}
          </Rail>
        )}
      </Shell>

      {/* Near you - only claims proximity when we actually have coordinates */}
      {nearby.length > 0 && (
        <Shell className="pt-12 sm:pt-16">
          <SectionHeader
            title={location.source === 'BROWSER' ? 'Near you' : `Items near ${locationLabel(location)}`}
            subtitle={location.source === 'BROWSER' ? 'Closest listings first.' : location.source === 'IP' ? 'City estimated from your connection.' : 'Listings in your selected city.'}
            actionLabel="Search nearby"
            onAction={() => navigate({ name: 'search' })}
            className="mb-5"
          />
          <Rail>
            {nearby.map((listing) => (
              <RailItem key={listing.id}><ListingCard {...cardProps(listing)} /></RailItem>
            ))}
          </Rail>
        </Shell>
      )}

      {/* Recently added */}
      {(loading || justAdded.length > 0) && (
        <Shell className="pt-12 sm:pt-16">
          <SectionHeader
            title="Just added"
            subtitle="The newest items on YBuy."
            actionLabel="See all"
            onAction={() => navigate({ name: 'search' })}
            className="mb-5"
          />
          {loading ? (
            <ListingGridSkeleton count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" />
          ) : (
            <Rail>
              {justAdded.map((listing) => (
                <RailItem key={listing.id}><ListingCard {...cardProps(listing)} /></RailItem>
              ))}
            </Rail>
          )}
        </Shell>
      )}

      {/* Live bidding - gated, off by default (§4 out of scope) */}
      {SHOW_OUT_OF_SCOPE_PAGES && (
        <Shell className="pt-12 sm:pt-16">
          <SectionHeader
            title="Live bidding"
            subtitle="Bid on high-demand rental periods."
            actionLabel="See all"
            onAction={() => navigate({ name: 'bidding' })}
            className="mb-5"
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {auctions.map((auction) => (
              <article
                key={auction.id}
                onClick={() => navigate({ name: 'auction', id: auction.id })}
                className="group bg-card border border-app rounded-card-lg overflow-hidden shadow-xs card-hover cursor-pointer"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-subtle">
                  <img src={auction.image} alt={auction.title} loading="lazy" className="w-full h-full object-cover zoom-media" />
                  <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-text text-[11px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse-soft" /> Live
                  </span>
                </div>
                <div className="p-3.5">
                  <h3 className="font-semibold text-[15px] text-main line-clamp-1 font-display">{auction.title}</h3>
                  <div className="flex items-end justify-between mt-2">
                    <div>
                      <p className="text-[11px] text-muted">Current bid</p>
                      <p className="text-lg font-bold text-accent tnum">${auction.currentBid}</p>
                    </div>
                    <p className="text-[11px] text-sec flex items-center gap-1"><Clock size={11} /> {auction.endsIn}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Shell>
      )}

      <HowItWorks />
      <OwnerCta onStart={() => navigate({ name: 'create-listing' })} />
      <Footer onNavigate={navigate} />
    </div>
  );
}

function Shell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`max-w-[1400px] mx-auto px-4 sm:px-6 ${className}`}>{children}</section>;
}

/** Horizontal, snap-scrolling on mobile; a plain 4-up grid from `lg`. */
function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex lg:grid lg:grid-cols-4 gap-3 sm:gap-4 overflow-x-auto lg:overflow-visible no-scrollbar snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 animate-cross-fade">
      {children}
    </div>
  );
}

function RailItem({ children }: { children: React.ReactNode }) {
  return <div className="w-[70vw] sm:w-[44vw] lg:w-auto shrink-0 lg:shrink snap-start">{children}</div>;
}

function Hero({
  categories, onSearch,
}: {
  categories: Category[];
  onSearch: ReturnType<typeof useRouter>['navigate'];
}) {
  return (
    <section className="relative isolate overflow-hidden">
      <HeroCarousel />
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 pt-10 pb-10 sm:pt-14 sm:pb-12">
        <div className="max-w-2xl">
          <h1 className="text-[30px] leading-tight sm:text-[44px] font-bold text-white font-display">
            What do you need to rent?
          </h1>
          <p className="text-white/90 text-sm sm:text-base mt-2 max-w-xl leading-relaxed">
            Find tools, cameras, outdoor gear and more from people nearby.
          </p>
        </div>

        <div className="relative z-[140] mt-6 sm:mt-8 max-w-4xl">
          <SearchBar
            variant="hero"
            onSearch={(p) => onSearch({
              name: 'search',
              q: p.keyword.trim() || undefined,
              locationLabel: p.location.source === 'USER_SELECTED' ? locationLabel(p.location) : undefined,
              start: p.startDate,
              end: p.endDate,
            })}
          />

          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-xs sm:text-sm text-white/90">
            <TrustPoint icon={<ShieldCheck size={15} />}>Google sign-in</TrustPoint>
            <TrustPoint icon={<CreditCard size={15} />}>Secure checkout</TrustPoint>
            <TrustPoint icon={<CheckCircle2 size={15} />}>Owner approval before payment</TrustPoint>
          </ul>

          {categories.length > 0 && (
            <div className="mt-5">
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => onSearch({ name: 'search', category: cat.id })}
                    className="group shrink-0 inline-flex items-center gap-2 min-h-11 px-3 rounded-card bg-black/30 hover:bg-black/50 border border-white/30 text-xs sm:text-sm font-medium text-white transition-colors duration-fast"
                  >
                    <CategoryIcon category={cat} size={15} />
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TrustPoint({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="text-white/80 shrink-0">{icon}</span>
      {children}
    </li>
  );
}

function CategoryCard({ category, cover, onClick }: { category: Category; cover?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-card-lg border border-app bg-card shadow-xs card-hover text-left aspect-[16/10]"
    >
      {cover ? (
        <>
          <img src={cover} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover zoom-media" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
        </>
      ) : (
        <span className="absolute inset-0 bg-accent-soft" />
      )}
      <span className={`absolute inset-x-0 bottom-0 p-3.5 flex items-end justify-between gap-2 ${cover ? 'text-white' : 'text-main'}`}>
        <span className="min-w-0">
          <span className="block font-semibold font-display leading-tight truncate">{category.name}</span>
          <span className={`block text-xs tnum ${cover ? 'text-white/75' : 'text-sec'}`}>
            {category.count.toLocaleString()} {category.count === 1 ? 'item' : 'items'}
          </span>
        </span>
        <span className={`grid place-items-center w-8 h-8 rounded-full shrink-0 ${cover ? 'bg-white/20 backdrop-blur-sm text-white' : 'bg-card text-accent'}`}>
          <CategoryIcon category={category} size={16} />
        </span>
      </span>
    </button>
  );
}

const STEPS = [
  { icon: Compass, title: 'Discover', desc: 'Search by item, place and the dates you need it.' },
  { icon: Calendar, title: 'Request', desc: 'Pick your dates and send a request to the owner.' },
  { icon: CreditCard, title: 'Rent', desc: 'Pay securely once the owner approves, then pick it up.' },
  { icon: PackageCheck, title: 'Return', desc: 'Hand it back, mark it returned, leave a review.' },
];

function HowItWorks() {
  return (
    <Shell className="pt-14 sm:pt-20">
      <div className="rounded-card-xl border border-app bg-card p-6 sm:p-10">
        <SectionHeader title="How YBuy works" subtitle="Four steps, start to finish." className="mb-8" />
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="relative flex gap-4 lg:block">
                <span className="grid place-items-center w-11 h-11 rounded-full bg-accent-soft text-accent shrink-0 lg:mb-4">
                  <Icon size={20} />
                </span>
                {/* Connector only where the steps actually read left-to-right. */}
                {i < STEPS.length - 1 && (
                  <span className="hidden lg:block absolute top-[22px] left-12 right-4 h-px bg-[var(--border)]" aria-hidden="true" />
                )}
                <div>
                  <h3 className="font-semibold text-main font-display">{step.title}</h3>
                  <p className="text-sm text-sec mt-1 leading-relaxed">{step.desc}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Shell>
  );
}

function OwnerCta({ onStart }: { onStart: () => void }) {
  return (
    <section className="mt-12 sm:mt-16 border-y border-app bg-subtle">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 sm:py-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 sm:gap-8">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-xl sm:text-2xl font-bold text-main font-display leading-tight">
            Rent out what you already own
          </h2>
          <p className="mt-2 text-sm text-sec leading-relaxed">
            Add photos, set available dates and choose which requests to approve.
          </p>
        </div>
        <Button
          size="md"
          variant="secondary"
          onClick={onStart}
          className="w-full sm:w-auto shrink-0"
          trailingIcon={<ArrowRight size={16} />}
        >
          List an item
        </Button>
      </div>
    </section>
  );
}

function Footer({ onNavigate }: { onNavigate: ReturnType<typeof useRouter>['navigate'] }) {
  return (
    <footer>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="" className="w-8 h-8 rounded-card object-cover" />
            <span className="font-extrabold text-main font-display">YBuy</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-sec">
            <button onClick={() => onNavigate({ name: 'search' })} className="hover:text-main transition-colors duration-fast">Browse</button>
            <button onClick={() => onNavigate({ name: 'create-listing' })} className="hover:text-main transition-colors duration-fast">List an item</button>
            <button onClick={() => onNavigate({ name: 'guidelines' })} className="hover:text-main transition-colors duration-fast">Guidelines</button>
          </nav>
          <p className="text-sm text-muted">© {new Date().getFullYear()} YBuy</p>
        </div>
      </div>
    </footer>
  );
}
