import { useEffect, useRef, useState } from 'react';
import type { Category, Listing } from '@/data';
import { useAuth } from '@/auth-context';
import { useRouter, type Route } from '@/router';
import { fetchCategories, fetchListingById, searchListings, toUiCategory, toUiListing, type DbCategory } from '@/lib/listings';
import { addFavorite, fetchFavoriteListingIds, fetchFavoriteListings, removeFavorite } from '@/lib/favorites';
import { fetchUnavailableDates } from '@/lib/availability';
import { fetchOwnerRatings, fetchReviewsForUser } from '@/lib/reviews';
import { getOrCreateConversation } from '@/lib/messages';
import { haversineMiles } from '@/lib/geo';
import { LISTING_SCHEDULING_DAYS, RENTAL_MAX_DAYS } from '@/lib/listing-availability';
import { savedSearchState, saveSearchState } from '@/lib/search-state';
import { usePlatformFeePct } from '@/lib/settings';
import { calculateRentalPricing, validRentalRange } from '@/lib/rental-pricing';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { useUtcDay } from '@/lib/use-utc-day';
import { createBookingRequest } from '@/lib/bookings';
import { createCheckoutSession } from '@/lib/payments';
import { insuranceAmountCents } from '@/lib/insurance-pricing';
import { bookingTaxCents } from '@/lib/booking-tax';
import { Checkout } from '@/preview-1/renting';
import { Browse, Details, Favorites, Home } from '@/preview-1/marketplace';
import { MarketplaceProvider, type MarketplaceStore } from '@/preview-1/marketplace-context';
import { href, type PageName } from '@/preview-1/state';
import { addDays, CITIES, eachDay, todayIso, type Avail } from '@/preview/dates';
import { DEFAULT_SEARCH, type SearchState } from '@/preview/ctx';

function categoryId(name: string, categories: DbCategory[]): string | undefined {
  if (name === 'All') return undefined;
  const aliases: Record<string, string> = {
    Cameras: 'Electronics', Camping: 'Outdoor & Camping', Tools: 'Tools & Equipment', Party: 'Party & Events',
  };
  const wanted = (aliases[name] ?? name).toLowerCase();
  const category = categories.find((row) => row.id === name || row.name.toLowerCase() === wanted);
  if (!category) throw new Error('That category is not available. Clear the category filter and try again.');
  return category.id;
}

function restoredSearch(route: Route): SearchState {
  const saved = savedSearchState();
  const state = route.name === 'search' && window.location.search ? { ...saved, ...route } : saved;
  return {
    ...DEFAULT_SEARCH, q: state.q, cat: state.category ?? 'All',
    loc: route.name === 'search' ? route.locationLabel ?? DEFAULT_SEARCH.loc : DEFAULT_SEARCH.loc,
    start: route.name === 'checkout' ? route.startDate ?? '' : state.start,
    end: route.name === 'checkout' ? route.endDate ?? '' : state.end, radius: state.radius, instant: state.instantOnly,
    maxPrice: state.maxPrice, sort: state.sortBy === 'price-low' ? 'price' : state.sortBy === 'distance' || state.sortBy === 'rating' ? state.sortBy : 'recommended',
  };
}

