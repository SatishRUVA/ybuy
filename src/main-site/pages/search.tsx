import { useState, useMemo, useEffect, useRef } from 'react';
import { SearchBar, SearchRadiusSelect, type SearchParams } from '@/main-site/components/search';
import { ListingCard, ListingCardWide } from '@/main-site/components/listing-card';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Listing, Category } from '@/data';
import { fetchCategories, fetchCategoryCounts, searchListings, resolveCategoryId, toUiCategory, toUiListing, enrichListingsWithRatings, SEARCH_PAGE_SIZE, type SearchSortBy } from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { cityForCoordinates, findCities, locationLabel as formatLocation } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { loadLeaflet, type LeafletMap } from '@/lib/leaflet';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { ListingGridSkeleton, ListingCardWideSkeleton } from '@/main-site/components/skeleton';
import { Button, Alert, EmptyState } from '@/main-site/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/main-site/components/shadcn/dialog';
import * as Icons from 'lucide-react';
import { Map as MapIcon, List, SlidersHorizontal, X, Shield, Zap, CheckCircle2, Truck, MapPin, SearchX, Loader2, PackagePlus, LocateFixed, Plus, Minus } from 'lucide-react';
import { SEARCH_RADII, searchStateParams, saveSearchState, type SearchState, type SearchRadius } from '@/lib/search-state';
import { useUtcDay } from '@/lib/use-utc-day';

// The price slider's top stop is labelled "$200+", so it must mean "no upper limit", not "$200".
const PRICE_FILTER_MAX = 200;

function initialSearchPageSize() {
  const columns = window.matchMedia('(min-width: 1280px)').matches ? 4
    : window.matchMedia('(min-width: 1024px)').matches ? 3 : 2;
  const cardHeight = columns === 4 ? 380 : columns === 3 ? 340 : 300;
  const availableHeight = Math.max(280, window.innerHeight - 220);
  const rows = Math.ceil(availableHeight / cardHeight) + 1;
  return Math.min(SEARCH_PAGE_SIZE, columns * rows);
}

