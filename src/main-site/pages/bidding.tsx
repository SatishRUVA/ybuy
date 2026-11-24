import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { Alert, Badge, Button, EmptyState, Surface } from '@/main-site/components/ui';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, Gavel, Package, RefreshCw, Search } from 'lucide-react';
import { getListingAuction, getListingAuctionFeed, getMyListingAuctionBids, selectListingAuctionWinner, type AuctionFeed, type AuctionFeedItem, type BiddingDirectorySort, type BiddingDirectoryStatus, type ListingAuction, type RenterAuctionParticipation } from '@/lib/listing-auctions';
import { ListingGridSkeleton } from '@/main-site/components/skeleton';
import { enrichListingsWithRatings, fetchListingById, fetchListingsByOwner, signListingImageUrl, toUiListing } from '@/lib/listings';
import { ListingAuctionPanel } from '@/main-site/components/listing-auction-panel';
import { UUID_RE } from '@/lib/text-safety';
import { auctionCountdown } from '@/lib/auction-countdown';
import type { Listing } from '@/data';
import { ListingPhoto } from '@/main-site/components/listing-card';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/main-site/components/shadcn/alert-dialog';
import { deadlineLabel, winnerRental } from '@/lib/owner-auction-display';
import type { OwnerAuctionBid } from '@/lib/listing-auctions';
import './bidding-directory.css';

const rentalDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dollars = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const rentalDuration = (start: string, end: string) => {
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  return `${days} day${days === 1 ? '' : 's'}`;
};

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

