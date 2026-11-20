import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Sparkles, Clock,
} from 'lucide-react';
import { SearchBar } from '@/main-site/components/search';
import { ListingCard } from '@/main-site/components/listing-card';
import { SignupRewardOffer } from '@/main-site/components/signup-reward-offer';
import { Badge, Button, SectionHeader, EmptyState, Alert } from '@/main-site/components/ui';
import { ListingGridSkeleton } from '@/main-site/components/skeleton';
import { CategoryIcon } from '@/main-site/components/category-icon';
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
import { BrandLogo } from '@/main-site/components/brand-logo';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { savedSearchState, type SearchRadius } from '@/lib/search-state';
import { useUtcDay } from '@/lib/use-utc-day';
import { fetchNearbyRequests, type MainItemRequest } from '../request-flow';

/** Size of the single pool the home rails are sliced from - one request, not one per section. */
const POOL_SIZE = 24;
const RAIL_SIZE = 8;

export function HomePage() {
  const utcDay = useUtcDay();
  const { enabled: mockBiddingEnabled } = useFeatureFlag('mock_bidding');
  const itemRequests = useFeatureFlag('item_requests');
  const { navigate } = useRouter();
  const { user, openSignIn } = useAuth();
  const userId = user?.id;
  const { location } = useMarketplaceLocation();
  const [pool, setPool] = useState<Listing[]>([]);
  const [fresh, setFresh] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [retryToken, setRetryToken] = useState(0);
  const [requestRetryToken, setRequestRetryToken] = useState(0);
  const [searchRadius, setSearchRadius] = useState<SearchRadius>(() => savedSearchState().radius);
  const [nearbyRequests, setNearbyRequests] = useState<MainItemRequest[]>([]);
  const [requestsError, setRequestsError] = useState<string | null>(null);

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
  }, [retryToken, utcDay]);

  useEffect(() => {
    let active = true;
    const latitude = location.latitude;
    const longitude = location.longitude;
    if (!userId || !itemRequests.enabled || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setNearbyRequests([]);
      setRequestsError(null);
      return () => { active = false; };
    }

    setNearbyRequests([]);
    setRequestsError(null);
    void fetchNearbyRequests({
      latitude, longitude, radius: searchRadius, search: '', categoryId: '', location: '',
      startDate: '', endDate: '', maxBudget: '', sort: 'newest', page: 0,
    }).then(({ rows }) => {
      if (active) setNearbyRequests(rows.slice(0, 4));
    }).catch((reason: unknown) => {
      if (active) setRequestsError(reason instanceof Error ? reason.message : 'Could not load nearby requests.');
    });
    return () => { active = false; };
  }, [userId, itemRequests.enabled, location.latitude, location.longitude, searchRadius, requestRetryToken]);

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
  const discoveryListings = nearby.length > 0 ? nearby : featured;
  const discoveryTitle = nearby.length > 0
    ? location.source === 'BROWSER' ? 'Rentals near you' : `Rentals near ${locationLabel(location)}`
    : 'Popular rentals';

  const cardProps = (listing: Listing) => ({
    listing,
    onClick: () => navigate({ name: 'listing', id: listing.id }),
    favorited: favoriteIds.has(listing.id),
    onToggleFavorite: () => void handleToggleFavorite(listing.id),
  });

  return (
    <div className="home-page animate-fade-in">
      <Hero
        onSearch={navigate}
        radius={searchRadius}
        onRadiusChange={setSearchRadius}
      />

      {error && (
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-6">
          <Alert tone="error" title="We couldn't load listings">
            <p>{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setRetryToken((token) => token + 1)}>Try again</Button>
          </Alert>
        </div>
      )}

      {(loading || categories.length > 0 || !error) && <Shell className="home-category-section">
        <div className="home-category-layout" aria-labelledby="browse-categories-heading">
          <div className="home-category-heading">
            <p className="marketplace-eyebrow">A little of everything</p>
            <h2 id="browse-categories-heading">What could make<br />your day easier?</h2>
            <button type="button" className="home-category-all" onClick={() => navigate({ name: 'search' })}>See all categories <ArrowRight size={14} /></button>
          </div>
          <div className="workspace-category-grid" aria-busy={loading && categories.length === 0}>
            {loading && categories.length === 0
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" aria-hidden="true" />)
              : categories.slice(0, 4).map((cat) => (
                <CategoryTile key={cat.id} category={cat} onClick={() => navigate({ name: 'search', category: cat.id })} />
              ))}
          </div>
          {loading && categories.length === 0 && <p role="status" className="sr-only">Loading categories</p>}
          {!loading && categories.length === 0 && (
            <p role="status" className="text-sm text-sec">{error ? 'Categories could not be loaded. Please try again above.' : 'No categories are available yet. You can still explore all rentals.'}</p>
          )}
        </div>
      </Shell>}

      {/* One primary rental rail avoids repeating the same items in separate featured and nearby rows. */}
      {!(error && discoveryListings.length === 0 && !loading) && <Shell className="home-discovery-section pt-12 sm:pt-16">
        <p className="marketplace-eyebrow">A good place to start</p>
        <SectionHeader
          title={discoveryTitle}
          subtitle={nearby.length > 0 ? 'Available items from nearby owners.' : 'Well-reviewed items from owners with a track record.'}
          actionLabel="Browse all rentals"
          onAction={() => navigate({ name: 'search' })}
          className="mb-5"
        />
        {loading ? (
          <ListingGridSkeleton count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" />
        ) : error ? null : discoveryListings.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={20} />}
            title="Nothing listed yet"
            description="YBuy grows one item at a time. List something you already own and it shows up right here."
            actionLabel="List your first item"
            onAction={() => navigate({ name: 'create-listing' })}
          />
        ) : (
          <Rail count={discoveryListings.length}>
            {discoveryListings.map((listing) => (
              <RailItem key={listing.id}><ListingCard {...cardProps(listing)} /></RailItem>
            ))}
          </Rail>
        )}
      </Shell>}

      {itemRequests.enabled && (
        <Shell className="home-community-section pt-8 sm:pt-10">
          <section className="home-community-panel">
            <div className="home-community-intro">
              <div className="home-community-copy">
                <p className="marketplace-eyebrow">The neighborhood works better together</p>
                <h2>Need something<br />a little different?</h2>
                <p>Put the word out to nearby owners. You might be surprised what’s already close by.</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => navigate({ name: 'need-something' })} trailingIcon={<ArrowRight size={16} />}>Ask your neighbors</Button>
                  <Button variant="secondary" onClick={() => navigate({ name: 'requests', tab: 'browse' })}>Browse renter requests</Button>
                </div>
              </div>
              <img src="https://images.pexels.com/photos/4505166/pexels-photo-4505166.jpeg?auto=compress&cs=tinysrgb&w=1100&h=850&fit=crop" alt="Garden tools gathered for a shared project" loading="lazy" />
            </div>
            {user && requestsError && (
              <Alert tone="error" title="Could not load nearby requests" className="mt-5">
                {requestsError}
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => setRequestRetryToken((token) => token + 1)}>Try again</Button>
              </Alert>
            )}
            {user && nearbyRequests.length > 0 && (
              <div className="mt-5 border-t border-app pt-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-main">Recently requested nearby</h3>
                  <span className="text-xs text-sec">Within {searchRadius === null ? 'any distance' : `${searchRadius} miles`} of {locationLabel(location)}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {nearbyRequests.map((request) => (
                    <button
                      key={request.id}
                      type="button"
                      aria-label={`Browse item request: ${request.title}`}
                      onClick={() => navigate({ name: 'requests', tab: 'browse' })}
                      className="min-w-0 rounded-card-lg border border-app bg-card p-4 text-left transition-colors duration-fast hover:border-strong hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Badge>{request.categories?.name ?? 'Item request'}</Badge>
                      <h3 className="mt-3 line-clamp-2 font-semibold text-main">{request.title}</h3>
                      <p className="mt-2 line-clamp-2 text-sm text-sec">{request.description}</p>
                      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sec">
                        <span>{formatRequestDates(request.preferred_start_date, request.preferred_end_date)}</span>
                        {request.distance_miles != null && <span>{request.distance_miles.toFixed(1)} mi away</span>}
                        {request.max_daily_budget != null && <span>${Number(request.max_daily_budget).toFixed(0)}/day max</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </Shell>
      )}

      {/* Recently added */}
      {(loading || justAdded.length > 0) && (
        <Shell className="home-recent-section pt-12 sm:pt-16">
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
            <Rail count={justAdded.length}>
              {justAdded.map((listing) => (
                <RailItem key={listing.id}><ListingCard {...cardProps(listing)} /></RailItem>
              ))}
            </Rail>
          )}
        </Shell>
      )}

      {mockBiddingEnabled && (
        <Shell className="home-bidding-section pt-12 sm:pt-16">
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

      {!user && <HowItWorks />}
      {!user && <OwnerCta onStart={() => navigate({ name: 'create-listing' })} />}
      <div className="home-reward-section"><SignupRewardOffer /></div>
      <Footer onNavigate={navigate} />
    </div>
  );
}

function Shell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`max-w-[1400px] mx-auto px-4 sm:px-6 ${className}`}>{children}</section>;
}

