import { useEffect, useMemo, useRef, useState } from 'react';
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
import { deleteOwnerListing, fetchListingsByOwner, toUiListing } from '@/lib/listings';
import { fetchPayoutsByOwner, markBookingPaidOut, type DbPayoutRow } from '@/lib/payouts';
import { fetchUnavailableDates, setDateAvailability } from '@/lib/availability';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { BookingListSkeleton, BookingRowSkeleton, Skeleton } from '@/components/skeleton';
import { Button, Badge, Alert, EmptyState, Surface, SectionHeader, Overlay } from '@/components/ui';
import { textareaClass } from '@/components/form-classes';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { Rating } from '@/components/trust';
import {
  Calendar, ChevronRight, Package, CheckCircle2, AlertCircle,
  Inbox, Star, X, CalendarCog, Wallet, MessageSquare, CreditCard, Search, Bell, Trash2,
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

const STATUS_TONE: Record<UiBooking['status'], 'neutral' | 'accent' | 'success' | 'warning' | 'error'> = {
  requested: 'neutral',
  pending_payment: 'warning',
  confirmed: 'accent',
  active: 'success',
  return_pending: 'warning',
  completed: 'success',
  cancelled: 'error',
  rejected: 'error',
};

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Compact numeric summary. Value first, because that's what the eye is scanning for. */
function StatCard({ icon: Icon, label, value, highlight, onClick }: {
  icon: typeof Calendar; label: string; value: string | number; highlight?: boolean; onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`p-4 rounded-card-lg border text-left w-full transition-colors duration-fast ${
        highlight ? 'bg-accent-soft border-accent' : 'bg-card border-app'
      } ${onClick ? 'hover:border-strong' : ''}`}
    >
      <div className="flex items-center justify-between">
        <Icon size={18} className={highlight ? 'text-accent' : 'text-sec'} />
        {onClick && <ChevronRight size={15} className="text-muted" />}
      </div>
      <p className="text-2xl font-bold text-main font-display mt-2.5 tnum">{value}</p>
      <p className="text-xs text-sec mt-0.5">{label}</p>
    </Tag>
  );
}

/** The one row layout every booking uses, on both dashboards. */
function BookingRow({
  booking, onOpen, onMessage, children,
}: {
  booking: UiBooking;
  onOpen?: () => void;
  onMessage?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Surface className="p-3.5">
      <div className="flex gap-3.5">
        <button
          onClick={onOpen}
          className="w-20 h-20 rounded-card overflow-hidden shrink-0 bg-subtle"
          aria-label={`Open ${booking.listingTitle}`}
        >
          <img src={booking.listingImage} alt="" className="w-full h-full object-cover" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <button onClick={onOpen} className="text-left min-w-0">
              <h3 className="font-semibold text-main font-display leading-snug line-clamp-1 hover:text-accent transition-colors duration-fast">
                {booking.listingTitle}
              </h3>
            </button>
            <p className="font-bold text-main shrink-0 tnum">${booking.total}</p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-sec mt-1.5">
            <Calendar size={13} /> {formatRange(booking.startDate, booking.endDate)}
            <span className="text-muted">·</span>
            <span className="tnum">{booking.days} {booking.days === 1 ? 'day' : 'days'}</span>
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Badge tone={STATUS_TONE[booking.status]}>{STATUS_LABEL[booking.status]}</Badge>
            <span className="text-xs text-sec truncate">{booking.counterpartName}</span>
          </div>
        </div>
      </div>
      {(children || onMessage) && (
        <div className="flex flex-wrap items-center gap-2 mt-3.5 pt-3.5 border-t border-app">
          {children}
          {onMessage && (
            <Button size="sm" variant="ghost" icon={<MessageSquare size={15} />} onClick={onMessage}>Message</Button>
          )}
        </div>
      )}
    </Surface>
  );
}