function auctionStatus(auction: Pick<ListingAuction, 'status'>): {
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
  onSelectWinner: (listingId: string, bidId: string) => Promise<string | null>;
}) {
  const { navigate } = useRouter();
  const [filter, setFilter] = useState<AuctionFilter>('all');
  const [now, setNow] = useState(Date.now());
  const [selection, setSelection] = useState<{ listingId: string; auction: ListingAuction; bid: OwnerAuctionBid } | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectionInFlight = useRef(false);
  const selectionTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const filters: { id: AuctionFilter; label: string }[] = [
    { id: 'all', label: 'All listings' },
    { id: 'live', label: 'Live' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'completed', label: 'Completed' },
    { id: 'closed', label: 'Closed' },
  ];
  const filteredAuctions = ownerAuctions.filter(({ auction }) => matchesAuctionFilter(auction, filter));
  const currentAuction = selection && ownerAuctions.find(item => item.listing.id === selection.listingId)?.auction;
  const currentBid = selection && currentAuction?.owner_bids?.find(bid => bid.id === selection.bid.id);
  const rental = selection && winnerRental(selection.auction, selection.bid);
  const currentRental = currentAuction && currentBid && winnerRental(currentAuction, currentBid);
  const selectionValid = !!(selection && rental && currentAuction?.status === 'open' && currentAuction.ends_at
    && Date.parse(currentAuction.ends_at) > now && currentBid?.eligible && !currentBid.selected && currentRental
    && currentBid.daily_rate === selection.bid.daily_rate && currentRental.start === rental.start
    && currentRental.end === rental.end && currentRental.subtotal === rental.subtotal);

  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-display text-main flex items-center gap-3">
          <Gavel className="text-accent" aria-hidden="true" />Your bidding listings
        </h1>
        <p className="mt-2 text-sm text-sec max-w-prose">Manage bidding and review bids.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={loading} icon={<RefreshCw size={16} aria-hidden="true" />} onClick={onRefresh}>Refresh listings</Button>
        <Button onClick={() => navigate({ name: 'owner-listings' })}>Manage listings</Button>
      </div>
    </header>

    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app mb-5">
      <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Bidding status filters">
        {filters.map(({ id, label }) => {
          const count = ownerAuctions.filter(({ auction }) => matchesAuctionFilter(auction, id)).length;
          return <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
            className={`min-h-11 border-b-2 px-1 text-sm font-semibold transition-colors ${filter === id ? 'border-accent text-accent' : 'border-transparent text-sec hover:text-main'}`}>
            {label} <span className="tnum text-xs">({count})</span>
          </button>;
        })}
      </nav>
      <p className="text-xs text-sec pb-2">Choose a bidder before bidding closes. If you don't, bidding expires.</p>
    </div>

    {error && <Alert tone="error" title="Your bidding listings could not be loaded">
      <p>{error}</p><Button size="sm" variant="secondary" className="mt-2" onClick={onRefresh}>Retry listings</Button>
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
                      ? `${deadlineLabel(auction.status)} ${auctionCountdown(deadline, now)}`
                      : new Date(deadline).toLocaleString()}
                  </span>}
                </div>
                <Button size="sm" variant="secondary" className="mt-4" onClick={() => navigate({ name: 'listing', id: listing.id })}>View listing</Button>
                {auction.selected_payment_status && <p className="mt-3 text-sm text-sec">Selected bidder’s payment: {auction.selected_payment_status}.</p>}
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
                              onClick={event => {
                                selectionTrigger.current = event.currentTarget;
                                setSelectionError(null);
                                setSelection({ listingId: listing.id, auction, bid });
                              }}
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
      <EmptyState icon={<Gavel size={24} />} title={ownerAuctions.length ? 'No bidding listings in this section' : 'No bidding on your listings yet'}
        description={ownerAuctions.length ? 'Choose another status to see your bidding listings.' : 'Enable competitive bidding from a published listing’s negotiation options. Your bidding listings will appear here.'}
        actionLabel={ownerAuctions.length ? 'Show all listings' : 'Manage listings'}
        onAction={() => ownerAuctions.length ? setFilter('all') : navigate({ name: 'owner-listings' })} />
    ) : null}
    <div className="mt-6 text-center">
      <Button variant="ghost" onClick={onExplore} trailingIcon={<ArrowUpRight size={16} aria-hidden="true" />}>Explore listings to bid on</Button>
    </div>
    <AlertDialog open={!!selection} onOpenChange={open => { if (!open && !selectingBidId) setSelection(null); }}>
      {selection && <AlertDialogContent onCloseAutoFocus={event => {
        if (selectionTrigger.current?.isConnected) { event.preventDefault(); selectionTrigger.current.focus(); }
      }}>
        <AlertDialogTitle>Confirm winner</AlertDialogTitle>
        <AlertDialogDescription>Review this offer before selecting the winner.</AlertDialogDescription>
        {rental && <dl className="mt-4 space-y-2 text-sm text-main">
          <div className="flex justify-between gap-4"><dt>Bidder</dt><dd className="font-semibold text-right">{selection.bid.renter.full_name}</dd></div>
          <div className="flex justify-between gap-4"><dt>Rental dates</dt><dd className="font-semibold text-right">{rentalDate(rental.start)} – {rentalDate(rental.end)}</dd></div>
          <div className="flex justify-between gap-4"><dt>Daily rate</dt><dd className="font-semibold">{dollars(selection.bid.daily_rate)}</dd></div>
          <div className="flex justify-between gap-4"><dt>Rental subtotal</dt><dd className="font-semibold">{dollars(rental.subtotal)}</dd></div>
        </dl>}
        <p className="mt-4 text-sm text-sec">A pending-payment booking will be created and the bidder notified. The rental is not secured until payment is completed. Fees and deposit are not included in the rental subtotal.</p>
        <p className="mt-2 text-sm text-sec">{selection.auction.date_flexible
          ? 'Bidding remains open; you can select other eligible bids for non-overlapping dates.'
          : 'Bidding ends for this fixed-date listing while the selected bidder completes payment.'}</p>
        {!selectionValid && <p role="alert" className="mt-3 text-sm text-error">This offer or bidding listing is no longer available as shown. Close this dialog and refresh the listings.</p>}
        {selectionError && <p role="alert" className="mt-3 text-sm text-error">{selectionError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel asChild><Button variant="secondary" disabled={!!selectingBidId}>Cancel</Button></AlertDialogCancel>
          <Button disabled={!selectionValid || !!selectingBidId || loading} loading={!!selectingBidId} onClick={() => {
            if (selectionInFlight.current || !selectionValid) return;
            selectionInFlight.current = true;
            setSelectionError(null);
            void onSelectWinner(selection.listingId, selection.bid.id).then(failure => {
              if (failure) setSelectionError(failure);
              else setSelection(null);
            }).finally(() => { selectionInFlight.current = false; });
          }}>Confirm winner</Button>
        </AlertDialogFooter>
      </AlertDialogContent>}
    </AlertDialog>
  </div>;
}

function LiveBidding() {
  const { route, navigate } = useRouter();
  const { user } = useAuth();
  const ownerId = user?.id;
  const [ownerAuctionsState, setOwnerAuctionsState] = useState<{ ownerId: string; auctions: OwnerAuction[] } | null>(null);
  const ownerAuctions = ownerAuctionsState && ownerAuctionsState.ownerId === ownerId ? ownerAuctionsState.auctions : [];
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [selectingBidId, setSelectingBidId] = useState<string | null>(null);
  const [ownerRetry, setOwnerRetry] = useState(0);
  const [view, setView] = useState<'owner' | 'explore'>(route.name === 'bidding' && route.view === 'owner' ? 'owner' : 'explore');
  const routeView = route.name === 'bidding' && route.view === 'owner' ? 'owner' : 'explore';

  useEffect(() => { setView(routeView); }, [routeView]);

  function changeView(next: 'owner' | 'explore') {
    setView(next);
    navigate(next === 'owner' ? { name: 'bidding', view: 'owner' } : { name: 'bidding' });
  }

  useEffect(() => {
    if (!ownerId) {
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
      } catch (failure) {
        if (!active) return;
        setOwnerError(failure instanceof Error ? failure.message : 'Could not load your bidding listings. Please retry.');
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
    <OwnerBiddingDashboard
      auctions={ownerAuctions}
      loading={ownerLoading}
      error={ownerError}
      selectingBidId={selectingBidId}
      onRefresh={() => setOwnerRetry(value => value + 1)}
      onExplore={() => changeView('explore')}
      onSelectWinner={async (listingId, bidId) => {
        setSelectingBidId(bidId);
        try {
          const next = await selectListingAuctionWinner(listingId, bidId);
          setOwnerAuctionsState(current => current && current.ownerId === ownerId
            ? { ...current, auctions: current.auctions.map(item => item.listing.id === listingId ? { ...item, auction: next } : item) }
            : current);
          setOwnerError(null);
          return null;
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : 'Could not select this winner. Please retry.';
          setOwnerError(message);
          return message;
        } finally {
          setSelectingBidId(null);
        }
      }}
    />
  </>;

  return <>
    {user && ownerError && <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4"><Alert tone="warning" title="Your bidding listings could not be loaded">{ownerError}</Alert></div>}
    <LiveBiddingDirectory key={user?.id ?? 'anonymous'} hasOwnerBiddingListings={ownerAuctions.length > 0} />
  </>;
}

function LiveBiddingDirectory({ hasOwnerBiddingListings }: { hasOwnerBiddingListings: boolean }) {
  const [feed, setFeed] = useState<AuctionFeed | null>(null);
  const [status, setStatus] = useState<BiddingDirectoryStatus>('live');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [sort, setSort] = useState<BiddingDirectorySort>('ending');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!hasOwnerBiddingListings && onlyMine) {
      setOnlyMine(false); setOffset(0); setFeed(null); setLoading(true); setError(null);
    }
  }, [hasOwnerBiddingListings, onlyMine]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query !== search) {
        setOffset(0); setFeed(null); setLoading(true); setError(null); setSearch(query);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const pages = await Promise.all(Array.from({ length: offset / 24 + 1 }, (_, index) => getListingAuctionFeed(index * 24, status, search, onlyMine, sort)));
        const result = { ...pages[0], items: pages.flatMap(page => page.items) };
        if (!active) return;
        setFeed(result);
        setError(null);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load bidding listings. Please retry.');
      } finally { if (active) setLoading(false); }
    }
    void load();
    // Refresh all loaded pages together so rankings cannot leave stale or duplicate cards.
    const refresh = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [status, search, onlyMine, sort, offset, retry]);

  const items = feed?.items ?? [];
  const live = items.filter(item => item.status === 'open');
  const upcoming = items.filter(item => item.status === 'scheduled');
  const past = items.filter(item => item.status !== 'open' && item.status !== 'scheduled');
  const counts = feed?.status_counts;

  function resetResults() {
    setOffset(0); setFeed(null); setLoading(true); setError(null);
  }

  function clearFilters() {
    setQuery(''); setSearch(''); setStatus('live'); setOnlyMine(false); setSort('ending');
    resetResults(); setRetry(value => value + 1);
  }

  return <div className="bidding-directory">
    <header className="bidding-directory-hero">
      {counts && <p className="bidding-directory-live">{counts.live > 0 && <span className="bidding-directory-live-dot" aria-hidden="true" />}{counts.live} live bidding listing{counts.live === 1 ? '' : 's'}</p>}
      <h1>Name your price. Win the dates you need.</h1>
      <p className="bidding-directory-intro">Bid on rentals from people in the community. You’re only charged after the owner selects your bid and you complete payment.</p>
      <div className="bidding-directory-toolbar">
        <fieldset className="bidding-directory-segment">
          <legend className="sr-only">Filter by status</legend>
          {([{ id: 'live', label: 'Live now' }, { id: 'all', label: 'All' }, { id: 'past', label: 'Past' }] satisfies { id: BiddingDirectoryStatus; label: string }[]).map(option =>
            <button type="button" key={option.id} aria-pressed={status === option.id} className={option.id === 'live' && counts?.live ? 'bidding-directory-live-tab' : undefined}
              onClick={() => { if (status !== option.id) { setStatus(option.id); resetResults(); } }}>
              {option.label}{counts && <> <span>{option.id === 'past' ? counts.completed + counts.closed : counts[option.id]}</span></>}
            </button>)}
        </fieldset>
        <label className="bidding-directory-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search bidding listings</span>
          <input type="search" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search bidding listings" />
        </label>
        {hasOwnerBiddingListings && <button type="button" className="bidding-directory-mine" aria-pressed={onlyMine} onClick={() => {
          setOnlyMine(value => !value); resetResults();
        }}>My bidding listings</button>}
        <label>
          <span className="sr-only">Sort by</span>
          <select className="bidding-directory-sort" value={sort} onChange={event => {
            const value = event.target.value;
            if (value === 'ending' || value === 'low' || value === 'high') { setSort(value); resetResults(); }
          }}>
            <option value="ending">Ending soonest</option>
            <option value="low">Lowest starting bid</option>
            <option value="high">Highest starting bid</option>
          </select>
        </label>
      </div>
    </header>
    <p role="status" className="sr-only">
      {loading ? 'Loading bidding listings...' : error ? 'Bidding listings could not be refreshed.' : `${feed?.total ?? 0} bidding listings`}
    </p>
    {error && <Alert tone="error" title="Bidding listings unavailable"><p>{error}</p>
      <Button variant="secondary" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Retry listings</Button>
    </Alert>}
    <div aria-busy={loading}>
      {loading && !feed ? <ListingGridSkeleton /> : items.length ? (
        <>
          {live.length > 0 && <section><h2 className="bidding-directory-section-title">Live now <small>{counts?.live} open for bids</small></h2>
            <ul className="bidding-directory-grid">{live.map(item => <BiddingDirectoryCard key={item.listing_id} item={item} now={now} />)}</ul>
          </section>}
          {upcoming.length > 0 && <section><h2 className="bidding-directory-section-title">Upcoming <small>{counts?.scheduled} scheduled</small></h2>
            <ul className="bidding-directory-grid">{upcoming.map(item => <BiddingDirectoryCard key={item.listing_id} item={item} now={now} />)}</ul>
          </section>}
          {past.length > 0 && <section><h2 className="bidding-directory-section-title">Past bidding <small>{counts ? counts.completed + counts.closed : 0} listing{counts && counts.completed + counts.closed === 1 ? '' : 's'}</small></h2>
            <ul className="bidding-directory-past">{past.map(item => <li key={item.listing_id}><a href={item.is_mine ? '/bidding?view=owner' : `/bidding/${item.listing_id}`} className="bidding-directory-row">
              <span className="bidding-directory-thumb"><AuctionImage url={item.image_url} /></span>
              <span className="bidding-directory-row-info"><strong>{item.title}</strong><span>{rentalDate(item.start_date)} – {rentalDate(item.end_date)} · {rentalDuration(item.start_date, item.end_date)} · {auctionStatus(item).label}</span></span>
              <span className="bidding-directory-row-price">{dollars(item.opening_daily_rate)}<small>per day start</small></span>
              <span className="bidding-directory-row-link">{item.is_mine ? 'Manage bidding' : 'View results'} <span aria-hidden="true">→</span></span>
            </a></li>)}</ul>
          </section>}
          {feed && feed.items.length < feed.total && <div className="mt-6 text-center">
            <Button variant="secondary" disabled={loading} onClick={() => { setLoading(true); setOffset(value => value + 24); }}>Load more listings</Button>
          </div>}
        </>
      ) : !error && !loading && <EmptyState icon={<Gavel size={24} />} title="Nothing matches yet"
        description={status === 'live' && !search && !onlyMine ? 'There are no live bidding listings right now.' : 'Try a different search or clear your filters.'}
        actionLabel={status === 'live' && !search && !onlyMine ? 'View all bidding' : 'Clear filters'}
        onAction={status === 'live' && !search && !onlyMine ? () => { setStatus('all'); resetResults(); } : clearFilters} />}
    </div>
  </div>;
}

