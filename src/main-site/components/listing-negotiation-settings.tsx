import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Gavel, Sparkles } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/main-site/components/ui';
import { ListingAuctionPreferences } from '@/main-site/components/listing-auction-preferences';
import { fetchListingById, type DbListingRow } from '@/lib/listings';
import { enableBiddingPreferences, getListingAuction, listingAuctionError, type ListingAuction, type ListingAuctionPreferences as AuctionPreferences } from '@/lib/listing-auctions';
import { saveAuctionPreferences } from '@/lib/listing-flow';
import { auctionPublicationMessage } from '@/lib/listing-auctions';
import { useFeatureFlag } from '@/lib/use-feature-flags';

function BiddingCelebration({ scheduled }: { scheduled: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 4200);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return createPortal(<div aria-hidden="true" className="bidding-celebration">
    <div className="bidding-celebration-stage">
      {Array.from({ length: 12 }, (_, index) => <Sparkles key={index} className="bidding-celebration-particle" style={{
        '--spark-x': `${Math.cos(index * Math.PI / 6) * (130 + index % 3 * 45)}px`,
        '--spark-y': `${Math.sin(index * Math.PI / 6) * (150 + index % 3 * 35)}px`,
        '--spark-turn': `${index % 2 ? 90 : -90}deg`,
        animationDelay: `${index % 3 * 70}ms`,
      } as CSSProperties} />)}
      <div className="bidding-celebration-hero">
        <div className="bidding-celebration-emblem">
          <i className="bidding-celebration-ring" />
          <i className="bidding-celebration-ring bidding-celebration-ring-delayed" />
          <Gavel className="bidding-celebration-gavel" strokeWidth={1.8} />
        </div>
        <p>{scheduled ? 'Ready for the bidding spotlight!' : 'Let the bidding begin!'}</p>
        <span>{scheduled ? 'Your auction is scheduled. The stage is set.' : 'Your auction is open. Let the bids roll in.'}</span>
      </div>
    </div>
  </div>, document.body);
}

export function ListingNegotiationSettings({ listingId, onSaved, startSetup = false }: { listingId: string; onSaved?: (auction: ListingAuction | null) => void; startSetup?: boolean }) {
  const { user } = useAuth();
  const flag = useFeatureFlag('bidding');
  const [listing, setListing] = useState<DbListingRow | null>(null);
  const [auction, setAuction] = useState<ListingAuction | null>(null);
  const [preferences, setPreferences] = useState<AuctionPreferences>({ enabled: false, start_date: null, end_date: null, bidding_starts_at: null, bidding_ends_at: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setListing(null); setError(null);
    void Promise.all([fetchListingById(listingId), getListingAuction(listingId)]).then(([row, current]) => {
      if (!active) return;
      if (!row || row.owner_id !== user?.id || row.status !== 'published' || !Number.isSafeInteger(row.revision)) throw new Error('Bidding settings require your published listing. Reload its current status before continuing.');
      setListing(row); setAuction(current);
      const loadedPreferences = { enabled: row.auction_enabled ?? false, start_date: row.auction_start_date ?? null, end_date: row.auction_end_date ?? null,
        date_flexible: current?.date_flexible ?? true,
        starts_immediately: current?.status === 'open',
        opening_daily_rate: row.auction_opening_daily_rate ?? row.price_per_day,
        bidding_starts_at: row.auction_bidding_starts_at ?? null, bidding_ends_at: row.auction_bidding_ends_at ?? null };
      setPreferences(startSetup && !current && !loadedPreferences.enabled
        ? enableBiddingPreferences(loadedPreferences, row.availability_start ?? '')
        : loadedPreferences);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load bidding settings. Please retry.'); });
    return () => { active = false; };
  }, [listingId, user?.id, retry, startSetup]);
  const locked = !!auction && ['scheduled', 'open', 'owner_selection', 'awaiting_payment'].includes(auction.status);
  const formatDate = (date: string | null) => date
    ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Not set';
  async function save() {
    if (!listing) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const start = listing.availability_start ?? '';
      const end = listing.availability_end ?? '';
      const auctionPreferences = { ...preferences, start_date: preferences.enabled ? preferences.start_date : null, end_date: preferences.enabled ? preferences.end_date : null,
        starts_immediately: preferences.enabled && preferences.starts_immediately === true,
        bidding_starts_at: preferences.enabled ? preferences.bidding_starts_at : null,
        bidding_ends_at: preferences.enabled ? preferences.bidding_ends_at : null };
      const invalid = !auction && listingAuctionError(auctionPreferences, start, end);
      if (invalid) throw new Error(invalid);
      const result = await saveAuctionPreferences(listingId, listing.revision!, auctionPreferences);
      setListing({ ...listing, revision: result.revision });
      const savedAuction = await getListingAuction(listingId);
      if (preferences.enabled && !savedAuction) throw new Error('Your settings were saved, but the auction was not confirmed. Reload your listing before continuing.');
      if (savedAuction) auctionPublicationMessage(savedAuction);
      setAuction(savedAuction);
      setSaved(true); onSaved?.(savedAuction);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save bidding settings. Your entries are kept.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    {saved && auction && ['scheduled', 'open'].includes(auction.status) && <BiddingCelebration scheduled={auction.status === 'scheduled'} />}
    {error && <Alert tone="error" title="Bidding settings unavailable">{error}
      {!listing && <Button variant="secondary" className="mt-3" onClick={() => setRetry(value => value + 1)}>Retry settings</Button>}
    </Alert>}
    {!listing && !error && <p role="status" className="text-sm text-sec">Loading bidding settings...</p>}
    {listing && <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sec">
        <span className="font-medium text-sec">Rental dates</span>
        <span className="font-semibold text-main">{formatDate(listing.availability_start ?? null)} – {formatDate(listing.availability_end ?? null)}</span>
      </div>
      {locked && <Alert tone="info">Auction terms are locked, including while bidding is scheduled. Open Bidding for current bids and winner selection.</Alert>}
      <ListingAuctionPreferences value={preferences} start={listing.availability_start ?? ''} end={listing.availability_end ?? ''} askingPrice={Number(listing.price_per_day)}
        hideEnableSwitch={startSetup}
        disabled={busy || !!auction || flag.loading || !flag.enabled} onChange={value => { setPreferences(value); setSaved(false); }} />
      {flag.error && <Alert tone="error">{flag.error}</Alert>}
      {!flag.loading && !flag.enabled && !flag.error && <p className="text-xs text-sec">Competitive bidding is currently disabled.</p>}
      {auction && <p className="text-xs text-sec">Auction {auction.status.replace(/_/g, ' ')}. This auction cannot be restarted or rescheduled.</p>}
      {saved && <div role="status" className="rounded-card bg-accent-soft p-4 text-sm text-main">
        <p className="font-semibold">{auction ? auctionPublicationMessage(auction) : 'Bidding settings saved. Regular rentals remain available.'}</p>
        {auction && <a className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent underline" href={`/auction/${listingId}`}>Manage your auction</a>}
      </div>}
      <div className="flex flex-col gap-3 border-t border-app pt-4 sm:flex-row sm:items-center">
        <Button loading={busy} disabled={locked || flag.loading || !flag.enabled} onClick={() => void save()}>Save changes</Button>
        <p className="text-xs leading-relaxed text-sec">Bidding changes take effect after you save. Regular rentals remain available outside auction dates.</p>
      </div>
    </>}
  </div>;
}
