import { useEffect, useId, useState } from 'react';
import { CalendarDays, ChevronUp, Flame, Package, Pause, Play, Tag, Zap } from 'lucide-react';
import { Alert, Button } from '@/main-site/components/ui';
import { getTopListingBids } from '@/lib/listing-auctions';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { BIDDING_SAMPLES } from '@/lib/bidding-samples';
import { useRouter } from '@/router';
import { auctionCountdown } from '@/lib/auction-countdown';

interface TopBid {
  listing_id: string;
  title: string;
  daily_rate: number;
  start_date: string;
  end_date: string;
  expires_at: string;
  image_url: string | null;
  synthetic?: boolean;
}

const DEMO_BADGES = [
  { label: 'HOT', Icon: Flame, tone: 'hot' },
  { label: 'POPULAR', Icon: Zap, tone: 'popular' },
  { label: 'GREAT DEAL', Icon: Tag, tone: 'deal' },
];

function dateAfter(days: number): string {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function createDemoOffers(now: number): TopBid[] {
  return BIDDING_SAMPLES.map((offer, index) => {
    const start = index * 4 + 5;
    return {
      ...offer,
      synthetic: true,
      start_date: dateAfter(start),
      end_date: dateAfter(start + 3),
      expires_at: new Date(now + 30 * 86400000).toISOString(),
    };
  });
}

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

function timeToBid(expiresAt: string, now: number): string {
  return `${auctionCountdown(expiresAt, now)} left to bid`;
}

export function BiddingTicker() {
  const { navigate } = useRouter();
  const { enabled } = useFeatureFlag('bidding');
  const { enabled: mockBidding } = useFeatureFlag('mock_bidding');
  const [rows, setRows] = useState<TopBid[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [motionStopped, setMotionStopped] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const liveOffers = rows?.filter((row) => Date.parse(row.expires_at) > now) ?? [];
  const demoOffers = mockBidding && !error && rows !== null && liveOffers.length === 0 ? createDemoOffers(now) : [];
  const offers = liveOffers.length ? liveOffers : demoOffers;
  const isDemoFeed = liveOffers.length === 0 && demoOffers.length > 0;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function refresh() {
      try {
        const rows = await getTopListingBids();
        if (!active) return;
        setError(null);
        setRows(rows);
        setNow(Date.now());
      } catch (error) {
        if (!active) return;
        setError(error instanceof Error ? error.message : 'Could not load live bidding photos.');
        setRows([]);
      }
    }
    void refresh();
    const poll = window.setInterval(() => void refresh(), 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('ybuy-auction-published', refresh);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('ybuy-auction-published', refresh);
    };
  }, [enabled, retry]);

  if (!enabled) return null;
  return (
    <section aria-label="Live bidding auctions" className={`bid-banner${motionStopped ? ' bid-banner-stopped' : ''}${collapsed ? ' bid-banner-collapsed' : ''}`}>
      <div id={contentId} className="bid-banner-inner" hidden={collapsed}>
        {error ? (
          <div className="bid-banner-error">
            <Alert tone="error" title="Live offers unavailable">
              {error}
              <Button size="sm" variant="secondary" className="ml-2" onClick={() => setRetry((value) => value + 1)}>Retry offers</Button>
            </Alert>
          </div>
        ) : (
          <>
        <div className="bid-banner-heading">
          <div className="flex items-center gap-2">
          <a href="/bidding" className="bid-banner-live" onClick={event => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault(); navigate({ name: 'bidding' });
            }
          }}>
            <span aria-hidden="true" />
            LIVE BIDDING
          </a>
          <button type="button" className="bid-banner-motion" aria-label={motionStopped ? 'Resume bidding ribbon motion' : 'Pause bidding ribbon motion'} aria-pressed={motionStopped} onClick={() => setMotionStopped(value => !value)}>
            {motionStopped ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
          </button>
          </div>
          <h2>Live auctions</h2>
          <p className="bid-banner-subtitle">New auctions first · refreshes every 15 sec</p>
          {isDemoFeed && <span className="bid-banner-demo">TEST DATA</span>}
        </div>
        {rows === null ? (
          <p role="status" className="bid-banner-message">Loading live auctions…</p>
        ) : offers.length === 0 ? (
          <p className="bid-banner-message">No open auctions right now. Scheduled auctions appear when bidding opens. <a className="underline font-semibold" href="/bidding">View bidding</a></p>
        ) : (
          <div className="bid-banner-viewport" tabIndex={0} role="group" aria-label={isDemoFeed ? 'Sample rental offers' : 'Live rental offers'}>
            <div className="bid-banner-track">
              {[0, 1].map(copy => (
                <ul key={copy} className={`bid-banner-group${copy ? ' bid-banner-copy' : ''}`} aria-hidden={copy ? true : undefined}>
                  {offers.map((row, index) => {
                    const badge = row.synthetic ? DEMO_BADGES[index % DEMO_BADGES.length] : { label: 'LIVE AUCTION', Icon: Tag, tone: 'deal' };
                    const card = (
                      <>
                        <span className="bid-card-rank">{String(index + 1).padStart(2, '0')}</span>
                        <span className={`bid-card-badge bid-card-badge-${badge.tone}`}>
                          <badge.Icon size={17} aria-hidden="true" />{badge.label}
                          {!row.synthetic && <time className="tnum" dateTime={row.expires_at} title={`Bidding closes ${new Date(row.expires_at).toLocaleString()}`}> · {timeToBid(row.expires_at, now)}</time>}
                        </span>
                        <BidImage key={row.image_url} url={row.image_url} />
                        <span className="bid-card-content">
                          <span className="bid-card-title" title={row.title}>{row.title}</span>
                          <span className="bid-card-dates"><CalendarDays size={20} aria-hidden="true" />{formatDate(row.start_date)} – {formatDate(row.end_date)}</span>
                          <span className="bid-card-price">${Number(row.daily_rate).toFixed(0)}<span> / day</span></span>
                        </span>
                      </>
                    );
                    return (
                      <li key={row.listing_id} className="bid-banner-item">
                        {row.synthetic ? (
                          <a href="/bidding" className="bid-card bid-card-demo" tabIndex={copy ? -1 : 0}
                            aria-label={`Demo offer ${index + 1}: ${row.title}. Browse sample bidding`}
                            onFocus={event => event.currentTarget.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })}
                          >{card}</a>
                        ) : (
                          <a
                            href={`/bidding/${row.listing_id}`}
                            className="bid-card"
                            title={row.title}
                            tabIndex={copy ? -1 : 0}
                            onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })}
                          >{card}</a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
          </div>
        )}
          </>
        )}
      </div>
      <button
        type="button"
        className="bid-banner-sleeve"
        aria-label={collapsed ? 'Expand bidding banner' : 'Minimize bidding banner'}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => setCollapsed(value => !value)}
      >
        {collapsed ? <span className="bid-banner-live"><span aria-hidden="true" />LIVE BIDDING</span> : <><ChevronUp size={16} aria-hidden="true" /><span>Hide</span></>}
      </button>
    </section>
  );
}
