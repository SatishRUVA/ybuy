import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { fetchFavoriteListings, removeFavorite } from '@/lib/favorites';
import { toUiListing } from '@/lib/listings';
import { ListingCard } from '@/components/listing-card';
import { ListingGridSkeleton } from '@/components/skeleton';
import type { Listing } from '@/data';

export function FavoritesPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    if (!user) return;
    setError(null);
    fetchFavoriteListings(user.id)
      .then((rows) => setListings(rows.map(toUiListing)))
      .catch((err: unknown) => { setListings([]); setError(err instanceof Error ? err.message : 'Failed to load favorites.'); });
  }

  useEffect(reload, [user]);

  async function handleUnfavorite(listingId: string) {
    if (!user) return;
    await removeFavorite(user.id, listingId);
    setListings((prev) => (prev ?? []).filter((l) => l.id !== listingId));
  }

  return (
    <div className="animate-fade-in min-h-screen pb-20 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-main font-display mb-6">Favorites</h1>
        {error && <p className="text-sm text-error mb-4">{error}</p>}
        {listings === null ? (
          <ListingGridSkeleton count={8} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" />
        ) : listings.length === 0 ? (
          <div className="text-center py-16">
            <Heart size={40} className="text-muted mx-auto mb-3" />
            <p className="text-sec">No favorites yet. Tap the heart on any item to save it here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 animate-cross-fade">
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