export function PreviewMarketplace() {
  const utcDay = useUtcDay();
  const { route, navigate } = useRouter();
  const { user, openSignIn } = useAuth();
  const feePct = usePlatformFeePct();
  const discounts = useFeatureFlag('duration_discounts');
  const [search, updateSearch] = useState(() => restoredSearch(route));
  const searchRef = useRef(search);
  const [items, setItems] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Record<string, Avail>>({});
  const [locked, setLocked] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const favoriteInFlight = useRef(new Set<string>());
  const initialCoords = useRef(route.name === 'search' && route.lat !== undefined && route.lng !== undefined
    ? { lat: route.lat, lng: route.lng, loc: route.locationLabel ?? DEFAULT_SEARCH.loc } : null);

  const coords = initialCoords.current?.loc === search.loc ? initialCoords.current : CITIES[search.loc];
  const userId = user?.id;
  const verifiedOnly = route.name === 'search' && route.verifiedOnly;
  const deliveryOnly = route.name === 'search' && route.deliveryOnly;
  const protectionOnly = route.name === 'search' && route.protectionOnly;
  const listingId = route.name === 'listing' || route.name === 'checkout' ? route.id : undefined;
  const routeName = route.name;
  const catalogSearch = routeName === 'home' || routeName === 'search' ? search : null;
  const catalogCoords = catalogSearch ? coords : null;
  useEffect(() => setPage(0), [utcDay]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    if (page === 0) setItems([]);
    async function load() {
      const dbCategories = await fetchCategories();
      if (!active) return;
      setCategories(dbCategories.map((row) => toUiCategory(row, new Map())));
      let listings: Listing[];
      let nextTotal = 0;
      let more = false;
      if ((routeName === 'listing' || routeName === 'checkout') && listingId) {
        const row = await fetchListingById(listingId);
        listings = row ? [toUiListing(row)] : [];
        if (row) {
          const [dates, reviews] = await Promise.all([fetchUnavailableDates(listingId), fetchReviewsForUser(row.owner_id)]);
          listings[0] = { ...listings[0], ...reviews, owner: { ...listings[0].owner, rating: reviews.rating, rentals: reviews.reviewCount, missedAuctionDecisionCount: reviews.missedDecisionCount } };
          if (active) {
            setAvailability({ [listingId]: {
              start: row.availability_start ?? todayIso(), end: row.availability_end ?? addDays(todayIso(), LISTING_SCHEDULING_DAYS),
              blocked: [...dates.blocked],
            } });
            setLocked({ [listingId]: [...dates.booked] });
          }
        }
      } else if (routeName === 'favorites') {
        listings = userId ? (await fetchFavoriteListings(userId)).map(toUiListing) : [];
      } else {
        if (!catalogCoords || !catalogSearch) throw new Error('Choose a supported search location before searching nearby.');
        const result = await searchListings({
          latitude: catalogCoords.lat, longitude: catalogCoords.lng, radiusMiles: catalogSearch.radius,
          keyword: routeName === 'home' ? undefined : catalogSearch.q,
          categoryId: routeName === 'home' ? undefined : categoryId(catalogSearch.cat, dbCategories),
          startDate: routeName === 'home' ? undefined : catalogSearch.start,
          endDate: routeName === 'home' ? undefined : catalogSearch.end,
          maxPrice: routeName === 'home' ? undefined : catalogSearch.maxPrice,
          instantOnly: routeName !== 'home' && catalogSearch.instant,
          verifiedOnly, deliveryOnly, protectionOnly,
          sortBy: catalogSearch.sort === 'price' ? 'price-low' : catalogSearch.sort === 'distance' ? 'distance' : 'recommended',
          page: routeName === 'home' ? 0 : page, pageSize: 24,
        });
        listings = result.rows.map(toUiListing);
        nextTotal = result.total; more = result.hasMore;
      }
      if (routeName !== 'listing' && routeName !== 'checkout') {
        const ratings = await fetchOwnerRatings(listings.map((item) => item.owner.id));
        listings = listings.map((item) => {
          const rating = ratings.get(item.owner.id);
          return rating ? { ...item, rating: rating.rating, reviewCount: rating.count, owner: { ...item.owner, rating: rating.rating, rentals: rating.count, missedAuctionDecisionCount: rating.missedDecisionCount } } : item;
        });
        if (catalogSearch?.sort === 'rating') listings.sort((a, b) => b.rating - a.rating);
      }
      if (!active) return;
      setItems((current) => page > 0 && routeName === 'search'
        ? [...new Map([...current, ...listings].map((item) => [item.id, item])).values()] : listings);
      setTotal(nextTotal || listings.length); setHasMore(more); setLoading(false);
    }
    void load().catch((reason: unknown) => {
      if (active) { setError(reason instanceof Error ? reason.message : 'Could not load rentals. Please try again.'); setLoading(false); }
    });
    return () => { active = false; };
  }, [catalogSearch, catalogCoords, routeName, listingId, userId, page, refresh, verifiedOnly, deliveryOnly, protectionOnly, utcDay]);

  useEffect(() => {
    let active = true;
    setSaved([]);
    if (userId) void fetchFavoriteListingIds(userId).then((ids) => { if (active) setSaved([...ids]); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load saved rentals.'); });
    return () => { active = false; };
  }, [userId, refresh]);

  function setSearch(patch: Partial<SearchState>) {
    const next = { ...searchRef.current, ...patch };
    searchRef.current = next; updateSearch(next); setPage(0);
    saveSearchState({
      ...savedSearchState(), q: next.q, category: next.cat === 'All' ? undefined : next.cat,
      start: next.start, end: next.end, radius: next.radius, maxPrice: next.maxPrice,
      instantOnly: next.instant, sortBy: next.sort === 'price' ? 'price-low' : next.sort,
    });
  }

  function go(name: PageName, id?: string) {
    const current = searchRef.current;
    if (name === 'search') {
      const position = initialCoords.current?.loc === current.loc ? initialCoords.current : CITIES[current.loc];
      navigate({ ...savedSearchState(), name: 'search', locationLabel: current.loc, lat: position?.lat, lng: position?.lng });
    } else if (name === 'checkout' && id) {
      navigate({ name: 'checkout', id, startDate: current.start, endDate: current.end });
    } else if (name === 'confirmation' && id) {
      navigate({ name: 'confirmation', id });
    } else window.location.assign(href(name, id));
  }

  function toggleSaved(id: string) {
    if (!user) { openSignIn(); return; }
    if (favoriteInFlight.current.has(id)) return;
    favoriteInFlight.current.add(id);
    const removing = saved.includes(id);
    void (removing ? removeFavorite(user.id, id) : addFavorite(user.id, id)).then(() => {
      setSaved((current) => removing ? current.filter((value) => value !== id) : [...new Set([...current, id])]);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not save this rental. Try again.'))
      .finally(() => favoriteInFlight.current.delete(id));
  }

  function availableRange(id: string, start: string, end: string) {
    const window = availability[id];
    return Boolean(window && validRentalRange(start, end) && start >= todayIso() && start >= window.start
      && end <= window.end
      && Math.round((Date.parse(end) - Date.parse(start)) / 86400000) <= RENTAL_MAX_DAYS
      && eachDay(start, addDays(end, -1)).every((date) => !window.blocked.includes(date) && !locked[id]?.includes(date)));
  }
  const value: MarketplaceStore = {
    production: true, items, categories, search, setSearch, saved, toggleSaved,
    availFor: (id) => availability[id] ?? { start: '', end: '', blocked: [] },
    blockedFor: (id) => new Set([...(availability[id]?.blocked ?? []), ...(locked[id] ?? [])]),
    availableRange,
    firstRange: (id, length = 2) => {
      const window = availability[id];
      if (window) for (let date = window.start > todayIso() ? window.start : todayIso(); date <= window.end; date = addDays(date, 1)) {
        const end = addDays(date, length);
        if (availableRange(id, date, end)) return { start: date, end };
      }
      return { start: '', end: '' };
    },
    navigate: go,
    checkout: {
      create: async (params) => {
        if (!user) throw new Error('Sign in before requesting a rental.');
        const booking = await createBookingRequest({ ...params, quantity: route.name === 'checkout' ? route.quantity : undefined });
        return { id: booking.id, paymentRequired: booking.status === 'pending_payment',
          taxAmount: Number(booking.tax_amount ?? 0), sandboxTax: booking.sandbox_tax === true,
          deposit: Number(booking.deposit),
          rentalTotal: Number(booking.total) - (booking.deposit_collection_model === 'authorization' ? 0 : Number(booking.deposit)),
          total: Number(booking.total) };
      },
      pay: async (id) => { window.location.assign(await createCheckoutSession(id)); },
    },
    contact: (item) => {
      if (!user) { openSignIn(); return; }
      void getOrCreateConversation({ currentUserId: user.id, otherUserId: item.owner.id, listingId: item.id })
        .then((id) => navigate({ name: 'conversation', id }))
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not open messages. Try again.'));
    },
    distance: (item) => coords ? Math.round(haversineMiles(coords.lat, coords.lng, item.lat, item.lng) * 10) / 10 : item.distance,
    rentalQuote: (item, days) => {
      const pricing = calculateRentalPricing(item.pricePerDay, days, {
        weeklyEnabled: discounts.enabled && item.weeklyDiscountEnabled, weeklyPercent: item.weeklyDiscountPercent,
        monthlyEnabled: discounts.enabled && item.monthlyDiscountEnabled, monthlyPercent: item.monthlyDiscountPercent,
      });
      if (!days) return { rental: 0, fee: 0, insurance: 0, tax: import.meta.env.VITE_TEST_ENVIRONMENT === 'true' ? 0 : undefined };
      const rental = pricing.subtotal;
      const fee = Math.round(rental * feePct * 100) / 100;
      return { rental, fee, tax: bookingTaxCents(rental, fee) / 100,
        insurance: insuranceAmountCents(item.declaredValue, days) / 100 };
    },
    loading, error, retry: () => setRefresh((current) => current + 1), total, hasMore,
    loadMore: () => setPage((current) => current + 1),
  };
  return <MarketplaceProvider value={value}>
    {routeName === 'home' ? <Home /> : routeName === 'search' ? <Browse /> : routeName === 'checkout' && listingId
      ? loading || error ? <main className="p1-container p1-page"><p role={error ? 'alert' : 'status'}>{error ?? 'Loading rental…'}</p>{error && <button className="p1-button p1-button-secondary" onClick={value.retry}>Try again</button>}</main>
        : route.name === 'checkout' && !validRentalRange(route.startDate ?? '', route.endDate ?? '') ? <main className="p1-container p1-page"><h1>Choose your dates first</h1><a className="p1-button p1-button-secondary" href={href('listing', listingId)}>Back to item</a></main> : <Checkout id={listingId} />
      : routeName === 'listing' && listingId ? <Details id={listingId} /> : <Favorites />}
  </MarketplaceProvider>;
}
