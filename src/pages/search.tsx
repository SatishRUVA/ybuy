import { useState, useMemo, useEffect, useRef } from 'react';
import { SearchBar, SearchRadiusSelect, type SearchParams } from '@/components/search';
import { ListingCard, ListingCardWide, ListingPhoto } from '@/components/listing-card';
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
import { ListingGridSkeleton, ListingCardWideSkeleton } from '@/components/skeleton';
import { Button, Alert, EmptyState } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/shadcn/dialog';
import { Dropdown } from '@/components/shadcn/select';
import { Map as MapIcon, List, LayoutGrid, SlidersHorizontal, X, Star, Shield, Zap, CheckCircle2, Truck, MapPin, SearchX, Loader2, PackagePlus } from 'lucide-react';
import { SEARCH_RADII, searchStateParams, saveSearchState, type SearchState, type SearchRadius } from '@/lib/search-state';
import './marketplace.css';

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
  const [view, setView] = useState<'grid' | 'list' | 'map'>('grid');
  const [showFilters, setShowFilters] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isMobileFilters, setIsMobileFilters] = useState(() => window.matchMedia('(max-width: 800px)').matches);
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
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [favoriteRetry, setFavoriteRetry] = useState(0);
  const [favoriteWrites, setFavoriteWrites] = useState<Set<string>>(new Set());
  const preciseLocation = location.source !== 'NONE'
    && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
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
    if (!categoriesLoaded || !routeLocationReady || window.location.pathname !== '/search') return;
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
  }, [categoriesLoaded, routeLocationReady, keyword, activeCategory, dateRange.start, dateRange.end, maxDistance, maxPrice, minRating, verifiedOnly, instantOnly, protectionOnly, deliveryOnly, sortBy, location, preciseLocation]);

  useEffect(() => {
    let active = true;
    setFavoriteIds(new Set()); setFavoriteError(null); setFavoritesLoaded(false);
    if (user) void fetchFavoriteListingIds(user.id).then((ids) => {
      if (active) { setFavoriteIds(ids); setFavoritesLoaded(true); }
    }).catch((reason: unknown) => {
      if (active) setFavoriteError(reason instanceof Error ? reason.message : 'Could not load saved items. Try again.');
    });
    return () => { active = false; };
  }, [user, favoriteRetry]);

  async function handleToggleFavorite(listingId: string) {
    if (!user) { openSignIn(); return; }
    if (!favoritesLoaded || favoriteWrites.has(listingId)) return;
    const isFav = favoriteIds.has(listingId);
    setFavoriteWrites(previous => new Set(previous).add(listingId));
    setFavoriteError(null);
    try {
      if (isFav) await removeFavorite(user.id, listingId); else await addFavorite(user.id, listingId);
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.delete(listingId); else next.add(listingId);
        return next;
      });
    } catch (reason) {
      setFavoriteError(reason instanceof Error ? reason.message : 'Could not update saved items. Try again.');
    } finally {
      setFavoriteWrites(previous => { const next = new Set(previous); next.delete(listingId); return next; });
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
          .catch((reason: unknown) => { console.warn('Category counts could not be loaded.', reason); });
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
  }, [categoriesLoaded, routeLocationReady, retryToken, keyword, activeCategory, maxPrice, verifiedOnly, instantOnly, protectionOnly, deliveryOnly, serverSortBy, preciseLocation, location.latitude, location.longitude, maxDistance, dateRange.start, dateRange.end]);

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

  const resultToolbar = (
          <div className="p1-results-toolbar flex-wrap">
            <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
              <button
                ref={mobileFilterTriggerRef}
                onClick={() => {
                  const mobile = window.matchMedia('(max-width: 800px)').matches;
                  setIsMobileFilters(mobile);
                  if (mobile) setMobileFiltersOpen(true);
                  else setShowFilters(value => !value);
                }}
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
              <Dropdown
                id="sort-by"
                value={sortBy}
                onChange={setSortBy}
                className="!w-auto shrink-0 h-9 rounded-full text-sm font-semibold"
                options={[
                  { value: 'recommended', label: 'Recommended' },
                  { value: 'newest', label: 'Newest' },
                  { value: 'price-low', label: 'Lowest price' },
                  { value: 'price-high', label: 'Highest price' },
                  ...(preciseLocation ? [{ value: 'distance' as const, label: 'Nearest first' }] : []),
                  { value: 'rating', label: 'Top rated' },
                ]}
              />
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
            <div className="p1-tabs p1-view-tabs shrink-0" role="group" aria-label="Result view">
              {([['grid', LayoutGrid, 'Grid'], ['list', List, 'List'], ['map', MapIcon, 'Map']] as const).map(([value, Icon, label]) => (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  aria-pressed={view === value}
                  aria-label={`${label} view`}
                  title={`${label} view`}
                >
                  <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
  );

  return (
    <div className="marketplace-search">
      <div className="p1-container p1-page">
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
        <header className="p1-page-head marketplace-search-heading">
          <div><h2 className="marketplace-search-title">
            {keyword ? `Find "${keyword}" nearby` : location.source !== 'NONE' ? `Good gear near ${location.city}` : 'Find your next thing'}
          </h2>
          <p className="mt-2 text-sm text-sec">{dateRange.start && dateRange.end
            ? `Rentals for ${dateRange.start} through ${dateRange.end}. Return on the last date.`
            : 'Add dates to find gear that fits your plans. Get to know the owner before booking.'}</p></div>
        </header>
        <div className={showFilters && !isMobileFilters ? 'p1-browse-layout' : ''}>
          {/* Filters sidebar */}
          {showFilters && !isMobileFilters && (
            <aside id="desktop-search-filters" aria-label="Refine your search" className="p1-filters">
              <div className="p1-filter-body">
                <div className="p1-section-head"><h3>Refine your search</h3>
                  <button onClick={clearAllFilters} className="p1-text-link">Reset</button></div>
                <FilterPanel {...filterPanelProps} />
              </div>
            </aside>
          )}

          {/* Results */}
          <div className="p1-results min-w-0">
            {resultToolbar}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 mb-4">
              <h1 className="marketplace-result-count" aria-live="polite" aria-atomic="true">
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
            {favoriteError && <Alert tone="error" className="mb-4">{favoriteError}
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setFavoriteRetry(value => value + 1)}>Reload saved items</Button></Alert>}
            {error && (
              <Alert tone="error" title="We couldn't load these items" className="mb-4">
                <p>{error}</p>
                <button type="button" onClick={() => { setError(null); if (categories.length === 0) setCategoriesToken((t) => t + 1); else setRetryToken((t) => t + 1); }} className="mt-2 font-semibold underline">Try again</button>
              </Alert>
            )}

            {!error && loading && (
              view !== 'map'
                ? <ListingGridSkeleton count={12} className="p1-item-grid p1-results-grid" />
                : <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <ListingCardWideSkeleton key={i} />)}</div>
            )}

            {loading ? null : view !== 'map' ? (
              <>
                <div className={`p1-item-grid p1-results-grid ${view === 'list' ? 'p1-list-view marketplace-results-list' : 'marketplace-results-grid'}`}>
                  {filtered.map((listing) => {
                    const Card = view === 'list' ? ListingCardWide : ListingCard;
                    return <Card
                      key={listing.id}
                      listing={listing}
                      onClick={() => navigate({ name: 'listing', id: listing.id })}
                      favorited={favoriteIds.has(listing.id)}
                      favoriteBusy={favoriteWrites.has(listing.id) || (!!user && !favoritesLoaded)}
                      onToggleFavorite={() => void handleToggleFavorite(listing.id)}
                    />;
                  })}
                </div>
                {hasMore && <div ref={loadMoreSentinelRef} className="flex h-12 items-center justify-center mt-5" aria-live="polite">
                  {loadingMore && <span className="flex items-center gap-2 text-sm text-sec" role="status"><Loader2 size={16} className="animate-spin" />Loading more rentals</span>}
                </div>}
              </>
            ) : (
              <div className="grid xl:grid-cols-[380px_minmax(0,1fr)] gap-3 animate-cross-fade">
                <div
                  ref={mapListingsRef}
                  onScroll={(event) => {
                    const scrollTop = event.currentTarget.scrollTop;
                    if (scrollTop > lastMapScrollTopRef.current) setHasUserScrolled(true);
                    lastMapScrollTopRef.current = scrollTop;
                  }}
                  className="h-[min(42rem,calc(100dvh_-_13rem))] min-h-80 overflow-y-auto overscroll-contain pr-1 space-y-2 no-scrollbar"
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
                        favoriteBusy={favoriteWrites.has(listing.id) || (!!user && !favoritesLoaded)}
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
    <div className="p1-filter-body">
      <div className="p1-field">
        <label htmlFor="filter-category">Category</label>
        <Dropdown id="filter-category" aria-label="Category" value={props.activeCategory ?? 'all'} onChange={value => props.setActiveCategory(value === 'all' ? null : value)}
          options={[{ value: 'all', label: 'All categories' }, ...props.categories.map(category => ({ value: category.id, label: `${category.name} (${category.count.toLocaleString()})` }))]} />
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
              aria-pressed={props.minRating === r}
              className={`min-h-11 rounded-card text-xs font-semibold border transition-colors duration-fast ${props.minRating === r ? 'border-accent text-accent bg-accent-soft' : 'border-app text-sec hover:bg-subtle'}`}
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
            <div className="w-16 h-16 rounded-card overflow-hidden shrink-0"><ListingPhoto src={previewListing.images[0]} alt="" /></div>
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
