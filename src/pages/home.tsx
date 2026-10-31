import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, MapPin, Sparkles } from 'lucide-react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { SearchBar } from '@/components/search';
import { FavoriteButton } from '@/components/listing-card';
import { Button, EmptyState, Alert } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import type { Listing, Category } from '@/data';
import { auctions, categories as seedCategories } from '@/data';
import {
  fetchCategories, fetchCategoryCounts, searchListings,
  toUiCategory, toUiListing, enrichListingsWithRatings,
} from '@/lib/listings';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { haversineMiles, listingIsInCity, locationLabel } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { savedSearchState } from '@/lib/search-state';

/** Size of the single pool the home shelves are sliced from - one request, not one per section. */
const POOL_SIZE = 24;
const RAIL_SIZE = 8;
const EASE = [0.16, 1, 0.3, 1] as const;
type Navigate = ReturnType<typeof useRouter>['navigate'];

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
    }).slice(0, 4),
    [available, location],
  );

  // Shelves shouldn't repeat the same item twice on one page.
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
    <div className="animate-fade-in overflow-x-clip">
      <Hero onSearch={navigate} onNavigate={navigate} />

      {error && (
        <Shell className="pt-8">
          <Alert tone="error" title="We couldn't load listings">
            <p>{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setRetryToken((token) => token + 1)}>Try again</Button>
          </Alert>
        </Shell>
      )}

      <Aisle categories={categories} loading={loading} error={error} onNavigate={navigate} />

      {loading || featured.length > 0 ? (
        <Shelf featured={featured} loading={loading} cardProps={cardProps} onNavigate={navigate} />
      ) : !error && (
        <Shell className="pt-20">
          <EmptyState
            icon={<Sparkles size={20} />}
            title="Nothing listed yet"
            description="YBuy grows one item at a time. List something you already own and it shows up right here."
            actionLabel="List your first item"
            onAction={() => navigate({ name: 'create-listing' })}
          />
        </Shell>
      )}

      {nearby.length > 0 && (
        <Tape
          title={location.source === 'BROWSER' ? 'Close to you' : `Around ${locationLabel(location)}`}
          note={location.source === 'BROWSER' ? 'The nearest things first, so pickup is easy.' : location.source === 'IP' ? 'City estimated from your connection.' : 'Listings in your selected city.'}
          actionLabel="Search nearby"
          onAction={() => navigate({ name: 'search' })}
          listings={nearby}
          cardProps={cardProps}
        />
      )}

      {justAdded.length > 0 && (
        <Tape
          title="Just arrived"
          note="Fresh from your neighbours."
          actionLabel="See all"
          onAction={() => navigate({ name: 'search' })}
          listings={justAdded}
          cardProps={cardProps}
        />
      )}

      {mockBiddingEnabled && <MockBidding onNavigate={navigate} />}

      <Journey />
      <AskBand onStart={() => navigate({ name: 'need-something' })} />
      <OwnerInvite onStart={() => navigate({ name: 'create-listing' })} />
      <Footer onNavigate={navigate} />
    </div>
  );
}

function Shell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`max-w-[1400px] mx-auto px-4 sm:px-6 ${className}`}>{children}</section>;
}

/** Entrance for a block as it scrolls into view; static under reduced motion. */
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** The one recurring device: a luggage-style tag that marks a price or a place. */
function PriceTag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`absolute left-0 inline-flex items-baseline gap-1 bg-[var(--highlight)] pl-7 pr-4 py-2 text-[var(--ink)] [clip-path:polygon(0.95rem_0,100%_0,100%_100%,0.95rem_100%,0_50%)] ${className}`}>
      <span aria-hidden="true" className="absolute left-[0.62rem] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[var(--ink)]" />
      {children}
    </span>
  );
}

/* ───────────────────────── Hero ───────────────────────── */

const WALL_ASPECTS = ['aspect-[3/4]', 'aspect-square', 'aspect-[4/5]', 'aspect-[3/4]'];