/** Horizontal, snap-scrolling on mobile; sparse rails center capped cards on desktop. */
function Rail({ children, count }: { children: React.ReactNode; count: number }) {
  const columns = count <= 2
    ? 'lg:grid-cols-[repeat(auto-fit,minmax(280px,360px))] lg:justify-center'
    : 'lg:grid-cols-4';
  return (
    <div className={`flex lg:grid ${columns} gap-3 sm:gap-4 overflow-x-auto lg:overflow-visible no-scrollbar snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 animate-cross-fade`}>
      {children}
    </div>
  );
}

function RailItem({ children }: { children: React.ReactNode }) {
  return <div className="w-[70vw] sm:w-[44vw] lg:w-auto shrink-0 lg:shrink snap-start">{children}</div>;
}

function Hero({
  onSearch, radius, onRadiusChange,
}: {
  onSearch: ReturnType<typeof useRouter>['navigate'];
  radius: SearchRadius;
  onRadiusChange: (radius: SearchRadius) => void;
}) {
  const [searchDraft] = useState(savedSearchState);
  return (
    // No `isolate` here: it would cap the search bar's popover z-index, letting the
    // category rail (a later DOM sibling) paint over the date/location dropdowns.
    <section className="marketplace-hero">
      <div className="marketplace-hero-inner">
        <div className="marketplace-hero-copy">
          <p className="marketplace-eyebrow">A neighborhood marketplace</p>
          <h1>Good things,<br /><em>close to home.</em></h1>
          <p>Find the useful things you need from people just around the corner.</p>
          <button type="button" className="marketplace-hero-link" onClick={() => onSearch({ name: 'search' })}>Explore what’s nearby <ArrowRight size={17} /></button>
          <p className="marketplace-hero-note">Made for sharing, right where you live.</p>
        </div>

        <figure className="marketplace-hero-media" role="group" aria-label="Marketplace inspiration">
          <div className="marketplace-hero-image">
            <img src="https://images.pexels.com/photos/31726722/pexels-photo-31726722.jpeg?auto=compress&cs=tinysrgb&w=1100&h=850&fit=crop" alt="A portable projector" />
          </div>
          <figcaption>Make a night of it.</figcaption>
        </figure>
        <div className="marketplace-hero-aside" aria-hidden="true">
          <img src="https://images.pexels.com/photos/19969452/pexels-photo-19969452.jpeg?auto=compress&cs=tinysrgb&w=500&h=700&fit=crop" alt="" />
          <span><Sparkles size={16} /> Good finds, shared locally</span>
        </div>

        <div className="marketplace-hero-search">
          <SearchBar
            variant="hero"
            defaultValue={searchDraft.q}
            initialStartDate={searchDraft.start}
            initialEndDate={searchDraft.end}
            initialRadius={searchDraft.radius}
            radius={radius}
            onRadiusChange={onRadiusChange}
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
      </div>
    </section>
  );
}

