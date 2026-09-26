import { useState, useMemo, useEffect, useRef } from 'react';
import { SearchBar, type SearchParams } from '@/components/search';
import { ListingCard, ListingCardWide } from '@/components/listing-card';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Listing, Category } from '@/data';
import { fetchCategories, fetchCategoryCounts, searchListings, toUiCategory, toUiListing, enrichListingsWithRatings, type SearchSortBy } from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { fetchUnavailableListingIds } from '@/lib/availability';
import { findCities, haversineMiles, listingIsInCity, locationLabel as formatLocation, todayIso, addDaysIso } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { loadLeaflet, type LeafletMap } from '@/lib/leaflet';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { ListingGridSkeleton, ListingCardWideSkeleton } from '@/components/skeleton';
import { Button, Alert, EmptyState, Overlay } from '@/components/ui';
import * as Icons from 'lucide-react';
import { Map as MapIcon, List, SlidersHorizontal, X, Star, Shield, Zap, CheckCircle2, Truck, MapPin, SearchX, Loader2 } from 'lucide-react';

export function SearchPage({
  initialCategory, initialQuery, initialLocationLabel, initialStartDate, initialEndDate,
}: {
  initialCategory?: string; initialQuery?: string;
  initialCoords?: { lat: number; lng: number }; initialLocationLabel?: string;
  initialStartDate?: string; initialEndDate?: string;
}) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const { location, selectCity, clearLocation } = useMarketplaceLocation();
  const lastRouteLocation = useRef<string | null>(null);

  function syncLocationUrl(nextLocation: import('@/lib/geo').MarketplaceLocation) {
    const url = new URL(window.location.href);
    if (nextLocation.source === 'USER_SELECTED') url.searchParams.set('loc', formatLocation(nextLocation));
    else url.searchParams.delete('loc');
    window.history.replaceState(window.history.state, '', url);
  }
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const queryVersionRef = useRef(0);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const mapListingsRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const [mapPreviewId, setMapPreviewId] = useState<string | null>(null);
  const [listPreviewId, setListPreviewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [showFilters, setShowFilters] = useState(false);
  const [keyword, setKeyword] = useState(initialQuery ?? '');
  const [dateRange, setDateRange] = useState({ start: initialStartDate ?? todayIso(), end: initialEndDate ?? addDaysIso(todayIso(), 1) });
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string | null>(initialCategory ?? null);
  const [maxPrice, setMaxPrice] = useState(200);
  const [maxDistance, setMaxDistance] = useState(10);
  const [minRating, setMinRating] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [instantOnly, setInstantOnly] = useState(false);
  const [protectionOnly, setProtectionOnly] = useState(false);
  const [deliveryOnly, setDeliveryOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SearchSortBy | 'distance' | 'rating' | 'recommended'>('recommended');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  function handleSearchBarSearch(p: SearchParams) {
    setKeyword(p.keyword);
    setDateRange({ start: p.startDate, end: p.endDate });
  }

  useEffect(() => {
    if (!initialLocationLabel || initialLocationLabel === 'Near me' || initialLocationLabel === 'Nearby') return;
    if (lastRouteLocation.current === initialLocationLabel) return;
    lastRouteLocation.current = initialLocationLabel;
    if (location.source === 'USER_SELECTED') return;
    let cancelled = false;
    void findCities(initialLocationLabel).then((cities) => {
      if (!cancelled && cities[0]) selectCity(cities[0]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [initialLocationLabel, location, selectCity]);

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

  // Categories + their listing counts load once; independent of the search filters below.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCategories(), fetchCategoryCounts()])
      .then(([catRows, counts]) => { if (!cancelled) setCategories(catRows.map((c) => toUiCategory(c, counts))); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); });
    return () => { cancelled = true; };
  }, []);

  // Real server-side search: keyword/category/price/feature filters/sort are pushed down to the Supabase query,
  // with pagination so the full listings table is never loaded at once.
  const serverSortBy: SearchSortBy = sortBy === 'recommended' || sortBy === 'newest' || sortBy === 'price-low' || sortBy === 'price-high'
    ? sortBy
    : 'newest';
  useEffect(() => {
    let cancelled = false;
    queryVersionRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoading(true);
    setError(null);
    searchListings({
      keyword,
      categoryId: activeCategory,
      maxPrice,
      verifiedOnly,
      instantOnly,
      protectionOnly,
      deliveryOnly,
      sortBy: serverSortBy,
      page: 0,
    })
      .then((result) => {
        if (cancelled) return;
        setListings(result.rows.map(toUiListing));
        setTotal(result.total);
        setHasMore(result.hasMore);
        setPage(0);
        void enrichListingsWithRatings(result.rows.map(toUiListing)).then((enriched) => {
          if (!cancelled) setListings(enriched);
        });
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [keyword, activeCategory, maxPrice, verifiedOnly, instantOnly, protectionOnly, deliveryOnly, serverSortBy]);

  function loadMore() {
    if (loading || loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = page + 1;
    const queryVersion = queryVersionRef.current;
    searchListings({
      keyword,
      categoryId: activeCategory,
      maxPrice,
      verifiedOnly,
      instantOnly,
      protectionOnly,
      deliveryOnly,
      sortBy: serverSortBy,
      page: nextPage,
    })
      .then(async (result) => {
        if (queryVersion !== queryVersionRef.current) return;
        const enriched = await enrichListingsWithRatings(result.rows.map(toUiListing));
        if (queryVersion !== queryVersionRef.current) return;
        setListings((prev) => [...prev, ...enriched]);
        setHasMore(result.hasMore);
        setPage(nextPage);
      })
      .catch((err: unknown) => {
        if (queryVersion === queryVersionRef.current) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (queryVersion === queryVersionRef.current) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      });
  }

  loadMoreRef.current = loadMore;

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = view === 'map' ? mapListingsRef.current : null;
    if (!sentinel || !hasMore || loading || loadingMore || error || (view === 'map' && !root)) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
    }, { root, rootMargin: '480px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [view, hasMore, loading, loadingMore, error, listings.length]);

  // Hides listings that already have a blocked date or an overlapping active booking within the
  // picked date range - scoped to the currently-loaded page of listings (see availability.ts).
  useEffect(() => {
    let cancelled = false;
    const ids = listings.map((l) => l.id);
    fetchUnavailableListingIds(ids, dateRange.start, dateRange.end)
      .then((result) => { if (!cancelled) setUnavailableIds(result); })
      .catch(() => { if (!cancelled) setUnavailableIds(new Set()); });
    return () => { cancelled = true; };
  }, [listings, dateRange]);

  // Distance is real when we have the user's coordinates and the listing has a valid stored lat/lng.
  // Listings without coordinates are treated as out-of-range when distance filtering is active.
  const preciseLocation = location.source === 'BROWSER' && location.latitude !== undefined && location.longitude !== undefined;
  const listingsWithDistance = useMemo(() => {
    if (!preciseLocation) return listings;
    return listings.map((l) => {
      const hasCoords = Number.isFinite(l.lat) && Number.isFinite(l.lng) && !(l.lat === 0 && l.lng === 0);
      if (!hasCoords) return { ...l, distance: Number.POSITIVE_INFINITY };
      return { ...l, distance: Math.round(haversineMiles(location.latitude!, location.longitude!, l.lat, l.lng) * 10) / 10 };
    });
  }, [listings, preciseLocation, location.latitude, location.longitude]);

  // ponytail: distance/rating sorting remain client-side because distance depends on browser
  // geolocation and ratings are enriched after listing fetch; server-side fields are filtered in SQL.
  const filtered = useMemo(() => {
    let result = listingsWithDistance.filter((l) =>
      l.rating >= minRating && !unavailableIds.has(l.id)
      && (preciseLocation ? l.distance <= maxDistance : location.source === 'NONE' || listingIsInCity(l.pickup, location.city))
    );
    if (sortBy === 'distance' && preciseLocation) result = [...result].sort((a, b) => a.distance - b.distance);
    if (sortBy === 'rating') result = [...result].sort((a, b) => b.rating - a.rating);
    return result;
  }, [listingsWithDistance, maxDistance, minRating, sortBy, unavailableIds, preciseLocation, location]);

  function handleMapPreviewChange(id: string | null) {
    setMapPreviewId(id);
    if (!id) return;
    const pane = mapListingsRef.current;
    const row = pane && Array.from(pane.children).find((child) => child instanceof HTMLElement && child.dataset.listingId === id);
    if (!(row instanceof HTMLElement) || !pane) return;
    const paneBounds = pane.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    if (rowBounds.top < paneBounds.top || rowBounds.bottom > paneBounds.bottom) {
      pane.scrollBy({ top: rowBounds.top - paneBounds.top - 12, behavior: 'smooth' });
    }
  }

  const activeFilterCount = [activeCategory, verifiedOnly, instantOnly, protectionOnly, deliveryOnly].filter(Boolean).length
    + (maxPrice < 200 ? 1 : 0) + (preciseLocation && maxDistance < 10 ? 1 : 0) + (minRating > 0 ? 1 : 0);

  function clearAllFilters() {
    setActiveCategory(null); setMaxPrice(200); setMaxDistance(10); setMinRating(0);
    setVerifiedOnly(false); setInstantOnly(false); setProtectionOnly(false); setDeliveryOnly(false);
  }

  const activeCategoryName = categories.find((c) => c.id === activeCategory)?.name;
  const appliedChips: { key: string; label: string; clear: () => void }[] = [
    ...(activeCategoryName ? [{ key: 'cat', label: activeCategoryName, clear: () => setActiveCategory(null) }] : []),
    ...(maxPrice < 200 ? [{ key: 'price', label: `Under $${maxPrice}/day`, clear: () => setMaxPrice(200) }] : []),
    ...(preciseLocation && maxDistance < 10 ? [{ key: 'dist', label: `Within ${maxDistance} mi`, clear: () => setMaxDistance(10) }] : []),
    ...(minRating > 0 ? [{ key: 'rating', label: `${minRating}+ stars`, clear: () => setMinRating(0) }] : []),
    ...(verifiedOnly ? [{ key: 'verified', label: 'Verified owner', clear: () => setVerifiedOnly(false) }] : []),
    ...(instantOnly ? [{ key: 'instant', label: 'Instant booking', clear: () => setInstantOnly(false) }] : []),
    ...(protectionOnly ? [{ key: 'protection', label: 'Rental protection', clear: () => setProtectionOnly(false) }] : []),
    ...(deliveryOnly ? [{ key: 'delivery', label: 'Delivery available', clear: () => setDeliveryOnly(false) }] : []),
  ];

  const filterPanelProps = {
    categories, activeCategory, setActiveCategory, maxPrice, setMaxPrice, maxDistance, setMaxDistance, preciseLocation,
    minRating, setMinRating, verifiedOnly, setVerifiedOnly, instantOnly, setInstantOnly,
    protectionOnly, setProtectionOnly, deliveryOnly, setDeliveryOnly,
  };

  return (
    <div className="animate-fade-in min-h-screen pb-20 md:pb-8">
      {/* Sticky search + controls */}
      <div className="sticky top-16 z-[140] glass-surface border-b border-app">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 space-y-2.5">
          <SearchBar
            onSearch={handleSearchBarSearch}
            onLocationChange={syncLocationUrl}
            variant="compact"
            defaultValue={keyword}
            initialStartDate={dateRange.start}
            initialEndDate={dateRange.end}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setShowFilters(!showFilters)}
                aria-expanded={showFilters}
                className={`shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-sm font-semibold transition-colors duration-fast ${
                  showFilters || activeFilterCount > 0
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-app bg-card text-main hover:bg-subtle'
                }`}
              >
                <SlidersHorizontal size={15} />
                Filters
                {activeFilterCount > 0 && (
                  <span className="grid place-items-center w-5 h-5 rounded-full bg-accent text-accent-text text-[10px] font-bold tnum">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <label className="sr-only" htmlFor="sort-by">Sort results</label>
              <select
                id="sort-by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="shrink-0 h-9 px-3 rounded-full border border-app bg-card text-sm font-semibold text-main outline-none cursor-pointer"
              >
                <option value="recommended">Recommended</option>
                <option value="newest">Newest first</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
                {preciseLocation && <option value="distance">Nearest first</option>}
                <option value="rating">Top rated</option>
              </select>
              {appliedChips.map((chip) => (
                <button
                  key={chip.key}
                  onClick={chip.clear}
                  className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-subtle text-sm font-medium text-sec hover:text-main transition-colors duration-fast"
                >
                  {chip.label}
                  <X size={13} />
                </button>
              ))}
              {appliedChips.length > 1 && (
                <button onClick={clearAllFilters} className="shrink-0 h-9 px-2 text-sm font-semibold text-accent">
                  Clear all
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-subtle shrink-0" role="group" aria-label="Result view">
              {([['list', List, 'List'], ['map', MapIcon, 'Map']] as const).map(([value, Icon, label]) => (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  aria-pressed={view === value}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold transition-colors duration-fast ${
                    view === value ? 'bg-card text-main shadow-xs' : 'text-sec'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
        <div className="flex gap-8">
          {/* Filters sidebar */}
          {showFilters && (
            <aside className="hidden lg:block w-64 shrink-0">
              <div className="sticky top-[188px] max-h-[calc(100vh-208px)] overflow-y-auto no-scrollbar pr-1">
                <FilterPanel {...filterPanelProps} />
              </div>
            </aside>
          )}

          {/* Results */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h1 className="text-lg font-bold text-main font-display">
                {loading ? 'Searching…' : (
                  <>
                    <span className="tnum">{filtered.length}</span>
                    {filtered.length !== total && <span className="text-sec font-normal"> of <span className="tnum">{total}</span></span>}
                    {' '}{total === 1 ? 'item' : 'items'}
                    {keyword && <span className="text-sec font-normal"> for “{keyword}”</span>}
                  </>
                )}
              </h1>
              {location.source !== 'NONE' && (
                <p className="text-xs text-sec shrink-0">{location.source === 'IP' ? `Showing items near ${formatLocation(location)} (approximate)` : location.source === 'BROWSER' ? `Near ${formatLocation(location)}` : `Items in ${formatLocation(location)}`}</p>
              )}
            </div>

            {error && <Alert tone="error" title="Search failed" className="mb-4">{error}</Alert>}

            {!error && loading && (
              view === 'list'
                ? <ListingGridSkeleton count={12} className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4" />
                : <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <ListingCardWideSkeleton key={i} />)}</div>
            )}

            {loading ? null : view === 'list' ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 animate-cross-fade">
                  {filtered.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      onClick={() => navigate({ name: 'listing', id: listing.id })}
                      favorited={favoriteIds.has(listing.id)}
                      onToggleFavorite={() => void handleToggleFavorite(listing.id)}
                    />
                  ))}
                </div>
                {hasMore && <div ref={loadMoreSentinelRef} className="flex h-12 items-center justify-center mt-5" aria-live="polite">
                  {loadingMore && <span className="flex items-center gap-2 text-sm text-sec" role="status"><Loader2 size={16} className="animate-spin" />Loading more rentals</span>}
                </div>}
              </>
            ) : (
              <div className="grid xl:grid-cols-[380px_minmax(0,1fr)] gap-3 animate-cross-fade">
                <div ref={mapListingsRef} className="h-[min(42rem,calc(100dvh_-_13rem))] min-h-80 overflow-y-auto overscroll-contain pr-1 space-y-2 no-scrollbar">
                  {filtered.map((listing) => (
                    <div
                      key={listing.id}
                      data-listing-id={listing.id}
                      onMouseEnter={() => setListPreviewId(listing.id)}
                      onMouseLeave={() => setListPreviewId((current) => current === listing.id ? null : current)}
                      onFocusCapture={() => setListPreviewId(listing.id)}
                      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setListPreviewId((current) => current === listing.id ? null : current); }}
                      className={`rounded-card-lg transition-colors duration-standard ${(listPreviewId ?? mapPreviewId) === listing.id ? 'ring-2 ring-accent' : ''}`}
                    >
                      <ListingCardWide
                        listing={listing}
                        onClick={() => navigate({ name: 'listing', id: listing.id })}
                        favorited={favoriteIds.has(listing.id)}
                        onToggleFavorite={() => void handleToggleFavorite(listing.id)}
                      />
                    </div>
                  ))}
                  {hasMore && <div ref={loadMoreSentinelRef} className="flex h-12 items-center justify-center" aria-live="polite">
                    {loadingMore && <span className="flex items-center gap-2 text-sm text-sec" role="status"><Loader2 size={16} className="animate-spin" />Loading more rentals</span>}
                  </div>}
                </div>
                <MapView
                  listings={filtered}
                  onSelect={(id) => navigate({ name: 'listing', id })}
                  listPreviewId={listPreviewId}
                  onPreviewChange={handleMapPreviewChange}
                />
              </div>
            )}

            {!loading && !hasMore && filtered.length === 0 && (
              <EmptyState
                icon={<SearchX size={20} />}
                title={location.source !== 'NONE' ? `No items in ${formatLocation(location)}` : 'Nothing matches those filters'}
                description={
                  location.source !== 'NONE'
                    ? 'Try another city, or browse everything without a location.'
                    : activeFilterCount > 0
                    ? 'Try widening the distance or price, or clear the filters to see everything nearby.'
                    : 'Try a different word, or browse a category to see what people near you are lending.'
                }
                actionLabel={location.source !== 'NONE' ? 'Browse all locations' : activeFilterCount > 0 ? 'Clear all filters' : 'Browse everything'}
                onAction={() => { if (location.source !== 'NONE') { clearLocation(); syncLocationUrl({ city: '', state: '', country: '', source: 'NONE' }); } else { clearAllFilters(); setKeyword(''); } }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Mobile filters - bottom sheet, thumb-reachable. */}
      {showFilters && (
        <Overlay className="lg:hidden flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/45 animate-fade-in" onClick={() => setShowFilters(false)} />
          <div className="relative bg-card rounded-t-card-xl max-h-[85vh] flex flex-col animate-sheet">
            <div className="flex items-center justify-between px-4 py-3 border-b border-app">
              <h2 className="font-bold text-main font-display">Filters</h2>
              <button onClick={() => setShowFilters(false)} aria-label="Close filters" className="grid place-items-center w-9 h-9 rounded-full hover:bg-subtle">
                <X size={20} className="text-main" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FilterPanel {...filterPanelProps} />
            </div>
            <div className="flex gap-2 p-4 border-t border-app pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button variant="secondary" onClick={clearAllFilters}>Clear</Button>
              <Button fullWidth onClick={() => setShowFilters(false)}>
                Show {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
              </Button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function FilterPanel(props: {
  categories: Category[];
  activeCategory: string | null;
  setActiveCategory: (v: string | null) => void;
  maxPrice: number;
  setMaxPrice: (v: number) => void;
  maxDistance: number;
  setMaxDistance: (v: number) => void;
  preciseLocation: boolean;
  minRating: number;
  setMinRating: (v: number) => void;
  verifiedOnly: boolean;
  setVerifiedOnly: (v: boolean) => void;
  instantOnly: boolean;
  setInstantOnly: (v: boolean) => void;
  protectionOnly: boolean;
  setProtectionOnly: (v: boolean) => void;
  deliveryOnly: boolean;
  setDeliveryOnly: (v: boolean) => void;
}) {
  return (
    <div className="space-y-7">
      <div>
        <h3 className="text-[13px] font-bold text-main mb-2">Category</h3>
        <div className="space-y-0.5">
          <button
            onClick={() => props.setActiveCategory(null)}
            className={`w-full text-left px-3 h-10 rounded-card text-sm transition-colors duration-fast ${!props.activeCategory ? 'bg-accent-soft text-accent font-semibold' : 'text-sec hover:bg-subtle'}`}
          >
            All categories
          </button>
          {props.categories.map((cat) => {
            const Icon = (Icons as unknown as Record<string, typeof Icons.Camera>)[cat.icon] ?? Icons.Box;
            const active = props.activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => props.setActiveCategory(active ? null : cat.id)}
                className={`w-full flex items-center gap-2.5 px-3 h-10 rounded-card text-sm transition-colors duration-fast ${active ? 'bg-accent-soft text-accent font-semibold' : 'text-sec hover:bg-subtle'}`}
              >
                <Icon size={15} className="shrink-0" />
                <span className="flex-1 text-left truncate">{cat.name}</span>
                <span className="text-xs text-muted tnum">{cat.count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-[13px] font-bold text-main">Max price per day</h3>
          <span className="text-sm font-semibold text-main tnum">${props.maxPrice}</span>
        </div>
        <input type="range" min="10" max="200" step="5" value={props.maxPrice} onChange={(e) => props.setMaxPrice(Number(e.target.value))} aria-label="Max price per day" className="w-full accent-[var(--accent)]" />
        <div className="flex justify-between text-xs text-muted mt-1"><span>$10</span><span>$200+</span></div>
      </div>

      {props.preciseLocation && <div>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-[13px] font-bold text-main">Max distance</h3>
          <span className="text-sm font-semibold text-main tnum">{props.maxDistance} mi</span>
        </div>
        <input type="range" min="1" max="10" step="0.5" value={props.maxDistance} onChange={(e) => props.setMaxDistance(Number(e.target.value))} aria-label="Max distance" className="w-full accent-[var(--accent)]" />
        <div className="flex justify-between text-xs text-muted mt-1"><span>1 mi</span><span>10 mi</span></div>
      </div>}

      <div>
        <h3 className="text-[13px] font-bold text-main mb-2">Minimum rating</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 4.0, 4.5, 4.8].map((r) => (
            <button
              key={r}
              onClick={() => props.setMinRating(r)}
              className={`h-9 rounded-card text-xs font-semibold border transition-colors duration-fast ${props.minRating === r ? 'border-accent text-accent bg-accent-soft' : 'border-app text-sec hover:bg-subtle'}`}
            >
              {r === 0 ? 'Any' : `${r}+`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-bold text-main mb-2">Features</h3>
        <div className="space-y-1.5">
          <FilterToggle label="Verified owner" icon={Shield} checked={props.verifiedOnly} onChange={props.setVerifiedOnly} />
          <FilterToggle label="Instant booking" icon={Zap} checked={props.instantOnly} onChange={props.setInstantOnly} />
          {SHOW_OUT_OF_SCOPE_PAGES && (
            <FilterToggle label="Rental protection" icon={CheckCircle2} checked={props.protectionOnly} onChange={props.setProtectionOnly} />
          )}
          <FilterToggle label="Delivery available" icon={Truck} checked={props.deliveryOnly} onChange={props.setDeliveryOnly} />
        </div>
      </div>
    </div>
  );
}

function FilterToggle({ label, icon: Icon, checked, onChange }: { label: string; icon: typeof Shield; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="w-full flex items-center justify-between gap-3 px-3 h-11 rounded-card border border-app hover:bg-subtle transition-colors duration-fast"
    >
      <span className="flex items-center gap-2.5 text-sm text-main">
        <Icon size={15} className="text-sec" />
        {label}
      </span>
      <span className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-fast ${checked ? 'bg-accent' : 'bg-[var(--border-strong)]'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-xs transition-transform duration-fast ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

function MapView({ listings, onSelect, listPreviewId, onPreviewChange }: {
  listings: typeof import('@/data').listings;
  onSelect: (id: string) => void;
  listPreviewId: string | null;
  onPreviewChange?: (id: string | null) => void;
}) {
  const mapApiKey = (import.meta.env.VITE_MAP_API_KEY as string | undefined)?.trim();
  const useMapTiler = Boolean(mapApiKey);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [cardHovered, setCardHovered] = useState(false);
  const [previewCorner, setPreviewCorner] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('bottom-left');
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef(new Map<string, import('@/lib/leaflet').LeafletMarker>());
  const listPreviewIdRef = useRef(listPreviewId);
  listPreviewIdRef.current = listPreviewId;
  const hoverClearTimer = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  const pinnedIdRef = useRef<string | null>(null);
  const cardHoveredRef = useRef(false);
  const located = useMemo(() => listings.filter((l) => l.lat && l.lng), [listings]);
  const previewListing = listings.find((l) => l.id === (listPreviewId ?? hoveredId ?? pinnedId));

  useEffect(() => {
    onPreviewChange?.(hoveredId ?? pinnedId ?? null);
  }, [hoveredId, pinnedId, onPreviewChange]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    pinnedIdRef.current = pinnedId;
  }, [pinnedId]);

  useEffect(() => {
    cardHoveredRef.current = cardHovered;
  }, [cardHovered]);

  useEffect(() => {
    const activeId = listPreviewId ?? hoveredId ?? pinnedId;
    for (const [id, marker] of markersRef.current) {
      marker.getElement()?.querySelector('.ybuy-price-pin')?.classList.toggle('is-selected', id === activeId);
    }
    const markerBounds = activeId && markersRef.current.get(activeId)?.getElement()?.getBoundingClientRect();
    const mapBounds = containerRef.current?.getBoundingClientRect();
    if (markerBounds && mapBounds) {
      const vertical = markerBounds.top - mapBounds.top > mapBounds.height / 2 ? 'top' : 'bottom';
      const horizontal = markerBounds.left - mapBounds.left > mapBounds.width / 2 ? 'left' : 'right';
      setPreviewCorner(`${vertical}-${horizontal}`);
    }
  }, [listPreviewId, hoveredId, pinnedId]);

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    const markers = markersRef.current;
    if (!el) return;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;

        // Reset any prior instance (e.g. when the filtered set changes) before re-rendering.
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
        markers.clear();

        const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: true });
        mapRef.current = map;
        const tileUrl = useMapTiler
          ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(mapApiKey ?? '')}`
          : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
        const attribution = useMapTiler
          ? '&copy; OpenStreetMap contributors &copy; MapTiler'
          : '&copy; OpenStreetMap contributors &copy; CARTO';

        L.tileLayer(tileUrl, {
          attribution,
          maxZoom: 20,
        }).addTo(map);

        for (const listing of located) {
          const icon = L.divIcon({
            className: 'ybuy-pin-marker',
            html: `<span class="ybuy-price-pin">$${listing.pricePerDay}</span>`,
            iconSize: [48, 24],
            iconAnchor: [24, 12],
          });
          const marker = L.marker([listing.lat, listing.lng], { icon }).addTo(map);
          markers.set(listing.id, marker);
          marker.getElement()?.querySelector('.ybuy-price-pin')?.classList.toggle('is-selected', listing.id === listPreviewIdRef.current);
          marker
            .on('mouseover', () => {
              if (hoverClearTimer.current) {
                window.clearTimeout(hoverClearTimer.current);
                hoverClearTimer.current = null;
              }
              setHoveredId(listing.id);
            })
            .on('mouseout', () => {
              hoverClearTimer.current = window.setTimeout(() => {
                if (!cardHoveredRef.current && pinnedIdRef.current !== listing.id) {
                  setHoveredId((prev) => (prev === listing.id ? null : prev));
                }
              }, 180);
            })
            .on('click', () => {
              setPinnedId(listing.id);
              setHoveredId(listing.id);
            });
        }

        if (located.length > 0) {
          const bounds = L.latLngBounds(located.map((l) => [l.lat, l.lng] as [number, number]));
          if (located.length === 1) map.setView([located[0].lat, located[0].lng], 13);
          else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        } else {
          map.setView([0, 0], 2);
        }
        setTimeout(() => {
          mapRef.current?.invalidateSize();
          const activeId = listPreviewIdRef.current;
          const markerBounds = activeId && markers.get(activeId)?.getElement()?.getBoundingClientRect();
          const mapBounds = containerRef.current?.getBoundingClientRect();
          if (markerBounds && mapBounds) {
            const vertical = markerBounds.top - mapBounds.top > mapBounds.height / 2 ? 'top' : 'bottom';
            const horizontal = markerBounds.left - mapBounds.left > mapBounds.width / 2 ? 'left' : 'right';
            setPreviewCorner(`${vertical}-${horizontal}`);
          }
        }, 0);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (hoverClearTimer.current) {
        window.clearTimeout(hoverClearTimer.current);
        hoverClearTimer.current = null;
      }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markers.clear();
    };
  }, [located]);

  if (failed) {
    return (
      <div className="h-[min(42rem,calc(100dvh_-_13rem))] min-h-80 rounded-card-lg border border-app bg-subtle flex flex-col items-center justify-center gap-2 text-center px-6">
        <MapPin size={24} className="text-accent" />
        <p className="text-sm text-sec">The map couldn't load. Check your connection, or switch back to list view.</p>
      </div>
    );
  }

  return (
    <div className="relative h-[min(42rem,calc(100dvh_-_13rem))] min-h-80 rounded-card-lg overflow-hidden border border-app bg-subtle">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-black/10 z-[350]" />

      {/* Hover/click preview */}
      {previewListing && (
        <div
          className={`absolute ${previewCorner.startsWith('top') ? 'top-[4.5rem]' : 'bottom-3'} ${previewCorner.endsWith('left') ? 'left-3' : 'right-3'} w-[min(19rem,calc(100%-1.5rem))] bg-card rounded-card-lg border border-app shadow-card p-2.5 z-[500]`}
          onMouseEnter={() => setCardHovered(true)}
          onMouseLeave={() => {
            setCardHovered(false);
            if (!pinnedId) setHoveredId(null);
          }}
        >
          <div className="flex gap-3">
            <img src={previewListing.images[0]} alt="" className="w-16 h-16 rounded-card object-cover shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm text-main line-clamp-1">{previewListing.title}</h4>
              <div className="flex items-center gap-1 text-xs text-sec mt-1">
                {previewListing.reviewCount > 0 && <><Star size={12} className="fill-[var(--star)] text-[var(--star)]" />{previewListing.rating.toFixed(1)}</>}
                {Number.isFinite(previewListing.distance) && previewListing.distance > 0 && <span>· {previewListing.distance} mi</span>}
              </div>
              <div className="flex items-baseline gap-0.5 mt-1">
                <span className="font-bold text-main">${previewListing.pricePerDay}</span>
                <span className="text-xs text-sec">/day</span>
              </div>
            </div>
            <div className="self-center flex flex-col items-end gap-1">
              <Button size="sm" onClick={() => onSelectRef.current(previewListing.id)}>View</Button>
              {pinnedId && (
                <button
                  onClick={() => { setPinnedId(null); setHoveredId(null); }}
                  className="text-[11px] text-sec hover:text-main"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="absolute top-4 left-4 flex items-center gap-2 px-3 h-9 rounded-full bg-card border border-app shadow-card text-xs font-medium text-sec z-[500]">
        <MapPin size={14} className="text-accent" />
        Approximate locations until booking is confirmed
      </div>
    </div>
  );
}