function BiddingDirectoryCard({ item, now }: { item: AuctionFeedItem; now: number }) {
  const scheduled = item.status === 'scheduled';
  return <li><a href={item.is_mine ? '/bidding?view=owner' : `/bidding/${item.listing_id}`} className="bidding-directory-card">
    <div className="bidding-directory-image">
      <AuctionImage url={item.image_url} />
      <span className="bidding-directory-card-status">{scheduled ? 'Scheduled' : 'Live'}</span>
      {!scheduled && <span className="bidding-directory-countdown">{auctionCountdown(item.expires_at, now)} left</span>}
      {item.is_mine && <span className="bidding-directory-owned">Your listing</span>}
    </div>
    <div className="bidding-directory-card-body">
      <span className="bidding-directory-category">{item.category_name}</span>
      <h3>{item.title}</h3>
      <p className="bidding-directory-dates">{rentalDate(item.start_date)} – {rentalDate(item.end_date)} · {rentalDuration(item.start_date, item.end_date)}</p>
      <p className="bidding-directory-price"><strong>{dollars(item.daily_rate)}</strong><span>/ day {item.has_bids ? 'current bid' : 'starting bid'}</span></p>
      <div className="bidding-directory-card-footer">
        <time dateTime={scheduled ? item.starts_at : item.expires_at}>{scheduled ? 'Opens' : 'Closes'} {new Date(scheduled ? item.starts_at : item.expires_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time>
        <span className="bidding-directory-action">{item.is_mine ? 'Manage bidding' : scheduled ? 'View bidding' : 'Place a bid'}</span>
      </div>
    </div>
  </a></li>;
}

export function BiddingPage() {
  const { route } = useRouter();
  if (route.name === 'bidding' && route.view === 'my-bids') return <MyBidsPage />;
  return <LiveBiddingGate />;
}

function LiveBiddingGate() {
  const { enabled, loading, error, reload } = useFeatureFlag('bidding');
  if (loading) return <div className="max-w-6xl mx-auto p-6"><ListingGridSkeleton /></div>;
  if (error) return <div className="max-w-6xl mx-auto p-6"><Alert tone="error" title="Could not check bidding availability">{error}<Button onClick={() => void reload()}>Retry bidding</Button></Alert></div>;
  return enabled ? <LiveBidding /> : <div className="max-w-6xl mx-auto p-6"><Alert tone="info" title="Bidding is unavailable">Browse rentals while bidding is unavailable.</Alert></div>;
}

function myBidState(item: RenterAuctionParticipation) {
  const selected = item.bids.find(bid => bid.selected);
  if (selected?.payment_status === 'paid') return { label: 'Won · Paid', tone: 'success' as const, selected };
  if (selected?.payment_status === 'pending') return { label: 'Payment due', tone: 'warning' as const, selected };
  if (selected?.payment_status === 'expired') return { label: 'Payment window expired', tone: 'neutral' as const, selected };
  if (selected) return { label: 'Selected', tone: 'success' as const, selected };
  if (item.status === 'scheduled') return { label: 'Scheduled', tone: 'accent' as const, selected: null };
  if (item.status === 'owner_selection') return { label: 'Awaiting owner decision', tone: 'warning' as const, selected: null };
  if (item.status === 'open' && Date.parse(item.ends_at) > Date.now()) {
    const current = item.bids.find(bid => bid.is_current);
    if (current?.rank === 1) return { label: 'Leading', tone: 'success' as const, selected: null };
    if (current?.rank) return { label: 'Outbid', tone: 'warning' as const, selected: null };
    if (item.bids.every(bid => bid.passed)) return { label: 'No longer eligible', tone: 'neutral' as const, selected: null };
    return { label: 'In progress', tone: 'accent' as const, selected: null };
  }
  if (item.status === 'open') return { label: 'Bidding closed', tone: 'warning' as const, selected: null };
  if (item.status === 'completed') return { label: 'Bidding completed', tone: 'neutral' as const, selected: null };
  if (item.status === 'cancelled') return { label: 'Cancelled', tone: 'error' as const, selected: null };
  return { label: 'Bidding ended', tone: 'neutral' as const, selected: null };
}

function MyBidsPage() {
  const { user, loading: authLoading, openSignIn } = useAuth();
  const userId = user?.id;
  const { navigate } = useRouter();
  const [items, setItems] = useState<RenterAuctionParticipation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setItems([]);
    setError(null);
    if (authLoading) return () => { active = false; };
    if (!userId) { setLoading(false); return () => { active = false; }; }
    void getMyListingAuctionBids(0, 20).then(async result => {
      const signed = await Promise.all(result.items.map(async item => ({
        ...item,
        image_url: item.image_url ? await signListingImageUrl(item.image_url) : null,
      })));
      if (active) { setItems(signed); setTotal(result.total); }
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load your bids. Please retry.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authLoading, userId, retry]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const result = await getMyListingAuctionBids(items.length, 20);
      const signed = await Promise.all(result.items.map(async item => ({
        ...item,
        image_url: item.image_url ? await signListingImageUrl(item.image_url) : null,
      })));
      setItems(current => [...current, ...signed]);
      setTotal(result.total);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load more bids. Please retry.');
    } finally { setLoadingMore(false); }
  }

  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
    <nav aria-label="Bidding sections" className="flex gap-5 border-b border-app mb-6">
      <button type="button" onClick={() => navigate({ name: 'bidding' })} className="min-h-11 border-b-2 border-transparent px-1 text-sm font-semibold text-sec hover:text-main">Explore bidding</button>
      <button type="button" aria-current="page" className="min-h-11 border-b-2 border-accent px-1 text-sm font-semibold text-accent">My bids</button>
    </nav>
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-display text-main flex items-center gap-3"><Gavel className="text-accent" aria-hidden="true" />My bids</h1>
        <p className="mt-2 text-sm text-sec max-w-prose">Track your bids and payment deadlines. Bidding won't charge you or reserve a rental.</p>
      </div>
      {user && <Button variant="secondary" onClick={() => setRetry(value => value + 1)} disabled={loading}>Refresh bids</Button>}
    </header>
    {authLoading ? <ListingGridSkeleton />
      : !user ? <EmptyState icon={<Gavel size={24} />} title="Sign in to see your bids" description="Your bidding activity will be available here after you sign in." actionLabel="Sign in" onAction={openSignIn} />
      : error && items.length === 0 ? <Alert tone="error" title="Your bids could not be loaded"><p>{error}</p><Button variant="secondary" className="mt-2" onClick={() => setRetry(value => value + 1)}>Retry</Button></Alert>
        : loading && items.length === 0 ? <ListingGridSkeleton />
          : items.length === 0 ? <EmptyState icon={<Gavel size={24} />} title="No bids yet" description="Your bids will appear here." actionLabel="Explore bidding" onAction={() => navigate({ name: 'bidding' })} />
            : <div className="space-y-4" aria-busy={loading || loadingMore}>
              {error && <Alert tone="error" title="Could not load more bids"><p>{error}</p><Button variant="secondary" className="mt-2" onClick={() => void loadMore()}>Retry</Button></Alert>}
              {items.map(item => {
                const state = myBidState(item);
                const bestBid = item.bids.find(bid => bid.is_current) ?? item.bids.reduce((best, bid) => bid.daily_rate > best.daily_rate ? bid : best, item.bids[0]);
                const dates = item.date_flexible && bestBid.start_date && bestBid.end_date
                  ? `${rentalDate(bestBid.start_date)} – ${rentalDate(bestBid.end_date)}`
                  : `${rentalDate(item.start_date)} – ${rentalDate(item.end_date)}`;
                return <Surface key={item.auction_id} className="p-4 sm:p-5">
                  <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                    <AuctionImage url={item.image_url} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><Badge tone={state.tone}>{state.label}</Badge><h2 className="mt-2 font-semibold text-main break-words">{item.title}</h2></div>
                        <p className="text-lg font-bold text-main tnum">{dollars(bestBid.daily_rate)}<span className="text-sm font-normal text-sec"> / day</span></p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-sec">
                        <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} aria-hidden="true" />{dates}</span>
                        <span>{item.date_flexible ? `${item.bids.length} bids placed` : `${item.bids.length} of 3 bids used`}</span>
                        <span>Last bid {new Date(item.last_bid_at).toLocaleString()}</span>
                      </div>
                      {state.selected?.payment_status === 'pending' && state.selected.booking_id && state.selected.payment_deadline && <p className="mt-3 text-sm font-semibold text-warning">Complete payment by {new Date(state.selected.payment_deadline).toLocaleString()} to secure the rental.</p>}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {state.selected?.payment_status === 'pending' && state.selected.booking_id && <Button size="sm" onClick={() => navigate({ name: 'confirmation', id: state.selected!.booking_id! })}>Complete payment</Button>}
                        <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'bidding-detail', id: item.listing_id })}>View bidding</Button>
                      </div>
                      <details className="mt-4 border-t border-app pt-2">
                        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-sec">Bid history ({item.bids.length})</summary>
                        <ul className="space-y-2 pb-2 text-sm">
                          {item.bids.map((bid, index) => <li key={bid.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sec">
                            <span>Bid {item.bids.length - index}{item.date_flexible && bid.start_date && bid.end_date ? ` · ${rentalDate(bid.start_date)} – ${rentalDate(bid.end_date)}` : ''}{bid.is_current && bid.rank ? ` · Rank ${bid.rank}` : ''}{bid.selected ? ' · Selected' : bid.passed ? ' · Passed' : ''}</span>
                            <span className="tnum">{dollars(bid.daily_rate)} / day · {new Date(bid.submitted_at).toLocaleString()}</span>
                          </li>)}
                        </ul>
                      </details>
                    </div>
                  </div>
                </Surface>;
              })}
              {items.length < total && <div className="text-center"><Button variant="secondary" disabled={loadingMore} loading={loadingMore} loadingLabel="Loading bids..." onClick={() => void loadMore()}>Load more bids</Button></div>}
            </div>}
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
  const [activePhoto, setActivePhoto] = useState(0);
  const [ownerAvatar, setOwnerAvatar] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListing(null);
    setOwnerAvatar(null);
    setError(null);
    async function load() {
      try {
        if (!UUID_RE.test(id)) throw new Error('This bidding link is invalid. Return to Bidding to choose a listing.');
        const row = await fetchListingById(id);
        if (row?.auction_enabled) {
          const [enriched] = await enrichListingsWithRatings([toUiListing(row)]);
          if (active) {
            setListing(enriched);
            setOwnerAvatar(row.owner?.avatar_url ?? null);
          }
        } else if (active) setListing(null);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load these bidding details. Please retry.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id, retry, user?.id]);

  return <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-5">
    <Button variant="ghost" icon={<ChevronLeft size={18} aria-hidden="true" />} onClick={() => navigate({ name: 'bidding' })}>Back to Bidding</Button>
    {loading ? <ListingGridSkeleton /> : error ? <Alert tone="error" title="Bidding details could not be loaded">
      <p>{error}</p><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry</Button>
    </Alert> : !listing ? <EmptyState icon={<Gavel size={24} />} title="Bidding listing not found"
      description="This rental is unavailable or does not have competitive bidding enabled."
      actionLabel="Explore bidding" onAction={() => navigate({ name: 'bidding' })} /> : <>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,0.85fr)_minmax(0,2.15fr)]">
      <header className="min-w-0 space-y-4 rounded-card-lg border border-app bg-card p-4">
        <div className="relative">
          <AuctionImage url={listing.images[activePhoto] ?? null} />
          {listing.images.length > 1 && <>
            <Button type="button" variant="secondary" aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 !rounded-full !p-2" onClick={() => setActivePhoto(index => (index - 1 + listing.images.length) % listing.images.length)}><ChevronLeft size={18} aria-hidden="true" /></Button>
            <Button type="button" variant="secondary" aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 !rounded-full !p-2" onClick={() => setActivePhoto(index => (index + 1) % listing.images.length)}><ChevronRight size={18} aria-hidden="true" /></Button>
            <span className="absolute bottom-2 right-2 rounded-full bg-[rgba(0,0,0,0.75)] px-2 py-1 text-xs text-white">{activePhoto + 1} / {listing.images.length}</span>
          </>}
        </div>
        {listing.images.length > 1 && <div className="flex gap-2 overflow-x-auto pb-2">{listing.images.map((photo, index) => <button key={`${photo}:${index}`} type="button" aria-label={`View photo ${index + 1}`} aria-pressed={activePhoto === index} onClick={() => setActivePhoto(index)} className={`h-16 w-16 shrink-0 overflow-hidden rounded-card border-2 ${activePhoto === index ? 'border-accent' : 'border-app'}`}><img src={photo} alt="" className="h-full w-full object-cover" /></button>)}</div>}
        <h1 className="text-2xl font-bold font-display text-main break-words">{listing.title}</h1>
        <p className="text-sm text-sec">{listing.category} · {listing.pickup}</p>
        <div className="flex items-center gap-3 rounded-card border border-app bg-subtle p-3">
          {ownerAvatar ? <img src={ownerAvatar} alt="" onError={() => setOwnerAvatar(null)} className="h-10 w-10 shrink-0 rounded-full object-cover" /> :
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent">{listing.owner.name.trim().slice(0, 1).toUpperCase()}</span>}
          <div className="min-w-0"><p className="font-semibold text-main">{listing.owner.name}</p><p className="text-xs text-sec">Owner · {listing.owner.rentals ? `${listing.owner.rating.toFixed(1)} stars (${listing.owner.rentals} reviews)` : 'No owner reviews'}</p></div>
        </div>
        {listing.description.trim() && listing.description.trim() !== listing.title.trim() && <p className="text-sm text-sec whitespace-pre-wrap">{listing.description}</p>}
        <div className="rounded-card border border-app p-4"><p className="text-xs text-sec">Listed rental price</p><p className="mt-1 text-xl font-bold">{dollars(listing.pricePerDay)}<span className="text-sm font-normal text-sec"> / day</span></p></div>
        <Button variant="secondary" className="w-full" onClick={() => navigate({ name: 'listing', id })}>Book at Listed Price</Button>
      </header>
      {listing.owner.id === user?.id ? <Surface className="p-5 space-y-3">
        <h2 className="text-lg font-semibold text-main">Manage bidding</h2>
        <p className="text-sm text-sec">Review bidders, select a winner and track payment. Other bidders see bids without names.</p>
        <Button onClick={() => navigate({ name: 'bidding', view: 'owner' })}>Manage my bidding listings</Button>
      </Surface> : <ListingAuctionPanel key={`${id}:${user?.id ?? 'anonymous'}`} listingId={id} deposit={listing.deposit} listedPrice={listing.pricePerDay} replacementValue={listing.declaredValue} />}
      </div>
    </>}
  </div>;
}