export function BookingsPage({ initialTab = 'renting' }: { initialTab?: 'renting' | 'lending' }) {
  const { route, navigate } = useRouter();
  const [rentingAttention, setRentingAttention] = useState(0);
  const [lendingRequests, setLendingRequests] = useState(0);
  const tab = route.name === 'owner-dashboard' ? 'lending'
    : route.name === 'renter-dashboard' ? 'renting'
      : route.name === 'dashboard' ? route.tab ?? initialTab : initialTab;

  function selectTab(nextTab: 'renting' | 'lending') {
    navigate({ name: 'dashboard', tab: nextTab });
  }

  return (
    <div className="pb-20 md:pb-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-9">
        <SectionHeader as="h1" title="Bookings" subtitle="Your rentals and the items you lend, in one place." className="mb-5" />
        <div className="grid grid-cols-2 gap-1 p-1 rounded-card-lg bg-subtle" role="tablist" aria-label="Booking activity">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'renting'}
            onClick={() => selectTab('renting')}
            className={`h-11 rounded-card text-sm font-semibold transition-colors duration-fast ${tab === 'renting' ? 'bg-card text-main shadow-xs' : 'text-sec hover:text-main'}`}
          >
            Renting
            {rentingAttention > 0 && <span className="ml-2 inline-flex min-w-5 justify-center rounded-full bg-warning-soft px-1.5 py-0.5 text-xs font-bold text-warning tnum">{rentingAttention}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'lending'}
            onClick={() => selectTab('lending')}
            className={`h-11 rounded-card text-sm font-semibold transition-colors duration-fast ${tab === 'lending' ? 'bg-card text-main shadow-xs' : 'text-sec hover:text-main'}`}
          >
            Lending
            {lendingRequests > 0 && <span className="ml-2 text-xs font-semibold text-accent tnum">· {lendingRequests} {lendingRequests === 1 ? 'request' : 'requests'}</span>}
          </button>
        </div>
      </div>
      <div role="tabpanel" aria-label="Renting" hidden={tab !== 'renting'}>
        <RenterDashboard onAttentionCount={setRentingAttention} />
      </div>
      <div role="tabpanel" aria-label="Lending" hidden={tab !== 'lending'}>
        <OwnerDashboard onRequestCount={setLendingRequests} />
      </div>
    </div>
  );
}

