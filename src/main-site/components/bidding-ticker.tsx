import { useEffect, useId, useState } from 'react';
import { CalendarDays, ChevronUp, Package, Pause, Play, Tag } from 'lucide-react';
import { Alert, Button } from '@/main-site/components/ui';
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
  const { enabled } = useFeatureFlag('bidding');
  const [rows, setRows] = useState<TopListingBid[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [motionStopped, setMotionStopped] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
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
        setError(reason instanceof Error ? reason.message : 'Could not load live auctions.');
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

  if (!enabled || (!error && (rows === null || offers.length === 0))) return null;

  return (
    <section aria-label="Live bidding" className={`bid-banner${motionStopped ? ' bid-banner-stopped' : ''}${collapsed ? ' bid-banner-collapsed' : ''}`}>
      <div id={contentId} className="bid-banner-inner" hidden={collapsed}>
        {error ? (
          <div className="bid-banner-error">
            <Alert tone="error" title="Live bids are unavailable">
              {error}
              <Button size="sm" variant="secondary" className="ml-2" onClick={() => setRetry((value) => value + 1)}>Try again</Button>
            </Alert>
          </div>
        ) : (
          <>
            <header className="bid-banner-heading">
              <div className="flex items-center gap-2">
                <a href="/bidding" className="bid-banner-live"><span aria-hidden="true" />LIVE BIDDING</a>
                <button type="button" className="bid-banner-motion" aria-label={motionStopped ? 'Resume bidding ribbon motion' : 'Pause bidding ribbon motion'} aria-pressed={motionStopped} onClick={() => setMotionStopped(value => !value)}>
                  {motionStopped ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
                </button>
              </div>
              <h2>Closing soon</h2>
              <p className="bid-banner-subtitle">{offers.length} live offer{offers.length === 1 ? '' : 's'} taking bids</p>
            </header>
            <div className="bid-banner-viewport" tabIndex={0} role="group" aria-label="Live rental offers">
              <div className="bid-banner-track">
                {[0, 1].map(copy => (
                  <ul key={copy} className={`bid-banner-group${copy ? ' bid-banner-copy' : ''}`} aria-hidden={copy ? true : undefined}>
                    {offers.map((row, index) => {
                      const activity = row.bid_count > 0
                        ? `${row.bid_count} bid${row.bid_count === 1 ? '' : 's'} · ${row.participant_count} bidder${row.participant_count === 1 ? '' : 's'}`
                        : 'Waiting for first bid';
                      const label = `${row.title}. ${row.has_bids ? 'Current high bid' : 'Opening bid'} ${formatRate(row.daily_rate)} per day. ${activity}. ${timeToBid(row.expires_at, now)}. Rental dates ${formatDate(row.start_date)} to ${formatDate(row.end_date)}.`;
                      return (
                        <li key={row.listing_id} className="bid-banner-item">
                          <a href={`/bidding/${row.listing_id}`} className="bid-card" aria-label={label} tabIndex={copy ? -1 : 0}
                            onFocus={event => event.currentTarget.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })}>
                            <span className="bid-card-rank">{String(index + 1).padStart(2, '0')}</span>
                            <span className="bid-card-badge bid-card-badge-deal">
                              <Tag size={17} aria-hidden="true" />LIVE BIDDING
                              <time dateTime={row.expires_at}> · {timeToBid(row.expires_at, now)}</time>
                            </span>
                            <BidImage key={row.image_url} url={row.image_url} />
                            <span className="bid-card-content">
                              <span className="bid-card-title" title={row.title}>{row.title}</span>
                              <span className="bid-card-dates"><CalendarDays size={20} aria-hidden="true" />{formatDate(row.start_date)} – {formatDate(row.end_date)}</span>
                              <span className="bid-card-price">{formatRate(row.daily_rate)}<span> / day</span></span>
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                ))}
              </div>
            </div>
            <p className="sr-only" role="status" aria-atomic="true">
              {offers.length} live offer{offers.length === 1 ? '' : 's'} taking bids, with {bidCount} bids across the featured offers.
            </p>
          </>
        )}
      </div>
      <button type="button" className="bid-banner-sleeve" aria-label={collapsed ? 'Expand bidding banner' : 'Minimize bidding banner'}
        aria-expanded={!collapsed} aria-controls={contentId} onClick={() => setCollapsed(value => !value)}>
        {collapsed ? <span className="bid-banner-live"><span aria-hidden="true" />LIVE BIDDING</span> : <><ChevronUp size={16} aria-hidden="true" /><span>Hide</span></>}
      </button>
    </section>
  );
}
