import { useState, useMemo, useEffect, useRef } from 'react';
import { SearchBar, type SearchParams } from '@/components/search';
import { ListingCard, ListingCardWide } from '@/components/listing-card';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Listing, Category } from '@/data';
import { fetchCategories, fetchCategoryCounts, searchListings, toUiCategory, toUiListing, enrichListingsWithRatings, type SearchSortBy } from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { fetchUnavailableListingIds } from '@/lib/availability';
import { CITY_CENTERS, haversineMiles, todayIso, addDaysIso } from '@/lib/geo';
import { loadLeaflet, type LeafletMap } from '@/lib/leaflet';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { ListingGridSkeleton, ListingCardWideSkeleton } from '@/components/skeleton';
import * as Icons from 'lucide-react';
import { Map as MapIcon, List, SlidersHorizontal, X, Star, Shield, Zap, CheckCircle2, Truck, MapPin } from 'lucide-react';

export function SearchPage({
  initialCategory, initialQuery, initialCoords, initialLocationLabel, initialStartDate, initialEndDate,
}: {
  initialCategory?: string; initialQuery?: string;
  initialCoords?: { lat: number; lng: number }; initialLocationLabel?: string;
  initialStartDate?: string; initialEndDate?: string;
}) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [locationLabel, setLocationLabel] = useState(initialLocationLabel ?? 'Near me');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(initialCoords ?? null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mapPreviewId, setMapPreviewId] = useState<string | null>(null);
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
  const [geoFallbackUsed, setGeoFallbackUsed] = useState(false);

  function handleSearchBarSearch(p: SearchParams) {
    setKeyword(p.keyword);
    setLocationLabel(p.locationLabel);
    if (p.coords !== undefined) setUserCoords(p.coords);
    setDateRange({ start: p.startDate, end: p.endDate });
  }

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

  // "Near me" is real: ask the browser for the user's coordinates once, then compute true
  // haversine distance below against each listing's stored lat/lng. If permission is denied or
  // unsupported, fall back to a deterministic metro center so nearby filtering still works.
  // Skipped when the user explicitly picked a named city instead — that choice shouldn't be
  // silently overwritten.
  useEffect(() => {
    const isNearbyMode = locationLabel === 'Near me' || locationLabel === 'Nearby';
    if (!isNearbyMode) return;

    if (!navigator.geolocation) {
      setUserCoords(CITY_CENTERS['Irving, TX']);
      setGeoFallbackUsed(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoFallbackUsed(false);
      },
      () => {
        setUserCoords(CITY_CENTERS['Irving, TX']);
        setGeoFallbackUsed(true);
      },
      { timeout: 5000 }
    );
  }, [locationLabel]);

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
    setLoadingMore(true);
    const nextPage = page + 1;
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
      .then((result) => {
        void enrichListingsWithRatings(result.rows.map(toUiListing)).then((enriched) => {
          setListings((prev) => [...prev, ...enriched]);
        });
        setHasMore(result.hasMore);
        setPage(nextPage);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoadingMore(false));
  }

  // Hides listings that already have a blocked date or an overlapping active booking within the
  // picked date range — scoped to the currently-loaded page of listings (see availability.ts).
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
  const listingsWithDistance = useMemo(() => {
    const locationFilteringActive = Boolean(userCoords);
    if (!locationFilteringActive) return listings;
    return listings.map((l) => {
      const hasCoords = Number.isFinite(l.lat) && Number.isFinite(l.lng) && !(l.lat === 0 && l.lng === 0);
      if (!hasCoords) return { ...l, distance: Number.POSITIVE_INFINITY };
      return { ...l, distance: Math.round(haversineMiles(userCoords!.lat, userCoords!.lng, l.lat, l.lng) * 10) / 10 };
    });
  }, [listings, userCoords]);

  // ponytail: distance/rating sorting remain client-side because distance depends on browser
  // geolocation and ratings are enriched after listing fetch; server-side fields are filtered in SQL.
  const filtered = useMemo(() => {
    let result = listingsWithDistance.filter((l) => l.distance <= maxDistance && l.rating >= minRating && !unavailableIds.has(l.id));
    if (sortBy === 'distance') result = [...result].sort((a, b) => a.distance - b.distance);
    if (sortBy === 'rating') result = [...result].sort((a, b) => b.rating - a.rating);
    return result;
  }, [listingsWithDistance, maxDistance, minRating, sortBy, unavailableIds]);

  const activeFilterCount = [activeCategory, verifiedOnly, instantOnly, protectionOnly, deliveryOnly].filter(Boolean).length
    + (maxPrice < 200 ? 1 : 0) + (maxDistance < 10 ? 1 : 0) + (minRating > 0 ? 1 : 0);


  return (
    <div className="animate-fade-in min-h-screen pb-20 md:pb-8">
      {/* Search bar */}
      <div className="sticky top-16 z-[140] bg-app/90 backdrop-blur-lg border-b border-app">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <SearchBar onSearch={handleSearchBarSearch} variant="compact" defaultValue={keyword} />
          <div className="flex items-center justify-between mt-3 gap-2">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-card-lg border border-app bg-card text-sm font-medium text-main hover:bg-subtle transition-colors shrink-0"
              >
                <SlidersHorizontal size={15} />
                Filters
                {activeFilterCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-accent text-accent-text text-[10px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="px-3 py-1.5 rounded-card-lg border border-app bg-card text-sm font-medium text-main outline-none cursor-pointer shrink-0"
              >
                <option value="recommended">Recommended</option>
                <option value="newest">Newest first</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="distance">Nearest first</option>
                <option value="rating">Top rated</option>
              </select>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-card-lg bg-subtle border border-app shrink-0">
              <button
                onClick={() => setView('list')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-card text-xs font-medium transition-colors ${view === 'list' ? 'bg-card text-main shadow-sm' : 'text-sec'}`}
              >
                <List size={14} /> List
              </button>
              <button
                onClick={() => setView('map')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-card text-xs font-medium transition-colors ${view === 'map' ? 'bg-card text-main shadow-sm' : 'text-sec'}`}
              >
                <MapIcon size={14} /> Map
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex gap-6">
          {/* Filters sidebar */}
          {showFilters && (
            <aside className="hidden lg:block w-64 shrink-0">
              <FilterPanel
                categories={categories}
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                maxPrice={maxPrice}
                setMaxPrice={setMaxPrice}
                maxDistance={maxDistance}
                setMaxDistance={setMaxDistance}
                minRating={minRating}
                setMinRating={setMinRating}
                verifiedOnly={verifiedOnly}
                setVerifiedOnly={setVerifiedOnly}
                instantOnly={instantOnly}
                setInstantOnly={setInstantOnly}
                protectionOnly={protectionOnly}
                setProtectionOnly={setProtectionOnly}
                deliveryOnly={deliveryOnly}
                setDeliveryOnly={setDeliveryOnly}
              />
            </aside>
          )}

          {/* Results */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-sec">
                <span className="font-semibold text-main">{filtered.length}</span> of {total} items
              </p>
              {geoFallbackUsed && (
                <p className="text-xs text-warning">Using Irving area as fallback for Nearby.</p>
              )}
            </div>

            {error && <p className="text-sm text-error">{error}</p>}
            {!error && loading && (
              view === 'list'
                ? <ListingGridSkeleton count={9} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4" />
                : <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <ListingCardWideSkeleton key={i} />)}</div>
            )}

            {loading ? null : view === 'list' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 stagger animate-cross-fade">
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
            ) : (
              <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-4 animate-cross-fade">
                <div className="h-[600px] overflow-y-auto pr-1 space-y-3 no-scrollbar">
                  {filtered.map((listing) => (
                    <div
                      key={listing.id}
                      className={`rounded-card-xl transition-shadow ${mapPreviewId === listing.id ? 'ring-2 ring-accent/40 shadow-hover' : ''}`}
                    >
                      <ListingCardWide
                        listing={listing}
                        onClick={() => navigate({ name: 'listing', id: listing.id })}
                        favorited={favoriteIds.has(listing.id)}
                        onToggleFavorite={() => void handleToggleFavorite(listing.id)}
                      />
                    </div>
                  ))}
                </div>
                <MapView
                  listings={filtered}
                  onSelect={(id) => navigate({ name: 'listing', id })}
                  onPreviewChange={setMapPreviewId}
                />
              </div>
            )}

            {!loading && view === 'list' && hasMore && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-5 py-2.5 rounded-card-lg border border-app bg-card text-sm font-medium text-main hover:bg-subtle transition-colors disabled:opacity-60"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="text-center py-20">
                <p className="text-sec text-lg">No items match your filters.</p>
                <button
                  onClick={() => {
                    setKeyword(''); setActiveCategory(null); setMaxPrice(200); setMaxDistance(10); setMinRating(0);
                    setVerifiedOnly(false); setInstantOnly(false); setProtectionOnly(false); setDeliveryOnly(false);
                  }}
                  className="mt-4 text-accent font-medium text-sm hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {showFilters && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setShowFilters(false)} />
          <div className="relative ml-auto w-80 max-w-[85vw] bg-card h-full overflow-y-auto animate-modal p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-main text-lg">Filters</h3>
              <button onClick={() => setShowFilters(false)} className="p-1.5 rounded-card-lg hover:bg-subtle">
                <X size={20} className="text-main" />
              </button>
            </div>
            <FilterPanel
              categories={categories}
              activeCategory={activeCategory}
              setActiveCategory={setActiveCategory}
              maxPrice={maxPrice}
              setMaxPrice={setMaxPrice}
              maxDistance={maxDistance}
              setMaxDistance={setMaxDistance}
              minRating={minRating}
              setMinRating={setMinRating}
              verifiedOnly={verifiedOnly}
              setVerifiedOnly={setVerifiedOnly}
              instantOnly={instantOnly}
              setInstantOnly={setInstantOnly}
              protectionOnly={protectionOnly}
              setProtectionOnly={setProtectionOnly}
              deliveryOnly={deliveryOnly}
              setDeliveryOnly={setDeliveryOnly}
            />
          </div>
        </div>
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
    <div className="space-y-6">
      <div>
        <h4 className="font-semibold text-sm text-main mb-2">Category</h4>
        <div className="space-y-1">
          <button
            onClick={() => props.setActiveCategory(null)}
            className={`w-full text-left px-3 py-1.5 rounded-card text-sm transition-colors ${!props.activeCategory ? 'bg-accent-soft text-accent font-medium' : 'text-sec hover:bg-subtle'}`}
          >
            All categories
          </button>
          {props.categories.map((cat) => {
            const Icon = (Icons as unknown as Record<string, typeof Icons.Camera>)[cat.icon] ?? Icons.Box;
            return (
              <button
                key={cat.id}
                onClick={() => props.setActiveCategory(props.activeCategory === cat.id ? null : cat.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-card text-sm transition-colors ${props.activeCategory === cat.id ? 'bg-accent-soft text-accent font-medium' : 'text-sec hover:bg-subtle'}`}
              >
                <Icon size={15} />
                {cat.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-sm text-main mb-2">Max price per day</h4>
        <input type="range" min="10" max="200" step="5" value={props.maxPrice} onChange={(e) => props.setMaxPrice(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
        <div className="flex justify-between text-xs text-sec mt-1">
          <span>$10</span>
          <span className="font-semibold text-main">${props.maxPrice}</span>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-sm text-main mb-2">Max distance</h4>
        <input type="range" min="1" max="10" step="0.5" value={props.maxDistance} onChange={(e) => props.setMaxDistance(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
        <div className="flex justify-between text-xs text-sec mt-1">
          <span>1 mi</span>
          <span className="font-semibold text-main">{props.maxDistance} mi</span>
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-sm text-main mb-2">Minimum rating</h4>
        <div className="flex gap-2">
          {[0, 4.0, 4.5, 4.8].map((r) => (
            <button
              key={r}
              onClick={() => props.setMinRating(r)}
              className={`flex-1 py-1.5 rounded-card text-xs font-medium border transition-colors ${props.minRating === r ? 'border-accent text-accent bg-accent-soft' : 'border-app text-sec hover:bg-subtle'}`}
            >
              {r === 0 ? 'Any' : `${r}+`}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        <h4 className="font-semibold text-sm text-main mb-1">Features</h4>
        <FilterToggle label="Verified owner" icon={Shield} checked={props.verifiedOnly} onChange={props.setVerifiedOnly} />
        <FilterToggle label="Instant booking" icon={Zap} checked={props.instantOnly} onChange={props.setInstantOnly} />
        {SHOW_OUT_OF_SCOPE_PAGES && (
          <FilterToggle label="Rental protection" icon={CheckCircle2} checked={props.protectionOnly} onChange={props.setProtectionOnly} />
        )}
        <FilterToggle label="Delivery available" icon={Truck} checked={props.deliveryOnly} onChange={props.setDeliveryOnly} />
      </div>
    </div>
  );
}

function FilterToggle({ label, icon: Icon, checked, onChange }: { label: string; icon: typeof Shield; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between px-3 py-2 rounded-card-lg border border-app hover:bg-subtle transition-colors"
    >
      <span className="flex items-center gap-2 text-sm text-sec">
        <Icon size={15} />
        {label}
      </span>
      <span className={`w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-accent' : 'bg-border-strong'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-card transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

function MapView({ listings, onSelect, onPreviewChange }: {
  listings: typeof import('@/data').listings;
  onSelect: (id: string) => void;
  onPreviewChange?: (id: string | null) => void;
}) {
  const mapApiKey = (import.meta.env.VITE_MAP_API_KEY as string | undefined)?.trim();
  const useMapTiler = Boolean(mapApiKey);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [cardHovered, setCardHovered] = useState(false);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const hoverClearTimer = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  const pinnedIdRef = useRef<string | null>(null);
  const cardHoveredRef = useRef(false);
  const located = useMemo(() => listings.filter((l) => l.lat && l.lng), [listings]);
  const previewListing = listings.find((l) => l.id === (hoveredId ?? pinnedId));

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
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;

        // Reset any prior instance (e.g. when the filtered set changes) before re-rendering.
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

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
          L.marker([listing.lat, listing.lng], { icon })
            .addTo(map)
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
          map.setView([32.81, -96.94], 11); // Dallas-area fallback when nothing is geocoded
        }
        setTimeout(() => mapRef.current?.invalidateSize(), 0);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (hoverClearTimer.current) {
        window.clearTimeout(hoverClearTimer.current);
        hoverClearTimer.current = null;
      }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [located]);

  if (failed) {
    return (
      <div className="h-[600px] rounded-card-xl border border-app bg-subtle flex flex-col items-center justify-center gap-2 text-center px-6">
        <MapPin size={24} className="text-accent" />
        <p className="text-sm text-sec">Map couldn't load. Check your connection and try again.</p>
      </div>
    );
  }

  return (
    <div className="relative h-[600px] rounded-card-xl overflow-hidden border border-app bg-subtle">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-black/10 z-[350]" />

      {/* Hover/click preview */}
      {previewListing && (
        <div
          className="absolute bottom-4 left-4 right-4 max-w-sm mx-auto bg-card rounded-card-xl border border-app shadow-hover p-3 animate-fade-up z-[500]"
          onMouseEnter={() => setCardHovered(true)}
          onMouseLeave={() => {
            setCardHovered(false);
            if (!pinnedId) setHoveredId(null);
          }}
        >
          <div className="flex gap-3">
            <img src={previewListing.images[0]} alt="" className="w-20 h-20 rounded-card-lg object-cover" />
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm text-main line-clamp-1">{previewListing.title}</h4>
              <div className="flex items-center gap-1 text-xs text-sec mt-1">
                <Star size={12} className="fill-[var(--star)] text-[var(--star)]" />
                {previewListing.rating}
                {previewListing.distance > 0 && <span>· {previewListing.distance} mi</span>}
              </div>
              <div className="flex items-baseline gap-0.5 mt-1">
                <span className="font-bold text-main">${previewListing.pricePerDay}</span>
                <span className="text-xs text-sec">/day</span>
              </div>
            </div>
            <div className="self-center flex flex-col items-end gap-1">
              <button
                onClick={() => onSelectRef.current(previewListing.id)}
                className="px-3 py-2 rounded-card-lg bg-accent text-accent-text text-xs font-semibold"
              >
                View
              </button>
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

      <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-card-lg bg-card border border-app shadow-card text-xs text-sec z-[500]">
        <MapPin size={14} className="text-accent" />
        Approximate locations shown until booking
      </div>
    </div>
  );
}

