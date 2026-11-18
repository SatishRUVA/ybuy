import { useEffect, useRef, useState } from 'react';
import { fetchMainItemRequest, fetchRequestMatches, saveRequestMatchPreference, type MainItemRequest } from '../request-flow';
import { enrichListingsWithRatings, toUiListing } from '@/lib/listings';
import type { Listing } from '@/data';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { ListingCard } from '../components/listing-card';
import { Alert, Badge, Button, EmptyState, SectionHeader } from '../components/ui';
import { ListingGridSkeleton } from '../components/skeleton';
import { addFavorite, fetchFavoriteListingIds, removeFavorite } from '@/lib/favorites';

export function RequestMatchesPage({ id }: { id: string }) {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const flag = useFeatureFlag('item_requests');
  const [request, setRequest] = useState<MainItemRequest | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const favoriteMutations = useRef(new Set<string>());
  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchFavoriteListingIds(user.id).then(ids => { if (active) setFavoriteIds(ids); })
      .catch((reason: unknown) => { if (active) setFavoriteError(reason instanceof Error ? reason.message : 'Could not load saved items.'); });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!user || !flag.enabled) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const next = await fetchMainItemRequest(id);
      if (next.renter_id !== user.id) throw new Error('Only the renter who posted this request can view its matching listings.');
      const matches = await fetchRequestMatches(next, page);
      const rated = await enrichListingsWithRatings(matches.rows.map(toUiListing));
      if (active) { setRequest(next); setListings(rated); setTotal(matches.total); }
    })().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load request matches.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, user, flag.enabled, page, attempt]);

  async function changePreference(enabled: boolean) {
    const previous = request?.notify_matches_in_app !== false;
    setSaving(true);
    setError(null);
    setRequest(current => current ? { ...current, notify_matches_in_app: enabled } : current);
    try {
      await saveRequestMatchPreference(id, enabled);
    } catch (reason) {
      setRequest(current => current ? { ...current, notify_matches_in_app: previous } : current);
      setError(reason instanceof Error ? reason.message : 'Could not save the notification preference.');
    }
    finally { setSaving(false); }
  }

  async function toggleFavorite(listingId: string) {
    if (!user) { setFavoriteError('Sign in to save this item.'); return; }
    if (favoriteMutations.current.has(listingId)) return;
    favoriteMutations.current.add(listingId);
    setFavoriteError(null);
    const wasSaved = favoriteIds.has(listingId);
    try {
      if (wasSaved) await removeFavorite(user.id, listingId);
      else await addFavorite(user.id, listingId);
      setFavoriteIds(current => {
        const next = new Set(current);
        if (wasSaved) next.delete(listingId); else next.add(listingId);
        return next;
      });
    } catch (reason) { setFavoriteError(reason instanceof Error ? reason.message : 'Could not update your saved items.'); }
    finally { favoriteMutations.current.delete(listingId); }
  }

  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-5">
    <Button variant="ghost" onClick={() => navigate({ name: 'requests', tab: 'mine' })}>Back to my requests</Button>
    <SectionHeader as="h1" title="Items matching your request" subtitle={request ? `${request.title} · ${request.preferred_start_date} – ${request.preferred_end_date} · ${request.location_label}` : 'Listings are checked against your request, not just its category.'} />
    {request && <div className="flex flex-wrap gap-3 items-center text-sm text-sec">
      <span>{request.max_daily_budget == null ? 'No daily budget limit' : `Maximum $${request.max_daily_budget}/day`}</span>
      <span>{request.requested_quantity} {request.requested_quantity === 1 ? 'unit' : 'units'} requested</span>
      {request.main_site_flow && <label className="inline-flex min-h-11 items-center gap-2">
        <input type="checkbox" disabled={saving} checked={request.notify_matches_in_app !== false} onChange={event => void changePreference(event.target.checked)} />
        Notify me in-app when a matching item is listed
      </label>}
    </div>}
    {(error || flag.error) && <Alert tone="error" title="Request matches unavailable">{error ?? flag.error}
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => { flag.reload(); setAttempt(value => value + 1); }}>Retry</Button>
    </Alert>}
    {favoriteError && <Alert tone="error" title="Saved items unavailable">{favoriteError}</Alert>}
    {flag.loading || (loading && flag.enabled) ? <ListingGridSkeleton />
      : !flag.enabled && !flag.error ? <EmptyState title="Item requests are not enabled" description="Request matching is temporarily unavailable." />
      : !error && listings.length === 0 ? <EmptyState title="No matching items available yet" description="New listings can appear here when they match your dates, area, quantity and daily budget." />
      : !error && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {listings.map(listing => <div key={listing.id} className="flex flex-col gap-2">
          <div><Badge tone="success">Matches your request · available for requested dates</Badge></div>
          <div className="flex-1"><ListingCard listing={listing} href={`/listing/${listing.id}?request=${id}`}
            favorited={favoriteIds.has(listing.id)} onToggleFavorite={() => void toggleFavorite(listing.id)}
            onClick={() => navigate({ name: 'listing', id: listing.id, requestId: id })} /></div>
        </div>)}
      </div>}
    {!error && total > 12 && <div className="flex flex-wrap justify-between gap-3">
      <p className="text-sm text-sec">{total} matching items · page {page + 1}</p>
      <div className="flex gap-2"><Button variant="secondary" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button>
        <Button variant="secondary" disabled={(page + 1) * 12 >= total || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div>
    </div>}
    <p className="text-xs text-sec">Matches do not reserve stock. Availability and payment are verified again during booking. In-app alerts also follow your account notification settings; device push is not enabled.</p>
  </div>;
}
