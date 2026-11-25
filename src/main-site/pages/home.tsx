import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Sparkles,
} from 'lucide-react';
import { SearchBar } from '@/main-site/components/search';
import { ListingCard } from '@/main-site/components/listing-card';
import { Badge, Button, SectionHeader, EmptyState, Alert } from '@/main-site/components/ui';
import { ListingGridSkeleton } from '@/main-site/components/skeleton';
import { BiddingTicker } from '@/main-site/components/bidding-ticker';
import { CategoryIcon } from '@/main-site/components/category-icon';
import { RouteLink, useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Listing, Category } from '@/data';
import {
  fetchCategories, searchListings,
  toUiCategory, toUiListing, enrichListingsWithRatings,
} from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { haversineMiles, listingIsInCity, locationLabel } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { savedSearchState, type SearchRadius } from '@/lib/search-state';
import { useUtcDay } from '@/lib/use-utc-day';
import { fetchNearbyRequests, type MainItemRequest } from '../request-flow';

/** Size of the single pool the home rails are sliced from - one request, not one per section. */
const POOL_SIZE = 24;
const RAIL_SIZE = 8;

export function HomePage() {
  const utcDay = useUtcDay();
  const itemRequests = useFeatureFlag('item_requests');
  const { navigate } = useRouter();
  const { user, openSignIn } = useAuth();
  const userId = user?.id;
  const { location } = useMarketplaceLocation();
  const [pool, setPool] = useState<Listing[]>([]);
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
        requestsEnabled={itemRequests.enabled}
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
            <h2 id="browse-categories-heading">Browse by category</h2>
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
            <p role="status" className="text-sm text-sec">{error ? 'Categories could not be loaded. Please try again above.' : 'No categories yet. Browse all rentals instead.'}</p>
          )}
        </div>
      </Shell>}

      {/* One primary rental rail avoids repeating the same items in separate featured and nearby rows. */}
      {!(error && discoveryListings.length === 0 && !loading) && <Shell className="home-discovery-section pt-12 sm:pt-16">
        <SectionHeader
          title={discoveryTitle}
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
            description="Be the first to share something nearby."
            actionLabel="List an item"
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

      <Shell className="home-bidding-section">
        <BiddingTicker />
      </Shell>

      {itemRequests.enabled && (
        <Shell className="home-community-section pt-8 sm:pt-10">
          <section className="home-community-panel">
            <div className="home-community-intro">
              <div className="home-community-copy">
                <h2>Someone nearby might have it.</h2>
                <p>Looking for something specific? Ask your community, or help a neighbor find what they need.</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => navigate({ name: 'need-something' })} trailingIcon={<ArrowRight size={16} />}>Request an item</Button>
                  <Button variant="secondary" onClick={() => navigate({ name: 'requests', tab: 'browse' })}>Browse requests</Button>
                </div>
              </div>
            </div>
            {user && requestsError && (
              <Alert tone="error" title="Could not load nearby requests" className="mt-5">
                {requestsError}
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => setRequestRetryToken((token) => token + 1)}>Try again</Button>
              </Alert>
            )}
            {user && nearbyRequests.length > 0 && (
              <div className="home-community-requests">
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

      <Shell className="home-sharing-section">
        <div className="home-sharing">
          <h2>Good things are meant to be used.</h2>
          <div>
            <p>That item sitting at home could be just what a neighbor needs. List it on YBuy and put it to good use.</p>
            <RouteLink route={{ name: 'create-listing' }}>List an item <ArrowRight size={16} aria-hidden="true" /></RouteLink>
          </div>
        </div>
      </Shell>

      <Footer />
    </div>
  );
}

function Shell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`max-w-[1400px] mx-auto px-4 sm:px-6 ${className}`}>{children}</section>;
}

/** Horizontal, snap-scrolling on mobile; sparse rails keep capped cards on desktop. */
function Rail({ children, count }: { children: React.ReactNode; count: number }) {
  const columns = count === 1 ? 'lg:grid-cols-[minmax(0,640px)]'
    : count === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-4';
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
  onSearch, radius, onRadiusChange, requestsEnabled,
}: {
  onSearch: ReturnType<typeof useRouter>['navigate'];
  radius: SearchRadius;
  onRadiusChange: (radius: SearchRadius) => void;
  requestsEnabled: boolean;
}) {
  const [searchDraft] = useState(savedSearchState);
  return (
    // No `isolate` here: it would cap the search bar's popover z-index, letting the
    // category rail (a later DOM sibling) paint over the date/location dropdowns.
    <section className="marketplace-hero">
      <div className="marketplace-hero-inner">
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
        <div className="marketplace-hero-copy">
          <h1>More moments. Less stuff.</h1>
          <p>For the projects, plans and little adventures ahead, rent what you need from people nearby.</p>
          <div className="marketplace-hero-actions">
            <RouteLink route={{ name: 'create-listing' }}>List an item <ArrowRight size={16} aria-hidden="true" /></RouteLink>
            {requestsEnabled && <RouteLink route={{ name: 'need-something' }}>Request an item <ArrowRight size={16} aria-hidden="true" /></RouteLink>}
          </div>
        </div>

        <div className="marketplace-hero-photo">
          <img
            src="https://images.pexels.com/photos/4505166/pexels-photo-4505166.jpeg?auto=compress&cs=tinysrgb&w=1100&h=850&fit=crop"
            alt=""
            width={1100}
            height={850}
            fetchPriority="high"
          />
          <p>Make room<br />for what matters.</p>
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
    </button>
  );
}

function Footer() {
  return (
    <footer>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <span className="reference-wordmark"><span aria-hidden="true">y</span>ybuy</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-sec">
            <RouteLink route={{ name: 'search' }} className="hover:text-main transition-colors duration-fast">Browse</RouteLink>
            <RouteLink route={{ name: 'create-listing' }} className="hover:text-main transition-colors duration-fast">List an item</RouteLink>
            <RouteLink route={{ name: 'guidelines' }} className="hover:text-main transition-colors duration-fast">Guidelines</RouteLink>
          </nav>
          <p className="text-sm text-muted">© {new Date().getFullYear()} YBuy</p>
        </div>
      </div>
    </footer>
  );
}
