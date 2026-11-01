import { useEffect, useState } from 'react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/components/ui';
import { ListingAuctionPreferences } from '@/components/listing-auction-preferences';
import { fetchListingById, type DbListingRow } from '@/lib/listings';
import { getListingAuction, listingAuctionError, type ListingAuction, type ListingAuctionPreferences as AuctionPreferences } from '@/lib/listing-auctions';
import { saveListingNegotiation } from '@/lib/listing-flow';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import '@/pages/production-workflows.css';

export function ListingNegotiationSettings({ listingId, onSaved }: { listingId: string; onSaved?: () => void }) {
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
      if (!row || row.owner_id !== user?.id || row.status !== 'published' || !Number.isSafeInteger(row.revision)) throw new Error('Rental settings require your published listing. Reload its current status before continuing.');
      setListing(row); setAuction(current);
      setPreferences({ enabled: row.auction_enabled ?? false, start_date: row.auction_start_date ?? null, end_date: row.auction_end_date ?? null,
        bidding_starts_at: row.auction_bidding_starts_at ?? null, bidding_ends_at: row.auction_bidding_ends_at ?? null });
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load negotiation settings. Please retry.'); });
    return () => { active = false; };
  }, [listingId, user?.id, retry]);
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
        bidding_starts_at: preferences.enabled ? new Date(Date.now() + 60_000).toISOString() : null };
      const invalid = !auction && listingAuctionError(auctionPreferences, start, end);
      if (invalid) throw new Error(invalid);
      // The shared RPC also receives legacy offer terms; keep them unchanged rather than erase history.
      const result = await saveListingNegotiation(listingId, listing.revision!, {
        negotiation_enabled: listing.negotiation_enabled,
        offer_minimum_daily: listing.offer_minimum_daily ?? null,
        offer_maximum_daily: listing.offer_maximum_daily ?? null,
        offer_target_daily: listing.offer_target_daily ?? null,
        offer_start_date: listing.offer_start_date ?? null,
        offer_end_date: listing.offer_end_date ?? null,
        offer_expiration_hours: listing.offer_expiration_hours ?? null,
      }, auctionPreferences);
      setListing({ ...listing, revision: result.revision });
      setAuction(await getListingAuction(listingId));
      setSaved(true); onSaved?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save rental settings. Your entries are kept.'); }
    finally { setBusy(false); }
  }
  return <section className="p1-settings-form space-y-5" aria-label="Rental settings" aria-busy={busy}>
    <div className="p1-section-head"><div><h2>Rental settings</h2>
      <p>Renters can book at your daily rate using your chosen approval mode. You can also enable competitive bidding for selected dates.</p></div></div>
    {error && <Alert tone="error" title="Rental settings unavailable">{error}
      {!listing && <Button variant="secondary" className="mt-3" onClick={() => setRetry(value => value + 1)}>Retry settings</Button>}
    </Alert>}
    {!listing && !error && <p role="status" className="text-sm text-sec">Loading rental settings...</p>}
    {listing && <>
      <div className="p1-info p1-production-rental-dates">
        <span className="font-medium text-sec">Rental dates</span>
        <span className="font-semibold text-main">{formatDate(listing.availability_start ?? null)} – {formatDate(listing.availability_end ?? null)}</span>
        <span className="text-xs text-sec">Set in listing availability</span>
      </div>
      {locked && <Alert tone="info">Auction terms are locked, including while bidding is scheduled. Open Bidding for current bids and winner selection.</Alert>}
      <ListingAuctionPreferences value={preferences} start={listing.availability_start ?? ''} end={listing.availability_end ?? ''}
        disabled={busy || !!auction || flag.loading || !flag.enabled} onChange={value => { setPreferences(value); setSaved(false); }} />
      {flag.error && <Alert tone="error">{flag.error}</Alert>}
      {!flag.loading && !flag.enabled && !flag.error && <p className="text-xs text-sec">Competitive bidding is currently disabled.</p>}
      {auction && <p className="text-xs text-sec">Auction {auction.status.replace(/_/g, ' ')}. This auction cannot be restarted or rescheduled.</p>}
      {saved && <p role="status" className="text-sm text-accent">Rental settings saved.</p>}
      <div className="p1-dialog-footer">
        <Button loading={busy} disabled={locked || flag.loading || !flag.enabled} onClick={() => void save()}>Save changes</Button>
        <p className="text-xs leading-relaxed text-sec">Bidding changes take effect after you save. Regular bookings remain available outside auction dates.</p>
      </div>
    </>}
  </section>;
}