export function RenterDashboard({ onAttentionCount }: { onAttentionCount?: (count: number) => void } = {}) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [tab, setTab] = useState<'requests' | 'upcoming' | 'active' | 'past' | 'claims'>('requests');
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<UiBooking | null>(null);
  const [trustScore, setTrustScore] = useState<{ rating: number; count: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const all = useMemo(() => bookings ?? [], [bookings]);
  const requests = all.filter((b) => b.status === 'requested' || b.status === 'pending_payment');
  const upcoming = all.filter((b) => b.status === 'confirmed');
  const active = all.filter((b) => b.status === 'active' || b.status === 'return_pending');
  const past = all.filter((b) => PAST_STATUSES.includes(b.status));
  const tabData = { requests, upcoming, active, past, claims: [] as UiBooking[] }[tab];
  const sectionCounts = { requests: requests.length, upcoming: upcoming.length, active: active.length, past: past.length };

  // Everything that is waiting on the renter, surfaced before the tab lists.
  const needsAttention = useMemo(() => [
    ...all.filter((b) => b.status === 'pending_payment').map((b) => ({ booking: b, kind: 'pay' as const })),
    ...all.filter((b) => b.status === 'confirmed').map((b) => ({ booking: b, kind: 'checkin' as const })),
    ...all.filter((b) => b.status === 'active').map((b) => ({ booking: b, kind: 'return' as const })),
    ...all.filter((b) => b.status === 'completed' && !reviewedBookingIds.has(b.id)).map((b) => ({ booking: b, kind: 'review' as const })),
  ], [all, reviewedBookingIds]);

  useEffect(() => { onAttentionCount?.(needsAttention.length); }, [onAttentionCount, needsAttention.length]);

  async function run(bookingId: string, fn: () => Promise<void>, fallback: string) {
    setActionError(null);
    setBusyId(bookingId);
    try { await fn(); } catch (err) { setActionError(err instanceof Error ? err.message : fallback); }
    finally { setBusyId(null); }
  }

  const handleCancel = (id: string) => run(id, async () => { await cancelBooking(id); reload(); }, 'Could not cancel this booking.');
  const handleStartCheckIn = (id: string, listingId: string) =>
    run(id, async () => { await markBookingActive(id); navigate({ name: 'check-in', id: listingId }); }, 'Could not start check-in.');
  const handleStartReturn = (id: string) =>
    run(id, async () => { await startBookingReturn(id); navigate({ name: 'check-out', id }); }, 'Could not start the return.');
  const handlePayNow = (id: string) =>
    run(id, async () => { window.location.href = await createCheckoutSession(id); }, 'Could not start checkout.');

  async function handleMessage(counterpartId: string, listingId: string, bookingId: string) {
    if (!user) return;
    await run(bookingId, async () => {
      const conversationId = await getOrCreateConversation({ currentUserId: user.id, otherUserId: counterpartId, listingId, bookingId });
      navigate({ name: 'conversation', id: conversationId });
    }, 'Could not open the conversation.');
  }

  async function handleSubmitReview(rating: number, body: string) {
    if (!user || !reviewTarget) return;
    await createReview({ bookingId: reviewTarget.id, reviewerId: user.id, revieweeId: reviewTarget.counterpartId, rating, body });
    setReviewedBookingIds((prev) => new Set(prev).add(reviewTarget.id));
    setReviewTarget(null);
  }

  return (
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}
        {loadError && <Alert tone="warning" className="mb-4">{loadError}</Alert>}

        {/* Attention first - the dashboard's real job */}
        {bookings === null ? (
          <div className="grid gap-2 mb-6"><Skeleton className="h-16 w-full" rounded="rounded-card-lg" /></div>
        ) : needsAttention.length > 0 && (
          <section className="mb-7">
            <h2 className="flex items-center gap-2 text-sm font-bold text-main mb-2.5">
              <Bell size={15} className="text-accent" />
              Needs your attention
              <span className="tnum text-sec font-semibold">({needsAttention.length})</span>
            </h2>
            <div className="space-y-2">
              {needsAttention.map(({ booking, kind }) => (
                <AttentionRow
                  key={`${kind}-${booking.id}`}
                  image={booking.listingImage}
                  title={booking.listingTitle}
                  detail={
                    kind === 'pay' ? 'Approved - pay to confirm your dates'
                      : kind === 'checkin' ? `Pick up ${formatRange(booking.startDate, booking.endDate)}`
                      : kind === 'return' ? `Due back ${formatRange(booking.startDate, booking.endDate)}`
                      : `Rented from ${booking.counterpartName}`
                  }
                  action={
                    kind === 'pay' ? (
                      <Button size="sm" icon={<CreditCard size={15} />} loading={busyId === booking.id} onClick={() => void handlePayNow(booking.id)}>
                        Pay ${booking.total}
                      </Button>
                    ) : kind === 'checkin' ? (
                      <Button size="sm" loading={busyId === booking.id} onClick={() => void handleStartCheckIn(booking.id, booking.listingId)}>
                        Start check-in
                      </Button>
                    ) : kind === 'return' ? (
                      <Button size="sm" variant="secondary" loading={busyId === booking.id} onClick={() => void handleStartReturn(booking.id)}>
                        Start return
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" icon={<Star size={15} />} onClick={() => setReviewTarget(booking)}>
                        Review
                      </Button>
                    )
                  }
                />
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
          <StatCard icon={Calendar} label="Upcoming" value={upcoming.length} />
          <StatCard icon={Package} label="Active now" value={active.length} />
          <StatCard icon={CheckCircle2} label="Completed" value={past.filter((b) => b.status === 'completed').length} />
          <StatCard
            icon={Star}
            label="Your rating"
            value={trustScore === null ? '…' : trustScore.count > 0 ? `${trustScore.rating.toFixed(1)}★` : 'New'}
          />
        </div>

        <div className="flex items-center gap-1 mb-4 p-1 rounded-card-lg bg-subtle w-fit max-w-full overflow-x-auto no-scrollbar">
          {(['requests', 'upcoming', 'active', 'past', ...(SHOW_OUT_OF_SCOPE_PAGES ? ['claims' as const] : [])] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`h-9 px-4 rounded-full text-sm font-semibold capitalize whitespace-nowrap transition-colors duration-fast ${
                tab === t ? 'bg-card text-main shadow-xs' : 'text-sec hover:text-main'
              }`}
            >
              <span className="capitalize">{t}</span>
              {t !== 'claims' && sectionCounts[t] > 0 && <span className="ml-1.5 text-xs tnum">{sectionCounts[t]}</span>}
              {t === 'claims' && claims.length > 0 && ` (${claims.length})`}
            </button>
          ))}
        </div>

        {bookings === null ? (
          <BookingListSkeleton count={3} />
        ) : tab === 'claims' ? (
          <div className="space-y-2.5">
            {claims.map((claim) => (
              <Surface key={claim.id} interactive className="p-4 flex items-center gap-4" onClick={() => navigate({ name: 'claim-detail', id: claim.id })}>
                <span className={`grid place-items-center w-11 h-11 rounded-card shrink-0 ${claim.status === 'under-review' ? 'bg-warning-soft' : 'bg-success-soft'}`}>
                  <AlertCircle size={20} className={claim.status === 'under-review' ? 'text-warning' : 'text-success'} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-main">Claim #{claim.id}</p>
                  <p className="text-xs text-sec truncate">{claim.listingTitle} - {claim.issue}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-main tnum">${claim.amount}</p>
                  <Badge tone={claim.status === 'under-review' ? 'warning' : 'success'}>
                    {claim.status === 'under-review' ? 'Under review' : 'Resolved'}
                  </Badge>
                </div>
              </Surface>
            ))}
          </div>
        ) : tabData.length === 0 ? (
          <EmptyState
            icon={tab === 'past' ? <CheckCircle2 size={20} /> : <Search size={20} />}
            title={
              tab === 'requests' ? 'No rental requests'
                : tab === 'upcoming' ? 'No upcoming rentals'
                : tab === 'active' ? 'Nothing out on rental right now'
                : 'No past rentals yet'
            }
            description={
              tab === 'requests' ? 'Requests you send and payments waiting on you will appear here.'
                : tab === 'upcoming' ? 'Confirmed pickups will appear here.'
                : tab === 'active' ? 'Rentals move here once you have checked the item in.'
                : 'Completed and cancelled rentals are kept here for your records.'
            }
            actionLabel={tab === 'past' ? undefined : 'Browse rentals'}
            onAction={tab === 'past' ? undefined : () => navigate({ name: 'search' })}
          />
        ) : (
          <div className="space-y-2.5 animate-cross-fade">
            {tabData.map((booking) => (
              <BookingRow
                key={booking.id}
                booking={booking}
                onOpen={() => navigate({ name: 'listing', id: booking.listingId })}
                onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}
              >
                <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'confirmation', id: booking.id })}>
                  View rental
                </Button>
                {booking.status === 'pending_payment' && (
                  <Button size="sm" icon={<CreditCard size={15} />} loading={busyId === booking.id} onClick={() => void handlePayNow(booking.id)}>
                    Pay now
                  </Button>
                )}
                {booking.status === 'confirmed' && (
                  <Button size="sm" loading={busyId === booking.id} onClick={() => void handleStartCheckIn(booking.id, booking.listingId)}>
                    Start check-in
                  </Button>
                )}
                {booking.status === 'active' && (
                  <Button size="sm" loading={busyId === booking.id} onClick={() => void handleStartReturn(booking.id)}>
                    Start return
                  </Button>
                )}
                {REQUESTED_STATUSES.includes(booking.status) && (
                  <Button size="sm" variant="danger" loading={busyId === booking.id} onClick={() => void handleCancel(booking.id)}>
                    Cancel
                  </Button>
                )}
                {booking.status === 'completed' && !reviewedBookingIds.has(booking.id) && (
                  <Button size="sm" variant="secondary" icon={<Star size={15} />} onClick={() => setReviewTarget(booking)}>
                    Leave a review
                  </Button>
                )}
              </BookingRow>
            ))}
          </div>
        )}
      </div>

      {reviewTarget && (
        <ReviewModal title={reviewTarget.listingTitle} onSubmit={handleSubmitReview} onClose={() => setReviewTarget(null)} />
      )}
    </div>
  );
}

