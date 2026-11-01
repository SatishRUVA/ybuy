import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarCheck, Check, ChevronRight, Search, Tent } from 'lucide-react';
import { SearchBar } from '@/components/search';
import { ListingCard, ListingPhoto } from '@/components/listing-card';
import { Button, SectionHeader, EmptyState, Alert } from '@/components/ui';
import { ListingGridSkeleton } from '@/components/skeleton';
import { CategoryIcon } from '@/components/category-icon';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Listing, Category } from '@/data';
import { fetchCategories, searchListings, toUiCategory, toUiListing, enrichListingsWithRatings } from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { haversineMiles, locationLabel } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { savedSearchState } from '@/lib/search-state';
import './home.css';

const POOL_SIZE = 24;
const SHELF_SIZE = 4;

export function HomePage() {
  const { navigate } = useRouter();
  const { user, openSignIn } = useAuth();
  const { location } = useMarketplaceLocation();
  const [pool, setPool] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [savingFavorites, setSavingFavorites] = useState<Set<string>>(new Set());
  const [retryToken, setRetryToken] = useState(0);
  const [searchDraft] = useState(savedSearchState);

  useEffect(() => {
    let active = true;
    setFavoriteIds(new Set());
    setFavoriteError(null);
    setFavoritesLoaded(false);
    if (user) void fetchFavoriteListingIds(user.id).then((ids) => {
      if (active) { setFavoriteIds(ids); setFavoritesLoaded(true); }
    }).catch((reason: unknown) => {
      if (active) setFavoriteError(reason instanceof Error ? reason.message : 'Could not load saved items. Reload to retry.');
    });
    return () => { active = false; };
  }, [user, retryToken]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    setPool([]); setCategories([]);
    void Promise.all([fetchCategories(), searchListings({
      sortBy: 'recommended', pageSize: POOL_SIZE,
      latitude: location.source === 'NONE' ? undefined : location.latitude,
      longitude: location.source === 'NONE' ? undefined : location.longitude,
      radiusMiles: searchDraft.radius,
    })])
      .then(async ([catRows, result]) => {
        if (!active) return;
        setCategories(catRows.map((category) => toUiCategory(category, new Map())));
        const rows = result.rows.map(toUiListing);
        setPool(rows);
        setLoading(false);
        const rated = await enrichListingsWithRatings(rows);
        if (active) setPool(rated);
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load listings.');
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retryToken, location.source, location.latitude, location.longitude, searchDraft.radius]);

  async function toggleFavorite(id: string) {
    if (!user) { openSignIn(); return; }
    if (!favoritesLoaded || savingFavorites.has(id)) return;
    setSavingFavorites((previous) => new Set(previous).add(id));
    setFavoriteError(null);
    const wasSaved = favoriteIds.has(id);
    try {
      if (wasSaved) await removeFavorite(user.id, id); else await addFavorite(user.id, id);
      setFavoriteIds((previous) => {
        const next = new Set(previous);
        if (wasSaved) next.delete(id); else next.add(id);
        return next;
      });
    } catch (reason) {
      setFavoriteError(reason instanceof Error ? reason.message : 'Could not save this item. Try again.');
    } finally {
      setSavingFavorites((previous) => { const next = new Set(previous); next.delete(id); return next; });
    }
  }

  const inventory = useMemo(() => pool.filter((listing) => listing.listingStatus === 'published').map((listing) => {
    if (location.source === 'NONE' || location.latitude === undefined || location.longitude === undefined
      || !Number.isFinite(listing.lat) || !Number.isFinite(listing.lng) || (listing.lat === 0 && listing.lng === 0)) return listing;
    return { ...listing, distance: Math.round(haversineMiles(location.latitude, location.longitude, listing.lat, listing.lng) * 10) / 10 };
  }), [pool, location]);
  const shelf = useMemo(() => [...inventory].sort((a, b) => {
    if (location.source !== 'NONE' && location.latitude !== undefined && location.longitude !== undefined) {
      const first = a.distance > 0 ? a.distance : Infinity;
      const second = b.distance > 0 ? b.distance : Infinity;
      if (first !== second) return first - second;
    }
    return b.reviewCount - a.reviewCount || b.rating - a.rating;
  }).slice(0, SHELF_SIZE), [inventory, location]);
  const outdoor = inventory.find((listing) => /outdoor|camping/i.test(listing.category));
  const mainItem = outdoor ?? inventory[0];
  const supporting = inventory.filter((listing) => listing.id !== mainItem?.id).slice(0, 2);
  const outdoorCategory = categories.find((category) => /outdoor|camping/i.test(category.name));
  const browseCategory = (category?: string) => navigate({
    ...savedSearchState(), name: 'search', category,
    lat: location.latitude, lng: location.longitude,
    locationLabel: location.source === 'NONE' ? undefined : locationLabel(location),
  });
  const openListing = (item: Listing) => navigate({ name: 'listing', id: item.id });

  return (
    <div className="marketplace-home">
      <section className="p1-hero">
        <div className="p1-container p1-hero-layout">
          <div className="p1-hero-copy">
            <h1>Great gear.<br />No need to buy.</h1>
            <p>From a weekend away to the project you keep putting off. Rent the things you need from people nearby.</p>
            <div className="p1-hero-links">
              <a href="#home-finds" className="p1-text-link">Find your next thing <ArrowRight size={18} aria-hidden="true" /></a>
              <button onClick={() => navigate({ name: 'create-listing' })}>Or put your gear to work</button>
            </div>
          </div>
          <div className={`p1-hero-collage ${supporting.length === 0 ? 'marketplace-home-collage-single' : supporting.length === 1 ? 'marketplace-home-collage-pair' : ''}`} aria-label="Explore rental gear">
            {loading ? <div className="skeleton marketplace-home-photo marketplace-home-photo-main" aria-label="Loading rental gear" role="status" />
              : mainItem ? <HeroPhoto item={mainItem} featured onOpen={() => openListing(mainItem)} />
                : <div className="marketplace-home-hero-empty"><Tent size={40} aria-hidden="true" /><p>Your next adventure starts with something shared.</p>
                  <Button onClick={() => navigate({ name: 'create-listing' })}>List your first item</Button></div>}
            {supporting.map((item) => <HeroPhoto key={item.id} item={item} onOpen={() => openListing(item)} />)}
          </div>
          <div className="p1-hero-search marketplace-home-search" role="search" aria-label="Find rental gear">
            <SearchBar variant="hero" defaultValue={searchDraft.q} initialStartDate={searchDraft.start}
              initialEndDate={searchDraft.end} initialRadius={searchDraft.radius}
              onSearch={(params) => navigate({
                ...savedSearchState(), name: 'search', q: params.keyword.trim() || undefined,
                lat: params.location.latitude, lng: params.location.longitude,
                locationLabel: params.location.source === 'NONE' ? undefined : locationLabel(params.location),
                radius: params.radius, start: params.startDate, end: params.endDate,
              })} />
            <div className="marketplace-home-popular"><span>Try</span>
              {categories.slice(0, 4).map((category) => <button key={category.id} onClick={() => browseCategory(category.id)}>{category.name}</button>)}
              <span className="marketplace-home-search-note">Dates are optional. Exact pickup addresses stay private.</span>
            </div>
          </div>
        </div>
      </section>

      <div className="p1-container">
        {error && <Alert tone="error" title="We couldn't load listings" className="mt-6">{error}
          <Button variant="secondary" className="mt-3" onClick={() => setRetryToken((value) => value + 1)}>Try again</Button></Alert>}
        {favoriteError && <Alert tone="error" className="mt-6">{favoriteError}
          <Button variant="secondary" className="mt-3" onClick={() => setRetryToken((value) => value + 1)}>Reload saved items</Button></Alert>}
        <section className="p1-home-section" aria-labelledby="browse-categories-heading">
          <SectionHeader title="What's the plan?" subtitle="A little inspiration for your next rental."
            actionLabel="Explore all categories" onAction={() => browseCategory()} className="mb-6" />
          <h2 id="browse-categories-heading" className="sr-only">Browse by category</h2>
          <div className="p1-category-grid" aria-busy={loading && categories.length === 0}>
            {loading && !categories.length ? Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton aspect-[4/3] rounded-card-lg" aria-hidden="true" />)
              : categories.map((category) => <CategoryTile key={category.id} category={category} onClick={() => browseCategory(category.id)} />)}
          </div>
          {!loading && !error && <button className="marketplace-home-more" aria-label="More categories" onClick={() => browseCategory()}>More categories <ArrowRight size={16} aria-hidden="true" /></button>}
          {loading && !categories.length && <p role="status" className="sr-only">Loading categories</p>}
          {!loading && !categories.length && <p role="status" className="text-sm text-sec mt-4">{error ? 'Categories could not be loaded. Please try again above.' : 'No categories are available yet. You can still explore all rentals.'}</p>}
        </section>

        <section id="home-finds" className="p1-home-section" aria-label="Rental finds">
          <SectionHeader title={location.source === 'NONE' ? 'A few good finds' : `Good finds around ${location.city}`}
            subtitle={location.source === 'NONE' ? 'Choose your area to find rentals nearby.' : 'Meet the gear. Meet the people behind it.'}
            actionLabel="Browse rentals" onAction={() => browseCategory()} className="mb-6" />
          {loading ? <ListingGridSkeleton count={4} className="marketplace-home-items" />
            : !error && shelf.length ? <div className="p1-item-grid">{shelf.map((listing) => <ListingCard key={listing.id}
              listing={listing} favorited={favoriteIds.has(listing.id)} favoriteBusy={savingFavorites.has(listing.id) || (!!user && !favoritesLoaded)}
              onToggleFavorite={() => void toggleFavorite(listing.id)} onClick={() => openListing(listing)} />)}</div>
              : !error && <EmptyState icon={<Tent size={22} />} title={location.source === 'NONE' ? 'Nothing listed yet' : 'No rentals found in your area'}
                description={location.source === 'NONE' ? 'YBuy grows one item at a time. Share something you already own to get started.' : 'Try another area or a wider radius in search, or share something of your own.'}
                actionLabel="List your first item" onAction={() => navigate({ name: 'create-listing' })} />}
        </section>

        {outdoor && outdoorCategory && <section className="p1-home-section" aria-label="Outdoor inspiration">
          <div className="p1-weekend">
            <div><Tent size={30} aria-hidden="true" /><h2>Pack light.<br />Live a little.</h2>
              <p>Get out there with camping essentials. Keep the memories, return the gear.</p>
              <Button className="p1-button-lime" onClick={() => browseCategory(outdoorCategory.id)} trailingIcon={<ArrowRight size={18} aria-hidden="true" />}>Explore outdoor gear</Button>
            </div>
            <a href={`/listing/${outdoor.id}`} onClick={(event) => {
              if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openListing(outdoor); }
            }} aria-label={`Explore ${outdoor.title}`}><ListingPhoto src={outdoor.images[0]} alt={outdoor.title} /></a>
          </div>
        </section>}

        <section className="p1-home-section p1-how" aria-labelledby="home-how-heading">
          <div><h2 id="home-how-heading">Less owning.<br />More doing.</h2><p>Your next rental, without the guesswork.</p></div>
          <ol>
            <li><Search aria-hidden="true" /><div><h3>Find what fits your plans</h3><p>Search nearby, choose your dates, and get to know the owner.</p></div></li>
            <li><CalendarCheck aria-hidden="true" /><div><h3>Book your days</h3><p>Choose regular booking or eligible competitive bidding. Review the rental price, service fee and refundable deposit before paying.</p></div></li>
            <li><Check aria-hidden="true" /><div><h3>Pick up. Enjoy. Return.</h3><p>Arrange the handoff in messages and keep all your rental details together.</p></div></li>
          </ol>
        </section>
        <section className="marketplace-home-section" aria-label="Request rental gear">
          <div className="marketplace-home-request"><div><h2>Can't find what you need?</h2><p>Tell nearby owners what you're looking for and when you need it.</p></div>
            <Button variant="secondary" onClick={() => navigate({ name: 'need-something' })}>Request an item</Button></div>
        </section>
        <section className="p1-home-section" aria-labelledby="home-owner-heading"><div className="p1-owner-promo">
          <div><h2 id="home-owner-heading">Your good stuff deserves<br />more than a shelf.</h2><p>Give it a second job. You choose the price, the dates and the days it stays home.</p></div>
          <Button className="p1-button-lime" onClick={() => navigate({ name: 'create-listing' })} trailingIcon={<ArrowRight size={18} aria-hidden="true" />}>List your first item</Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function HeroPhoto({ item, featured = false, onOpen }: { item: Listing; featured?: boolean; onOpen: () => void }) {
  return <a className={featured ? 'p1-hero-main-photo' : 'p1-hero-small-photo'}
    href={`/listing/${item.id}`} onClick={(event) => {
      if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpen(); }
    }}>
    <ListingPhoto src={item.images[0]} alt="" loading="eager" />
    <span>{featured ? <><span className="p1-tag p1-tag-lime">Make room for adventure</span><strong>{item.title}</strong><small>Rent it from ${item.pricePerDay} / day</small></> : item.title}</span>
  </a>;
}

function CategoryTile({ category, onClick }: { category: Category; onClick: () => void }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return <button aria-label={category.name} onClick={onClick}>
    {category.image && failedImage !== category.image ? <img src={category.image} alt="" loading="lazy" decoding="async"
      onError={() => setFailedImage(category.image)} /> : <div className="marketplace-home-category-fallback h-[95px]"><CategoryIcon category={category} size={32} />
        {failedImage && <small>Photo unavailable</small>}</div>}
    <span>{category.name}<ChevronRight size={16} aria-hidden="true" /></span>
  </button>;
}
