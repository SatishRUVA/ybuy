import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { fetchFavoriteListings, removeFavorite } from '@/lib/favorites';
import { toUiListing } from '@/lib/listings';
import { ListingCard } from '@/components/listing-card';
import { ListingGridSkeleton } from '@/components/skeleton';
import { Alert, EmptyState, Button } from '@/components/ui';
import { WorkspaceHeader } from '@/components/account-workspace';
import type { Listing } from '@/data';

export function FavoritesPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setListings(null);
    setError(null);
    fetchFavoriteListings(user.id)
      .then((rows) => { if (!cancelled) setListings(rows.map(toUiListing)); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load favorites.');
      });
    return () => { cancelled = true; };
  }, [user, attempt]);

  async function handleUnfavorite(listingId: string) {
    if (!user || removingId) return;
    setError(null);
    setRemovingId(listingId);
    try {
      await removeFavorite(user.id, listingId);
      setListings((prev) => (prev ?? []).filter((l) => l.id !== listingId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this saved item. Please try again.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="p1-work-page p1-account">
      <div>
        <WorkspaceHeader title="Keep the good things close." description={listings && listings.length > 0
          ? `${listings.length} saved ${listings.length === 1 ? 'rental' : 'rentals'} for your next plan. Check dates and terms before you book.`
          : 'Save the gear you like, compare your options, and come back when your dates are ready.'}
          action={<Button variant="secondary" onClick={() => navigate({ name: 'search' })}>Find a new rental</Button>} />
        <h2 className="text-lg font-semibold text-main mb-5">Saved items</h2>
        {error && <Alert tone="warning" className="mb-4">{error}{listings === null && <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAttempt(value => value + 1)}>Try again</Button>}</Alert>}
        {listings === null ? !error && (
          <ListingGridSkeleton count={8} className="p1-item-grid" />
        ) : listings.length === 0 ? (
          <EmptyState
            className="p1-empty account-empty"
            icon={<Heart size={20} />}
            title="Nothing saved yet"
            description="Tap the heart on any listing and it lands here, so you can compare before you book."
            actionLabel="Browse rentals"
            onAction={() => navigate({ name: 'search' })}
          />
        ) : (
          <div className="p1-item-grid">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onClick={() => navigate({ name: 'listing', id: listing.id })}
                favorited
                favoriteBusy={removingId === listing.id}
                onToggleFavorite={() => void handleUnfavorite(listing.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