function AttentionRow({ image, title, detail, action }: {
  image?: string; title: string; detail: string; action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-card-lg bg-card border border-accent/35">
      {image && <img src={image} alt="" className="w-11 h-11 rounded-card object-cover shrink-0 bg-subtle" />}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-main truncate">{title}</p>
        <p className="text-xs text-sec truncate">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export function OwnerDashboard({ onRequestCount }: { onRequestCount?: (count: number) => void } = {}) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [myListings, setMyListings] = useState<Listing[] | null>(null);
  const [payouts, setPayouts] = useState<Map<string, DbPayoutRow>>(new Map());
  const [actionError, setActionError] = useState<string | null>(null);
  const [listingNotice, setListingNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<UiBooking | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<Listing | null>(null);
  const [availabilityListingId, setAvailabilityListingId] = useState('');
  const [availabilityDates, setAvailabilityDates] = useState<{ blocked: Set<string>; booked: Set<string> }>({ blocked: new Set(), booked: new Set() });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingListingId, setDeletingListingId] = useState<string | null>(null);
  const [selectingListings, setSelectingListings] = useState(false);
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(new Set());
  const [removalTarget, setRemovalTarget] = useState<Listing[] | null>(null);
  const [removingListings, setRemovingListings] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);

  function reload() {
    if (!user) return;
    setLoadError(null);
    fetchBookingsAsOwner(user.id).then((rows) => {
      setBookings(rows);
      const completedIds = rows.filter((b) => b.status === 'completed').map((b) => b.id);
      fetchReviewedBookingIds(user.id, completedIds).then(setReviewedBookingIds).catch(() => {});
    }).catch((err: unknown) => { setBookings([]); setLoadError(err instanceof Error ? err.message : 'Could not load your bookings.'); });
    fetchListingsByOwner(user.id).then((rows) => {
      const listings = rows.map(toUiListing);
      setMyListings(listings);
      setAvailabilityListingId((current) => current || listings[0]?.id || '');
    }).catch(() => setMyListings([]));
    fetchPayoutsByOwner(user.id).then(setPayouts).catch(() => {});
  }

  useEffect(reload, [user]);

  const all = useMemo(() => bookings ?? [], [bookings]);
  const pending = all.filter((b) => b.status === 'requested');
  const upcomingRentals = all.filter((b) => b.status === 'pending_payment' || b.status === 'confirmed');
  const activeRentals = all.filter((b) => b.status === 'active' || b.status === 'return_pending');
  const pastRentals = all.filter((b) => PAST_STATUSES.includes(b.status));

  useEffect(() => { onRequestCount?.(pending.length); }, [onRequestCount, pending.length]);

  // Earnings are the owner's share (subtotal), never the renter-facing total.
  const earned = useMemo(
    () => all.filter((b) => PAID_OUT_ELIGIBLE_STATUSES.includes(b.status)).reduce((sum, b) => sum + b.subtotal, 0),
    [all],
  );
  const paidOut = useMemo(
    () => [...payouts.values()].filter((p) => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount), 0),
    [payouts],
  );

  async function run(id: string, fn: () => Promise<void>, fallback: string) {
    setActionError(null);
    setBusyId(id);
    try { await fn(); } catch (err) { setActionError(err instanceof Error ? err.message : fallback); }
    finally { setBusyId(null); }
  }

  const handleRespond = (id: string, approve: boolean) =>
    run(id, async () => { await respondToBookingRequest(id, approve); reload(); }, 'Could not respond to this request.');
  const handleMarkReturned = (id: string) =>
    run(id, async () => { await completeBookingReturn(id); reload(); }, 'Could not complete this return.');

  function toggleListingSelection(id: string) {
    setSelectedListingIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function closeRemoval() {
    if (removingListings) return;
    setRemovalTarget(null);
    setRemovalError(null);
  }

  async function handleDeleteListings() {
    if (!user || !removalTarget || removingListings) return;
    setActionError(null);
    setListingNotice(null);
    setRemovalError(null);
    setRemovingListings(true);
    const failed: Listing[] = [];
    const failureReasons: string[] = [];
    const succeededIds: string[] = [];
    let archived = 0;
    let removed = 0;
    for (const listing of removalTarget) {
      setDeletingListingId(listing.id);
      try {
        const result = await deleteOwnerListing(user.id, listing.id);
        if (result === 'archived') archived += 1; else removed += 1;
        succeededIds.push(listing.id);
        setMyListings((current) => current?.filter((item) => item.id !== listing.id) ?? []);
        setSelectedListingIds((current) => {
          const next = new Set(current);
          next.delete(listing.id);
          return next;
        });
      } catch (err) {
        failed.push(listing);
        failureReasons.push(err instanceof Error ? err.message : 'Could not remove this listing.');
      }
    }
    setDeletingListingId(null);
    setRemovingListings(false);
    setAvailabilityListingId((current) => succeededIds.includes(current)
      ? myListings?.find((item) => !succeededIds.includes(item.id))?.id ?? ''
      : current);
    if (removed || archived) setListingNotice(`${removed} removed${archived ? `, ${archived} archived` : ''}.`);
    if (failed.length) setRemovalError(`${failed.length} ${failed.length === 1 ? 'listing' : 'listings'} could not be removed. ${failureReasons[0]}`);
    setRemovalTarget(failed.length ? failed : null);
    if (!failed.length) setSelectingListings(false);
  }

  async function handleMessage(counterpartId: string, listingId: string, bookingId: string) {
    if (!user) return;
    await run(bookingId, async () => {
      const conversationId = await getOrCreateConversation({ currentUserId: user.id, otherUserId: counterpartId, listingId, bookingId });
      navigate({ name: 'conversation', id: conversationId });
    }, 'Could not open the conversation.');
  }

  async function handleSubmitReview(rating: number, body: string) {
    if (!user || !reviewTarget) return;
    await createReview({ bookingId: reviewTarget.id, reviewerId: user.id, revieweeId: reviewTarget.counterpartId, rating, body });
    setReviewedBookingIds((prev) => new Set(prev).add(reviewTarget.id));
    setReviewTarget(null);
  }

  async function handleMarkPaidOut(booking: UiBooking) {
    if (!user) return;
    await run(booking.id, async () => {
      await markBookingPaidOut(booking.id, user.id, booking.subtotal);
      setPayouts(await fetchPayoutsByOwner(user.id));
    }, 'Could not record this payout.');
  }

  function handleOpenAvailability(listing: Listing) {
    setAvailabilityTarget(listing);
    fetchUnavailableDates(listing.id).then(setAvailabilityDates).catch(() => {});
  }

  function handleOpenSelectedAvailability() {
    const listing = myListings?.find((item) => item.id === availabilityListingId);
    if (listing) handleOpenAvailability(listing);
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
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}
        {listingNotice && <Alert tone="success" className="mb-4">{listingNotice}</Alert>}
        {loadError && <Alert tone="warning" className="mb-4">{loadError}</Alert>}

        {/* Requests waiting on the owner */}
        <section className="mb-7">
          <h2 className="flex items-center gap-2 text-sm font-bold text-main mb-2.5">
            <Inbox size={15} className="text-accent" />
            Incoming requests
            {pending.length > 0 && <span className="tnum text-sec font-semibold">({pending.length})</span>}
          </h2>
          {bookings === null ? (
            <BookingRowSkeleton />
          ) : pending.length === 0 ? (
            <p className="text-sm text-sec">Nothing needs a decision right now.</p>
          ) : (
            <div className="space-y-2.5">
              {pending.map((booking) => (
                <Surface key={booking.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {booking.counterpartAvatar && (
                      <img src={booking.counterpartAvatar} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-sec">
                        <span className="font-semibold text-main">{booking.counterpartName}</span> wants to rent your{' '}
                        <span className="font-semibold text-main">{booking.listingTitle}</span>
                      </p>
                      <p className="flex items-center gap-1.5 text-xs text-sec mt-1.5">
                        <Calendar size={13} /> {formatRange(booking.startDate, booking.endDate)}
                        <span className="text-muted">·</span>
                        <span className="tnum">You earn ${booking.subtotal}</span>
                      </p>
                    </div>
                    <p className="font-bold text-main shrink-0 tnum">${booking.total}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3.5 pt-3.5 border-t border-app">
                    <Button size="sm" variant="success" loading={busyId === booking.id} onClick={() => void handleRespond(booking.id, true)}>
                      Accept request
                    </Button>
                    <Button size="sm" variant="secondary" loading={busyId === booking.id} onClick={() => void handleRespond(booking.id, false)}>
                      Decline
                    </Button>
                    <Button size="sm" variant="ghost" icon={<MessageSquare size={15} />} onClick={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                      Message
                    </Button>
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </section>

        {(upcomingRentals.length > 0 || myListings === null || (myListings?.length ?? 0) > 0) && <section className="mb-8">
          <SectionHeader as="h3" title="Upcoming rentals" className="mb-3" />
          {upcomingRentals.length === 0 ? <p className="text-sm text-sec">No upcoming rentals.</p> : (
            <div className="space-y-2.5">
              {upcomingRentals.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onOpen={() => navigate({ name: 'listing', id: booking.listingId })} onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                  <PayoutControl booking={booking} payout={payouts.get(booking.id)} onMarkPaidOut={handleMarkPaidOut} />
                </BookingRow>
              ))}
            </div>
          )}
        </section>}

        {(activeRentals.length > 0 || myListings === null || (myListings?.length ?? 0) > 0) && <section className="mb-8">
          <SectionHeader as="h3" title="Active rentals" className="mb-3" />
          {activeRentals.length === 0 ? <p className="text-sm text-sec">No active rentals.</p> : (
            <div className="space-y-2.5">
              {activeRentals.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onOpen={() => navigate({ name: 'listing', id: booking.listingId })} onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                  {booking.status === 'return_pending' && <Button size="sm" loading={busyId === booking.id} onClick={() => void handleMarkReturned(booking.id)}>Mark returned</Button>}
                  <PayoutControl booking={booking} payout={payouts.get(booking.id)} onMarkPaidOut={handleMarkPaidOut} />
                </BookingRow>
              ))}
            </div>
          )}
        </section>}

        {(pastRentals.length > 0 || myListings === null || (myListings?.length ?? 0) > 0) && <section className="mb-8">
          <SectionHeader as="h3" title="Past rentals" className="mb-3" />
          {pastRentals.length === 0 ? <p className="text-sm text-sec">Past rentals will appear here.</p> : (
            <div className="space-y-2.5">
              {pastRentals.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onOpen={() => navigate({ name: 'listing', id: booking.listingId })} onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                  <PayoutControl booking={booking} payout={payouts.get(booking.id)} onMarkPaidOut={handleMarkPaidOut} />
                  {booking.status === 'completed' && !reviewedBookingIds.has(booking.id) && (
                    <Button size="sm" variant="secondary" icon={<Star size={15} />} onClick={() => setReviewTarget(booking)}>Review {booking.counterpartName.split(' ')[0]}</Button>
                  )}
                </BookingRow>
              ))}
            </div>
          )}
        </section>}

        <section className="mb-8">
          <SectionHeader
            as="h3"
            title="My listings"
            className="mb-3"
          />
          {!!myListings?.length && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Button size="sm" variant="secondary" onClick={() => {
                setSelectingListings((current) => !current);
                setSelectedListingIds(new Set());
              }}>
                {selectingListings ? 'Cancel selection' : 'Select listings'}
              </Button>
              {selectingListings && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedListingIds(new Set(myListings.map((item) => item.id)))}>
                    Select all
                  </Button>
                  <Button size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={selectedListingIds.size === 0} onClick={() => setRemovalTarget(myListings.filter((item) => selectedListingIds.has(item.id)))}>
                    Remove selected ({selectedListingIds.size})
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'create-listing' })} className="sm:ml-auto">
                Add another item
              </Button>
            </div>
          )}
          {myListings === null ? (
            <div className="grid sm:grid-cols-2 gap-3">
              <Skeleton className="h-28" rounded="rounded-card-lg" />
              <Skeleton className="h-28" rounded="rounded-card-lg" />
            </div>
          ) : myListings.length === 0 ? (
            <EmptyState
              icon={<Package size={20} />}
              title="Turn something you own into income."
              description="List it, set the dates it is available, and approve each rental request."
              actionLabel="List an item"
              onAction={() => navigate({ name: 'create-listing' })}
            />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {myListings.map((listing) => (
                <Surface key={listing.id} className="p-3 flex gap-3.5">
                  {selectingListings ? (
                    <label className="relative w-20 h-20 rounded-card overflow-hidden shrink-0 bg-subtle cursor-pointer">
                      <img src={listing.images[0]} alt="" className="w-full h-full object-cover" />
                      <span className="absolute top-1 left-1 grid place-items-center w-8 h-8 rounded-card bg-card shadow-xs">
                        <input type="checkbox" checked={selectedListingIds.has(listing.id)} onChange={() => toggleListingSelection(listing.id)} aria-label={`Select ${listing.title}`} className="w-5 h-5 accent-[var(--accent)] cursor-pointer" />
                      </span>
                    </label>
                  ) : (
                    <button onClick={() => navigate({ name: 'listing', id: listing.id })} className="w-20 h-20 rounded-card overflow-hidden shrink-0 bg-subtle" aria-label={`Open ${listing.title}`}>
                      <img src={listing.images[0]} alt="" className="w-full h-full object-cover" />
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <button onClick={() => selectingListings ? toggleListingSelection(listing.id) : navigate({ name: 'listing', id: listing.id })} aria-pressed={selectingListings ? selectedListingIds.has(listing.id) : undefined} className="text-left w-full">
                      <h4 className="font-semibold text-sm text-main font-display line-clamp-1 hover:text-accent transition-colors duration-fast">{listing.title}</h4>
                    </button>
                    <div className="flex items-center gap-2 mt-1"><Rating value={listing.rating} count={listing.reviewCount} size="sm" /></div>
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <p className="font-bold text-main text-sm tnum">${listing.pricePerDay}<span className="text-xs text-sec font-medium">/day</span></p>
                      <Badge tone={listing.available ? 'success' : 'neutral'}>{listing.available ? 'Published' : 'Draft'}</Badge>
                    </div>
                    {!selectingListings && (
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="mt-1.5 -ml-3.5 text-error hover:bg-error-soft" onClick={() => setRemovalTarget([listing])}>
                        Remove listing
                      </Button>
                    )}
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </section>

        {(myListings?.length ?? 0) > 0 && <section className="mb-8">
          <SectionHeader as="h3" title="Availability" className="mb-3" />
          {myListings === null ? (
            <Skeleton className="h-11 w-full max-w-xl" />
          ) : myListings.length > 0 ? (
            <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
              <label className="sr-only" htmlFor="availability-listing">Choose a listing</label>
              <select id="availability-listing" value={availabilityListingId} onChange={(e) => setAvailabilityListingId(e.target.value)} className="h-11 flex-1 px-3 rounded-card border border-app bg-card text-sm text-main">
                {myListings.map((listing) => <option key={listing.id} value={listing.id}>{listing.title}</option>)}
              </select>
              <Button icon={<CalendarCog size={15} />} onClick={handleOpenSelectedAvailability}>Manage dates</Button>
            </div>
          ) : (
            <p className="text-sm text-sec">Create a listing to set its available dates.</p>
          )}
        </section>}

        {(myListings?.length ?? 0) > 0 && <section className="mb-8">
          <SectionHeader as="h3" title="Earnings" className="mb-3" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard icon={Wallet} label="Earned to date" value={`$${earned.toLocaleString()}`} />
            <StatCard icon={CheckCircle2} label="Marked paid out" value={`$${paidOut.toLocaleString()}`} />
            <StatCard icon={Calendar} label="Upcoming & active" value={upcomingRentals.length + activeRentals.length} />
          </div>
          {paidOut > 0 && (
            <Alert tone="success" className="mt-3">
              <span className="tnum">${paidOut.toLocaleString()}</span> of <span className="tnum">${earned.toLocaleString()}</span> marked as paid out.
            </Alert>
          )}
        </section>}
      </div>

      {reviewTarget && (
        <ReviewModal title={reviewTarget.counterpartName} onSubmit={handleSubmitReview} onClose={() => setReviewTarget(null)} />
      )}

      {removalTarget && (
        <Sheet title={removalTarget.length === 1 ? 'Remove listing' : `Remove ${removalTarget.length} listings`} onClose={closeRemoval} locked={removingListings}>
          <p className="text-sm text-sec leading-relaxed break-words">
            {removalTarget.length === 1 ? `Remove "${removalTarget[0].title}"?` : 'Remove the selected listings?'} Listings without rental history are permanently deleted. Listings with past rentals are archived. Current requests or rentals prevent removal.
          </p>
          {removalTarget.length > 1 && (
            <ul className="mt-3 max-h-40 overflow-y-auto rounded-card border border-app divide-y divide-[var(--border)] text-sm text-main">
              {removalTarget.map((listing) => <li key={listing.id} className="px-3 py-2 truncate">{listing.title}</li>)}
            </ul>
          )}
          {removalError && <Alert tone="error" className="mt-4">{removalError}</Alert>}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
            <Button variant="secondary" onClick={closeRemoval} disabled={removingListings}>Cancel</Button>
            <Button variant="danger" icon={<Trash2 size={16} />} loading={removingListings} loadingLabel={deletingListingId ? 'Removing…' : undefined} onClick={() => void handleDeleteListings()}>
              {removalTarget.length === 1 ? 'Remove listing' : `Remove ${removalTarget.length} listings`}
            </Button>
          </div>
        </Sheet>
      )}

      {availabilityTarget && (
        <Sheet title={`Availability - ${availabilityTarget.title}`} onClose={() => setAvailabilityTarget(null)}>
          <p className="text-sm text-sec mb-3">Tap a date to block it. Booked dates are managed for you.</p>
          <AvailabilityCalendar
            bookedDates={availabilityDates.booked}
            blockedDates={availabilityDates.blocked}
            editable
            onToggleDate={handleToggleAvailabilityDate}
          />
        </Sheet>
      )}
    </div>
  );
}

function PayoutControl({ booking, payout, onMarkPaidOut }: {
  booking: UiBooking; payout?: DbPayoutRow; onMarkPaidOut: (booking: UiBooking) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  if (!PAID_OUT_ELIGIBLE_STATUSES.includes(booking.status)) return null;
  if (payout?.status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
        <CheckCircle2 size={14} /> Paid out ${payout.amount}
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Wallet size={15} />}
      loading={submitting}
      loadingLabel="Recording…"
      onClick={async () => { setSubmitting(true); await onMarkPaidOut(booking); setSubmitting(false); }}
    >
      Mark ${booking.subtotal} paid out
    </Button>
  );
}

/** Bottom sheet on mobile, centered dialog from `sm`. One implementation for both dashboards. */
function Sheet({ title, onClose, children, locked = false }: { title: string; onClose: () => void; children: React.ReactNode; locked?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  return (
    <Overlay className="flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/45 animate-fade-in" onClick={locked ? undefined : onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); if (!locked) onClose(); return; }
          if (event.key !== 'Tab') return;
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        className="relative w-full sm:max-w-md bg-card rounded-t-card-xl sm:rounded-card-xl border border-app shadow-pop max-h-[88vh] overflow-y-auto animate-sheet sm:animate-modal"
      >
        <div className="sticky top-0 bg-card flex items-center justify-between gap-3 px-5 py-3.5 border-b border-app">
          <h2 className="font-bold text-main font-display truncate">{title}</h2>
          <button onClick={onClose} disabled={locked} aria-label="Close" className="grid place-items-center w-9 h-9 rounded-full hover:bg-subtle disabled:opacity-50 shrink-0">
            <X size={18} className="text-sec" />
          </button>
        </div>
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </Overlay>
  );
}

/** 1-5 star rating + optional text, shown after a booking reaches Completed (spec §3.14). */
function ReviewModal({ title, onSubmit, onClose }: { title: string; onSubmit: (rating: number, body: string) => Promise<void>; onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (rating === 0) { setError('Choose a star rating first.'); return; }
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
    <Sheet title={`Review ${title}`} onClose={onClose}>
      <div className="flex items-center justify-center gap-1.5 mb-5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => { setRating(n); setError(null); }} aria-label={`${n} star${n === 1 ? '' : 's'}`} className="p-1">
            <Star size={30} className={n <= rating ? 'fill-[var(--star)] text-[var(--star)]' : 'text-[var(--border-strong)]'} />
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What went well? Anything the next person should know?"
        rows={4}
        className={textareaClass()}
      />
      {error && <p className="text-xs text-error mt-2">{error}</p>}
      <Button fullWidth className="mt-4" loading={submitting} loadingLabel="Sending…" onClick={handleSubmit}>
        Submit review
      </Button>
    </Sheet>
  );
}
