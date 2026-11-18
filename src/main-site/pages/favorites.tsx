import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { fetchFavoriteListings, removeFavorite } from '@/lib/favorites';
import { toUiListing } from '@/lib/listings';
import { ListingCard } from '@/main-site/components/listing-card';
import { ListingGridSkeleton } from '@/main-site/components/skeleton';
import { Alert, EmptyState, SectionHeader } from '@/main-site/components/ui';
import type { Listing } from '@/data';

export function FavoritesPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [user]);

  async function handleUnfavorite(listingId: string) {
    if (!user) return;
    setError(null);
    try {
      await removeFavorite(user.id, listingId);
      setListings((prev) => (prev ?? []).filter((l) => l.id !== listingId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this saved item. Please try again.');
    }
  }

  return (
    <div className="animate-fade-in min-h-screen pb-20 md:pb-10">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <SectionHeader
          as="h1"
          title="Saved items"
          subtitle={listings && listings.length > 0
            ? `${listings.length} ${listings.length === 1 ? 'item' : 'items'} you're keeping an eye on.`
            : 'Items you save are kept here while you decide.'}
          className="mb-6"
        />
        {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
        {listings === null ? !error && (
          <ListingGridSkeleton count={8} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" />
        ) : listings.length === 0 ? (
          <EmptyState
            icon={<Heart size={20} />}
            title="Nothing saved yet"
            description="Tap the heart on any listing and it lands here, so you can compare before you book."
            actionLabel="Browse rentals"
            onAction={() => navigate({ name: 'search' })}
          />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 animate-cross-fade">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onClick={() => navigate({ name: 'listing', id: listing.id })}
                favorited
                onToggleFavorite={() => void handleUnfavorite(listing.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