function Hero({ onSearch, onNavigate }: { onSearch: Navigate; onNavigate: Navigate }) {
  const [searchDraft] = useState(savedSearchState);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const lift = useTransform(scrollY, [0, 700], [0, -40]);
  const columns = [[0, 3, 6, 9], [1, 4, 7], [2, 5, 8]].map((ids) => ids.map((id) => seedCategories[id]).filter(Boolean));

  return (
    // No `isolate` or overflow clipping around the search: it would trap its popovers.
    <section>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-8 sm:pt-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-x-14 lg:gap-y-6 lg:[grid-template-areas:'text_wall'_'search_search']">
          <div className="min-w-0 flex flex-col justify-center lg:[grid-area:text]">
            <h1 className="font-editorial text-[clamp(4rem,10.5vw,10.5rem)] leading-[0.86] tracking-[-0.035em] text-main">
              {['Don’t buy it. ', 'Rent it.'].map((line, index) => (
                <span key={line} className={`block overflow-hidden pb-[0.14em] -mb-[0.14em] ${index === 1 ? 'text-[var(--accent)]' : ''}`}>
                  <motion.span
                    className="block"
                    initial={reduce ? false : { y: '108%' }}
                    animate={{ y: 0 }}
                    transition={{ duration: 0.95, delay: 0.1 + index * 0.14, ease: EASE }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </h1>
            <motion.p
              className="mt-6 sm:mt-8 max-w-md text-lg sm:text-xl text-main leading-snug"
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.55, ease: EASE }}
            >
              Cameras, camping gear, tools and party supplies from people close by, for exactly the days you need them.
            </motion.p>
            <motion.div
              className="mt-6 flex flex-wrap gap-x-7 gap-y-2 text-sm font-semibold"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.75 }}
            >
              <button type="button" onClick={() => onNavigate({ name: 'need-something' })} className="group inline-flex items-center gap-1.5 min-h-11 underline underline-offset-[6px] decoration-2">
                Ask for something <ArrowUpRight size={16} aria-hidden="true" className="transition-transform duration-standard group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
              <button type="button" onClick={() => onNavigate({ name: 'create-listing' })} className="group inline-flex items-center gap-1.5 min-h-11 underline underline-offset-[6px] decoration-2">
                Rent out yours <ArrowUpRight size={16} aria-hidden="true" className="transition-transform duration-standard group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
            </motion.div>
          </div>

          {/* Not clipped and not z-indexed: it would cap the search popovers below the dim Overlay. */}
          <div className="relative min-w-0 lg:[grid-area:search] lg:max-w-[64rem]">
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
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-sec">
              {['Secure sign-in', 'Secure checkout', 'Owner approval before payment'].map((point) => (
                <li key={point} className="inline-flex items-center gap-1.5"><Check size={15} aria-hidden="true" className="shrink-0 text-main" />{point}</li>
              ))}
            </ul>
          </div>

          <motion.div aria-hidden="true" style={reduce ? undefined : { y: lift }} className="relative mt-6 lg:mt-0 grid grid-cols-3 gap-2 sm:gap-3 h-[22rem] sm:h-[30rem] lg:h-[34rem] overflow-hidden rounded-[1.75rem] lg:[grid-area:wall]">
            {columns.map((items, index) => (
              <WallColumn key={index} items={items} reverse={index === 1} reduce={Boolean(reduce)} offset={index} />
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function WallColumn({ items, reverse, reduce, offset }: { items: Category[]; reverse: boolean; reduce: boolean; offset: number }) {
  const loop = reduce ? items : [...items, ...items];
  return (
    <div className="relative overflow-hidden">
      <motion.div
        className="flex flex-col"
        animate={reduce ? undefined : { y: reverse ? ['-50%', '0%'] : ['0%', '-50%'] }}
        transition={{ duration: 34 + offset * 6, ease: 'linear', repeat: Infinity }}
      >
        {loop.map((category, index) => (
          <div key={`${category.id}-${index}`} className="pb-2 sm:pb-3">
            <div className={`relative overflow-hidden rounded-[1rem] bg-subtle ${WALL_ASPECTS[(index + offset) % WALL_ASPECTS.length]}`}>
              <img src={category.image} alt="" loading="eager" decoding="async" className="absolute inset-0 h-full w-full object-cover photo-mono" />
              <PriceTag className="absolute bottom-3 left-0 text-xs sm:text-sm font-bold !py-1.5">{category.name}</PriceTag>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/* ─────────────────── Categories ─────────────────── */

function Aisle({ categories, loading, error, onNavigate }: {
  categories: Category[]; loading: boolean; error: string | null; onNavigate: Navigate;
}) {
  return (
    <Shell className="pt-20 sm:pt-32">
      <section aria-labelledby="browse-categories-heading">
        <Reveal className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5 mb-8 sm:mb-12">
          <div>
            <h2 id="browse-categories-heading" className="font-editorial text-5xl sm:text-7xl leading-[0.92] tracking-[-0.03em] text-main">Browse by category</h2>
            <p className="mt-3 text-base sm:text-lg text-sec">Start with what you need.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate({ name: 'search' })}
            className="group inline-flex items-center gap-2 min-h-11 self-start sm:self-auto text-sm font-bold underline underline-offset-[6px] decoration-2"
          >
            Explore all categories <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-standard group-hover:translate-x-1" />
          </button>
        </Reveal>

        <div aria-busy={loading && categories.length === 0} className="flex gap-3 sm:gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 pb-2">
          {loading && categories.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} aria-hidden="true" className="w-[46vw] sm:w-[16.5rem] shrink-0">
                  <div className="skeleton aspect-[4/5] rounded-[1.5rem]" />
                </div>
              ))
            : (
              <>
                {categories.map((category, index) => (
                  <CategoryTile key={category.id} category={category} index={index} onClick={() => onNavigate({ name: 'search', category: category.id })} />
                ))}
                <MoreTile onClick={() => onNavigate({ name: 'search' })} />
              </>
            )}
        </div>
        {loading && categories.length === 0 && <p role="status" className="sr-only">Loading categories</p>}
        {!loading && categories.length === 0 && (
          <p role="status" className="mt-4 text-sm text-sec">
            {error ? 'Categories could not be loaded. Please try again above.' : 'No categories are available yet. You can still explore all rentals.'}
          </p>
        )}
      </section>
    </Shell>
  );
}

function CategoryTile({ category, index, onClick }: { category: Category; index: number; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();
  const hasImage = category.image && !failed;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={reduce ? undefined : { y: -8 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className={`group w-[46vw] sm:w-[16.5rem] shrink-0 snap-start text-left ${index % 2 ? 'sm:mt-8' : ''}`}
    >
      <span className="relative block aspect-[4/5] overflow-hidden rounded-[1.5rem] bg-subtle">
        {hasImage ? (
          <img
            src={category.image}
            alt=""
            loading="lazy"
            decoding="async"
            width={400}
            height={300}
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover zoom-media photo-mono"
          />
        ) : (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-xs text-sec">Photo unavailable</span>
        )}
      </span>
      <span className="mt-3 flex items-center justify-between gap-2 px-1 font-display text-base sm:text-lg font-bold leading-snug [overflow-wrap:anywhere]">
        {category.name}
        <ArrowUpRight size={18} aria-hidden="true" className="shrink-0 transition-transform duration-standard group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </motion.button>
  );
}

function MoreTile({ onClick }: { onClick: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label="More categories"
      whileHover={reduce ? undefined : { y: -8 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className="group w-[46vw] sm:w-[16.5rem] shrink-0 snap-start text-left"
    >
      <span className="grid aspect-[4/5] place-items-center rounded-[1.5rem] bg-[var(--ink)] text-white">
        <span className="font-editorial text-5xl leading-none">More</span>
      </span>
      <span className="mt-3 flex items-center justify-between gap-2 px-1 font-display text-base sm:text-lg font-bold">
        Everything else <ArrowRight size={18} aria-hidden="true" />
      </span>
    </motion.button>
  );
}

/* ─────────────────── Featured shelf ─────────────────── */

type CardProps = { listing: Listing; onClick?: () => void; favorited?: boolean; onToggleFavorite?: () => void };

function openListingLink(event: MouseEvent<HTMLAnchorElement>, onClick?: () => void) {
  if (!onClick || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onClick();
}

function listingPlace(listing: Listing) {
  return listing.distance > 0 && Number.isFinite(listing.distance)
    ? `About ${listing.distance} ${listing.distanceUnit} away`
    : listing.pickup;
}

function listingRating(listing: Listing) {
  return listing.reviewCount > 0 ? `${listing.rating.toFixed(1)} (${listing.reviewCount})` : 'New listing';
}

/** Borderless, photo-first listing: the price hangs off the picture as a tag. */
function ShelfCard({ listing, onClick, favorited, onToggleFavorite, aspect, large = false, delay = 0 }: CardProps & { aspect: string; large?: boolean; delay?: number }) {
  const place = listingPlace(listing);
  return (
    <Reveal delay={delay}>
      <article className="relative">
        <a
          href={`/listing/${encodeURIComponent(listing.id)}`}
          aria-label={`View listing: ${listing.title}`}
          onClick={(event) => openListingLink(event, onClick)}
          className="group block focus-visible:outline-offset-4"
        >
          <span className={`relative block overflow-hidden rounded-[1.5rem] bg-subtle ${aspect}`}>
            {listing.images[0] && <img src={listing.images[0]} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover zoom-media photo-mono" />}
            <PriceTag className={`absolute left-0 ${large ? 'bottom-6' : 'bottom-4'}`}>
              <span className={`font-display font-extrabold tnum ${large ? 'text-3xl' : 'text-lg'}`}>${listing.pricePerDay}</span>
              <span className="text-xs font-semibold">/ day</span>
            </PriceTag>
          </span>
          <span className="mt-3 block px-1">
            <span className={`block font-display font-bold leading-snug line-clamp-2 ${large ? 'text-2xl sm:text-3xl' : 'text-base'}`}>{listing.title}</span>
            <span className="mt-1 flex items-center gap-1.5 text-sm text-sec">
              {place && <><MapPin size={13} aria-hidden="true" className="shrink-0" /><span className="truncate">{place}</span><span aria-hidden="true">·</span></>}
              <span className="shrink-0">{listingRating(listing)}</span>
            </span>
          </span>
        </a>
        <FavoriteButton liked={Boolean(favorited)} onToggle={onToggleFavorite ?? (() => {})} className="absolute top-3 right-3 z-10" />
      </article>
    </Reveal>
  );
}

function Shelf({ featured, loading, cardProps, onNavigate }: {
  featured: Listing[]; loading: boolean; cardProps: (listing: Listing) => CardProps; onNavigate: Navigate;
}) {
  return (
    <section aria-labelledby="featured-heading" className="ink-surface mt-24 sm:mt-36">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-16 sm:py-28">
        <Reveal className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5 mb-12 sm:mb-16">
          <div className="min-w-0">
            <h2 id="featured-heading" className="font-editorial text-5xl sm:text-8xl leading-[0.9] tracking-[-0.03em]">Featured rentals</h2>
            <p className="mt-4 text-base sm:text-lg text-white/75 max-w-lg">Well-reviewed things from owners with a track record.</p>
          </div>
          <button type="button" onClick={() => onNavigate({ name: 'search' })} className="group inline-flex items-center gap-2 min-h-11 self-start sm:self-auto text-sm font-bold underline underline-offset-[6px] decoration-2">
            See all <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-standard group-hover:translate-x-1" />
          </button>
        </Reveal>

        {loading ? (
          <div aria-hidden="true" className="grid lg:grid-cols-[7fr_5fr] gap-8">
            <div className="aspect-[4/5] rounded-[1.5rem] bg-white/10" />
            <div className="grid grid-cols-2 gap-4"><div className="aspect-[3/4] rounded-[1.5rem] bg-white/10" /><div className="aspect-[3/4] rounded-[1.5rem] bg-white/10 mt-12" /></div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[7fr_5fr] gap-10 lg:gap-14">
            <ShelfCard {...cardProps(featured[0])} aspect="aspect-[4/5]" large />
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 content-start">
              {featured[1] && <ShelfCard {...cardProps(featured[1])} aspect="aspect-[3/4]" delay={0.08} />}
              {featured[2] && <div className="mt-10 sm:mt-20"><ShelfCard {...cardProps(featured[2])} aspect="aspect-[3/4]" delay={0.16} /></div>}
              {featured[3] && <div className="col-span-2"><ShelfCard {...cardProps(featured[3])} aspect="aspect-[16/10]" delay={0.1} /></div>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ─────────────────── Tapes (scrolling shelves) ─────────────────── */

function Tape({ title, note, actionLabel, onAction, listings, cardProps }: {
  title: string; note: string; actionLabel: string; onAction: () => void; listings: Listing[]; cardProps: (listing: Listing) => CardProps;
}) {
  return (
    <Shell className="pt-24 sm:pt-36">
      <Reveal className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5 mb-8 sm:mb-12">
        <div className="min-w-0">
          <h2 className="font-editorial text-5xl sm:text-7xl leading-[0.92] tracking-[-0.03em] text-main">{title}</h2>
          <p className="mt-3 text-base sm:text-lg text-sec">{note}</p>
        </div>
        <button type="button" onClick={onAction} className="group inline-flex items-center gap-2 min-h-11 self-start sm:self-auto text-sm font-bold underline underline-offset-[6px] decoration-2">
          {actionLabel} <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-standard group-hover:translate-x-1" />
        </button>
      </Reveal>
      <div className="flex gap-4 sm:gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 pb-2">
        {listings.map((listing, index) => (
          <div key={listing.id} className={`w-[68vw] sm:w-[19rem] shrink-0 snap-start ${index % 2 ? 'sm:mt-10' : ''}`}>
            <ShelfCard {...cardProps(listing)} aspect="aspect-[4/5]" delay={Math.min(index, 4) * 0.05} />
          </div>
        ))}
      </div>
    </Shell>
  );
}

function MockBidding({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <Shell className="pt-24 sm:pt-36">
      <Reveal className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5 mb-8 sm:mb-12">
        <div>
          <h2 className="font-editorial text-5xl sm:text-7xl leading-[0.92] tracking-[-0.03em] text-main">Mock bidding</h2>
          <p className="mt-3 text-base sm:text-lg text-sec">Demo only. No real bids, bookings or payments.</p>
        </div>
        <button type="button" onClick={() => onNavigate({ name: 'bidding' })} className="group inline-flex items-center gap-2 min-h-11 self-start sm:self-auto text-sm font-bold underline underline-offset-[6px] decoration-2">
          See all <ArrowRight size={18} aria-hidden="true" className="transition-transform duration-standard group-hover:translate-x-1" />
        </button>
      </Reveal>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6">
        {auctions.map((auction) => (
          <button key={auction.id} type="button" onClick={() => onNavigate({ name: 'auction', id: auction.id })} className="group text-left">
            <span className="relative block aspect-[4/5] overflow-hidden rounded-[1.5rem] bg-subtle">
              <img src={auction.image} alt={auction.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover zoom-media photo-mono" />
              <PriceTag className="absolute bottom-4 left-0"><span className="font-display text-lg font-extrabold tnum">${auction.currentBid}</span><span className="text-xs font-semibold">demo bid</span></PriceTag>
            </span>
            <span className="mt-3 block px-1">
              <span className="block font-display text-base font-bold line-clamp-1">{auction.title}</span>
              <span className="block text-sm text-sec">Demo · {auction.endsIn}</span>
            </span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

/* ─────────────────── How it works: a ticket strip ─────────────────── */

const STEPS = [
  { title: 'Discover', desc: 'Search by item, place and the dates you need it.' },
  { title: 'Request', desc: 'Pick your dates and send a request to the owner.' },
  { title: 'Rent', desc: 'Pay securely once the owner approves, then pick it up.' },
  { title: 'Return', desc: 'Hand it back, mark it returned, leave a review.' },
];

const STUB_NOTCH = '[clip-path:polygon(0_0,100%_0,100%_42%,calc(100%-0.8rem)_50%,100%_58%,100%_100%,0_100%,0_58%,0.8rem_50%,0_42%)]';

function Journey() {
  const reduce = useReducedMotion();
  return (
    <Shell className="pt-24 sm:pt-36">
      <Reveal>
        <h2 className="font-editorial text-5xl sm:text-7xl leading-[0.92] tracking-[-0.03em] text-main">How YBuy works</h2>
        <p className="mt-3 text-base sm:text-lg text-sec">Four stops, start to finish.</p>
      </Reveal>
      <ol className="mt-10 sm:mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {STEPS.map((step, index) => (
          <motion.li
            key={step.title}
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '0px 0px -10% 0px' }}
            transition={{ duration: 0.6, delay: index * 0.09, ease: EASE }}
            whileHover={reduce ? undefined : { y: -6 }}
            className={`${STUB_NOTCH} flex min-h-[15rem] flex-col justify-between px-7 py-8 sm:px-9 ${index % 2 ? 'bg-[var(--accent)] text-white' : 'bg-card text-main'}`}
          >
            <h3 className="font-editorial text-5xl leading-none tracking-[-0.02em]">{step.title}</h3>
            <p className={`mt-8 text-base leading-snug ${index % 2 ? 'text-white/80' : 'text-sec'}`}>{step.desc}</p>
          </motion.li>
        ))}
      </ol>
    </Shell>
  );
}

/* ─────────────────── Ask band ─────────────────── */

function AskBand({ onStart }: { onStart: () => void }) {
  const reduce = useReducedMotion();
  const phrase = 'Can’t find it? Ask for it.';
  return (
    <section aria-labelledby="ask-heading" className="mt-24 sm:mt-36">
      <div data-marquee className="overflow-hidden">
        <motion.div
          className="flex w-max items-center whitespace-nowrap font-editorial text-[clamp(4.5rem,14vw,13rem)] leading-none tracking-[-0.03em] text-main"
          animate={reduce ? undefined : { x: ['0%', '-50%'] }}
          transition={{ duration: 28, ease: 'linear', repeat: Infinity }}
        >
          {(reduce ? [0] : [0, 1]).map((copy) => (
            <span key={copy} aria-hidden={copy === 1 ? true : undefined} className="flex items-center">
              {[0, 1, 2].map((n) => (
                <span key={n} className="flex items-center pr-[0.4em]">
                  {copy === 0 && n === 0 ? <h2 id="ask-heading" className="font-[inherit]">{phrase}</h2> : <span>{phrase}</span>}
                  <span aria-hidden="true" className="ml-[0.4em] h-[0.16em] w-[0.16em] rounded-full bg-[var(--accent)]" />
                </span>
              ))}
            </span>
          ))}
        </motion.div>
      </div>
      <Shell className="pt-8 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
        <p className="max-w-md text-base sm:text-lg text-sec leading-relaxed">Tell nearby owners what you’re looking for and when you need it. They come to you.</p>
        <Button size="lg" onClick={onStart} trailingIcon={<ArrowRight size={18} />} className="w-full sm:w-auto">Request an item</Button>
      </Shell>
    </section>
  );
}

/* ─────────────────── Owner invitation ─────────────────── */

const OWNER_STEPS = ['Add photos of what you already own.', 'Set the dates it is available.', 'Choose which requests to approve.'];
const STACK = [
  { index: 4, rotate: -7, x: '0%', y: '4%' },
  { index: 1, rotate: 5, x: '38%', y: '0%' },
  { index: 3, rotate: -2, x: '16%', y: '38%' },
];

function OwnerInvite({ onStart }: { onStart: () => void }) {
  return (
    <section aria-labelledby="owner-cta-heading" className="ink-surface mt-24 sm:mt-36">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-16 sm:py-28 grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
        <div className="min-w-0">
          <Reveal>
            <h2 id="owner-cta-heading" className="font-editorial text-6xl sm:text-8xl leading-[0.88] tracking-[-0.035em]">Rent out what you already own</h2>
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="mt-8 space-y-3 text-base sm:text-lg text-white/80">
              {OWNER_STEPS.map((step) => <li key={step} className="flex gap-3"><ArrowRight size={20} aria-hidden="true" className="mt-1 shrink-0 text-white" />{step}</li>)}
            </ul>
            <Button size="lg" onClick={onStart} trailingIcon={<ArrowRight size={18} />} className="mt-9 w-full sm:w-auto">List an item</Button>
          </Reveal>
        </div>
        <div aria-hidden="true" className="relative mx-auto h-[26rem] sm:h-[38rem] w-full max-w-[34rem]">
          {STACK.map((item, index) => (
            <motion.div
              key={item.index}
              initial={{ opacity: 0, y: 40, rotate: 0 }}
              whileInView={{ opacity: 1, y: 0, rotate: item.rotate }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: index * 0.12, ease: EASE }}
              whileHover={{ rotate: 0, scale: 1.03, zIndex: 5 }}
              style={{ left: item.x, top: item.y }}
              className="absolute w-[58%] overflow-hidden rounded-[1.25rem] bg-white p-2 pb-8 sm:p-3 sm:pb-10"
            >
              <img src={seedCategories[item.index]?.image} alt="" loading="lazy" className="aspect-[4/5] w-full rounded-[0.75rem] object-cover photo-mono" />
              <PriceTag className="absolute bottom-3 left-0 !py-1 text-xs font-bold">{seedCategories[item.index]?.name}</PriceTag>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────── Footer ─────────────────── */

function Footer({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <footer className="overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <BrandLogo />
          <nav aria-label="Footer" className="flex items-center gap-6 text-sm text-sec">
            <button type="button" onClick={() => onNavigate({ name: 'search' })} className="min-h-11 hover:text-main transition-colors duration-fast">Browse</button>
            <button type="button" onClick={() => onNavigate({ name: 'create-listing' })} className="min-h-11 hover:text-main transition-colors duration-fast">List an item</button>
            <button type="button" onClick={() => onNavigate({ name: 'guidelines' })} className="min-h-11 hover:text-main transition-colors duration-fast">Guidelines</button>
          </nav>
        </div>
        <p className="py-6 text-sm text-muted">© {new Date().getFullYear()} YBuy</p>
      </div>
    </footer>
  );
}
