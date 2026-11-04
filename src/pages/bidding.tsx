import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { auctions } from '@/data';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { Alert, Badge, Button, EmptyState } from '@/components/ui';
import { fieldClass } from '@/components/form-classes';
import { ArrowUpRight, CalendarDays, Clock3, Gavel, Package, RefreshCw, ShieldCheck } from 'lucide-react';
import { getListingAuction, getListingAuctionFeed, selectListingAuctionWinner, type AuctionFeed, type ListingAuction } from '@/lib/listing-auctions';
import { ListingGridSkeleton } from '@/components/skeleton';
import { fetchListingById, fetchListingsByOwner, toUiListing } from '@/lib/listings';
import { ListingAuctionPanel } from '@/components/listing-auction-panel';
import { ListingPhoto } from '@/components/listing-card';
import { UUID_RE } from '@/lib/text-safety';
import { auctionCountdown } from '@/lib/auction-countdown';
import type { Listing } from '@/data';
import './marketplace.css';
import './production-workflows.css';

const rentalDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dollars = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function AuctionImage({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return <div className="h-full bg-subtle grid place-items-center overflow-hidden">
    {url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      : <Package size={40} strokeWidth={1.5} className="text-muted" aria-hidden="true" />}
  </div>;
}

export type OwnerAuction = { listing: Listing; auction: ListingAuction };
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

export function OwnerBiddingDashboard({
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

  return <main className="p1-container p1-page p1-work-page">
    <header className="p1-page-head">
      <div>
        <h1>Your gear. Their next good bid.</h1>
        <p>Review every bidder, make your decision before the deadline, and track payment status.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={loading} icon={<RefreshCw size={16} aria-hidden="true" />} onClick={onRefresh}>Refresh auctions</Button>
        <Button onClick={() => navigate({ name: 'dashboard', tab: 'lending' })}>Manage listings</Button>
      </div>
    </header>

    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app mb-5">
      <nav className="p1-tabs p1-space-bottom" aria-label="Auction status filters">
        {filters.map(({ id, label }) => {
          const count = ownerAuctions.filter(({ auction }) => matchesAuctionFilter(auction, id)).length;
          return <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label} <span className="tnum text-xs">({count})</span>
          </button>;
        })}
      </nav>
      <p className="text-xs text-sec pb-2">Select an eligible bidder before bidding closes. Undecided bidding expires. Bidders are never selected automatically.</p>
    </div>

    {error && <Alert tone="error" title="Your auctions could not be loaded">
      <p>{error}</p><Button size="sm" variant="secondary" className="mt-2" onClick={onRefresh}>Retry auctions</Button>
    </Alert>}
    {loading && ownerAuctions.length === 0 ? <ListingGridSkeleton /> : filteredAuctions.length > 0 ? (
      <div className="space-y-4" aria-busy={loading}>
        {filteredAuctions.map(({ listing, auction }) => {
          const status = auctionStatus(auction);
          const deadline = auctionDeadline(auction);
          const canSelectWinner = auction.status === 'open' && !!auction.ends_at && Date.parse(auction.ends_at) > now;
          const ownerBids = auction.owner_bids ?? [];
          return <article key={auction.id} className="p1-production-bidding-owner">
                <header className="p1-bid-room-head">
                  <div className="p1-production-bid-head-photo"><ListingPhoto src={listing.images[0]} alt="" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span className="text-xs text-sec">{listing.category || 'Rental'}</span>
                    </div>
                    <h2>{listing.title}</h2>
                    <p>{rentalDate(auction.start_date)} – {rentalDate(auction.end_date)} · ${listing.pricePerDay}/day listed rate</p>
                    <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'listing', id: listing.id })}>View listing</Button>
                  </div>
                  {deadline && <div><small>{auction.status === 'scheduled' ? 'Bidding opens' : 'Current deadline'}</small>
                    <span className="p1-countdown">{isAuctionLive(auction) || auction.status === 'scheduled' ? auctionCountdown(deadline, now) : new Date(deadline).toLocaleString()}</span>
                  </div>}
                </header>
            <div className="p1-bid-room-layout">
              <section className="p1-bid-panel min-w-0">
                <h3 className="text-sm font-semibold text-main mb-2">Bid history</h3>
                {ownerBids.length === 0 ? (
                  <p className="rounded-card bg-subtle px-3 py-4 text-sm text-sec">No bids yet. The opening bid is {dollars(auction.minimum_next_bid)} per day.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="p1-production-bid-table w-full text-left text-sm">
                      <thead><tr className="border-b border-app text-xs text-sec">
                        <th scope="col" className="py-2 pr-3 font-medium">Rank</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Bidder</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Rating</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Bid per day</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Submitted</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Bids placed</th>
                        {canSelectWinner && <th scope="col" className="py-2 text-right font-medium">Action</th>}
                      </tr></thead>
                      <tbody>{ownerBids.map(bid => {
                        const selecting = selectingBidId === bid.id;
                        return <tr key={bid.id} className="border-b last:border-0 border-app">
                          <td className="py-3 pr-3 font-semibold text-main">{bid.rank ? `#${bid.rank}` : '—'}</td>
                          <td className="py-3 pr-3">
                            <span className="flex items-center gap-2">
                              {bid.renter.avatar_url
                                ? <img src={bid.renter.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                                : <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-subtle text-xs font-semibold">{bid.renter.full_name.slice(0, 1).toUpperCase()}</span>}
                              <span className="font-medium text-main">{bid.renter.full_name}</span>
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-sec">{bid.renter.review_count
                            ? `${bid.renter.rating === null ? 'Unrated' : bid.renter.rating.toFixed(1)} (${bid.renter.review_count})`
                            : 'No reviews'}</td>
                          <td className="py-3 pr-3 font-bold text-main tnum">{dollars(bid.daily_rate)}</td>
                          <td className="py-3 pr-3 text-sec">{new Date(bid.submitted_at).toLocaleString()}</td>
                          <td className="py-3 pr-3 text-sec tnum">{bid.bid_count} {bid.bid_count === 1 ? 'bid' : 'bids'}</td>
                          {canSelectWinner && <td className="py-3 text-right">
                            <Button
                              size="sm"
                              onClick={() => void onSelectWinner(listing.id, bid.id)}
                              disabled={!bid.eligible || loading || !!selectingBidId}
                              loading={selecting}
                              loadingLabel="Selecting..."
                            >
                              {bid.eligible ? 'Select bidder' : bid.passed ? 'Payment expired' : 'Not eligible'}
                            </Button>
                          </td>}
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                )}
              </section>
              <aside className="p1-bid-rules">
                <h2>A bid is not a booking.</h2>
                <div className="p1-info"><ShieldCheck size={20} aria-hidden="true" /><p>Choose any eligible bidder when selection is available. Payment verification is still required before a rental is confirmed.</p></div>
                {auction.selected_payment_status && <p className="p1-muted">Selected renter payment: {auction.selected_payment_status.replace('_', ' ')}.</p>}
              </aside>
            </div>
          </article>;
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
  </main>;
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
      <nav aria-label="Bidding sections" className="p1-tabs">
        <button type="button" aria-pressed="true">My auctions</button>
        <button type="button" aria-pressed="false" onClick={() => setView('explore')}>Explore auctions</button>
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
      <nav aria-label="Bidding sections" className="p1-tabs">
        <button type="button" aria-pressed="false" onClick={() => setView('owner')}>
          My auctions{ownerAuctions.length > 0 ? ` (${ownerAuctions.length})` : ''}
        </button>
        <button type="button" aria-pressed="true">Explore auctions</button>
      </nav>
    </div>}
    {user && ownerError && <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4"><Alert tone="warning" title="Your auctions could not be loaded">{ownerError}</Alert></div>}
    <LiveBiddingDirectory key={user?.id ?? 'anonymous'} />
  </>;
}

function LiveBiddingDirectory() {
  const { navigate } = useRouter();
  const reducedMotion = useReducedMotion();
  const [feed, setFeed] = useState<AuctionFeed | null>(null);
  const [category, setCategory] = useState<string | null>(null);
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

  const categories = feed?.categories ?? [];
  const selected = category;
  const items = feed?.items.filter(item => Date.parse(item.expires_at) > now) ?? [];
  const total = feed?.total ?? 0;
  const allCount = categories.reduce((sum, item) => sum + item.count, 0);

  function filter(id: string | null) {
    if (id === category) return;
    setCategory(id); setOffset(0); setFeed(null); setLoading(true); setError(null);
  }

  return <main className="p1-container p1-page">
    <header className="p1-page-head">
      <div>
        <h1>Great gear. Your bid.</h1>
        <p>Live bidding is a second way to rent. Review the dates, choose your daily price and follow the next step.</p>
      </div>
        <Button variant="secondary" disabled={loading} icon={<RefreshCw size={16} aria-hidden="true" />}
          onClick={() => { setOffset(0); setLoading(true); setRetry(value => value + 1); }}>Refresh auctions</Button>
    </header>
    <div className="p1-bid-intro"><Gavel size={26} aria-hidden="true" />
      <p><b>A bid is not a booking.</b>The owner chooses an eligible bid. Selection comes before checkout; your rental is confirmed only after payment is verified. Bid limits, next eligible price and deadlines appear on each auction. Bidder identities stay private.</p>
      <ShieldCheck size={25} aria-hidden="true" />
    </div>
    <fieldset className="mb-6">
      <legend className="sr-only">Filter by category</legend>
      <div className="p1-tabs p1-space-bottom">
        {[{ id: null, name: 'All categories', count: allCount }, ...categories].map(option =>
          <button type="button" key={option.id ?? 'all'} aria-pressed={selected === option.id} disabled={loading}
            onClick={() => filter(option.id)}>
            {option.name}<span className="text-xs tnum">({option.count})</span>
          </button>)}
      </div>
    </fieldset>
    <p role="status" aria-live="polite" className="text-sm text-sec mb-4">
      {loading ? 'Loading auctions...' : error ? 'Auctions could not be refreshed.' : `${total} open ${total === 1 ? 'auction' : 'auctions'}${selected ? ` in ${categories.find(item => item.id === selected)?.name ?? 'this category'}` : ''}`}
    </p>
    {error && <Alert tone="error" title="Live bidding unavailable"><p>{error}</p>
      <Button variant="secondary" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Retry auctions</Button>
    </Alert>}
    <div aria-busy={loading}>
      {loading && !feed ? <ListingGridSkeleton /> : items.length ? (
        <>
          <ul className="p1-auction-grid" aria-label="Open auctions">
            {items.map(item => <motion.li key={item.listing_id} layout={!reducedMotion} transition={{ duration: reducedMotion ? 0 : 0.2 }} className="p1-auction-card">
              <a href={`/bidding/${item.listing_id}`} aria-label={`See bidding for ${item.title}`}
                className="p1-auction-photo p1-production-auction-photo">
                <AuctionImage key={item.image_url} url={item.image_url} />
                <span><Clock3 size={14} aria-hidden="true" /><span className="p1-countdown">{auctionCountdown(item.expires_at, now)}</span></span>
              </a>
              <div>
                <div className="p1-section-head"><span className="p1-muted">{item.category_name}</span><span className="p1-tag p1-tag-lime">Live bidding</span></div>
                <h2><a href={`/bidding/${item.listing_id}`}>{item.title}</a></h2>
                <p className="p1-auction-owner"><CalendarDays size={14} aria-hidden="true" /><span>{rentalDate(item.start_date)} – {rentalDate(item.end_date)}</span></p>
                <div className="p1-auction-price">
                  <p><small>{item.has_bids ? 'Top bid per day' : 'Starting bid per day'}</small><strong className="tnum">{dollars(item.daily_rate)}</strong></p>
                  <Button variant="secondary" onClick={() => navigate({ name: 'bidding-detail', id: item.listing_id })}>See bidding<ArrowUpRight size={16} aria-hidden="true" /></Button>
                </div>
                <time dateTime={item.expires_at} className="block text-xs text-sec mt-3">Closes {new Date(item.expires_at).toLocaleString()}</time>
              </div>
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
  </main>;
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
  const { navigate } = useRouter();
  const { enabled, loading, error, reload } = useFeatureFlag('bidding');
  const [sampleAuctionId, setSampleAuctionId] = useState<string | null>(null);
  if (loading) return <div className="max-w-6xl mx-auto p-6"><ListingGridSkeleton /></div>;
  if (error) return <div className="max-w-6xl mx-auto p-6"><Alert tone="error" title="Could not check bidding availability">{error}<Button onClick={() => void reload()}>Retry bidding</Button></Alert></div>;
  if (enabled) return <LiveBidding />;
  return <div className="marketplace-bidding max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
    <header>
      <h1 className="text-3xl font-bold font-display text-main">Competitive bidding</h1>
      <p className="mt-3 max-w-prose text-sm text-sec">Explore a sample bidding flow while live auctions are unavailable.</p>
    </header>
    <Alert tone="info" title="Sample bidding only">
      Live auctions are currently unavailable. Try a simulated auction below; demo bids stay in this browser and never affect real listings, bookings, or payments.
    </Alert>
    <div>
      <Button variant="secondary" trailingIcon={<ArrowUpRight size={16} aria-hidden="true" />} onClick={() => navigate({ name: 'search' })}>
        Browse available rentals
      </Button>
    </div>
    <section aria-labelledby="sample-auctions-heading">
      <div className="mb-4">
        <h2 id="sample-auctions-heading" className="text-xl font-semibold text-main">Try a sample auction</h2>
        <p className="mt-1 text-sm text-sec">Place a demo bid and see how it appears in the sample bid history.</p>
      </div>
      {sampleAuctionId ? <DemoAuction key={sampleAuctionId} id={sampleAuctionId} onBack={() => setSampleAuctionId(null)} />
        : <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {auctions.map(sample => (
            <li key={sample.id}>
              <button type="button" aria-label={`Try sample auction: ${sample.title}`}
                onClick={() => setSampleAuctionId(sample.id)}
                className="block h-full w-full rounded-card-xl border border-app bg-card p-4 text-left transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
                <AuctionImage url={sample.image} />
                <div className="mt-4 flex items-center justify-between gap-2">
                  <p className="text-xs text-sec">{sample.category}</p>
                  <Badge tone="neutral">SAMPLE</Badge>
                </div>
                <h3 className="mt-2 break-words font-semibold text-main">{sample.title}</h3>
                <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-app pt-3">
                  <div>
                    <p className="text-xs text-sec">Example top bid</p>
                    <p className="mt-1 font-bold text-lg text-accent tnum">{dollars(sample.currentBid)}<span className="text-xs font-normal text-sec"> / day</span></p>
                  </div>
                  <p className="text-xs text-sec">{sample.bids.length} sample bids · {sample.rentalDays} days</p>
                </div>
                <span className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent">Try sample bidding<ArrowUpRight size={16} aria-hidden="true" /></span>
              </button>
            </li>
          ))}
        </ul>}
    </section>
  </div>;
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
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListing(null);
    setError(null);
    async function load() {
      try {
        if (!UUID_RE.test(id)) throw new Error('This auction link is invalid. Return to Bidding to choose an auction.');
        const row = await fetchListingById(id);
        if (active) setListing(row?.auction_enabled ? toUiListing(row) : null);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load this auction. Please retry.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id, retry, user?.id]);

  return <main className="p1-container p1-page">
    <div className="p1-bid-navigation"><Button variant="ghost" onClick={() => navigate({ name: 'bidding' })}>Back to Bidding</Button></div>
    {loading ? <ListingGridSkeleton /> : error ? <Alert tone="error" title="Auction could not be loaded">
      <p>{error}</p><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry auction</Button>
    </Alert> : !listing ? <EmptyState icon={<Gavel size={24} />} title="Auction not found"
      description="This rental is unavailable or does not have competitive bidding enabled."
      actionLabel="Explore auctions" onAction={() => navigate({ name: 'bidding' })} /> : <>
      <header className="p1-bid-room-head">
        <div className="p1-production-bid-head-photo"><AuctionImage url={listing.images[0] ?? null} /></div>
        <div>
          <h1>{listing.title}</h1>
          <p className="text-sm text-sec mt-2">{listing.category}</p>
          <p className="text-sm text-sec mt-2">Bid on this rental here. Regular listing details and booking stay separate.</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate({ name: 'listing', id })}>View listing details</Button>
        </div>
      </header>
      {listing.owner.id === user?.id ? <section className="p1-bid-panel space-y-3">
        <h2 className="text-lg font-semibold text-main">Manage your auction</h2>
        <p className="text-sm text-sec">Review anonymous bids, select a winner, and track payment from your owner dashboard.</p>
        <Button onClick={() => navigate({ name: 'bidding' })}>Manage my auctions</Button>
      </section> : <div className="p1-production-auction-panel"><ListingAuctionPanel key={`${id}:${user?.id ?? 'anonymous'}`} listingId={id} /></div>}
    </>}
  </main>;
}

export function AuctionPage({ id }: { id: string }) {
  return <MockBiddingGate><DemoAuction key={id} id={id} /></MockBiddingGate>;
}

function DemoAuction({ id, onBack }: { id: string; onBack?: () => void }) {
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
      <Button variant="secondary" onClick={() => onBack ? onBack() : navigate({ name: 'bidding' })}>
        {onBack ? 'Back to sample auctions' : 'Back to demo auctions'}
      </Button>
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
