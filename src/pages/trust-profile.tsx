import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { supabase } from '@/lib/supabase';
import { fetchBookingsAsRenter, type UiBooking } from '@/lib/bookings';
import { fetchReviewsForUser } from '@/lib/reviews';
import { Rating } from '@/components/trust';
import { CheckCircle2, Clock, Shield, TrendingUp, Package, ArrowRight, Settings, Bell, LogOut } from 'lucide-react';

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
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-main font-display">My profile</h1>
          <div className="flex items-center gap-2">
            <button className="p-2 rounded-card-lg border border-app hover:bg-subtle transition-colors">
              <Bell size={18} className="text-sec" />
            </button>
            <button className="p-2 rounded-card-lg border border-app hover:bg-subtle transition-colors">
              <Settings size={18} className="text-sec" />
            </button>
            <button
              onClick={() => void signOut()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-card-lg border border-app text-sm text-sec hover:bg-subtle transition-colors"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>

        <p className="text-xs text-sec -mt-4 mb-4">Signed in as {profile.email}</p>

        {/* Profile card */}
        <div className="p-6 rounded-card-xl bg-card border border-app mb-4">
          <div className="flex items-start gap-4">
            <img
              src={profile.avatar_url ?? undefined}
              alt=""
              className="w-20 h-20 rounded-full object-cover shrink-0 bg-subtle"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-main">{profile.full_name}</h2>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {reviewCount > 0 ? <Rating value={rating} size="md" /> : <span className="text-sm text-sec">No reviews yet</span>}
                <span className="text-sm text-sec">· Member since {joinedYear}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Trust stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon={Package} label="Completed rentals" value={loading ? '—' : completedRentals.length} />
          <StatCard icon={Clock} label="Listings owned" value={loading ? '—' : listingCount} />
          <StatCard icon={Shield} label="Reviews received" value={loading ? '—' : reviewCount} />
          <StatCard icon={TrendingUp} label="Average rating" value={loading || reviewCount === 0 ? '—' : rating.toFixed(1)} />
        </div>

        {/* Trust details */}
        <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
          <h3 className="font-semibold text-main mb-4">Trust & verification</h3>
          <div className="space-y-3">
            <TrustRow label="Signed in with Google" verified />
            <TrustRow label="Email verified" verified />
          </div>
        </div>

        {/* Rental history */}
        {completedRentals.length > 0 && (
          <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
            <h3 className="font-semibold text-main mb-4">Rental history</h3>
            <div className="space-y-3">
              {completedRentals.slice(0, 3).map((booking) => (
                <div
                  key={booking.id}
                  onClick={() => navigate({ name: 'listing', id: booking.listingId })}
                  className="flex items-center gap-3 pb-3 border-b border-app last:border-0 last:pb-0 cursor-pointer hover:bg-subtle -mx-2 px-2 rounded-card transition-colors"
                >
                  <img src={booking.listingImage} alt="" className="w-12 h-12 rounded-card object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-main truncate">{booking.listingTitle}</p>
                    <p className="text-xs text-sec">
                      {new Date(booking.endDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · Completed
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => navigate({ name: 'renter-dashboard' })} className="flex items-center justify-center gap-2 py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm">
            My rentals <ArrowRight size={16} />
          </button>
          <button onClick={() => navigate({ name: 'owner-dashboard' })} className="flex items-center justify-center gap-2 py-3 rounded-card-lg border border-app text-main font-semibold text-sm hover:bg-subtle transition-colors">
            Owner dashboard <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string | number }) {
  return (
    <div className="p-4 rounded-card-xl bg-card border border-app">
      <Icon size={18} className="text-sec" />
      <p className="text-xl font-bold mt-2 text-main">{value}</p>
      <p className="text-xs text-sec">{label}</p>
    </div>
  );
}


function TrustRow({ label, verified }: { label: string; verified: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-card-lg bg-subtle border border-app">
      <span className="text-sm text-main">{label}</span>
      {verified ? (
        <span className="flex items-center gap-1 text-sm text-success font-medium">
          <CheckCircle2 size={16} /> Verified
        </span>
      ) : (
        <span className="text-sm text-muted">Pending</span>
      )}
    </div>
  );
}