function formatRequestDates(start: string, end: string) {
  const format = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${format(start)} – ${format(end)}`;
}

function CategoryTile({ category, onClick }: { category: Category; onClick: () => void }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasImage = category.image && failedImage !== category.image;

  return (
    <button type="button" onClick={onClick} className="home-category-tile">
      <span className="home-category-image">
        {hasImage ? (
          <>
            <img
              src={category.image}
              alt=""
              loading="lazy"
              decoding="async"
              width={400}
              height={300}
              onError={() => setFailedImage(category.image)}
              className="absolute inset-0 w-full h-full object-cover zoom-media"
            />
            <span className="absolute inset-0 grid place-items-center text-white">
              <CategoryIcon category={category} size={20} />
            </span>
          </>
        ) : (
          <span aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-accent">
            <CategoryIcon category={category} size={32} />
            {failedImage === category.image && <span className="text-xs text-sec">Photo unavailable</span>}
          </span>
        )}
      </span>
      <span className="home-category-name">
        {category.name}
      </span>
        <ArrowRight size={15} aria-hidden="true" />
    </button>
  );
}

const STEPS = [
  { title: 'Discover', desc: 'Search by item, place and the dates you need it.' },
  { title: 'Request', desc: 'Pick your dates and send a request to the owner.' },
  { title: 'Rent', desc: 'Pay securely once the owner approves, then pick it up.' },
  { title: 'Return', desc: 'Hand it back, mark it returned, leave a review.' },
];

function HowItWorks() {
  return (
    <Shell className="home-explainer-section pt-14 sm:pt-20">
      <div className="rounded-card-xl border border-app bg-card p-6 sm:p-10">
        <SectionHeader title="How YBuy works" subtitle="Four steps, start to finish." className="mb-8" />
        <ol className="home-steps grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-4">
          {STEPS.map((step) => {
            return (
              <li key={step.title}>
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
    <Shell className="home-owner-section pt-6 sm:pt-8">
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
            <BrandLogo />
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
