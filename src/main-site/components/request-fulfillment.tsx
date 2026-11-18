import { useEffect, useState } from 'react';
import { Alert, Button, Surface } from './ui';
import { fieldClass } from './form-classes';
import { fetchRequestListingMatches, type OwnerListing } from '@/lib/marketplace';
import { linkMainRequestListing, type MainItemRequest } from '../request-flow';
import { useRouter } from '@/router';

export function RequestFulfillment({ request, publishedListingId }: { request: MainItemRequest; publishedListingId?: string }) {
  const { navigate } = useRouter();
  const [listings, setListings] = useState<OwnerListing[]>([]);
  const [listingId, setListingId] = useState(publishedListingId ?? '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ in_app_notified: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchRequestListingMatches([request.id]).then(matches => {
      if (active) setListings(matches[request.id] ?? []);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load your matching listings.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request.id, attempt]);

  async function link(notify: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (!listingId) throw new Error('Choose your published matching listing.');
      setResult(await linkMainRequestListing(request.id, listingId, notify));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not link your listing.'); }
    finally { setBusy(false); }
  }

  return <Surface className="mt-4 p-4 sm:p-5 space-y-4">
    <h3 className="text-lg font-semibold text-main">{publishedListingId ? 'Notify the renter' : 'List your item for this request'}</h3>
    <p className="text-sm text-sec">{request.title} · {request.preferred_start_date} – {request.preferred_end_date} · {request.location_label}</p>
    {result ? <div role="status" className="space-y-3">
      <p className="font-semibold text-success">{result.in_app_notified ? 'Rental linked. The renter’s in-app match notification is available.' : 'Rental linked without a new in-app notification.'}</p>
      <p className="text-sm text-sec">The renter can find this item in their request matches. Existing notifications are not removed, and linking does not reserve the item.</p>
      <Button variant="secondary" onClick={() => navigate({ name: 'requests' })}>Back to requests</Button>
    </div> : <>
      {loading && <p role="status" className="text-sm text-sec">Checking your published listings against the request dates, area, quantity and daily budget…</p>}
      {!loading && listings.length > 0 && <label className="block text-sm font-semibold text-main">Use an existing listing
        <select value={listingId} onChange={event => setListingId(event.target.value)} className={fieldClass('mt-1')} disabled={busy}>
          <option value="">Choose a matching listing</option>
          {listings.map(listing => <option value={listing.id} key={listing.id}>{listing.title} · ${listing.price_per_day}/day</option>)}
        </select>
      </label>}
      {!loading && !error && !listings.length && <p className="text-sm text-sec">{publishedListingId
        ? 'Your published item does not currently match the requested dates, area, quantity or daily budget. Update the listing, then retry.'
        : 'No published listing fits yet. Create a listing with the request details already filled in.'}</p>}
      {!publishedListingId && <Button variant="secondary" disabled={busy} onClick={() => navigate({ name: 'create-listing', requestId: request.id })}>Create a new listing for this request</Button>}
      {request.notify_matches_in_app === false && <p className="text-sm text-sec">The renter has turned off in-app match notifications for this request. You can still link your item.</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || loading || !listings.some(listing => listing.id === listingId)} loading={busy} onClick={() => void link(true)}>Link rental and notify renter</Button>
        <Button variant="secondary" disabled={busy || loading || !listings.some(listing => listing.id === listingId)} onClick={() => void link(false)}>Link rental · skip notification</Button>
        {publishedListingId && <Button variant="ghost" disabled={busy} onClick={() => navigate({ name: 'requests' })}>Skip for now</Button>}
      </div>
    </>}
    {error && <Alert tone="error" title="Request response unavailable">{error}
      <Button variant="secondary" size="sm" className="mt-2" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Retry matching listings</Button>
    </Alert>}
  </Surface>;
}
