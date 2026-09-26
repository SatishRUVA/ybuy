import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { supabase } from '@/lib/supabase';
import { fetchBookingsAsRenter, type UiBooking } from '@/lib/bookings';
import { fetchReviewsForUser } from '@/lib/reviews';
import { Rating } from '@/components/trust';
import { Button, Surface, SectionHeader, Badge } from '@/components/ui';
import { CheckCircle2, Clock, Shield, TrendingUp, Package, ArrowRight, LogOut, Heart } from 'lucide-react';

export function TrustProfilePage() {
  const { navigate } = useRouter();
  const { profile, signOut } = useAuth();

  const [completedRentals, setCompletedRentals] = useState<UiBooking[]>([]);
  const [listingCount, setListingCount] = useState(0);
  const [rating, setRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchBookingsAsRenter(profile.id),
      fetchReviewsForUser(profile.id),
      supabase.from('listings').select('id', { count: 'exact', head: true }).eq('owner_id', profile.id),
    ])
      .then(([bookings, reviews, listingsResult]) => {
        if (cancelled) return;
        setCompletedRentals(bookings.filter((b) => b.status === 'completed'));
        setRating(reviews.rating);
        setReviewCount(reviews.reviewCount);
        setListingCount(listingsResult.count ?? 0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  if (!profile) return null;

  const joinedYear = new Date(profile.created_at).getFullYear();

  return (
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <div className="flex items-end justify-between gap-3 mb-6">
          <SectionHeader as="h1" title="Your profile" subtitle={`Signed in as ${profile.email}`} />
          <Button variant="secondary" size="sm" icon={<LogOut size={15} />} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>

        {/* Profile card */}
        <Surface className="p-6 mb-4">
          <div className="flex items-center gap-5">
            <img
              src={profile.avatar_url ?? undefined}
              alt=""
              className="w-20 h-20 rounded-full object-cover shrink-0 bg-subtle"
            />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-main font-display">{profile.full_name}</h2>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                <Rating value={rating} count={reviewCount} size="sm" />
                <Badge tone="neutral">Member since {joinedYear}</Badge>
              </div>
            </div>
          </div>
        </Surface>

        {/* Trust stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon={Package} label="Completed rentals" value={loading ? '-' : completedRentals.length} />
          <StatCard icon={Clock} label="Listings owned" value={loading ? '-' : listingCount} />
          <StatCard icon={Shield} label="Reviews received" value={loading ? '-' : reviewCount} />
          <StatCard icon={TrendingUp} label="Average rating" value={loading || reviewCount === 0 ? '-' : rating.toFixed(1)} />
        </div>

        {/* Trust details */}
        <Surface className="p-5 mb-4">
          <h3 className="font-semibold text-main font-display mb-4">Trust and verification</h3>
          <div className="space-y-2.5">
            <TrustRow label="Signed in with Google" verified />
            <TrustRow label="Email verified" verified />
          </div>
        </Surface>

        {/* Rental history */}
        {completedRentals.length > 0 && (
          <Surface className="p-5 mb-6">
            <h3 className="font-semibold text-main font-display mb-4">Recent rentals</h3>
            <div className="space-y-1">
              {completedRentals.slice(0, 3).map((booking) => (
                <button
                  key={booking.id}
                  onClick={() => navigate({ name: 'listing', id: booking.listingId })}
                  className="w-full flex items-center gap-3 -mx-2 px-2 py-2 rounded-card text-left hover:bg-subtle transition-colors duration-fast"
                >
                  <img src={booking.listingImage} alt="" className="w-11 h-11 rounded-card object-cover shrink-0 bg-subtle" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-main truncate">{booking.listingTitle}</p>
                    <p className="text-xs text-sec">
                      Completed {new Date(booking.endDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <ArrowRight size={15} className="text-muted shrink-0" />
                </button>
              ))}
            </div>
          </Surface>
        )}

        <div className="grid sm:grid-cols-2 gap-2">
          <Button fullWidth variant="secondary" icon={<Heart size={16} />} trailingIcon={<ArrowRight size={16} />} onClick={() => navigate({ name: 'favorites' })}>
            Saved items
          </Button>
          <Button fullWidth trailingIcon={<ArrowRight size={16} />} onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>
            Bookings
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string | number }) {
  return (
    <div className="p-4 rounded-card-lg bg-card border border-app">
      <Icon size={18} className="text-sec" />
      <p className="text-2xl font-bold text-main font-display mt-2.5 tnum">{value}</p>
      <p className="text-xs text-sec mt-0.5">{label}</p>
    </div>
  );
}

function TrustRow({ label, verified }: { label: string; verified: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 h-11 rounded-card bg-subtle">
      <span className="text-sm text-main">{label}</span>
      {verified ? (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-success">
          <CheckCircle2 size={15} /> Verified
        </span>
      ) : (
        <span className="text-sm text-muted">Pending</span>
      )}
    </div>
  );
}
