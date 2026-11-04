import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Package } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { fetchListingById, fetchListingsByOwner, toUiListing } from '@/lib/listings';
import { auctionCountdown } from '@/lib/auction-countdown';
import { getListingAuction, getListingAuctionFeed, placeListingAuctionBid, selectListingAuctionWinner,
  type AuctionFeed, type ListingAuction } from '@/lib/listing-auctions';
import { canPlacePreviewBid, canSelectPreviewWinner } from '@/lib/auction-eligibility';
import { Button, Empty, ErrorNote, Field, PageHead, Tag, Avatar, money } from '@/preview-1/ui';
import { href } from '@/preview-1/state';
import { AuctionCard, BiddingLayout, BidRoomLayout } from '@/preview-1/bidding';
import { OwnerBiddingDashboard, type OwnerAuction } from '@/pages/bidding';

const rentalDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : 'Could not load live bidding. Please retry.';

function Countdown({ until, now }: { until: string | null; now: number }) {
  if (!until) return <span className="p1-countdown">Not scheduled</span>;
  return <span className="p1-countdown">{auctionCountdown(until, now)}</span>;
}

function AuctionImage({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} />
    : <div className="h-full w-full bg-subtle grid place-items-center" role="img" aria-label={`${alt} image unavailable`}><Package size={40} strokeWidth={1.5} aria-hidden="true" /></div>;
}

