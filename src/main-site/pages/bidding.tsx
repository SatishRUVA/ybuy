import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { auctions } from '@/data';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { Alert, Badge, Button, EmptyState, Surface } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { ArrowUpRight, CalendarDays, Clock3, Gavel, Package, RefreshCw } from 'lucide-react';
import { BIDDING_SAMPLES } from '@/lib/bidding-samples';
import { getListingAuction, getListingAuctionFeed, selectListingAuctionWinner, type AuctionFeed, type ListingAuction } from '@/lib/listing-auctions';
import { CategoryIcon } from '@/main-site/components/category-icon';
import { ListingGridSkeleton } from '@/main-site/components/skeleton';
import { enrichListingsWithRatings, fetchListingById, fetchListingsByOwner, toUiListing } from '@/lib/listings';
import { ListingAuctionPanel } from '@/main-site/components/listing-auction-panel';
import { UUID_RE } from '@/lib/text-safety';
import { auctionCountdown } from '@/lib/auction-countdown';
import type { Listing } from '@/data';
import { ListingPhoto } from '@/main-site/components/listing-card';

const rentalDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dollars = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function AuctionImage({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return <div className="aspect-[5/3] bg-subtle grid place-items-center overflow-hidden rounded-card-lg">
    {url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-contain" />
      : <Package size={40} strokeWidth={1.5} className="text-muted" aria-hidden="true" />}
  </div>;
}

type OwnerAuction = { listing: Listing; auction: ListingAuction };
type AuctionFilter = 'all' | 'live' | 'scheduled' | 'completed' | 'closed';

function isAuctionLive(auction: ListingAuction) {
  return ['open', 'owner_selection', 'awaiting_payment'].includes(auction.status);
}

function auctionStatus(auction: ListingAuction): {
  label: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'error';
} {
  switch (auction.status) {
    case 'scheduled': return { label: 'Scheduled', tone: 'accent' };
    case 'open': return { label: 'Live', tone: 'success' };
    case 'owner_selection': return { label: 'Closing', tone: 'warning' };
    case 'awaiting_payment': return { label: 'Payment pending', tone: 'warning' };
    case 'completed': return { label: 'Completed', tone: 'success' };
    case 'cancelled': return { label: 'Cancelled', tone: 'error' };
    case 'ended': return { label: 'Ended', tone: 'neutral' };
  }
}

function auctionDeadline(auction: ListingAuction): string | null {
  if (auction.status === 'scheduled') return auction.starts_at ?? null;
  if (auction.status === 'owner_selection') return auction.selection_deadline;
  if (auction.status === 'awaiting_payment') return auction.payment_deadline;
  return auction.ends_at;
}

function matchesAuctionFilter(auction: ListingAuction, filter: AuctionFilter) {
  if (filter === 'all') return true;
  if (filter === 'live') return isAuctionLive(auction);
  if (filter === 'scheduled') return auction.status === 'scheduled';
  if (filter === 'completed') return auction.status === 'completed';
  return auction.status === 'ended' || auction.status === 'cancelled';
}

function OwnerBiddingDashboard({
  auctions: ownerAuctions, loading, error, selectingBidId, onRefresh, onExplore, onSelectWinner,
}: {
  auctions: OwnerAuction[];
  loading: boolean;
  error: string | null;
  selectingBidId: string | null;
  onRefresh: () => void;
  onExplore: () => void;
  onSelectWinner: (listingId: string, bidId: string) => Promise<void>;
}) {
  const { navigate } = useRouter();
  const [filter, setFilter] = useState<AuctionFilter>('all');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const filters: { id: AuctionFilter; label: string }[] = [
    { id: 'all', label: 'All auctions' },
    { id: 'live', label: 'Live' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'completed', label: 'Completed' },
    { id: 'closed', label: 'Closed' },
  ];
  const filteredAuctions = ownerAuctions.filter(({ auction }) => matchesAuctionFilter(auction, filter));

  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-display text-main flex items-center gap-3">
          <Gavel className="text-accent" aria-hidden="true" />Owner — Bidding
        </h1>
        <p className="mt-2 text-sm text-sec max-w-prose">Manage your auctions, review bidder profiles and full bid history, and track rental status.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={loading} icon={<RefreshCw size={16} aria-hidden="true" />} onClick={onRefresh}>Refresh auctions</Button>
        <Button onClick={() => navigate({ name: 'dashboard', tab: 'lending' })}>Manage listings</Button>
      </div>
    </header>

    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app mb-5">
      <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Auction status filters">
        {filters.map(({ id, label }) => {
          const count = ownerAuctions.filter(({ auction }) => matchesAuctionFilter(auction, id)).length;
          return <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
            className={`min-h-11 border-b-2 px-1 text-sm font-semibold transition-colors ${filter === id ? 'border-accent text-accent' : 'border-transparent text-sec hover:text-main'}`}>
            {label} <span className="tnum text-xs">({count})</span>
          </button>;
        })}
      </nav>
      <p className="text-xs text-sec pb-2">Select eligible bidders before bidding closes. Without an owner decision, bidding expires. The system never selects bidders automatically.</p>
    </div>

    {error && <Alert tone="error" title="Your auctions could not be loaded">
      <p>{error}</p><Button size="sm" variant="secondary" className="mt-2" onClick={onRefresh}>Retry auctions</Button>
    </Alert>}
    {loading && ownerAuctions.length === 0 ? <ListingGridSkeleton /> : filteredAuctions.length > 0 ? (
      <div className="space-y-4" aria-busy={loading}>
        {filteredAuctions.map(({ listing, auction }) => {
          const status = auctionStatus(auction);
          const deadline = auctionDeadline(auction);
          const canSelectWinner = auction.status === 'open' && auction.ends_at !== null && Date.parse(auction.ends_at) > now;
          const ownerBids = auction.owner_bids ?? [];
          return <Surface key={auction.id} className="p-4 sm:p-5">
            <div className="grid md:grid-cols-[minmax(15rem,0.85fr)_minmax(0,1.4fr)] gap-5">
              <div className="min-w-0">
                <div className="flex items-start gap-3">
                  <ListingPhoto images={listing.images} className="h-20 w-24 rounded-card object-cover bg-subtle shrink-0" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span className="text-xs text-sec">{listing.category || 'Rental'}</span>
                    </div>
                    <h2 className="mt-2 font-semibold text-main break-words">{listing.title}</h2>
                    <p className="mt-1 text-sm font-semibold text-accent tnum">${listing.pricePerDay}/day</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-sec">
                  <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden="true" />{rentalDate(auction.start_date)} – {rentalDate(auction.end_date)}</span>
                  {deadline && <span className="inline-flex items-center gap-1.5">
                    <Clock3 size={14} aria-hidden="true" />
                    {isAuctionLive(auction) || auction.status === 'scheduled'
                      ? `${auction.status === 'scheduled' ? 'Opens' : 'Closes'} ${auctionCountdown(deadline, now)}`
                      : new Date(deadline).toLocaleString()}
                  </span>}
                </div>
                <Button size="sm" variant="secondary" className="mt-4" onClick={() => navigate({ name: 'listing', id: listing.id })}>View listing</Button>
                {auction.selected_payment_status && <p className="mt-3 text-sm text-sec">Selected renter payment: {auction.selected_payment_status}.</p>}
              </div>

              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-main mb-2">Bid history</h3>
                {ownerBids.length === 0 ? (
                  <p className="rounded-card bg-subtle px-3 py-4 text-sm text-sec">No bids yet. The opening bid is {dollars(auction.minimum_next_bid)} per day.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead><tr className="border-b border-app text-xs text-sec">
                        <th scope="col" className="py-2 pr-3 font-medium">Rank</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Bidder</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Rating</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Bid per day</th>
                        {auction.date_flexible && <th scope="col" className="py-2 pr-3 font-medium">Rental dates / total</th>}
                        <th scope="col" className="py-2 pr-3 font-medium">Submitted</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Bids placed</th>
                        {canSelectWinner && <th scope="col" className="py-2 text-right font-medium">Action</th>}
                      </tr></thead>
                      <tbody>{ownerBids.map(bid => {
                        const selecting = selectingBidId === bid.id;
                        return <tr key={bid.id} className="border-b last:border-0 border-app">
                          <td className="py-3 pr-3 font-semibold text-main">{bid.rank ? `#${bid.rank}` : '-'}</td>
                          <td className="py-3 pr-3 text-main">
                            <span className="flex items-center gap-2">
                              {bid.renter.avatar_url && <img src={bid.renter.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />}
                              {bid.renter.full_name}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-sec">{bid.renter.review_count
                            ? `${bid.renter.rating?.toFixed(1) ?? 'Unrated'} (${bid.renter.review_count})`
                            : 'No reviews'}</td>
                          <td className="py-3 pr-3 font-bold text-main tnum">{dollars(bid.daily_rate)}</td>
                          {auction.date_flexible && <td className="py-3 pr-3 text-sec">{bid.start_date && bid.end_date && <span className="block">{rentalDate(bid.start_date)} – {rentalDate(bid.end_date)}</span>}<strong>{dollars(bid.total_value ?? 0)}</strong>{bid.payment_status && <span className="block">Payment: {bid.payment_status}{bid.payment_deadline && ` · ${new Date(bid.payment_deadline).toLocaleString()}`}</span>}</td>}
                          <td className="py-3 pr-3 text-sec">{new Date(bid.submitted_at).toLocaleString()}</td>
                          <td className="py-3 pr-3 text-sec tnum">{bid.bid_count} {bid.bid_count === 1 ? 'bid' : 'bids'}</td>
                          {canSelectWinner && <td className="py-3 text-right">
                            <Button
                              size="sm"
                              onClick={() => void onSelectWinner(listing.id, bid.id)}
                              disabled={bid.selected || !bid.eligible || loading || !!selectingBidId}
                              loading={selecting}
                              loadingLabel="Selecting..."
                            >
                              {bid.selected ? 'Selected' : 'Select winner'}
                            </Button>
                          </td>}
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </Surface>;
        })}
      </div>
    ) : !error && !loading ? (
      <EmptyState icon={<Gavel size={24} />} title={ownerAuctions.length ? 'No auctions in this section' : 'No auctions on your listings yet'}
        description={ownerAuctions.length ? 'Choose another status to see your auctions.' : 'Enable competitive bidding from a published listing’s negotiation options. Your auctions will appear here.'}
        actionLabel={ownerAuctions.length ? 'Show all auctions' : 'Manage listings'}
        onAction={() => ownerAuctions.length ? setFilter('all') : navigate({ name: 'dashboard', tab: 'lending' })} />
    ) : null}
    <div className="mt-6 text-center">
      <Button variant="ghost" onClick={onExplore} trailingIcon={<ArrowUpRight size={16} aria-hidden="true" />}>Explore auctions to bid on</Button>
    </div>
  </div>;
}

function LiveBidding() {
  const { user } = useAuth();
  const ownerId = user?.id;
  const [ownerAuctionsState, setOwnerAuctionsState] = useState<{ ownerId: string; auctions: OwnerAuction[] } | null>(null);
  const ownerAuctions = ownerAuctionsState && ownerAuctionsState.ownerId === ownerId ? ownerAuctionsState.auctions : [];
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [selectingBidId, setSelectingBidId] = useState<string | null>(null);
  const [ownerRetry, setOwnerRetry] = useState(0);
  const [view, setView] = useState<'owner' | 'explore'>('explore');
  const defaultedUser = useRef<string | null>(null);

  useEffect(() => {
    if (!ownerId) {
      defaultedUser.current = null;
      setOwnerError(null);
      setOwnerLoading(false);
      setView('explore');
      return;
    }

    const activeOwnerId = ownerId;
    let active = true;
    let requestPending = false;
    async function loadOwnerAuctions() {
      if (requestPending) return;
      requestPending = true;
      try {
        const rows = await fetchListingsByOwner(activeOwnerId);
        const listings = rows.map(toUiListing).filter(listing => listing.auctionEnabled);
        const results = await Promise.all(listings.map(async listing => ({
          listing,
          auction: await getListingAuction(listing.id),
        })));
        if (!active) return;
        const current = results.filter((item): item is { listing: Listing; auction: ListingAuction } => item.auction !== null);
        setOwnerAuctionsState({ ownerId: activeOwnerId, auctions: current });
        setOwnerError(null);
        if (defaultedUser.current !== activeOwnerId) {
          defaultedUser.current = activeOwnerId;
          setView(current.length ? 'owner' : 'explore');
        }
      } catch (failure) {
        if (!active) return;
        setOwnerError(failure instanceof Error ? failure.message : 'Could not load your auctions. Please retry.');
        if (defaultedUser.current !== activeOwnerId) {
          defaultedUser.current = activeOwnerId;
          setView('explore');
        }
      } finally {
        requestPending = false;
        if (active) setOwnerLoading(false);
      }
    }

    setOwnerError(null);
    setOwnerLoading(true);
    void loadOwnerAuctions();
    const refresh = window.setInterval(() => { if (!document.hidden) void loadOwnerAuctions(); }, 15000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [ownerId, ownerRetry]);

  if (user && view === 'owner') return <>
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5">
      <nav aria-label="Bidding sections" className="flex gap-5 border-b border-app">
        <button type="button" aria-current="page" className="min-h-11 border-b-2 border-accent px-1 text-sm font-semibold text-accent">My auctions</button>
        <button type="button" onClick={() => setView('explore')} className="min-h-11 border-b-2 border-transparent px-1 text-sm font-semibold text-sec hover:text-main">Explore auctions</button>
      </nav>
    </div>
    <OwnerBiddingDashboard
      auctions={ownerAuctions}
      loading={ownerLoading}
      error={ownerError}
      selectingBidId={selectingBidId}
      onRefresh={() => setOwnerRetry(value => value + 1)}
      onExplore={() => setView('explore')}
      onSelectWinner={async (listingId, bidId) => {
        setSelectingBidId(bidId);
        try {
          const next = await selectListingAuctionWinner(listingId, bidId);
          setOwnerAuctionsState(current => current && current.ownerId === ownerId
            ? { ...current, auctions: current.auctions.map(item => item.listing.id === listingId ? { ...item, auction: next } : item) }
            : current);
          setOwnerError(null);
        } catch (failure) {
          setOwnerError(failure instanceof Error ? failure.message : 'Could not select this winner. Please retry.');
        } finally {
          setSelectingBidId(null);
        }
      }}
    />
  </>;

  return <>
    {user && <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5">
      <nav aria-label="Bidding sections" className="flex gap-5 border-b border-app">
        <button type="button" onClick={() => setView('owner')} className="min-h-11 border-b-2 border-transparent px-1 text-sm font-semibold text-sec hover:text-main">
          My auctions{ownerAuctions.length > 0 ? ` (${ownerAuctions.length})` : ''}
        </button>
        <button type="button" aria-current="page" className="min-h-11 border-b-2 border-accent px-1 text-sm font-semibold text-accent">Explore auctions</button>
      </nav>
    </div>}
    {user && ownerError && <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4"><Alert tone="warning" title="Your auctions could not be loaded">{ownerError}</Alert></div>}
    <LiveBiddingDirectory key={user?.id ?? 'anonymous'} />
  </>;
}

function LiveBiddingDirectory() {
  const { navigate } = useRouter();
  const { enabled: mockBiddingEnabled } = useFeatureFlag('mock_bidding');
  const reducedMotion = useReducedMotion();
  const [feed, setFeed] = useState<AuctionFeed | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [sampleCategory, setSampleCategory] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const pages = await Promise.all(Array.from({ length: offset / 24 + 1 }, (_, index) => getListingAuctionFeed(category, index * 24)));
        const result = { ...pages[0], items: pages.flatMap(page => page.items) };
        if (!active) return;
        setFeed(result);
        setError(null);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load live auctions. Please retry.');
      } finally { if (active) setLoading(false); }
    }
    void load();
    // Refresh all loaded pages together so rankings cannot leave stale or duplicate cards.
    const refresh = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [category, offset, retry]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const sampleMode = mockBiddingEnabled && import.meta.env.VITE_TEST_ENVIRONMENT === 'true' && feed !== null
    && feed.categories.length === 0 && feed.total === 0 && category === null && !error;
  const categories = sampleMode
    ? [...new Set(BIDDING_SAMPLES.map(item => item.category))].map(name => ({
      id: name, name, count: BIDDING_SAMPLES.filter(item => item.category === name).length,
    }))
    : feed?.categories ?? [];
  const selected = sampleMode ? sampleCategory : category;
  const samples = BIDDING_SAMPLES.filter(item => !sampleCategory || item.category === sampleCategory);
  const items = feed?.items.filter(item => Date.parse(item.expires_at) > now) ?? [];
  const total = sampleMode ? samples.length : feed?.total ?? 0;
  const allCount = categories.reduce((sum, item) => sum + item.count, 0);

  function filter(id: string | null) {
    if (sampleMode) { setSampleCategory(id); return; }
    if (id === category) return;
    setCategory(id); setOffset(0); setFeed(null); setLoading(true); setError(null);
  }

  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
    <header className="flex flex-wrap items-start justify-between gap-4 mb-7">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-display text-main flex items-center gap-3"><Gavel className="text-accent" aria-hidden="true" />Live bidding</h1>
        <p className="mt-2 text-sm text-sec max-w-prose">Find your next rental. Browse open auctions by category, then review the dates and place your bid.</p>
      </div>
      <Button variant="secondary" disabled={loading} icon={<RefreshCw size={16} aria-hidden="true" />}
        onClick={() => { setOffset(0); setLoading(true); setRetry(value => value + 1); }}>Refresh auctions</Button>
    </header>
    {sampleMode && <div className="rounded-card-lg bg-warning-soft text-warning p-4 mb-6">
      <p className="text-sm font-semibold">TEST DATA · 10 sample auctions</p>
      <p className="text-sm mt-1">Preview the browsing experience. These items are not available to bid on; no bookings or payments are created.</p>
    </div>}
    <fieldset className="mb-6">
      <legend className="text-sm font-semibold text-main mb-3">Filter by category</legend>
      <div className="flex flex-wrap gap-2">
        {[{ id: null, name: 'All categories', count: allCount }, ...categories].map(option =>
          <button type="button" key={option.id ?? 'all'} aria-pressed={selected === option.id} disabled={loading}
            onClick={() => filter(option.id)}
            className={`min-h-11 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60 ${selected === option.id ? 'bg-accent text-accent-text border-transparent' : 'bg-card text-sec border-app hover:bg-subtle'}`}>
            {option.id && <CategoryIcon category={{ id: option.id, name: option.name, icon: 'Package' }} size={16} />}
            {option.name}<span className="text-xs tnum">({option.count})</span>
          </button>)}
      </div>
    </fieldset>
    <p role="status" aria-live="polite" className="text-sm text-sec mb-4">
      {loading ? 'Loading auctions...' : error ? 'Auctions could not be refreshed.' : `${total} ${sampleMode ? 'sample' : 'open'} ${total === 1 ? 'auction' : 'auctions'}${selected ? ` in ${categories.find(item => item.id === selected)?.name ?? 'this category'}` : ''}`}
    </p>
    {error && <Alert tone="error" title="Live bidding unavailable"><p>{error}</p>
      <Button variant="secondary" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Retry auctions</Button>
    </Alert>}
    <div aria-busy={loading}>
      {loading && !feed ? <ListingGridSkeleton /> : sampleMode ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" aria-label="Sample auctions">
          {samples.map(item => <motion.li key={item.listing_id} layout={!reducedMotion} transition={{ duration: reducedMotion ? 0 : 0.2 }}
            className="rounded-card-xl border border-app bg-card p-4">
            <AuctionImage url={item.image_url} />
            <div className="flex justify-between gap-3 mt-4 text-xs text-sec"><span>{item.category}</span><span className="font-semibold text-warning">SAMPLE</span></div>
            <h2 className="font-semibold text-main mt-2 break-words">{item.title}</h2>
            <p className="text-sm text-sec mt-3">Illustrative daily bid</p>
            <p className="font-bold text-lg text-accent tnum">{dollars(item.daily_rate)}<span className="text-xs font-normal text-sec"> / day</span></p>
            <p className="text-xs text-sec mt-3">Sample only · Bidding unavailable</p>
          </motion.li>)}
        </ul>
      ) : items.length ? (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" aria-label="Open auctions">
            {items.map(item => <motion.li key={item.listing_id} layout={!reducedMotion} transition={{ duration: reducedMotion ? 0 : 0.2 }}>
              <a href={`/bidding/${item.listing_id}`}
                className="block h-full rounded-card-xl border border-app bg-card p-4 hover:border-[var(--accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
                <AuctionImage key={item.image_url} url={item.image_url} />
                <p className="text-xs text-sec mt-4">{item.category_name}</p>
                <h2 className="font-semibold text-main mt-2 break-words">{item.title}</h2>
                <p className="inline-flex items-center gap-2 text-xs text-sec mt-3"><CalendarDays size={15} aria-hidden="true" />{rentalDate(item.start_date)} – {rentalDate(item.end_date)}</p>
                <p className="text-sm text-sec mt-3">{item.has_bids ? 'Highest daily bid' : 'Starting daily bid'}</p>
                <p className="font-bold text-lg text-accent tnum">{dollars(item.daily_rate)}<span className="text-xs font-normal text-sec"> / day</span></p>
                <time dateTime={item.expires_at} className="block text-xs text-sec mt-2">Bidding closes {new Date(item.expires_at).toLocaleString()}</time>
                <span className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent mt-2">View auction<ArrowUpRight size={16} aria-hidden="true" /></span>
              </a>
            </motion.li>)}
          </ul>
          {feed && feed.items.length < feed.total && <div className="mt-6 text-center">
            <Button variant="secondary" disabled={loading} onClick={() => { setLoading(true); setOffset(value => value + 24); }}>Load more auctions</Button>
          </div>}
        </>
      ) : !error && !loading && <EmptyState icon={<Gavel size={24} />} title="No open auctions right now"
        description={category ? 'Try another category or return to all categories.' : 'Check back soon for new rental auctions, or browse available listings.'}
        actionLabel={category ? 'Clear category filter' : 'Browse listings'} onAction={() => category ? filter(null) : navigate({ name: 'search' })} />}
    </div>
  </div>;
}

function MockBiddingGate({ children }: { children: ReactNode }) {
  const { enabled, loading, error, reload } = useFeatureFlag('mock_bidding');
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <h1 className="text-2xl font-bold font-display text-main">Mock bidding</h1>
      {loading ? <p role="status">Checking demo availability...</p>
        : error ? <Alert tone="error" title="Could not check demo availability">
          <p>{error}</p><Button onClick={() => void reload()}>Try again</Button>
        </Alert>
          : !enabled ? <Alert tone="warning" title="Mock bidding is offline">
            The bidding demo is not available. A Super Admin can enable mock_bidding in Feature flags.
          </Alert>
            : <>
              <Alert tone="info" title="Demo only">
                All auctions and bids are simulated. No real bids, bookings or payments are created.
                Demo bids reset when you leave this page.
              </Alert>
              {children}
            </>}
    </div>
  );
}

export function BiddingPage() {
  const { enabled, loading, error, reload } = useFeatureFlag('bidding');
  if (loading) return <div className="max-w-6xl mx-auto p-6"><ListingGridSkeleton /></div>;
  if (error) return <div className="max-w-6xl mx-auto p-6"><Alert tone="error" title="Could not check bidding availability">{error}<Button onClick={() => void reload()}>Retry bidding</Button></Alert></div>;
  return enabled ? <LiveBidding /> : <MockBiddingPage />;
}

export function BiddingDetailPage({ id }: { id: string }) {
  const { enabled, loading, error, reload } = useFeatureFlag('bidding');
  if (loading) return <div className="max-w-6xl mx-auto p-6"><ListingGridSkeleton /></div>;
  if (error) return <div className="max-w-6xl mx-auto p-6"><Alert tone="error" title="Could not check bidding availability">{error}<Button onClick={() => void reload()}>Retry bidding</Button></Alert></div>;
  if (!enabled) return <div className="max-w-6xl mx-auto p-6"><Alert tone="warning" title="Bidding is offline">Competitive bidding is currently unavailable.</Alert></div>;
  return <RentalAuctionDetail key={id} id={id} />;
}

function RentalAuctionDetail({ id }: { id: string }) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [activePhoto, setActivePhoto] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListing(null);
    setError(null);
    async function load() {
      try {
        if (!UUID_RE.test(id)) throw new Error('This auction link is invalid. Return to Bidding to choose an auction.');
        const row = await fetchListingById(id);
        if (row?.auction_enabled) {
          const [enriched] = await enrichListingsWithRatings([toUiListing(row)]);
          if (active) setListing(enriched);
        } else if (active) setListing(null);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load this auction. Please retry.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id, retry, user?.id]);

  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    <Button variant="secondary" onClick={() => navigate({ name: 'bidding' })}>Back to Bidding</Button>
    {loading ? <ListingGridSkeleton /> : error ? <Alert tone="error" title="Auction could not be loaded">
      <p>{error}</p><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry auction</Button>
    </Alert> : !listing ? <EmptyState icon={<Gavel size={24} />} title="Auction not found"
      description="This rental is unavailable or does not have competitive bidding enabled."
      actionLabel="Explore auctions" onAction={() => navigate({ name: 'bidding' })} /> : <>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2.2fr)]">
      <header className="min-w-0 space-y-4">
        <AuctionImage url={listing.images[activePhoto] ?? null} />
        {listing.images.length > 1 && <div className="flex gap-2 overflow-x-auto pb-2">{listing.images.map((photo, index) => <button key={`${photo}:${index}`} type="button" aria-label={`View photo ${index + 1}`} aria-pressed={activePhoto === index} onClick={() => setActivePhoto(index)} className={`h-16 w-16 shrink-0 overflow-hidden rounded-card border-2 ${activePhoto === index ? 'border-accent' : 'border-app'}`}><img src={photo} alt="" className="h-full w-full object-cover" /></button>)}</div>}
        <h1 className="text-2xl font-bold font-display text-main break-words">{listing.title}</h1>
        <p className="text-sm text-sec">{listing.category} · {listing.pickup}</p>
        <p className="text-sm text-sec">{listing.owner.name} · {listing.owner.rentals ? `${listing.owner.rating.toFixed(1)} stars (${listing.owner.rentals} reviews)` : 'No owner reviews'}</p>
        <p className="text-sm text-sec whitespace-pre-wrap">{listing.description}</p>
        <div className="rounded-card border border-app p-4"><p className="text-xs text-sec">Listed rental price</p><p className="mt-1 text-xl font-bold">{dollars(listing.pricePerDay)}<span className="text-sm font-normal text-sec"> / day</span></p></div>
        <Button variant="secondary" className="w-full" onClick={() => navigate({ name: 'listing', id })}>Book at Listed Price</Button>
      </header>
      {listing.owner.id === user?.id ? <Surface className="p-5 space-y-3">
        <h2 className="text-lg font-semibold text-main">Manage your auction</h2>
        <p className="text-sm text-sec">Review anonymous bids, select a winner, and track payment from your owner dashboard.</p>
        <Button onClick={() => navigate({ name: 'bidding' })}>Manage my auctions</Button>
      </Surface> : <ListingAuctionPanel key={`${id}:${user?.id ?? 'anonymous'}`} listingId={id} deposit={listing.deposit} listedPrice={listing.pricePerDay} />}
      </div>
    </>}
  </div>;
}

function MockBiddingPage() {
  const { navigate } = useRouter();
  return (
    <MockBiddingGate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {auctions.map((auction) => (
          <button
            key={auction.id}
            onClick={() => navigate({ name: 'auction', id: auction.id })}
            className="group text-left p-4 rounded-card-xl bg-card border border-app shadow-card card-hover"
          >
            <img src={auction.image} alt="" loading="lazy" className="aspect-[5/3] w-full object-cover rounded-card-lg mb-3" />
            <h2 className="font-semibold text-main">{auction.title}</h2>
            <p className="text-sm text-sec">{auction.rentalDays}-day demo rental</p>
            <p className="mt-3 font-bold text-accent">Current demo bid: ${auction.currentBid}</p>
            <span className="text-sm text-sec">View demo auction</span>
          </button>
        ))}
      </div>
    </MockBiddingGate>
  );
}

export function AuctionPage({ id }: { id: string }) {
  return <MockBiddingGate><DemoAuction key={id} id={id} /></MockBiddingGate>;
}

function DemoAuction({ id }: { id: string }) {
  const { navigate } = useRouter();
  const auction = auctions.find((row) => row.id === id);
  const [bids, setBids] = useState(() => auction?.bids ?? []);
  const [amount, setAmount] = useState(String((auction?.currentBid ?? 0) + 5));
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const currentBid = bids[bids.length - 1]?.amount ?? auction?.currentBid ?? 0;

  function placeBid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = Number(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || next <= currentBid || next > 1_000_000) {
      setError(`Enter a bid above $${currentBid} and no more than $1,000,000, with up to two decimal places.`);
      setPlaced(false);
      return;
    }
    setBids((previous) => [...previous.map((bid) => ({ ...bid, isLeading: false })), {
      id: crypto.randomUUID(), bidder: 'You (demo)', avatar: '', amount: next, time: 'Just now', isLeading: true,
    }]);
    setAmount(String(Math.min(next + 5, 1_000_000)));
    setError(null);
    setPlaced(true);
  }

  return (
    <div className="space-y-5">
      <Button variant="secondary" onClick={() => navigate({ name: 'bidding' })}>Back to demo auctions</Button>
      {!auction ? <EmptyState icon={<Gavel size={20} />} title="Demo auction not found" description="Choose an auction from the demo list." />
        : <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <img src={auction.image} alt="" className="aspect-[4/3] w-full object-cover rounded-card-xl mb-4" />
            <h2 className="text-xl font-bold text-main">{auction.title}</h2>
            <p className="text-sm text-sec">{auction.rentalDays}-day simulated rental. No real rental slot is reserved.</p>
          </div>
          <div className="space-y-4">
            <p className="text-lg font-bold text-accent" role="status">Current demo bid: ${currentBid}</p>
            <form onSubmit={placeBid} className="space-y-3">
              <label htmlFor="demo-bid" className="block text-sm font-semibold text-main">Your demo bid</label>
              <input id="demo-bid" type="number" step="0.01" max="1000000" required value={amount}
                onChange={(event) => setAmount(event.target.value)} className={fieldClass()}
                aria-invalid={Boolean(error)} aria-describedby={error ? 'demo-bid-error' : undefined} />
              {error && <p id="demo-bid-error" role="alert" className="text-sm text-error">{error}</p>}
              <Button type="submit">Place demo bid</Button>
            </form>
            {placed && <Alert tone="success">Demo bid placed. No money was charged.</Alert>}
            <h3 className="font-semibold text-main">Demo bid history</h3>
            <ul className="space-y-2 text-sm text-sec">
              {[...bids].reverse().map((bid) => (
                <li key={bid.id} className="flex justify-between gap-3">
                  <span>{bid.bidder}{bid.isLeading ? ' - Leading' : ''}</span><span>${bid.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>}
    </div>
  );
}
