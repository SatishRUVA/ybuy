import { useEffect, useState } from 'react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/components/ui';
import { ListingOfferPreferences } from '@/components/listing-offer-preferences';
import { ListingAuctionPreferences } from '@/components/listing-auction-preferences';
import { fetchListingById, type DbListingRow } from '@/lib/listings';
import { getListingAuction, listingAuctionError, type ListingAuction, type ListingAuctionPreferences as AuctionPreferences } from '@/lib/listing-auctions';
import { EMPTY_LISTING_OFFERS, getListingFlowPolicy, listingOfferError, listingOfferPreferences, saveListingNegotiation, type ListingFlowPolicy, type ListingOfferForm } from '@/lib/listing-flow';
import { useFeatureFlag } from '@/lib/use-feature-flags';

export function ListingNegotiationSettings({ listingId, onSaved }: { listingId: string; onSaved?: () => void }) {
  const { user } = useAuth();
  const flag = useFeatureFlag('bidding');
  const privateOffersFlag = useFeatureFlag('private_offers');
  const [listing, setListing] = useState<DbListingRow | null>(null);
  const [policy, setPolicy] = useState<ListingFlowPolicy | null>(null);
  const [auction, setAuction] = useState<ListingAuction | null>(null);
  const [offers, setOffers] = useState<ListingOfferForm>(EMPTY_LISTING_OFFERS);
  const [preferences, setPreferences] = useState<AuctionPreferences>({ enabled: false, start_date: null, end_date: null, bidding_starts_at: null, bidding_ends_at: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setListing(null); setError(null);
    void Promise.all([fetchListingById(listingId), getListingFlowPolicy(), getListingAuction(listingId)]).then(([row, rules, current]) => {
      if (!active) return;
      if (!row || row.owner_id !== user?.id || row.status !== 'published' || !Number.isSafeInteger(row.revision)) throw new Error('Negotiation settings require your published listing. Reload its current status before continuing.');
      setListing(row); setPolicy(rules); setAuction(current);
      setOffers({
        enabled: row.negotiation_enabled, minimumDaily: row.offer_minimum_daily == null ? '' : String(row.offer_minimum_daily),
        maximumDaily: row.offer_maximum_daily == null ? '' : String(row.offer_maximum_daily),
        expirationHours: row.offer_expiration_hours == null ? '' : String(row.offer_expiration_hours),
        startDate: row.offer_start_date ?? '', endDate: row.offer_end_date ?? '', targetDaily: row.offer_target_daily ?? null,
      });
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
    if (!listing || !policy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const start = listing.availability_start ?? '';
      const end = listing.availability_end ?? '';
      const auctionPreferences = { ...preferences, start_date: preferences.enabled ? preferences.start_date : null, end_date: preferences.enabled ? preferences.end_date : null,
        bidding_starts_at: preferences.enabled ? new Date(Date.now() + 60_000).toISOString() : null };
      const invalid = listingOfferError(offers, listing.price_per_day, policy, start, end)
        || (!auction && listingAuctionError(auctionPreferences, start, end));
      if (invalid) throw new Error(invalid);
      const result = await saveListingNegotiation(listingId, listing.revision!, listingOfferPreferences(offers, listing.price_per_day, start, end), auctionPreferences);
      setListing({ ...listing, revision: result.revision });
      setAuction(await getListingAuction(listingId));
      setSaved(true); onSaved?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save negotiation settings. Your entries are kept.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <div className="max-w-2xl"><h2 className="text-xl font-bold text-main">Offer settings</h2>
      <p className="mt-1 text-sm leading-relaxed text-sec">Choose how renters can make an offer. You can turn on one option or both.</p></div>
    {error && <Alert tone="error" title="Negotiation settings unavailable">{error}
      {!listing && <Button variant="secondary" className="mt-3" onClick={() => setRetry(value => value + 1)}>Retry settings</Button>}
    </Alert>}
    {!listing && !error && <p role="status" className="text-sm text-sec">Loading negotiation settings...</p>}
    {listing && policy && <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card bg-subtle px-3.5 py-3 text-sm">
        <span className="font-medium text-sec">Rental dates</span>
        <span className="font-semibold text-main">{formatDate(listing.availability_start ?? null)} – {formatDate(listing.availability_end ?? null)}</span>
        <span className="text-xs text-sec">Set in listing availability</span>
      </div>
      {locked && <Alert tone="info">Auction terms are locked, including while bidding is scheduled. Open Bidding for current bids and winner selection.</Alert>}
      <ListingOfferPreferences value={offers} askingPrice={listing.price_per_day} startDate={listing.availability_start ?? ''} endDate={listing.availability_end ?? ''}
        policy={policy} disabled={busy || locked || privateOffersFlag.loading || (!privateOffersFlag.enabled && !offers.enabled)} onChange={value => { setOffers(value); setSaved(false); }} />
      <ListingAuctionPreferences value={preferences} start={listing.availability_start ?? ''} end={listing.availability_end ?? ''}
        disabled={busy || !!auction || flag.loading || !flag.enabled} onChange={value => { setPreferences(value); setSaved(false); }} />
      {flag.error && <Alert tone="error">{flag.error}</Alert>}
      {!flag.loading && !flag.enabled && !flag.error && <p className="text-xs text-sec">Competitive bidding is currently disabled.</p>}
      {privateOffersFlag.error && <Alert tone="error">Could not check private offer availability: {privateOffersFlag.error}</Alert>}
      {!privateOffersFlag.loading && !privateOffersFlag.enabled && !privateOffersFlag.error && <p className="text-xs text-sec">Private offers are currently disabled by an administrator.</p>}
      {auction && <p className="text-xs text-sec">Auction {auction.status.replace(/_/g, ' ')}. This auction cannot be restarted or rescheduled.</p>}
      {saved && <p role="status" className="text-sm text-accent">Negotiation settings saved.</p>}
      <div className="flex flex-col gap-3 border-t border-app pt-4 sm:flex-row sm:items-center">
        <Button loading={busy} disabled={locked || flag.loading || privateOffersFlag.loading} onClick={() => void save()}>Save changes</Button>
        <p className="text-xs leading-relaxed text-sec">Changes take effect for new offers and auctions after you save.</p>
      </div>
    </>}
  </div>;
}