export function PreviewBidding() {
  const { user } = useAuth();
  const { enabled, loading: flagLoading, error: flagError, reload } = useFeatureFlag('bidding');
  const [feed, setFeed] = useState<AuctionFeed | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [ownerAuctionsState, setOwnerAuctionsState] = useState<{ ownerId: string; auctions: OwnerAuction[] } | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [ownerRetry, setOwnerRetry] = useState(0);
  const [selectingBidId, setSelectingBidId] = useState<string | null>(null);
  const [view, setView] = useState<'explore' | 'owner'>('explore');
  const defaultedUser = useRef<string | null>(null);
  const ownerAuctions = ownerAuctionsState && ownerAuctionsState.ownerId === user?.id ? ownerAuctionsState.auctions : [];

  useEffect(() => {
    if (flagLoading || flagError || !enabled) { setLoading(false); return; }
    let active = true;
    async function load() {
      try {
        const pages = await Promise.all(Array.from({ length: offset / 24 + 1 }, (_, index) => getListingAuctionFeed(category, index * 24)));
        if (!active) return;
        setFeed({ ...pages[0], items: pages.flatMap(page => page.items) });
        setError(null);
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { if (active) setLoading(false); }
    }
    setLoading(true); void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [category, enabled, flagError, flagLoading, offset, retry]);

  useEffect(() => {
    if (!user?.id) {
      defaultedUser.current = null;
      setOwnerAuctionsState(null);
      setOwnerError(null);
      setOwnerLoading(false);
      setView('explore');
      return;
    }
    if (flagLoading || flagError || !enabled) return;

    const ownerId = user.id;
    let active = true;
    let requestPending = false;
    async function loadOwnerAuctions() {
      if (requestPending) return;
      requestPending = true;
      try {
        const rows = await fetchListingsByOwner(ownerId);
        const listings = rows.map(toUiListing).filter(listing => listing.auctionEnabled);
        const results = await Promise.all(listings.map(async listing => ({
          listing,
          auction: await getListingAuction(listing.id),
        })));
        if (!active) return;
        const auctions = results.filter((item): item is OwnerAuction => item.auction !== null);
        setOwnerAuctionsState({ ownerId, auctions });
        setOwnerError(null);
        if (defaultedUser.current !== ownerId) {
          defaultedUser.current = ownerId;
          setView(auctions.length ? 'owner' : 'explore');
        }
      } catch (reason) {
        if (!active) return;
        setOwnerError(errorMessage(reason));
        if (defaultedUser.current !== ownerId) {
          defaultedUser.current = ownerId;
          setView('explore');
        }
      } finally {
        requestPending = false;
        if (active) setOwnerLoading(false);
      }
    }
    setOwnerLoading(true);
    void loadOwnerAuctions();
    const timer = window.setInterval(() => { if (!document.hidden) void loadOwnerAuctions(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [enabled, flagError, flagLoading, ownerRetry, user?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (flagLoading) return <main className="p1-container p1-page"><PageHead title="Great gear. Your bid." /><p role="status" aria-busy="true">Checking live bidding…</p></main>;
  if (flagError) return <main className="p1-container p1-page"><PageHead title="Great gear. Your bid." /><ErrorNote>{flagError}</ErrorNote><Button variant="secondary" onClick={() => void reload()}>Retry bidding</Button></main>;
  if (!enabled) return <main className="p1-container p1-page"><PageHead title="Great gear. Your bid." description="Live auctions are not available right now." />
    <Empty title="Live bidding is unavailable." body="No sample auctions or simulated bids are shown here. Check back when live bidding is available." /></main>;

  const categories = feed?.categories ?? [];
  const items = feed?.items.filter(item => Date.parse(item.expires_at) > now) ?? [];
  const total = feed?.total ?? 0;
  const sectionNav = user && <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5">
    <nav aria-label="Bidding sections" className="p1-tabs">
      <button type="button" aria-pressed={view === 'owner'} onClick={() => setView('owner')}>
        My auctions{ownerAuctions.length ? ` (${ownerAuctions.length})` : ''}
      </button>
      <button type="button" aria-pressed={view === 'explore'} onClick={() => setView('explore')}>Explore auctions</button>
    </nav>
  </div>;

  function filter(id: string | null) {
    if (id === category) return;
    setCategory(id); setOffset(0); setFeed(null); setLoading(true); setError(null);
  }

  if (user && view === 'owner') return <>
    {sectionNav}
    <OwnerBiddingDashboard
      auctions={ownerAuctions}
      loading={ownerLoading}
      error={ownerError}
      selectingBidId={selectingBidId}
      onRefresh={() => { setOwnerLoading(true); setOwnerRetry(value => value + 1); }}
      onExplore={() => setView('explore')}
      onSelectWinner={async (listingId, bidId) => {
        setSelectingBidId(bidId);
        try {
          const auction = await selectListingAuctionWinner(listingId, bidId);
          setOwnerAuctionsState(current => current?.ownerId === user.id
            ? { ...current, auctions: current.auctions.map(item => item.listing.id === listingId ? { ...item, auction } : item) }
            : current);
          setOwnerError(null);
        } catch (reason) {
          setOwnerError(errorMessage(reason));
        } finally {
          setSelectingBidId(null);
        }
      }}
    />
  </>;

  return <>
    {sectionNav}
    <BiddingLayout categories={
        [{ id: null, name: 'All' }, ...categories].map(option =>
          <button type="button" key={option.id ?? 'all'} aria-pressed={category === option.id} disabled={loading}
            onClick={() => filter(option.id)}>{option.name}</button>)
    }>
    {ownerError && <div role="alert" className="mb-4"><ErrorNote>{ownerError}</ErrorNote><Button variant="secondary" onClick={() => { setOwnerLoading(true); setOwnerRetry(value => value + 1); }}>Retry your auctions</Button></div>}
    <p role="status" aria-live="polite" className="text-sm text-sec mb-4">
      {loading ? 'Loading auctions...' : error ? 'Auctions could not be refreshed.' : `${total} open ${total === 1 ? 'auction' : 'auctions'}${category ? ` in ${categories.find(item => item.id === category)?.name ?? 'this category'}` : ''}`}
    </p>
    {error && <div role="alert"><ErrorNote>{error}</ErrorNote><Button variant="secondary" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Retry auctions</Button></div>}
    <div aria-busy={loading}>
      {loading && !feed ? <p role="status">Finding live auctions…</p> : items.length ? <>
        <div className="p1-auction-grid" aria-label="Open auctions">
          {items.map(item => <AuctionCard key={item.listing_id} id={item.listing_id} title={item.title}
            image={<AuctionImage url={item.image_url} alt={item.title} />} countdown={<Countdown until={item.expires_at} now={now} />}
            category={item.category_name} status={<Tag tone="lime">Live bidding</Tag>} price={item.daily_rate}
            priceLabel={item.has_bids ? 'Top bid per day' : 'Starting bid per day'}
            owner={<><Clock size={14} aria-hidden="true" /><span>{rentalDate(item.start_date)} – {rentalDate(item.end_date)}</span></>} />)}
        </div>
        {feed && feed.items.length < feed.total && <div className="mt-6 text-center">
          <Button variant="secondary" disabled={loading} onClick={() => { setLoading(true); setOffset(value => value + 24); }}>Load more auctions</Button>
        </div>}
      </> : !error && !loading && <Empty title="No open auctions right now"
        body={category ? 'Try another category or return to all categories.' : 'Check back soon for new rental auctions, or browse available listings.'}>
        {category ? <Button variant="secondary" onClick={() => filter(null)}>Clear category filter</Button> : <a className="p1-button p1-button-secondary" href={href('search')}>Browse rentals</a>}
      </Empty>}
    </div>
    </BiddingLayout>
  </>;
}

function auctionStatus(auction: ListingAuction): { label: string; tone: 'neutral' | 'good' | 'pending' | 'blue' | 'lime' | 'bad' } {
  switch (auction.status) {
    case 'scheduled': return { label: 'Scheduled', tone: 'blue' };
    case 'open': return { label: 'Live auction', tone: 'lime' };
    case 'owner_selection': return { label: 'Owner decision', tone: 'pending' };
    case 'awaiting_payment': return { label: 'Payment pending', tone: 'pending' };
    case 'completed': return { label: 'Completed', tone: 'good' };
    case 'ended': return { label: 'Ended', tone: 'neutral' };
    case 'cancelled': return { label: 'Cancelled', tone: 'bad' };
  }
}

function auctionDeadline(auction: ListingAuction): string | null {
  if (auction.status === 'scheduled') return auction.starts_at ?? null;
  if (auction.status === 'owner_selection') return auction.selection_deadline;
  if (auction.status === 'awaiting_payment') return auction.payment_deadline;
  return auction.ends_at;
}

export function PreviewBidRoom({ id }: { id: string }) {
  const { user, openSignIn } = useAuth();
  const { navigate } = useRouter();
  const { enabled, loading: flagLoading, error: flagError, reload } = useFeatureFlag('bidding');
  const [listing, setListing] = useState<ReturnType<typeof toUiListing> | null>(null);
  const [auction, setAuction] = useState<ListingAuction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const serverOffset = useRef(0);
  const pendingBid = useRef<{ rate: number; key: string } | null>(null);
  const mounted = useRef(false);

  const applyAuction = useCallback((value: ListingAuction) => {
    serverOffset.current = Date.parse(value.server_now) - Date.now();
    setAuction(value);
    setRate(value.minimum_next_bid.toFixed(2));
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [row, value] = await Promise.all([fetchListingById(id), getListingAuction(id)]);
      if (!mounted.current) return;
      if (!row || !value) { setListing(null); setAuction(null); setError(null); }
      else { setListing(toUiListing(row)); applyAuction(value); }
    } catch (reason) { if (mounted.current) setError(errorMessage(reason)); }
    finally { if (mounted.current) setLoading(false); }
  }, [applyAuction, id]);

  useEffect(() => {
    if (flagLoading || flagError || !enabled) { setLoading(false); return; }
    mounted.current = true; setLoading(true); setListing(null); setAuction(null); setError(null);
    void refresh();
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const tick = window.setInterval(() => setNow(Date.now() + serverOffset.current), 1000);
    return () => { mounted.current = false; window.clearInterval(poll); window.clearInterval(tick); };
  }, [enabled, flagError, flagLoading, refresh]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!auction || !canPlacePreviewBid(auction, now) || !user) return;
    const amount = Number(rate);
    setBusy(true); setError(null);
    try {
      if (!rate.trim() || !Number.isFinite(amount) || amount < auction.minimum_next_bid) {
        throw new Error(`Enter a bid of at least ${money(auction.minimum_next_bid)} per day.`);
      }
      if (!pendingBid.current || pendingBid.current.rate !== amount) pendingBid.current = { rate: amount, key: crypto.randomUUID() };
      applyAuction(await placeListingAuctionBid(id, amount, pendingBid.current.key));
      pendingBid.current = null;
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  if (flagLoading || loading) return <main className="p1-container p1-page"><p role="status" aria-busy="true">Loading current bids…</p></main>;
  if (flagError) return <main className="p1-container p1-page"><ErrorNote>{flagError}</ErrorNote><Button variant="secondary" onClick={() => void reload()}>Retry bidding</Button></main>;
  if (!enabled) return <main className="p1-container p1-page"><Empty title="Live bidding is unavailable." body="No sample auction or simulated payment is shown." /></main>;
  if (error && !auction) return <main className="p1-container p1-page"><ErrorNote>{error}</ErrorNote><Button variant="secondary" onClick={() => { setLoading(true); void refresh(); }}>Retry auction</Button></main>;
  if (!listing || !auction) return <main className="p1-container p1-page"><Empty title="This auction isn’t here." body="It may have ended or been removed. Choose another live auction.">
    <a className="p1-button p1-button-secondary" href={href('bidding')}>See live bidding</a>
  </Empty></main>;

  const status = auctionStatus(auction);
  const deadline = auctionDeadline(auction);
  const top = auction.top_bids[0]?.daily_rate ?? listing.pricePerDay;
  const mayBid = canPlacePreviewBid(auction, now);
  const maySelect = canSelectPreviewWinner(auction, now);
  const leading = auction.my_daily_rate !== null && auction.my_daily_rate === top;

  return <BidRoomLayout
    error={error && <div role="alert"><ErrorNote>{error}</ErrorNote><Button variant="secondary" disabled={busy} onClick={() => void refresh()}>Refresh bids</Button></div>}
    heading={<>
      <AuctionImage url={listing.images[0] ?? null} alt={listing.title} />
      <div><h1>{listing.title}</h1><p><Avatar src={listing.owner.avatar} name={listing.owner.name} size={27} /> From {listing.owner.name} · {rentalDate(auction.start_date)} – {rentalDate(auction.end_date)}</p><Tag tone={status.tone}>{status.label}</Tag></div>
      <div><small>{auction.status === 'scheduled' ? 'Bidding opens in' : auction.status === 'owner_selection' ? 'Owner selection ends in' : auction.status === 'awaiting_payment' ? 'Payment deadline' : auction.status === 'open' ? 'Bidding closes in' : 'Auction status'}</small><Countdown until={deadline} now={now} />
        {deadline && <time dateTime={deadline}>{new Date(deadline).toLocaleString()}</time>}</div>
    </>}>
      <div className="p1-bid-price"><span>{auction.top_bids.length ? 'Top daily bid' : 'Starting daily price'}</span><strong>{money(top)}</strong>
        <small>{auction.my_bid_count} of 3 of your bids used</small></div>
      {auction.is_owner && maySelect && <div className="p1-info-copy"><h2>Review your bidders</h2><p>Choose an eligible renter before bidding closes. Undecided bidding expires. Payment must still be verified before the rental is confirmed.</p>
        <Button variant="secondary" onClick={() => navigate({ name: 'bidding' })}>Open My auctions</Button></div>}
      {!auction.is_owner && auction.status === 'open' && user && (leading ? <Tag tone="lime">You’re currently leading</Tag> : <Tag tone="neutral">Your next bid could be the one</Tag>)}
      {!auction.is_owner && mayBid && user && <form onSubmit={event => void submit(event)}>
        {auction.my_daily_rate !== null && <p className="p1-muted">Your highest bid: {money(auction.my_daily_rate)} / day.</p>}
        <Field label="Your bid per day"><input type="number" step="0.01" min={auction.minimum_next_bid} value={rate}
          onChange={event => setRate(event.target.value)} aria-invalid={Boolean(error)} /></Field>
        <p className="p1-muted">The platform-configured minimum increase is {money(auction.minimum_increment)} per day.</p>
        <div className="p1-actions">{[2, 5, 10].map(amount => <Button key={amount} variant="secondary" type="button"
          onClick={() => setRate((auction.minimum_next_bid + amount).toFixed(2))}>+{money(amount)}</Button>)}</div>
        <Button type="submit" className="p1-full" disabled={busy}>{busy ? 'Placing bid…' : `Place bid · ${money(Number(rate) || 0)} / day`}</Button>
        <p className="p1-muted">{auction.my_bid_count} of 3 bids used. No payment is taken when bidding.</p>
      </form>}
      {!auction.is_owner && !user && auction.status === 'open' && <Button onClick={openSignIn}>Sign in to place a bid</Button>}
      {auction.my_booking_id && auction.status === 'awaiting_payment' && <div role="status"><p>Your bid was selected. Complete the existing checkout before its deadline.</p>
        <Button onClick={() => navigate({ name: 'confirmation', id: auction.my_booking_id! })}>Continue to payment</Button></div>}
      {auction.status === 'completed' && auction.my_booking_id && <Button onClick={() => navigate({ name: 'confirmation', id: auction.my_booking_id! })}>View booking</Button>}
      {!auction.is_owner && auction.status === 'scheduled' && <p className="p1-muted">Bidding opens at the scheduled time. You can place up to three bids after it opens.</p>}
      {!auction.is_owner && ['ended', 'cancelled'].includes(auction.status) && <p className="p1-muted">This auction is closed. No further bids can be placed.</p>}
      {auction.is_owner && auction.status === 'owner_selection' && !maySelect && <p className="p1-muted">Bidding has closed. No bidder will be selected automatically.</p>}
      <h2>Top bids <span className="p1-muted">(anonymous)</span></h2>
      {auction.top_bids.length ? auction.top_bids.map(bid => <div className="p1-bid-row" key={bid.id}>
        <span>Eligible bid {bid.rank}</span><b>{money(bid.daily_rate)} / day · {bid.bid_count} {bid.bid_count === 1 ? 'bid' : 'bids'}</b>
        {!auction.is_owner && <Tag tone={auction.my_daily_rate === bid.daily_rate ? 'lime' : 'pending'}>{auction.my_daily_rate === bid.daily_rate ? 'Your bid' : `#${bid.rank}`}</Tag>}
      </div>) : <p className="p1-muted">No bids yet. The opening price is {money(auction.minimum_next_bid)} per day.</p>}
      {!auction.is_owner && user && <section aria-labelledby="my-auction-bids-title" className="mt-5">
        <h2 id="my-auction-bids-title">Your bid history</h2>
        <p className="p1-muted">{auction.my_rank ? `Your current rank is #${auction.my_rank}.` : 'You are not currently ranked among eligible bids.'}</p>
        {auction.my_bids.length > 0 ? <ol className="space-y-2">
          {auction.my_bids.map(bid => <li key={bid.id} className="p1-bid-row">
            <span>{new Date(bid.submitted_at).toLocaleString()}</span>
            <b>{money(bid.daily_rate)} / day</b>
            <span>{bid.selected ? 'Selected' : bid.passed ? 'Payment window expired' : bid.is_current ? 'Current bid' : 'Earlier bid'}</span>
            {bid.rank !== null && <Tag tone={bid.rank === 1 ? 'lime' : 'pending'}>#{bid.rank}</Tag>}
          </li>)}
        </ol> : <p className="p1-muted">You have not placed a bid in this auction.</p>}
      </section>}
  </BidRoomLayout>;
}
