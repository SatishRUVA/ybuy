import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { claims, type Listing } from '@/data';
import {
  fetchBookingsAsRenter, fetchBookingsAsOwner, respondToBookingRequest, cancelBooking,
  markBookingActive, startBookingReturn, completeBookingReturn, type UiBooking,
} from '@/lib/bookings';
import { createCheckoutSession } from '@/lib/payments';
import { getOrCreateConversation } from '@/lib/messages';
import { createReview, fetchReviewedBookingIds, fetchReviewsForUser } from '@/lib/reviews';
import { fetchListingsByOwner, toUiListing } from '@/lib/listings';
import { fetchPayoutsByOwner, markBookingPaidOut, type DbPayoutRow } from '@/lib/payouts';
import { fetchUnavailableDates, setDateAvailability } from '@/lib/availability';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { BookingListSkeleton, BookingRowSkeleton } from '@/components/skeleton';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { Rating } from '@/components/trust';
import {
  Calendar, Clock, ChevronRight, Plus, Package,
  CheckCircle2, AlertCircle, ArrowRight, Inbox, Shield, Star, X, CalendarCog, DollarSign,
} from 'lucide-react';

const PAID_OUT_ELIGIBLE_STATUSES: UiBooking['status'][] = ['confirmed', 'active', 'return_pending', 'completed'];

const REQUESTED_STATUSES: UiBooking['status'][] = ['requested', 'pending_payment', 'confirmed'];
const PAST_STATUSES: UiBooking['status'][] = ['completed', 'cancelled', 'rejected'];

const STATUS_LABEL: Record<UiBooking['status'], string> = {
  requested: 'Awaiting owner approval',
  pending_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  active: 'Active',
  return_pending: 'Return in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Declined',
};

