import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Calendar, CheckCircle2, Compass, CreditCard,
  PackageCheck, ShieldCheck, Sparkles, Clock, MoreHorizontal,
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
  fetchCategories, fetchCategoryCounts, searchListings,
  toUiCategory, toUiListing, enrichListingsWithRatings,
} from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { haversineMiles, listingIsInCity, locationLabel } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { SHOW_HERO_CATEGORY_PILLS } from '@/lib/feature-flags';
import logo from '@/assets/logo.png';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { savedSearchState } from '@/lib/search-state';

/** Size of the single pool the home rails are sliced from - one request, not one per section. */
const POOL_SIZE = 24;
const RAIL_SIZE = 8;

export function HomePage() {
  const { enabled: mockBiddingEnabled } = useFeatureFlag('mock_bidding');
  const { navigate } = useRouter();
  const { user, openSignIn } = useAuth();
  const { location } = useMarketplaceLocation();
  const [pool, setPool] = useState<Listing[]>([]);
  const [fresh, setFresh] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!user) { setFavoriteIds(new Set()); return; }
    fetchFavoriteListingIds(user.id).then(setFavoriteIds).catch(() => {});
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchCategories(),
      searchListings({ sortBy: 'recommended', pageSize: POOL_SIZE }),
    ])
      .then(([catRows, recommended]) => {
        if (cancelled) return;
        setCategories(catRows.map((c) => toUiCategory(c, new Map())));
        setPool(recommended.rows.map(toUiListing));
        setLoading(false);
        void enrichListingsWithRatings(recommended.rows.map(toUiListing))
          .then((rows) => { if (!cancelled) setPool(rows); });

        void searchListings({ sortBy: 'newest', pageSize: RAIL_SIZE })
          .then((newest) => {
            if (cancelled) return;
            const rows = newest.rows.map(toUiListing);
            setFresh(rows);
            void enrichListingsWithRatings(rows)
              .then((ratedRows) => { if (!cancelled) setFresh(ratedRows); });
          })
          .catch(() => {});

        void fetchCategoryCounts()
          .then((counts) => {
            if (cancelled) return;
            setCategories(catRows.map((c) => toUiCategory(c, counts)));
          })
          .catch(() => {});
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load listings.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retryToken]);

  async function handleToggleFavorite(listingId: string) {
    if (!user) { openSignIn(); return; }
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
            <p>{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setRetryToken((token) => token + 1)}>Try again</Button>
          </Alert>
        </div>
      )}

      {/* Categories */}
      <Shell className="pt-10 sm:pt-14">
        <SectionHeader
          title="Browse by category"
          actionLabel="See all"
          onAction={() => navigate({ name: 'search' })}
          className="mb-5"
        />
        <div className="flex gap-4 sm:gap-6 overflow-x-auto no-scrollbar pb-1">
          {loading && categories.length === 0
            ? Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="shrink-0 w-20 sm:w-24">
                  <div className="skeleton rounded-card-lg aspect-square" />
                  <div className="skeleton h-3 w-14 mt-2 rounded" />
                </div>
              ))
            : (
              <>
                {categories.map((cat) => (
                  <CategoryTile
                    key={cat.id}
                    category={cat}
                    onClick={() => navigate({ name: 'search', category: cat.id })}
                  />
                ))}
                <CategoryMoreTile onClick={() => navigate({ name: 'search' })} />
              </>
            )}
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
        ) : error ? null : featured.length === 0 ? (
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

      {mockBiddingEnabled && (
        <Shell className="pt-12 sm:pt-16">
          <SectionHeader
            title="Mock bidding"
            subtitle="Demo only. No real bids, bookings or payments."
            actionLabel="See all"
            onAction={() => navigate({ name: 'bidding' })}
            className="mb-5"
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {auctions.map((auction) => (
              <button
                key={auction.id}
                onClick={() => navigate({ name: 'auction', id: auction.id })}
                className="group text-left bg-card border border-app rounded-card-lg overflow-hidden shadow-xs card-hover cursor-pointer"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-subtle">
                  <img src={auction.image} alt={auction.title} loading="lazy" className="w-full h-full object-cover zoom-media" />
                  <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-text text-[11px] font-semibold">
                    Demo
                  </span>
                </div>
                <div className="p-3.5">
                  <h3 className="font-semibold text-[15px] text-main line-clamp-1 font-display">{auction.title}</h3>
                  <div className="flex items-end justify-between mt-2">
                    <div>
                      <p className="text-[11px] text-muted">Current demo bid</p>
                      <p className="text-lg font-bold text-accent tnum">${auction.currentBid}</p>
                    </div>
                    <p className="text-[11px] text-sec flex items-center gap-1"><Clock size={11} /> {auction.endsIn}</p>
                  </div>
                </div>
              </button>
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
  const [searchDraft] = useState(savedSearchState);
  return (
    // No `isolate` here: it would cap the search bar's popover z-index, letting the
    // category rail (a later DOM sibling) paint over the date/location dropdowns.
    <section className="relative">
      <div className="absolute inset-0 overflow-hidden pointer-events-none"><HeroCarousel /></div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/25" />

      <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 pt-14 pb-12 sm:pt-20 sm:pb-16">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-[11px] sm:text-xs font-semibold tracking-wide text-white/90 uppercase">
            <Sparkles size={13} className="text-white" />
            Trusted local rentals
          </span>
          <h1 className="text-[32px] leading-[1.1] sm:text-[48px] font-bold text-white font-display tracking-tight mt-4">
            What do you need to rent?
          </h1>
          <p className="text-white/85 text-sm sm:text-lg mt-3 max-w-xl leading-relaxed">
            Find tools, cameras, outdoor gear and more from people nearby.
          </p>
        </div>

        {/* No z-index here: it would cap the search bar's popovers below the shared dim Overlay (z-200). */}
        <div className="relative mt-7 sm:mt-9 max-w-4xl">
          <div className="rounded-card-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)]">
            <SearchBar
              variant="hero"
              defaultValue={searchDraft.q}
              initialStartDate={searchDraft.start}
              initialEndDate={searchDraft.end}
              initialRadius={searchDraft.radius}
              onSearch={(p) => onSearch({
                ...savedSearchState(),
                name: 'search',
                q: p.keyword.trim() || undefined,
                lat: p.location.latitude,
                lng: p.location.longitude,
                locationLabel: p.location.source !== 'NONE' ? locationLabel(p.location) : undefined,
                radius: p.radius,
                start: p.startDate,
                end: p.endDate,
              })}
            />
          </div>

          <ul className="flex flex-wrap gap-2 mt-4">
            <TrustPoint icon={<ShieldCheck size={14} />}>Secure sign-in</TrustPoint>
            <TrustPoint icon={<CreditCard size={14} />}>Secure checkout</TrustPoint>
            <TrustPoint icon={<CheckCircle2 size={14} />}>Owner approval before payment</TrustPoint>
          </ul>

          {categories.length > 0 && SHOW_HERO_CATEGORY_PILLS && (
            <div className="mt-6">
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => onSearch({ name: 'search', category: cat.id })}
                    className="group shrink-0 inline-flex items-center gap-2 min-h-11 px-3.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/25 text-xs sm:text-sm font-medium text-white shadow-sm transition-colors duration-fast"
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
    <li className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs sm:text-sm font-medium text-white/90">
      <span className="text-white shrink-0">{icon}</span>
      {children}
    </li>
  );
}

function CategoryTile({ category, onClick }: { category: Category; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group shrink-0 w-20 sm:w-24 flex flex-col items-center gap-2 text-center">
      <span className="relative block w-full aspect-square rounded-card-lg overflow-hidden border border-app bg-subtle">
        {category.image ? (
          <img src={category.image} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover zoom-media" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-accent"><CategoryIcon category={category} size={26} /></span>
        )}
      </span>
      <span className="text-xs sm:text-sm font-medium text-main leading-tight line-clamp-2">{category.name}</span>
    </button>
  );
}

function CategoryMoreTile({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="shrink-0 w-20 sm:w-24 flex flex-col items-center gap-2 text-center">
      <span className="grid place-items-center w-full aspect-square rounded-card-lg border border-app bg-subtle text-sec">
        <MoreHorizontal size={22} />
      </span>
      <span className="text-xs sm:text-sm font-medium text-main">More</span>
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
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex gap-4 lg:block">
                <span className="grid place-items-center w-11 h-11 rounded-full bg-accent-soft text-accent shrink-0 lg:mb-4">
                  <Icon size={20} />
                </span>
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
    <Shell className="pt-6 sm:pt-8">
      <div className="rounded-card-xl bg-subtle p-6 sm:p-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 sm:gap-8">
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
          variant="primary"
          onClick={onStart}
          className="w-full sm:w-auto shrink-0"
          trailingIcon={<ArrowRight size={16} />}
        >
          List an item
        </Button>
      </div>
    </Shell>
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