export function SearchPage({
  initialCategory, initialQuery, initialCoords, initialLocationLabel, initialStartDate, initialEndDate, initialFilters = {},
}: {
  initialCategory?: string; initialQuery?: string;
  initialCoords?: { lat: number; lng: number }; initialLocationLabel?: string;
  initialStartDate?: string; initialEndDate?: string;
  initialFilters?: Partial<SearchState>;
}) {
  const { navigate } = useRouter();
  const utcDay = useUtcDay();
  const { user, openSignIn } = useAuth();
  const itemRequestsFlag = useFeatureFlag('item_requests');
  const { location, selectCity, clearLocation } = useMarketplaceLocation();
  const lastRouteLocation = useRef<string | null>(null);
  const [routeLocationReady, setRouteLocationReady] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [totalMatches, setTotalMatches] = useState<number | null>(null);
  const [hasUserScrolled, setHasUserScrolled] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const queryVersionRef = useRef(0);
  const pageSizeRef = useRef(SEARCH_PAGE_SIZE);
  const lastScrollYRef = useRef(0);
  const lastMapScrollTopRef = useRef(0);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const mapListingsRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const [mapPreviewId, setMapPreviewId] = useState<string | null>(null);
  const [listPreviewId, setListPreviewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [showFilters, setShowFilters] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isMobileFilters, setIsMobileFilters] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const [keyword, setKeyword] = useState(initialQuery ?? '');
  const [dateRange, setDateRange] = useState({ start: initialStartDate ?? '', end: initialEndDate ?? '' });
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [categoryNotice, setCategoryNotice] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [categoriesToken, setCategoriesToken] = useState(0);
  const appliedCategoryRef = useRef(initialCategory);
  const [maxPrice, setMaxPrice] = useState(initialFilters.maxPrice ?? 200);
  const [maxDistance, setMaxDistance] = useState<SearchRadius>(initialFilters.radius === undefined ? 5 : initialFilters.radius);
  const [minRating, setMinRating] = useState(initialFilters.minRating ?? 0);
  const [verifiedOnly, setVerifiedOnly] = useState(initialFilters.verifiedOnly ?? false);
  const [instantOnly, setInstantOnly] = useState(initialFilters.instantOnly ?? false);
  const [protectionOnly, setProtectionOnly] = useState(initialFilters.protectionOnly ?? false);
  const [deliveryOnly, setDeliveryOnly] = useState(initialFilters.deliveryOnly ?? false);
  const [sortBy, setSortBy] = useState<SearchState['sortBy']>(initialFilters.sortBy ?? 'recommended');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const preciseLocation = location.source !== 'NONE'
    && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => {
      setIsMobileFilters(media.matches);
      if (!media.matches) setMobileFiltersOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > lastScrollYRef.current) setHasUserScrolled(true);
      lastScrollYRef.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function handleSearchBarSearch(p: SearchParams) {
    setKeyword(p.keyword);
    setDateRange({ start: p.startDate, end: p.endDate });
    setMaxDistance(p.radius);
  }

  // Apply the city from the URL (shared link / search box). It is marked as handled only after the
  // lookup finishes: marking it up front meant a cancelled first request (React dev double-mount,
  // or any re-run) was never retried, so the URL city was silently dropped.
  useEffect(() => {
    const routeKey = `${initialLocationLabel ?? ''}:${initialCoords?.lat ?? ''}:${initialCoords?.lng ?? ''}`;
    if (lastRouteLocation.current === routeKey) return;
    if (initialCoords && location.country && location.latitude === initialCoords.lat && location.longitude === initialCoords.lng) {
      lastRouteLocation.current = routeKey;
      setRouteLocationReady(true);
      return;
    }
    if (!initialCoords && (!initialLocationLabel || initialLocationLabel === 'Near me' || initialLocationLabel === 'Nearby')) {
      lastRouteLocation.current = routeKey;
      setRouteLocationReady(true);
      return;
    }
    if (!initialCoords && formatLocation(location).toLowerCase() === initialLocationLabel?.trim().toLowerCase()
      && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
      lastRouteLocation.current = routeKey;
      setRouteLocationReady(true);
      return;
    }
    const controller = new AbortController();
    setLocationError(null);
    const lookup = initialCoords
      ? cityForCoordinates(initialCoords.lat, initialCoords.lng).then(city => city ? [city] : [])
      : findCities(initialLocationLabel ?? '', controller.signal);
    void lookup.then(async (cities) => {
      if (controller.signal.aborted) return;
      if (cities[0]) {
        await selectCity(cities[0]);
        if (controller.signal.aborted) return;
        lastRouteLocation.current = routeKey;
        setRouteLocationReady(true);
      }
      else { setLocationError('Could not find that city or postal code. Choose another location.'); setLoading(false); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLocationError(error instanceof Error ? error.message : 'Could not resolve the search location.');
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [initialLocationLabel, initialCoords, location, selectCity]);

  useEffect(() => {
    if (!categoriesLoaded || !routeLocationReady) return;
    const state: SearchState = {
      q: keyword, category: activeCategory ?? undefined, start: dateRange.start, end: dateRange.end,
      radius: maxDistance, maxPrice, minRating, verifiedOnly, instantOnly, protectionOnly, deliveryOnly, sortBy,
    };
    const params = searchStateParams(state);
    if (location.source !== 'NONE') params.set('loc', formatLocation(location));
    if (preciseLocation) {
      params.set('lat', String(location.latitude));
      params.set('lng', String(location.longitude));
    }
    window.history.replaceState(window.history.state, '', `/search?${params}`);
    saveSearchState(state);
  }, [categoriesLoaded, routeLocationReady, keyword, activeCategory, dateRange.start, dateRange.end, maxDistance, maxPrice, minRating, verifiedOnly, instantOnly, protectionOnly, deliveryOnly, sortBy, location, preciseLocation, utcDay]);

  useEffect(() => {
    if (!user) { setFavoriteIds(new Set()); return; }
    fetchFavoriteListingIds(user.id).then(setFavoriteIds).catch(() => {});
  }, [user]);

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

  // Categories load first so a URL category (id or name) is resolved before it reaches the UUID
  // column filter. Counts are decorative, so a failure there must not break the whole page.
  useEffect(() => {
    let cancelled = false;
    fetchCategories()
      .then((rows) => {
        if (cancelled) return;
        const resolved = resolveCategoryId(initialCategory, rows);
        setCategories(rows.map((c) => toUiCategory(c, new Map())));
        setActiveCategory(resolved);
        setCategoryNotice(initialCategory && !resolved ? `We couldn't find the "${initialCategory}" category, so all items are shown.` : null);
        setCategoriesLoaded(true);
        void fetchCategoryCounts()
          .then((counts) => { if (!cancelled) setCategories(rows.map((c) => toUiCategory(c, counts))); })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setActiveCategory(null);
        setCategoriesLoaded(true);
        setError(err instanceof Error ? err.message : 'Failed to load categories');
      });
    return () => { cancelled = true; };
    // initialCategory changes after mount are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesToken]);

  // The search route stays mounted when only the category in the URL changes.
  useEffect(() => {
    if (!categoriesLoaded || initialCategory === appliedCategoryRef.current) return;
    appliedCategoryRef.current = initialCategory;
    const resolved = resolveCategoryId(initialCategory, categories);
    setActiveCategory(resolved);
    setCategoryNotice(initialCategory && !resolved ? `We couldn't find the "${initialCategory}" category, so all items are shown.` : null);
  }, [initialCategory, categoriesLoaded, categories]);

  // Real server-side search: keyword/category/price/feature filters/sort are pushed down to the Supabase query,
  // with pagination so the full listings table is never loaded at once.
  const serverSortBy: SearchSortBy = sortBy === 'recommended' || sortBy === 'newest' || sortBy === 'price-low' || sortBy === 'price-high' || sortBy === 'distance'
    ? sortBy
    : 'newest';
  useEffect(() => {
    // A category filter can't be applied until the URL category has been resolved to a real id.
    if (!categoriesLoaded || !routeLocationReady) return;
    let cancelled = false;
    queryVersionRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setTotalMatches(null);
    setHasUserScrolled(false);
    lastScrollYRef.current = window.scrollY;
    lastMapScrollTopRef.current = mapListingsRef.current?.scrollTop ?? 0;
    pageSizeRef.current = initialSearchPageSize();
    setLoading(true);
    setError(null);
    setListings([]);
    setHasMore(false);
    searchListings({
      keyword,
      latitude: preciseLocation ? location.latitude : undefined,
      longitude: preciseLocation ? location.longitude : undefined,
      radiusMiles: maxDistance,
      startDate: dateRange.start,
      endDate: dateRange.end,
      categoryId: activeCategory,
      maxPrice: maxPrice < PRICE_FILTER_MAX ? maxPrice : undefined,
      verifiedOnly,
      instantOnly,
      protectionOnly,
      deliveryOnly,
      sortBy: serverSortBy,
      page: 0,
      pageSize: pageSizeRef.current,
    })
      .then((result) => {
        if (cancelled) return;
        setListings(result.rows.map(toUiListing));
        setTotalMatches(result.total);
        setHasMore(result.hasMore);
        setPage(0);
        void enrichListingsWithRatings(result.rows.map(toUiListing)).then((enriched) => {
          if (!cancelled) setListings(enriched);
        });
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoriesLoaded, routeLocationReady, retryToken, keyword, activeCategory, maxPrice, verifiedOnly, instantOnly, protectionOnly, deliveryOnly, serverSortBy, preciseLocation, location.latitude, location.longitude, maxDistance, dateRange.start, dateRange.end, utcDay]);

  function loadMore() {
    if (loading || loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = page + 1;
    const queryVersion = queryVersionRef.current;
    searchListings({
      keyword,
      latitude: preciseLocation ? location.latitude : undefined,
      longitude: preciseLocation ? location.longitude : undefined,
      radiusMiles: maxDistance,
      startDate: dateRange.start,
      endDate: dateRange.end,
      categoryId: activeCategory,
      maxPrice: maxPrice < PRICE_FILTER_MAX ? maxPrice : undefined,
      verifiedOnly,
      instantOnly,
      protectionOnly,
      deliveryOnly,
      sortBy: serverSortBy,
      page: nextPage,
      pageSize: pageSizeRef.current,
    })
      .then(async (result) => {
        if (queryVersion !== queryVersionRef.current) return;
        const enriched = await enrichListingsWithRatings(result.rows.map(toUiListing));
        if (queryVersion !== queryVersionRef.current) return;
        setListings((prev) => [...prev, ...enriched]);
        setTotalMatches(result.total);
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
    if (!sentinel || !hasMore || !hasUserScrolled || loading || loadingMore || error || (view === 'map' && !root)) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
    }, { root, rootMargin: '200px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [view, hasMore, hasUserScrolled, loading, loadingMore, error, listings.length]);

  const filtered = useMemo(() => {
    let result = listings.filter((l) => l.rating >= minRating);
    if (sortBy === 'rating') result = [...result].sort((a, b) => b.rating - a.rating);
    return result;
  }, [listings, minRating, sortBy]);

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
    + (maxPrice < 200 ? 1 : 0) + (preciseLocation && maxDistance !== 5 ? 1 : 0) + (minRating > 0 ? 1 : 0);

  function clearAllFilters() {
    setActiveCategory(null); setMaxPrice(200); setMaxDistance(5); setMinRating(0);
    setVerifiedOnly(false); setInstantOnly(false); setProtectionOnly(false); setDeliveryOnly(false);
  }

  const activeCategoryName = categories.find((c) => c.id === activeCategory)?.name;
  const appliedChips: { key: string; label: string; clear: () => void }[] = [
    ...(activeCategoryName ? [{ key: 'cat', label: activeCategoryName, clear: () => setActiveCategory(null) }] : []),
    ...(maxPrice < 200 ? [{ key: 'price', label: `Under $${maxPrice}/day`, clear: () => setMaxPrice(200) }] : []),
    ...(preciseLocation ? [{ key: 'dist', label: maxDistance === null ? 'Any distance' : `Within ${maxDistance} mi`, clear: () => setMaxDistance(5) }] : []),
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
      <div className="workspace-search-toolbar sticky top-16 z-[140] glass-surface border-b border-app">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 space-y-2.5">
          <SearchBar
            onSearch={handleSearchBarSearch}
            onLocationChange={() => { setLocationError(null); setRouteLocationReady(true); }}
            variant="compact"
            defaultValue={keyword}
            initialStartDate={dateRange.start}
            initialEndDate={dateRange.end}
            radius={maxDistance}
            onRadiusChange={setMaxDistance}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
              <button
                ref={mobileFilterTriggerRef}
                onClick={() => isMobileFilters ? setMobileFiltersOpen(true) : setShowFilters(!showFilters)}
                aria-expanded={isMobileFilters ? mobileFiltersOpen : showFilters}
                aria-haspopup={isMobileFilters ? 'dialog' : undefined}
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
                className="shrink-0 h-9 px-3 rounded-full border border-app bg-card text-sm font-semibold text-main cursor-pointer"
              >
                <option value="recommended">Recommended</option>
                <option value="newest">Newest</option>
                <option value="price-low">Lowest price</option>
                <option value="price-high">Highest price</option>
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
                  aria-label={`${label} view`}
                  title={`${label} view`}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-full text-xs font-semibold transition-colors duration-fast ${
                    view === value ? 'bg-card text-main shadow-xs' : 'text-sec'
                  }`}
                >
                  <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
        <div className="flex gap-8">
          {/* Filters sidebar */}
          {showFilters && !isMobileFilters && (
            <aside id="desktop-search-filters" className="hidden lg:block w-64 shrink-0">
              <div className="workspace-search-filters sticky top-[188px] max-h-[calc(100vh-208px)] overflow-y-auto no-scrollbar pr-1">
                <FilterPanel {...filterPanelProps} />
              </div>
            </aside>
          )}

          {/* Results */}
          <div className="workspace-results flex-1 min-w-0">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 mb-4">
              <h1 className="text-lg font-bold text-main font-display" aria-live="polite" aria-atomic="true">
                {error ? 'Could not load results' : loading ? 'Searching…' : (
                  <>
                    <span>
                      <span className="tnum">{totalMatches ?? 0}</span>{' '}{totalMatches === 1 ? 'item' : 'items'}
                    </span>
                    {keyword && <span className="text-sec font-normal"> for “{keyword}”</span>}
                  </>
                )}
              </h1>
              <p className="text-xs text-sec sm:shrink-0">{preciseLocation ? `${maxDistance === null ? 'Any distance from' : `Within ${maxDistance} miles of`} ${formatLocation(location)} (approximate distances)` : 'Choose a city or allow location access to filter by distance.'}</p>
            </div>
            {itemRequestsFlag.enabled && !error && !loading && filtered.length > 0 && <div className="mb-3 flex justify-end">
              <Button size="sm" variant="ghost" icon={<PackagePlus size={15} />} onClick={() => navigate({ name: 'need-something' })}>Request an item instead</Button>
            </div>}

            {categoryNotice && !error && <Alert tone="info" className="mb-4">{categoryNotice}</Alert>}
            {locationError && <Alert tone="error" className="mb-4">{locationError}</Alert>}
            {error && (
              <Alert tone="error" title="We couldn't load these items" className="mb-4">
                <p>{error}</p>
                <button type="button" onClick={() => { setError(null); if (categories.length === 0) setCategoriesToken((t) => t + 1); else setRetryToken((t) => t + 1); }} className="mt-2 font-semibold underline">Try again</button>
              </Alert>
            )}

            {!error && loading && (
              view === 'list'
                ? <ListingGridSkeleton count={12} className="workspace-results-grid grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4" />
                : <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <ListingCardWideSkeleton key={i} />)}</div>
            )}

            {loading ? null : view === 'list' ? (
              <>
                <div className="workspace-results-grid grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 animate-cross-fade">
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
              <div className="workspace-map-grid grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)] gap-4 animate-cross-fade">
                <div
                  ref={mapListingsRef}
                  onScroll={(event) => {
                    const scrollTop = event.currentTarget.scrollTop;
                    if (scrollTop > lastMapScrollTopRef.current) setHasUserScrolled(true);
                    lastMapScrollTopRef.current = scrollTop;
                  }}
                  className="h-[min(42rem,calc(100dvh_-_15rem))] min-h-96 overflow-y-auto overscroll-contain pr-1 space-y-3 no-scrollbar"
                >
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
                  listPreviewId={listPreviewId}
                  onPreviewChange={handleMapPreviewChange}
                  center={preciseLocation ? [location.latitude!, location.longitude!] : undefined}
                  onSwitchToList={() => setView('list')}
                />
              </div>
            )}

            {!error && !loading && routeLocationReady && !hasMore && filtered.length === 0 && (
              <><EmptyState
                icon={<SearchX size={20} />}
                title={itemRequestsFlag.enabled ? "Couldn't find what you need?" : location.source !== 'NONE' ? `No matching items near ${formatLocation(location)}` : 'Nothing matches those filters'}
                description={
                  itemRequestsFlag.enabled
                    ? 'Request an item and nearby owners can respond with listings that fit your dates and budget.'
                    : location.source !== 'NONE'
                    ? `No rentals match${maxDistance === null ? ' at any distance' : ` within ${maxDistance} miles`}. Expand the radius below, change your dates or filters, or choose another city.`
                    : activeFilterCount > 0
                    ? 'Try widening the distance or price, or clear the filters to see everything nearby.'
                    : 'Try a different word, or browse a category to see what people near you are lending.'
                }
                actionLabel={itemRequestsFlag.enabled ? 'Request an item' : location.source !== 'NONE' ? 'Browse all locations' : activeFilterCount > 0 ? 'Clear all filters' : 'Browse everything'}
                onAction={() => {
                  if (itemRequestsFlag.enabled) navigate({ name: 'need-something' });
                  else if (location.source !== 'NONE') clearLocation();
                  else { clearAllFilters(); setKeyword(''); }
                }}
              />
              <div className="mt-3 flex flex-wrap justify-center gap-3">
                {preciseLocation && maxDistance !== null && <>
                  {SEARCH_RADII.filter((miles) => miles > maxDistance).map((miles) => (
                    <Button key={miles} variant="secondary" onClick={() => setMaxDistance(miles)}>Search {miles} miles</Button>
                  ))}
                  <Button variant="secondary" onClick={() => setMaxDistance(null)}>Search Any distance</Button>
                </>}
                {itemRequestsFlag.enabled && <Button variant="secondary" onClick={() => { clearAllFilters(); setKeyword(''); }}>Continue browsing</Button>}
              </div></>
            )}
          </div>
        </div>
      </div>

      <Dialog open={mobileFiltersOpen && isMobileFilters} onOpenChange={setMobileFiltersOpen}>
        <DialogContent
          id="mobile-search-filters"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            mobileFilterTriggerRef.current?.focus();
          }}
          className="!fixed !inset-x-0 !bottom-0 !top-auto !left-0 !translate-x-0 !translate-y-0 !h-[85dvh] !w-full !max-w-none !max-h-[85dvh] !overflow-hidden !rounded-t-card-xl !rounded-b-none !p-0 !border-x-0 !border-b-0 !animate-sheet"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-app px-4 py-3 pr-14">
              <DialogTitle className="font-bold">Filters</DialogTitle>
              <DialogDescription className="sr-only">Adjust search filters. Changes are kept when you close this panel.</DialogDescription>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <FilterPanel {...filterPanelProps} />
            </div>
            <div className="shrink-0 flex gap-2 border-t border-app p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button variant="secondary" onClick={clearAllFilters}>Clear</Button>
              <Button fullWidth onClick={() => setMobileFiltersOpen(false)}>
                Show {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterPanel(props: {
  categories: Category[];
  activeCategory: string | null;
  setActiveCategory: (v: string | null) => void;
  maxPrice: number;
  setMaxPrice: (v: number) => void;
  maxDistance: SearchRadius;
  setMaxDistance: (v: SearchRadius) => void;
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
          <span className="text-sm font-semibold text-main tnum">{props.maxDistance === null ? 'Any distance' : `${props.maxDistance} mi`}</span>
        </div>
        <SearchRadiusSelect value={props.maxDistance} onChange={props.setMaxDistance} label="Max distance" />
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

function MapView({ listings, listPreviewId, onPreviewChange, center, onSwitchToList }: {
  listings: Listing[];
  listPreviewId: string | null;
  onPreviewChange?: (id: string | null) => void;
  center?: [number, number];
  onSwitchToList: () => void;
}) {
  const mapApiKey = (import.meta.env.VITE_MAP_API_KEY as string | undefined)?.trim();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef(new Map<string, import('@/lib/leaflet').LeafletMarker>());
  const markerLabelsRef = useRef(new Map<string, string>());
  const hoverClearTimer = useRef<number | null>(null);
  const onPreviewChangeRef = useRef(onPreviewChange);
  const pinnedIdRef = useRef<string | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const activeIdRef = useRef(listPreviewId ?? pinnedId ?? hoveredId);
  activeIdRef.current = listPreviewId ?? pinnedId ?? hoveredId;
  const located = useMemo(() => listings.filter((listing) =>
    Number.isFinite(listing.lat) && Number.isFinite(listing.lng)
    && Math.abs(listing.lat) <= 90 && Math.abs(listing.lng) <= 180
    && !(listing.lat === 0 && listing.lng === 0)), [listings]);
  const locationGroups = useMemo(() => {
    const groups = new Map<string, Listing[]>();
    for (const listing of located) {
      const key = `${listing.lat.toFixed(5)},${listing.lng.toFixed(5)}`;
      const group = groups.get(key);
      if (group) group.push(listing);
      else groups.set(key, [listing]);
    }
    return Array.from(groups, ([key, items]) => ({ key, items, lat: items[0].lat, lng: items[0].lng }));
  }, [located]);
  const locationGroupsRef = useRef(locationGroups);
  locationGroupsRef.current = locationGroups;
  const centerRef = useRef(center);
  centerRef.current = center;
  const groupsKey = locationGroups.map(({ key, items }) => `${key}:${items.map((item) => `${item.id},${item.pricePerDay}`).join(',')}`).join('|');
  const centerLat = center?.[0];
  const centerLng = center?.[1];

  useEffect(() => {
    onPreviewChangeRef.current = onPreviewChange;
  }, [onPreviewChange]);

  useEffect(() => {
    onPreviewChangeRef.current?.(pinnedId ?? hoveredId ?? null);
  }, [hoveredId, pinnedId]);

  useEffect(() => {
    pinnedIdRef.current = pinnedId;
  }, [pinnedId]);

  useEffect(() => {
    if (pinnedId && !listings.some((listing) => listing.id === pinnedId)) setPinnedId(null);
    if (hoveredId && !listings.some((listing) => listing.id === hoveredId)) setHoveredId(null);
  }, [listings, pinnedId, hoveredId]);

  useEffect(() => {
    const activeId = listPreviewId ?? pinnedId ?? hoveredId;
    const activeGroup = locationGroups.find((group) => group.items.some((listing) => listing.id === activeId));
    for (const [key, marker] of markersRef.current) {
      marker.getElement()?.querySelector('.ybuy-price-pin')?.classList.toggle('is-selected', key === activeGroup?.key);
    }
  }, [locationGroups, listPreviewId, hoveredId, pinnedId]);

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;

        const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: false, keyboard: true });
        mapRef.current = map;
        const tileUrl = mapApiKey
          ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(mapApiKey ?? '')}`
          : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
        const attribution = mapApiKey
          ? '&copy; OpenStreetMap contributors &copy; MapTiler'
          : '&copy; OpenStreetMap contributors &copy; CARTO';

        L.tileLayer(tileUrl, {
          attribution,
          maxZoom: 20,
        }).addTo(map);

        map.on('click', () => {
          setPinnedId(null);
          setHoveredId(null);
        });
        const initialCenter = centerRef.current ?? (locationGroupsRef.current[0]
          ? [locationGroupsRef.current[0].lat, locationGroupsRef.current[0].lng] as [number, number] : undefined);
        map.setView(initialCenter ?? [0, 0], initialCenter ? 12 : 2);
        resizeObserverRef.current = new ResizeObserver(() => map.invalidateSize());
        resizeObserverRef.current.observe(el);
        setMapReady(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (hoverClearTimer.current) {
        window.clearTimeout(hoverClearTimer.current);
        hoverClearTimer.current = null;
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [mapApiKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const L = (window as unknown as { L?: import('@/lib/leaflet').Leaflet }).L;
    if (!L) return;
    const markers = markersRef.current;
    const currentGroups = locationGroupsRef.current;
    const visibleKeys = new Set(currentGroups.map((group) => group.key));
    for (const [id, marker] of markers) {
      if (!visibleKeys.has(id)) {
        marker.remove();
        markers.delete(id);
        markerLabelsRef.current.delete(id);
      }
    }

    for (const group of currentGroups) {
      const label = group.items.length === 1 ? `$${group.items[0].pricePerDay}` : `${group.items.length} items`;
      const iconWidth = group.items.length === 1 ? 58 : 78;
      const icon = L.divIcon({
        className: 'ybuy-pin-marker',
        html: `<span class="ybuy-price-pin${group.items.length > 1 ? ' is-cluster' : ''}">${label}</span>`,
        iconSize: [iconWidth, 34],
        iconAnchor: [iconWidth / 2, 17],
      });
      const marker = markers.get(group.key);
      if (marker) {
        marker.setLatLng([group.lat, group.lng]);
        if (markerLabelsRef.current.get(group.key) !== label) {
          marker.setIcon(icon);
          marker.getElement()?.querySelector('.ybuy-price-pin')?.classList.toggle('is-selected',
            group.items.some((listing) => listing.id === activeIdRef.current));
        }
      } else {
        const firstItem = group.items[0];
        const title = group.items.length === 1
          ? `${firstItem.title}, $${firstItem.pricePerDay} per day`
          : `${group.items.length} rentals at this approximate pickup area`;
        const added = L.marker([group.lat, group.lng], {
          icon, title, alt: title, keyboard: true,
        }).addTo(map);
        markers.set(group.key, added);
        added.getElement()?.querySelector('.ybuy-price-pin')?.classList.toggle('is-selected',
          group.items.some((listing) => listing.id === activeIdRef.current));
        added
          .on('mouseover', () => {
            if (hoverClearTimer.current) {
              window.clearTimeout(hoverClearTimer.current);
              hoverClearTimer.current = null;
            }
            setHoveredId(firstItem.id);
          })
          .on('mouseout', () => {
            hoverClearTimer.current = window.setTimeout(() => {
              if (pinnedIdRef.current !== firstItem.id) {
                setHoveredId((prev) => (prev === firstItem.id ? null : prev));
              }
            }, 180);
          })
          .on('click', () => {
            setPinnedId(firstItem.id);
            setHoveredId(firstItem.id);
          });
      }
      markerLabelsRef.current.set(group.key, label);
    }

    if (currentGroups.length > 1) {
      const bounds = L.latLngBounds(currentGroups.map((group) => [group.lat, group.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [56, 56], maxZoom: 14 });
    } else if (currentGroups.length === 1) {
      map.setView([currentGroups[0].lat, currentGroups[0].lng], 13);
    } else if (centerLat !== undefined && centerLng !== undefined) {
      map.setView([centerLat, centerLng], 12);
    }
    map.invalidateSize();
  }, [mapReady, groupsKey, centerLat, centerLng]);

  function fitResults() {
    const map = mapRef.current;
    if (!map) return;
    if (locationGroups.length > 1) {
      const L = (window as unknown as { L?: import('@/lib/leaflet').Leaflet }).L;
      if (L) map.fitBounds(L.latLngBounds(locationGroups.map((group) => [group.lat, group.lng] as [number, number])), { padding: [56, 56], maxZoom: 14 });
    } else if (locationGroups.length === 1) {
      map.setView([locationGroups[0].lat, locationGroups[0].lng], 13);
    } else if (center) {
      map.setView(center, 12);
    }
  }

  if (failed) {
    return (
      <div className="h-[min(42rem,calc(100dvh_-_13rem))] min-h-80 rounded-card-lg border border-app bg-subtle flex flex-col items-center justify-center gap-2 text-center px-6">
        <MapPin size={24} className="text-accent" />
        <p className="text-sm text-sec">The map couldn’t load. Check your connection, or switch back to list view.</p>
        <Button size="sm" variant="secondary" onClick={onSwitchToList}>Switch to list</Button>
      </div>
    );
  }

  return (
    <div className="relative h-[min(42rem,calc(100dvh_-_15rem))] min-h-96 rounded-card-lg overflow-hidden border border-app bg-subtle" role="region" aria-label="Rental map">
      <div ref={containerRef} className="absolute inset-0 z-0" aria-label="Map of approximate rental pickup locations" />

      <div className="absolute top-4 left-4 flex items-center gap-2 px-3 h-9 rounded-full bg-card border border-app shadow-card text-xs font-medium text-sec z-[500]">
        <MapPin size={14} className="text-accent" />
        Approximate pickup areas
      </div>
      <div className="absolute top-4 right-4 z-[500] grid gap-2" role="group" aria-label="Map controls">
        <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in on map" title="Zoom in"
          className="grid h-10 w-10 place-items-center rounded-card border border-app bg-card text-main hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <Plus size={18} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out on map" title="Zoom out"
          className="grid h-10 w-10 place-items-center rounded-card border border-app bg-card text-main hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <Minus size={18} aria-hidden="true" />
        </button>
        <button type="button" onClick={fitResults} aria-label="Show all rental results on map" title="Show all results"
          className="grid h-10 w-10 place-items-center rounded-card border border-app bg-card text-main hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <LocateFixed size={18} aria-hidden="true" />
        </button>
      </div>
      {locationGroups.length === 0 && (
        <div className="absolute inset-x-4 bottom-4 z-[500] flex flex-wrap items-center justify-between gap-3 rounded-card-lg border border-app bg-card p-3">
          <span className="text-sm text-sec">Pickup locations aren’t available for these results.</span>
          <Button size="sm" variant="secondary" onClick={onSwitchToList}>View list</Button>
        </div>
      )}
    </div>
  );
}