export function RenterDashboard() {
  const { navigate } = useRouter();
  const { user, roleState, setActiveRole } = useAuth();
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'active' | 'past' | 'claims'>('upcoming');
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<UiBooking | null>(null);
  const [trustScore, setTrustScore] = useState<{ rating: number; count: number } | null>(null);

  function reload() {
    if (!user) return;
    setLoadError(null);
    fetchBookingsAsRenter(user.id).then((rows) => {
      setBookings(rows);
      const completedIds = rows.filter((b) => b.status === 'completed').map((b) => b.id);
      fetchReviewedBookingIds(user.id, completedIds).then(setReviewedBookingIds).catch(() => {});
    }).catch((err: unknown) => { setBookings([]); setLoadError(err instanceof Error ? err.message : 'Could not load your bookings.'); });
    fetchReviewsForUser(user.id).then((r) => setTrustScore({ rating: r.rating, count: r.reviewCount })).catch(() => {});
  }

  useEffect(reload, [user]);

  const upcoming = (bookings ?? []).filter((b) => REQUESTED_STATUSES.includes(b.status));
  const active = (bookings ?? []).filter((b) => b.status === 'active' || b.status === 'return_pending');
  const past = (bookings ?? []).filter((b) => PAST_STATUSES.includes(b.status));
  const myClaims = claims;

  const tabData = { upcoming, active, past, claims: [] }[tab];

  async function handleCancel(bookingId: string) {
    setActionError(null);
    try {
      await cancelBooking(bookingId);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel this booking.');
    }
  }

  async function handleStartCheckIn(bookingId: string, listingId: string) {
    setActionError(null);
    try {
      await markBookingActive(bookingId);
      navigate({ name: 'check-in', id: listingId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start check-in.');
    }
  }

  async function handleStartReturn(bookingId: string) {
    setActionError(null);
    try {
      await startBookingReturn(bookingId);
      navigate({ name: 'check-out', id: bookingId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start the return.');
    }
  }

  async function handlePayNow(bookingId: string) {
    setActionError(null);
    try {
      const url = await createCheckoutSession(bookingId);
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start checkout.');
    }
  }

  async function handleMessage(counterpartId: string, listingId: string, bookingId: string) {
    if (!user) return;
    setActionError(null);
    try {
      const conversationId = await getOrCreateConversation({ currentUserId: user.id, otherUserId: counterpartId, listingId, bookingId });
      navigate({ name: 'conversation', id: conversationId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open the conversation.');
    }
  }

  async function handleSubmitReview(rating: number, body: string) {
    if (!user || !reviewTarget) return;
    await createReview({ bookingId: reviewTarget.id, reviewerId: user.id, revieweeId: reviewTarget.counterpartId, rating, body });
    setReviewedBookingIds((prev) => new Set(prev).add(reviewTarget.id));
    setReviewTarget(null);
  }

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-main font-display">My rentals</h1>
            <p className="text-sec text-sm mt-1">Manage your bookings and returns</p>
          </div>
          <div className="flex items-center gap-2">
            {roleState?.isMultiRole && (
              <button
                onClick={() => { setActiveRole('owner'); navigate({ name: 'dashboard' }); }}
                className="px-3 py-2 rounded-card-lg border border-app text-sm font-medium text-sec hover:bg-subtle"
              >
                Owner view
              </button>
            )}
            <button
              onClick={() => navigate({ name: 'search' })}
              className="flex items-center gap-2 px-4 py-2.5 rounded-card-lg bg-accent text-accent-text text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Find something <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard icon={Calendar} label="Upcoming" value={upcoming.length} />
          <StatCard icon={Clock} label="Active" value={active.length} />
          <StatCard icon={CheckCircle2} label="Completed" value={past.filter((b) => b.status === 'completed').length} />
          <StatCard icon={Shield} label="Trust score" value={trustScore === null ? '…' : trustScore.count > 0 ? `${trustScore.rating.toFixed(1)}★` : 'New'} />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto no-scrollbar">
          {(['upcoming', 'active', 'past', ...(SHOW_OUT_OF_SCOPE_PAGES ? ['claims' as const] : [])] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-card-lg text-sm font-medium capitalize transition-colors whitespace-nowrap ${
                tab === t ? 'bg-accent text-accent-text' : 'text-sec hover:bg-subtle'
              }`}
            >
              {t} {t === 'claims' && myClaims.length > 0 && `(${myClaims.length})`}
            </button>
          ))}
        </div>

        {actionError && (
          <div className="p-3 rounded-card-lg bg-warning-soft border border-app text-sm text-warning mb-4">{actionError}</div>
        )}
        {loadError && (
          <div className="p-3 rounded-card-lg bg-warning-soft border border-app text-sm text-warning mb-4">{loadError}</div>
        )}

        {/* Content */}
        {bookings === null ? (
          <BookingListSkeleton count={3} />
        ) : tab === 'claims' ? (
          <div className="space-y-3">
            {myClaims.map((claim) => (
              <button
                key={claim.id}
                onClick={() => navigate({ name: 'claim-detail', id: claim.id })}
                className="w-full flex items-center gap-4 p-4 rounded-card-xl bg-card border border-app hover:shadow-card card-hover text-left"
              >
                <div className={`w-12 h-12 rounded-card-lg flex items-center justify-center shrink-0 ${
                  claim.status === 'under-review' ? 'bg-warning-soft' : 'bg-success-soft'
                }`}>
                  <AlertCircle size={22} className={claim.status === 'under-review' ? 'text-warning' : 'text-success'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-main">Claim #{claim.id}</p>
                  <p className="text-xs text-sec truncate">{claim.listingTitle} — {claim.issue}</p>
                  <p className="text-xs text-muted mt-0.5">{claim.date}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-main">${claim.amount}</p>
                  <p className={`text-xs ${claim.status === 'under-review' ? 'text-warning' : 'text-success'}`}>
                    {claim.status === 'under-review' ? 'Under review' : 'Resolved'}
                  </p>
                </div>
                <ChevronRight size={18} className="text-muted shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3 animate-cross-fade">
            {tabData.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sec">No {tab} rentals yet.</p>
              </div>
            ) : (
              tabData.map((booking) => (
                <div key={booking.id} className="p-4 rounded-card-xl bg-card border border-app">
                  <div className="flex gap-4">
                    <img src={booking.listingImage} alt="" className="w-20 h-20 rounded-card-lg object-cover shrink-0 cursor-pointer" onClick={() => navigate({ name: 'listing', id: booking.listingId })} />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-main cursor-pointer hover:text-accent" onClick={() => navigate({ name: 'listing', id: booking.listingId })}>
                        {booking.listingTitle}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 text-xs text-sec">
                        <Calendar size={13} /> {booking.startDate} → {booking.endDate}
                      </div>
                      <p className="text-xs text-sec mt-1">{STATUS_LABEL[booking.status]}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-main">${booking.total}</p>
                      <button
                        onClick={() => navigate({ name: 'confirmation', id: booking.id })}
                        className="mt-2 text-xs font-medium text-accent hover:underline"
                      >
                        View rental →
                      </button>
                      <button
                        onClick={() => handleMessage(booking.counterpartId, booking.listingId, booking.id)}
                        className="mt-1 block text-xs font-medium text-sec hover:text-main hover:underline"
                      >
                        Message
                      </button>
                    </div>
                  </div>
                  {tab === 'upcoming' && (
                    <div className="mt-3 pt-3 border-t border-app flex items-center gap-2">
                      {booking.status === 'pending_payment' && (
                        <button
                          onClick={() => handlePayNow(booking.id)}
                          className="flex-1 py-2 rounded-card-lg bg-accent text-accent-text text-xs font-semibold"
                        >
                          Pay now
                        </button>
                      )}
                      {booking.status === 'confirmed' && (
                        <button
                          onClick={() => handleStartCheckIn(booking.id, booking.listingId)}
                          className="flex-1 py-2 rounded-card-lg bg-accent text-accent-text text-xs font-semibold"
                        >
                          Start check-in
                        </button>
                      )}
                      <button
                        onClick={() => handleCancel(booking.id)}
                        className="px-4 py-2 rounded-card-lg border border-app text-xs font-medium text-sec hover:bg-subtle transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {tab === 'active' && booking.status === 'active' && (
                    <div className="mt-3 pt-3 border-t border-app">
                      <button
                        onClick={() => handleStartReturn(booking.id)}
                        className="w-full py-2 rounded-card-lg bg-accent text-accent-text text-xs font-semibold"
                      >
                        Start return
                      </button>
                    </div>
                  )}
                  {tab === 'past' && booking.status === 'completed' && !reviewedBookingIds.has(booking.id) && (
                    <div className="mt-3 pt-3 border-t border-app">
                      <button
                        onClick={() => setReviewTarget(booking)}
                        className="flex items-center gap-1.5 py-2 px-3 rounded-card-lg border border-app text-xs font-semibold text-main hover:bg-subtle transition-colors"
                      >
                        <Star size={14} /> Leave a review
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {reviewTarget && (
        <ReviewModal
          title={reviewTarget.listingTitle}
          onSubmit={handleSubmitReview}
          onClose={() => setReviewTarget(null)}
        />
      )}
    </div>
  );
}

export function OwnerDashboard() {
  const { navigate } = useRouter();
  const { user, roleState, setActiveRole } = useAuth();
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [payouts, setPayouts] = useState<Map<string, DbPayoutRow>>(new Map());
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<UiBooking | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<Listing | null>(null);
  const [availabilityDates, setAvailabilityDates] = useState<{ blocked: Set<string>; booked: Set<string> }>({ blocked: new Set(), booked: new Set() });

  function reload() {
    if (!user) return;
    setLoadError(null);
    fetchBookingsAsOwner(user.id).then((rows) => {
      setBookings(rows);
      const completedIds = rows.filter((b) => b.status === 'completed').map((b) => b.id);
      fetchReviewedBookingIds(user.id, completedIds).then(setReviewedBookingIds).catch(() => {});
    }).catch((err: unknown) => { setBookings([]); setLoadError(err instanceof Error ? err.message : 'Could not load your bookings.'); });
    fetchListingsByOwner(user.id).then((rows) => setMyListings(rows.map(toUiListing))).catch(() => {});
    fetchPayoutsByOwner(user.id).then(setPayouts).catch(() => {});
  }

  useEffect(reload, [user]);

  const pending = (bookings ?? []).filter((b) => b.status === 'requested');
  const upcomingOrActive = (bookings ?? []).filter((b) => ['pending_payment', 'confirmed', 'active', 'return_pending'].includes(b.status));
  const completed = (bookings ?? []).filter((b) => b.status === 'completed');

  async function handleRespond(bookingId: string, approve: boolean) {
    setActionError(null);
    try {
      await respondToBookingRequest(bookingId, approve);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not respond to this request.');
    }
  }

  async function handleMessage(counterpartId: string, listingId: string, bookingId: string) {
    if (!user) return;
    setActionError(null);
    try {
      const conversationId = await getOrCreateConversation({ currentUserId: user.id, otherUserId: counterpartId, listingId, bookingId });
      navigate({ name: 'conversation', id: conversationId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open the conversation.');
    }
  }

  async function handleSubmitReview(rating: number, body: string) {
    if (!user || !reviewTarget) return;
    await createReview({ bookingId: reviewTarget.id, reviewerId: user.id, revieweeId: reviewTarget.counterpartId, rating, body });
    setReviewedBookingIds((prev) => new Set(prev).add(reviewTarget.id));
    setReviewTarget(null);
  }

  async function handleMarkPaidOut(booking: UiBooking) {
    if (!user) return;
    setActionError(null);
    try {
      await markBookingPaidOut(booking.id, user.id, booking.subtotal);
      const rows = await fetchPayoutsByOwner(user.id);
      setPayouts(rows);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not record this payout.');
    }
  }

  async function handleMarkReturned(bookingId: string) {
    setActionError(null);
    try {
      await completeBookingReturn(bookingId);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not complete this return.');
    }
  }

  function handleOpenAvailability(listing: Listing) {
    setAvailabilityTarget(listing);
    fetchUnavailableDates(listing.id).then(setAvailabilityDates).catch(() => {});
  }

  async function handleToggleAvailabilityDate(date: string) {
    if (!availabilityTarget) return;
    const isBlocked = availabilityDates.blocked.has(date);
    setAvailabilityDates((prev) => {
      const blocked = new Set(prev.blocked);
      if (isBlocked) blocked.delete(date); else blocked.add(date);
      return { ...prev, blocked };
    });
    try {
      await setDateAvailability(availabilityTarget.id, date, isBlocked);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update availability for that date.');
      setAvailabilityDates((prev) => {
        const blocked = new Set(prev.blocked);
        if (isBlocked) blocked.add(date); else blocked.delete(date);
        return { ...prev, blocked };
      });
    }
  }


  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-main font-display">Owner dashboard</h1>
            <p className="text-sec text-sm mt-1">Manage your items, rentals, and earnings</p>
          </div>
          <div className="flex items-center gap-2">
            {roleState?.isMultiRole && (
              <button
                onClick={() => { setActiveRole('renter'); navigate({ name: 'dashboard' }); }}
                className="px-3 py-2 rounded-card-lg border border-app text-sm font-medium text-sec hover:bg-subtle"
              >
                Renter view
              </button>
            )}
            <button
              onClick={() => navigate({ name: 'create-listing' })}
              className="flex items-center gap-2 px-4 py-2.5 rounded-card-lg bg-accent text-accent-text text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <Plus size={16} /> List an item
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard icon={Package} label="Your items" value={myListings.length} />
          <StatCard icon={Calendar} label="Upcoming" value={upcomingOrActive.length} />
          <StatCard icon={Inbox} label="Pending requests" value={pending.length} highlight={pending.length > 0} />
          <StatCard icon={AlertCircle} label="Open claims" value={0} />
        </div>

        {actionError && (
          <div className="p-3 rounded-card-lg bg-warning-soft border border-app text-sm text-warning mb-4">{actionError}</div>
        )}
        {loadError && (
          <div className="p-3 rounded-card-lg bg-warning-soft border border-app text-sm text-warning mb-4">{loadError}</div>
        )}

        {/* Pending requests */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-main font-display mb-3">Pending requests</h2>
          <div className="space-y-3 animate-cross-fade">
            {bookings === null ? (
              <BookingRowSkeleton />
            ) : pending.length === 0 ? (
              <p className="text-sec text-sm">No pending requests.</p>
            ) : (
              pending.map((booking) => (
                <div key={booking.id} className="p-4 rounded-card-xl bg-card border border-app">
                  <div className="flex items-start gap-3">
                    {booking.counterpartAvatar && (
                      <img src={booking.counterpartAvatar} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm">
                          <span className="font-semibold text-main">{booking.counterpartName}</span>
                          <span className="text-sec"> wants to rent your </span>
                          <span className="font-semibold text-main">{booking.listingTitle}</span>
                        </p>
                        <span className="font-bold text-main shrink-0">${booking.total}</span>
                      </div>
                      <p className="text-xs text-sec mt-1">{booking.startDate} → {booking.endDate}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-app">
                    <button
                      onClick={() => handleRespond(booking.id, true)}
                      className="flex-1 py-2 rounded-card-lg bg-success text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRespond(booking.id, false)}
                      className="flex-1 py-2 rounded-card-lg border border-app text-xs font-medium text-sec hover:bg-subtle transition-colors"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => handleMessage(booking.counterpartId, booking.listingId, booking.id)}
                      className="px-4 py-2 rounded-card-lg border border-app text-xs font-medium text-sec hover:bg-subtle transition-colors"
                    >
                      Message
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Your items */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-main font-display">Your items</h2>
            <button onClick={() => navigate({ name: 'create-listing' })} className="text-sm text-accent font-medium flex items-center gap-1">
              <Plus size={15} /> Add item
            </button>
          </div>
          {myListings.length === 0 ? (
            <p className="text-sec text-sm">You haven't listed anything yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {myListings.map((listing) => (
                <div key={listing.id} className="flex gap-3 p-3 rounded-card-xl bg-card border border-app card-hover">
                  <img src={listing.images[0]} alt="" className="w-20 h-20 rounded-card-lg object-cover shrink-0 cursor-pointer" onClick={() => navigate({ name: 'listing', id: listing.id })} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm text-main line-clamp-1 cursor-pointer" onClick={() => navigate({ name: 'listing', id: listing.id })}>{listing.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Rating value={listing.rating} size="sm" />
                      <span className="text-xs text-sec">{listing.rentalCount} rentals</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-bold text-main text-sm">${listing.pricePerDay}<span className="text-xs text-sec font-normal">/day</span></span>
                      <span className={`text-xs font-medium ${listing.available ? 'text-success' : 'text-muted'}`}>
                        {listing.available ? 'Available' : 'Booked'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleOpenAvailability(listing)}
                      className="mt-2 flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                    >
                      <CalendarCog size={13} /> Manage availability
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming rentals */}
        <div>
          <h2 className="text-lg font-bold text-main font-display mb-3">Upcoming rentals</h2>
          <div className="space-y-2">
            {upcomingOrActive.length === 0 ? (
              <p className="text-sec text-sm">No upcoming rentals yet.</p>
            ) : (
              upcomingOrActive.map((booking) => (
                <div key={booking.id} className="flex items-center gap-3 p-3 rounded-card-lg bg-card border border-app">
                  <img src={booking.listingImage} alt="" className="w-12 h-12 rounded-card object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-main line-clamp-1">{booking.listingTitle}</p>
                    <p className="text-xs text-sec">{booking.startDate} → {booking.endDate}</p>
                  </div>
                  <span className="text-sm font-semibold text-main shrink-0">${booking.total}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    booking.status === 'active' ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent'
                  }`}>
                    {STATUS_LABEL[booking.status]}
                  </span>
                  {booking.status === 'return_pending' && (
                    <button
                      onClick={() => void handleMarkReturned(booking.id)}
                      className="px-3 py-1.5 rounded-card-lg bg-accent text-accent-text text-xs font-semibold hover:opacity-90 transition-opacity shrink-0"
                    >
                      Mark returned
                    </button>
                  )}
                  <PayoutControl booking={booking} payout={payouts.get(booking.id)} onMarkPaidOut={handleMarkPaidOut} />
                  <button
                    onClick={() => handleMessage(booking.counterpartId, booking.listingId, booking.id)}
                    className="text-xs font-medium text-sec hover:text-main hover:underline shrink-0"
                  >
                    Message
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Completed rentals */}
        {completed.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-main font-display mb-3">Completed rentals</h2>
            <div className="space-y-2">
              {completed.map((booking) => (
                <div key={booking.id} className="flex items-center gap-3 p-3 rounded-card-lg bg-card border border-app">
                  <img src={booking.listingImage} alt="" className="w-12 h-12 rounded-card object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-main line-clamp-1">{booking.listingTitle}</p>
                    <p className="text-xs text-sec">{booking.startDate} → {booking.endDate} · {booking.counterpartName}</p>
                  </div>
                  <PayoutControl booking={booking} payout={payouts.get(booking.id)} onMarkPaidOut={handleMarkPaidOut} />
                  {!reviewedBookingIds.has(booking.id) && (
                    <button
                      onClick={() => setReviewTarget(booking)}
                      className="flex items-center gap-1.5 py-1.5 px-3 rounded-card-lg border border-app text-xs font-semibold text-main hover:bg-subtle transition-colors shrink-0"
                    >
                      <Star size={13} /> Review
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {reviewTarget && (
        <ReviewModal
          title={reviewTarget.counterpartName}
          onSubmit={handleSubmitReview}
          onClose={() => setReviewTarget(null)}
        />
      )}
      {availabilityTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setAvailabilityTarget(null)}>
          <div className="bg-app w-full sm:max-w-md rounded-t-card-xl sm:rounded-card-xl p-5 max-h-[90vh] overflow-y-auto animate-modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-main">Availability — {availabilityTarget.title}</h3>
              <button onClick={() => setAvailabilityTarget(null)} className="p-1.5 rounded-full hover:bg-subtle text-sec"><X size={18} /></button>
            </div>
            <AvailabilityCalendar
              bookedDates={availabilityDates.booked}
              blockedDates={availabilityDates.blocked}
              editable
              onToggleDate={handleToggleAvailabilityDate}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PayoutControl({ booking, payout, onMarkPaidOut }: { booking: UiBooking; payout?: DbPayoutRow; onMarkPaidOut: (booking: UiBooking) => Promise<void>; }) {
  const [submitting, setSubmitting] = useState(false);
  if (!PAID_OUT_ELIGIBLE_STATUSES.includes(booking.status)) return null;
  if (payout?.status === 'paid') {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-success shrink-0">
        <CheckCircle2 size={13} /> Paid out ${payout.amount}
      </span>
    );
  }
  return (
    <button
      onClick={async () => { setSubmitting(true); await onMarkPaidOut(booking); setSubmitting(false); }}
      disabled={submitting}
      className="flex items-center gap-1 text-xs font-medium text-accent hover:underline shrink-0 disabled:opacity-50"
    >
      <DollarSign size={13} /> {submitting ? 'Marking…' : `Mark $${booking.subtotal} paid out`}
    </button>
  );
}

function StatCard({ icon: Icon, label, value, highlight }: { icon: typeof Calendar; label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-card-xl border ${highlight ? 'bg-accent-soft border-accent' : 'bg-card border-app'}`}>
      <Icon size={20} className={highlight ? 'text-accent' : 'text-sec'} />
      <p className="text-2xl font-bold text-main mt-2">{value}</p>
      <p className="text-xs text-sec">{label}</p>
    </div>
  );
}

/** 1-5 star rating + optional text, shown after a booking reaches Completed (spec §3.14). */
function ReviewModal({ title, onSubmit, onClose }: { title: string; onSubmit: (rating: number, body: string) => Promise<void>; onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (rating === 0) { setError('Please select a rating.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(rating, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your review.');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-sm bg-card rounded-card-xl border border-app shadow-hover p-5 animate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-main">Review {title}</h3>
          <button onClick={onClose} className="p-1 rounded-card hover:bg-subtle transition-colors">
            <X size={18} className="text-sec" />
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setRating(n)} className="p-0.5">
              <Star size={28} className={n <= rating ? 'fill-[var(--star)] text-[var(--star)]' : 'text-border-strong'} />
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Optional comments…"
          rows={3}
          className="w-full p-3 rounded-card-lg border border-app bg-app text-sm text-main resize-none mb-3"
        />
        {error && <p className="text-xs text-error mb-3">{error}</p>}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-2.5 rounded-card-lg bg-accent text-accent-text text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
    </div>
  );
}

