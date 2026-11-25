import { useEffect, useState } from 'react';
import { ArrowRight, Gavel, Package } from 'lucide-react';
import { getTopListingBids, subscribeToAuctionTickerUpdates, type TopListingBid } from '@/lib/listing-auctions';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { auctionCountdown } from '@/lib/auction-countdown';

function BidImage({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="bid-card-image">
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : <Package size={23} aria-hidden="true" />}
    </span>
  );
}

const formatDate = (value: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));

const formatRate = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(value);

function timeToBid(expiresAt: string, now: number): string {
  return `${auctionCountdown(expiresAt, now)} left to bid`;
}

export function BiddingTicker() {
  const flag = useFeatureFlag('bidding');
  const enabled = flag.enabled;
  const lastEnabled = flag.data?.find(item => item.key === 'bidding')?.enabled;
  const [rows, setRows] = useState<TopListingBid[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const offers = rows?.filter((row) => Date.parse(row.expires_at) > now).slice(0, 3) ?? [];
  const bidCount = offers.reduce((total, row) => total + row.bid_count, 0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function refresh() {
      try {
        const nextRows = await getTopListingBids();
        if (!active) return;
        setError(null);
        setRows(nextRows);
        setNow(Date.now());
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Could not load live bidding.');
        setRows([]);
      }
    }

    void refresh();
    const poll = window.setInterval(() => void refresh(), 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const unsubscribe = subscribeToAuctionTickerUpdates(() => { void refresh(); });
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('ybuy-auction-published', refresh);
    window.addEventListener('ybuy-auction-updated', refresh);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
      unsubscribe();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('ybuy-auction-published', refresh);
      window.removeEventListener('ybuy-auction-updated', refresh);
    };
  }, [enabled, retry]);

  if (flag.data && !lastEnabled) return null;
  const waiting = flag.loading || (enabled && rows === null && !error);
  const unavailable = flag.error || error;
  if (!waiting && !unavailable && offers.length === 0) return null;

  return (
    <section aria-label="Bidding" className="bid-banner">
      <div className="bid-banner-inner">
        <div className="bid-banner-heading">
          <span className="bid-banner-mark"><Gavel size={19} aria-hidden="true" /></span>
          <div>
            <h2>Live bidding</h2>
            <p>{waiting ? 'Loading current offers' : unavailable ? 'Bidding is temporarily unavailable' : 'Offers from your community'}</p>
          </div>
        </div>
        {unavailable && !waiting ? <div className="bid-banner-error" role="alert">
          <span>{unavailable}</span>
          <button type="button" onClick={() => flag.error ? flag.reload() : setRetry(value => value + 1)}>Try again</button>
        </div> : !waiting && offers.length > 0 ? <div className="bid-banner-viewport" role="group" aria-label="Live rental offers">
              <ul className="bid-banner-list">
                    {offers.map(row => {
                      const activity = row.bid_count > 0
                        ? `${row.bid_count} bid${row.bid_count === 1 ? '' : 's'} · ${row.participant_count} bidder${row.participant_count === 1 ? '' : 's'}`
                        : 'Waiting for first bid';
                      const label = `${row.title}. ${row.has_bids ? 'Current high bid' : 'Opening bid'} ${formatRate(row.daily_rate)} per day. ${activity}. ${timeToBid(row.expires_at, now)}. Rental dates ${formatDate(row.start_date)} to ${formatDate(row.end_date)}.`;
                      return (
                        <li key={row.listing_id} className="bid-banner-item">
                          <a href={`/bidding/${row.listing_id}`} className="bid-card" aria-label={label}>
                            <BidImage key={row.image_url} url={row.image_url} />
                            <span className="bid-card-content">
                              <span className="bid-card-title" title={row.title}>{row.title}</span>
                              <span className="bid-card-price">{formatRate(row.daily_rate)}<span> / day</span></span>
                              <span className="bid-card-dates">{row.has_bids ? 'Current bid' : 'Opening bid'} · {timeToBid(row.expires_at, now)}</span>
                            </span>
                          </a>
                        </li>
                      );
                    })}
              </ul>
            </div> : <div className="bid-banner-empty">{!waiting && !unavailable && <span>Discover what’s coming up next.</span>}</div>}
        <div className="bid-banner-actions">
          {enabled && <a href="/bidding" className="bid-banner-explore">See all bids <ArrowRight size={17} aria-hidden="true" /></a>}
        </div>
      </div>
      {!waiting && !unavailable && <p className="sr-only" role="status" aria-atomic="true">
        {offers.length} listing{offers.length === 1 ? '' : 's'} accepting bids, with {bidCount} bids across the featured listings.
      </p>}
    </section>
  );
}
