import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { type Listing } from '@/data';
import { WorkspaceHeader } from '@/components/account-workspace';
import {
  fetchBookingsAsRenter, fetchBookingsAsOwner, respondToBookingRequest, cancelBooking,
  startBookingReturn, type UiBooking,
} from '@/lib/bookings';
import { startBookingPickup } from '@/lib/booking-handoff';
import { getOrCreateConversation } from '@/lib/messages';
import { createReview, fetchReviewedBookingIds, REVIEW_MAX_LENGTH } from '@/lib/reviews';
import { deleteOwnerListing, fetchListingsByOwner, fetchListingTimeZone, toUiListing } from '@/lib/listings';
import { pickupToday } from '@/lib/pickup-timezone';
import { fetchBankPayoutStatus, fetchPayoutsByOwner, startConnectOnboarding, type BankPayoutStatus, type DbPayoutRow } from '@/lib/payouts';
import { RentalSettlement } from '@/components/rental-settlement';
import { BookingPickup } from '@/components/booking-pickup';
import { fetchUnavailableDates, setDateAvailability } from '@/lib/availability';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { DurationDiscountControl } from '@/components/duration-discount-control';
import { OwnerPromotionControl } from '@/components/owner-promotion-control';
import { ListingPhoto } from '@/components/listing-card';
import { BookingListSkeleton, BookingRowSkeleton, Skeleton } from '@/components/skeleton';
import { Button, Badge, Alert, EmptyState, Surface, SectionHeader, Overlay } from '@/components/ui';
import { textareaClass } from '@/components/form-classes';
import { Rating } from '@/components/trust';
import { SuccessNotice } from '@/components/success-feedback';
import { Dropdown } from '@/components/shadcn/select';
import './production-workflows.css';
import {
  Calendar, Package, CheckCircle2,
  Star, X, CalendarCog, Wallet, MessageSquare, CreditCard, Search, Trash2,
} from 'lucide-react';

const PAID_OUT_ELIGIBLE_STATUSES: UiBooking['status'][] = ['confirmed', 'active', 'return_pending', 'completed'];
const REQUESTED_STATUSES: UiBooking['status'][] = ['requested', 'pending_payment', 'confirmed'];
const PAST_STATUSES: UiBooking['status'][] = ['completed', 'cancelled', 'rejected'];
type RenterTab = 'all' | 'upcoming' | 'active' | 'pending' | 'approved' | 'past' | 'cancelled';
const RENTER_TAB_STATUSES: Record<Exclude<RenterTab, 'all'>, UiBooking['status'][]> = {
  upcoming: ['confirmed'],
  active: ['active', 'return_pending'],
  pending: ['requested'],
  approved: ['pending_payment'],
  past: ['completed'],
  cancelled: ['cancelled', 'rejected'],
};

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

function StatCard({ label, value, highlight, onClick, hint }: {
  icon: typeof Calendar; label: string; value: string | number; highlight?: boolean; onClick?: () => void; hint?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`p1-production-metric text-left ${highlight ? 'p1-metric-accent' : ''}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
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
    <article className="p1-rental-row p1-production-rental">
        <button
          onClick={onOpen}
          className="p1-production-rental-photo"
          aria-label={`Open ${booking.listingTitle}`}
        >
          <ListingPhoto src={booking.listingImage} alt="" />
        </button>
        <div className="p1-production-rental-body">
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
          <p className="text-xs text-sec mt-1">Booking reference: {booking.bookingReference ?? 'Not assigned'}</p>
        </div>
      {['confirmed', 'active', 'return_pending'].includes(booking.status) && <div className="p1-production-rental-extra"><BookingPickup bookingId={booking.id} status={booking.status} /></div>}
      {(children || onMessage) && (
        <div className="p1-actions p1-wrap p1-production-rental-extra">
          {children}
          {onMessage && (
            <Button size="sm" variant="ghost" icon={<MessageSquare size={15} />} onClick={onMessage}>Message</Button>
          )}
        </div>
      )}
    </article>
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

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'renting' : event.key === 'End' ? 'lending' : tab === 'renting' ? 'lending' : 'renting';
    selectTab(next);
    document.getElementById(`${next}-tab`)?.focus();
  }

  return (
    <div className="ybuy-workspace p1-work-page">
      <div className="workspace-container !pb-0">
        <WorkspaceHeader title={tab === 'lending' ? 'A little more from what you own.' : 'Your next good plans.'} description={tab === 'lending'
          ? 'Review requests and keep your rentals running smoothly.'
          : 'Upcoming adventures, projects in progress, and things well done.'} action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate({ name: tab === 'lending' ? 'create-listing' : 'search' })}>{tab === 'lending' ? 'List an item' : 'Find a new rental'}</Button>
            {tab === 'renting' && <Button variant="ghost" onClick={() => navigate({ name: 'claims' })}>Disputes & claims</Button>}
          </div>
        } />
        <div className="p1-tabs p1-space-bottom" role="tablist" aria-label="Booking activity">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'renting'}
            tabIndex={tab === 'renting' ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            onClick={() => selectTab('renting')}
            aria-controls="renting-workspace"
            id="renting-tab"
          >
            Renting
            {rentingAttention > 0 && <span className="ml-2 inline-flex min-w-5 justify-center rounded-full bg-warning-soft px-1.5 py-0.5 text-xs font-bold text-warning tnum">{rentingAttention}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'lending'}
            tabIndex={tab === 'lending' ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            onClick={() => selectTab('lending')}
            aria-controls="lending-workspace"
            id="lending-tab"
          >
            Lending
            {lendingRequests > 0 && <span className="ml-2 text-xs font-semibold text-accent tnum">· {lendingRequests} {lendingRequests === 1 ? 'request' : 'requests'}</span>}
          </button>
        </div>
      </div>
      <div role="tabpanel" id="renting-workspace" aria-labelledby="renting-tab" hidden={tab !== 'renting'}>
        <RenterDashboard onAttentionCount={setRentingAttention} />
      </div>
      <div role="tabpanel" id="lending-workspace" aria-labelledby="lending-tab" hidden={tab !== 'lending'}>
        <OwnerDashboard onRequestCount={setLendingRequests} />
      </div>
    </div>
  );
}

export function RenterDashboard({ onAttentionCount }: { onAttentionCount?: (count: number) => void } = {}) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [successNotice, setSuccessNotice] = useState<{ message: string; eventKey: string } | null>(null);
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [tab, setTab] = useState<RenterTab>('all');
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<UiBooking | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    if (!user) return;
    setLoadError(null);
    fetchBookingsAsRenter(user.id).then((rows) => {
      setBookings(rows);
      const completedIds = rows.filter((b) => b.status === 'completed').map((b) => b.id);
      fetchReviewedBookingIds(user.id, completedIds).then(setReviewedBookingIds).catch(() => {});
    }).catch((err: unknown) => { setBookings([]); setLoadError(err instanceof Error ? err.message : 'Could not load your bookings.'); });
  }

  useEffect(reload, [user]);

  const all = useMemo(() => bookings ?? [], [bookings]);
  const upcoming = all.filter((b) => b.status === 'confirmed');
  const active = all.filter((b) => b.status === 'active' || b.status === 'return_pending');
  const tabData = tab === 'all' ? all : all.filter((booking) => RENTER_TAB_STATUSES[tab].includes(booking.status));
  const sectionCounts: Record<RenterTab, number> = {
    all: all.length,
    upcoming: upcoming.length,
    active: active.length,
    pending: all.filter((b) => b.status === 'requested').length,
    approved: all.filter((b) => b.status === 'pending_payment').length,
    past: all.filter((b) => b.status === 'completed').length,
    cancelled: all.filter((b) => b.status === 'cancelled' || b.status === 'rejected').length,
  };

  // Keep the workspace attention count in sync with renter actions.
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
  const handleStartCheckIn = (id: string) =>
    run(id, async () => {
      if (!bookings?.find(booking => booking.id === id)?.paymentFirst) await startBookingPickup(id);
      navigate({ name: 'check-in', id });
    }, 'Could not start pickup.');
  const handleStartReturn = (id: string) =>
    run(id, async () => { await startBookingReturn(id); navigate({ name: 'check-out', id }); }, 'Could not start the return.');
  const handlePayNow = (id: string) =>
    navigate({ name: 'confirmation',id });

  async function handleMessage(counterpartId: string, listingId: string, bookingId: string) {
    if (!user) return;
    await run(bookingId, async () => {
      const conversationId = await getOrCreateConversation({ currentUserId: user.id, otherUserId: counterpartId, listingId, bookingId });
      navigate({ name: 'conversation', id: conversationId });
    }, 'Could not open the conversation.');
  }

  async function handleSubmitReview(rating: number, body: string) {
    if (!user || !reviewTarget) return;
    setSuccessNotice(null);
    await createReview({ bookingId: reviewTarget.id, reviewerId: user.id, revieweeId: reviewTarget.counterpartId, rating, body });
    setReviewedBookingIds((prev) => new Set(prev).add(reviewTarget.id));
    setReviewTarget(null);
    setSuccessNotice({ message: 'Your review was saved.', eventKey: `review:${reviewTarget.id}` });
  }

  return (
    <div className="ybuy-workspace">
      <div className="workspace-container !pt-0">
        {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}
        {successNotice && <SuccessNotice key={successNotice.eventKey} eventKey={successNotice.eventKey} onDismiss={() => setSuccessNotice(null)}>{successNotice.message}</SuccessNotice>}
        {loadError && <Alert tone="warning" className="mb-4">{loadError}<Button size="sm" variant="secondary" className="mt-2" onClick={reload}>Try again</Button></Alert>}

        <div className="p1-tabs p1-space-bottom" aria-label="Rental status">
          {(['all', 'upcoming', 'active', 'pending', 'approved', 'past', 'cancelled'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              aria-label={`${t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)} (${sectionCounts[t]})`}
              type="button"
            >
              <span>{t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}</span>
              <span className="ml-1.5 text-xs tnum">{sectionCounts[t]}</span>
            </button>
          ))}
        </div>

        {bookings === null ? (
          <BookingListSkeleton count={3} />
        ) : tabData.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title={
              tab === 'all' ? 'Your next good plan starts here.'
                : tab === 'pending' ? 'No requests waiting on an owner'
                : tab === 'approved' ? 'No approved rentals waiting for payment'
                : tab === 'upcoming' ? 'No upcoming rentals'
                : tab === 'active' ? 'Nothing out on rental right now'
                : tab === 'past' ? 'No past rentals yet' : 'No cancelled rentals'
            }
            description={
              tab === 'all' ? 'Find the gear you need. Requests, pickup details and returns stay together here.'
                : tab === 'pending' ? 'Requests you send will appear here until the owner responds.'
                : tab === 'approved' ? 'Once an owner approves your request, payment steps will appear here.'
                : tab === 'upcoming' ? 'Confirmed pickups will appear here.'
                : tab === 'active' ? 'Rentals move here once you have checked the item in.'
                : tab === 'past' ? 'Completed rentals are kept here for your records.'
                : 'Cancelled or declined requests are kept here for your records.'
            }
            actionLabel={tab === 'past' || tab === 'cancelled' ? undefined : 'Browse rentals'}
            onAction={tab === 'past' || tab === 'cancelled' ? undefined : () => navigate({ name: 'search' })}
            className="workspace-renter-empty"
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
                  <Button size="sm" loading={busyId === booking.id} onClick={() => void handleStartCheckIn(booking.id)}>
                    {booking.paymentFirst ? 'Check-in: choose a slot' : "I'm Here – Start Pickup"}
                  </Button>
                )}
                {booking.status === 'active' && (
                  <Button size="sm" loading={busyId === booking.id} onClick={() => void handleStartReturn(booking.id)}>
                    Start return
                  </Button>
                )}
                {booking.status === 'return_pending' && (
                  <Button size="sm" onClick={() => navigate({ name: 'check-out', id: booking.id })}>Continue return</Button>
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
                {booking.status === 'completed' && <RentalSettlement bookingId={booking.id} isOwner={false} />}
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

export function OwnerDashboard({ onRequestCount, listingView = false }: { onRequestCount?: (count: number) => void; listingView?: boolean } = {}) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [successNotice, setSuccessNotice] = useState<{ message: string; eventKey: string } | null>(null);
  const [availabilityNotice, setAvailabilityNotice] = useState(false);
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [myListings, setMyListings] = useState<Listing[] | null>(null);
  const [payouts, setPayouts] = useState<Map<string, DbPayoutRow>>(new Map());
  const [payoutsVerified, setPayoutsVerified] = useState(false);
  const [bankPayouts, setBankPayouts] = useState<BankPayoutStatus[] | null>(null);
  const [bankPayoutConnected, setBankPayoutConnected] = useState(false);
  const [bankPayoutError, setBankPayoutError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [listingNotice, setListingNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<UiBooking | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<Listing | null>(null);
  const availabilityRequest=useRef(0);
  const [availabilityListingId, setAvailabilityListingId] = useState('');
  const [availabilityDates, setAvailabilityDates] = useState<{ blocked: Set<string>; booked: Set<string> }>({ blocked: new Set(), booked: new Set() });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingListingId, setDeletingListingId] = useState<string | null>(null);
  const [selectingListings, setSelectingListings] = useState(false);
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(new Set());
  const [removalTarget, setRemovalTarget] = useState<Listing[] | null>(null);
  const [rentalTab, setRentalTab] = useState<'upcoming' | 'active' | 'past'>('upcoming');
  const [listingTab, setListingTab] = useState<'all' | 'live' | 'review' | 'offline'>('all');
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
    }).catch((err: unknown) => {
      setMyListings([]);
      setLoadError(err instanceof Error ? err.message : 'Could not load your listings.');
    });
    setPayoutsVerified(false);
    fetchPayoutsByOwner(user.id).then(rows => { setPayouts(rows); setPayoutsVerified(true); }).catch((err: unknown) => {
      setActionError(err instanceof Error ? err.message : 'Could not verify your Stripe transfers.');
    });
    fetchBankPayoutStatus().then((result) => {
      setBankPayoutConnected(result.connected);
      setBankPayouts(result.payouts);
      setBankPayoutError(null);
    }).catch((err: unknown) => {
      setBankPayoutError(err instanceof Error ? err.message : 'Could not load your Stripe bank payout status.');
    });
  }

  useEffect(reload, [user]);

  const all = useMemo(() => bookings ?? [], [bookings]);
  const pending = all.filter((b) => b.status === 'requested');
  const upcomingRentals = all.filter((b) => b.status === 'pending_payment' || b.status === 'confirmed');
  const activeRentals = all.filter((b) => b.status === 'active' || b.status === 'return_pending');
  const pastRentals = all.filter((b) => PAST_STATUSES.includes(b.status));
  const visibleListings = (myListings ?? []).filter(listing => listingTab === 'all'
    || (listingTab === 'live' ? listing.listingStatus === 'published'
      : listingTab === 'review' ? listing.listingStatus === 'pending_approval'
        : listing.listingStatus !== 'published' && listing.listingStatus !== 'pending_approval'));

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
    setSuccessNotice(null);
    await createReview({ bookingId: reviewTarget.id, reviewerId: user.id, revieweeId: reviewTarget.counterpartId, rating, body });
    setReviewedBookingIds((prev) => new Set(prev).add(reviewTarget.id));
    setReviewTarget(null);
    setSuccessNotice({ message: 'Your review was saved.', eventKey: `review:${reviewTarget.id}` });
  }

  async function handleOpenAvailability(listing: Listing) {
    const request=++availabilityRequest.current;
    setActionError(null);
    setAvailabilityNotice(false);
    setAvailabilityTarget(null);
    try{
      const [dates,timeZone]=await Promise.all([fetchUnavailableDates(listing.id),fetchListingTimeZone(listing.id)]);
      if(request!==availabilityRequest.current)return;
      setAvailabilityDates(dates);
      setAvailabilityTarget({ ...listing, pickupTimeZone: timeZone ?? undefined });
    }catch(error){
      if(request===availabilityRequest.current)setActionError(error instanceof Error?error.message:'Could not verify listing availability.');
    }
  }

  function handleOpenSelectedAvailability() {
    const listing = myListings?.find((item) => item.id === availabilityListingId);
    if (listing) handleOpenAvailability(listing);
  }

  async function handleToggleAvailabilityDate(date: string) {
    if (!availabilityTarget) return;
    setAvailabilityNotice(false);
    const isBlocked = availabilityDates.blocked.has(date);
    setAvailabilityDates((prev) => {
      const blocked = new Set(prev.blocked);
      if (isBlocked) blocked.delete(date); else blocked.add(date);
      return { ...prev, blocked };
    });
    try {
      await setDateAvailability(availabilityTarget.id, date, isBlocked);
      setAvailabilityNotice(true);
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
    <div className="ybuy-workspace p1-work-page">
      <div className="workspace-container !pt-0">
        {listingView && <WorkspaceHeader title="Your gear, working for you." description="Price it, pause it, and keep its dates in shape." action={
          <Button variant="secondary" onClick={() => navigate({ name: 'create-listing' })}>List an item</Button>
        } />}
        {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}
        {listingNotice && <Alert tone="success" className="mb-4">{listingNotice}</Alert>}
        {successNotice && <SuccessNotice key={successNotice.eventKey} eventKey={successNotice.eventKey} onDismiss={() => setSuccessNotice(null)}>{successNotice.message}</SuccessNotice>}
        {loadError && <Alert tone="warning" className="mb-4">{loadError}<Button size="sm" variant="secondary" className="mt-2" onClick={reload}>Try again</Button></Alert>}

        {!listingView && <div className="p1-owner-metrics" aria-label="Owner overview" aria-busy={bookings === null || myListings === null}>
          <StatCard icon={Wallet} label="Accepted rental value" value={bookings === null || loadError ? '—' : `$${earned.toLocaleString()}`} hint="Rental value · not settled bank payouts" />
          <StatCard icon={Calendar} label="Waiting on you" value={bookings === null || loadError ? '—' : pending.length} highlight hint="Requests ready to review" />
          <StatCard icon={Package} label="Your listings" value={myListings === null || loadError ? '—' : myListings.filter(l => l.listingStatus === 'published').length} hint="Live in the marketplace" />
        </div>}
        <div className="p1-production-owner-sections">
        {!listingView && <div>
        <section className="p1-owner-requests" aria-labelledby="owner-request-queue">
          <div className="p1-section-head"><div>
            <h2 id="owner-request-queue">The next handoffs {pending.length > 0 && <span className="tnum text-sec">({pending.length})</span>}</h2>
            <p>Review rental requests and keep each handoff moving.</p>
          </div></div>
          {bookings === null ? (
            <BookingRowSkeleton />
          ) : pending.length === 0 ? (
            <p className="text-sm text-sec">Nothing needs a decision right now.</p>
          ) : (
            <div className="p1-request-queue">
              {pending.map((booking) => (
                <article key={booking.id}>
                    {booking.counterpartAvatar && (
                      <img src={booking.counterpartAvatar} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <strong>{booking.counterpartName}</strong>
                      <p>{booking.listingTitle}</p>
                      <small>{formatRange(booking.startDate, booking.endDate)} · ${booking.total} total · ${booking.subtotal} rental subtotal</small>
                    </div>
                  <div className="p1-actions p1-wrap">
                    <Button size="sm" loading={busyId === booking.id} disabled={busyId !== null} onClick={() => void handleRespond(booking.id, true)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" loading={busyId === booking.id} disabled={busyId !== null} onClick={() => void handleRespond(booking.id, false)}>
                      Decline
                    </Button>
                    <Button size="sm" variant="ghost" icon={<MessageSquare size={15} />} onClick={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                      Message
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="p1-section-head"><div><h2>Rental activity</h2><p>Coordinate pickups, confirm returns and keep rental history close.</p></div></div>
        <div className="p1-tabs p1-space-bottom" aria-label="Owner rental status">
          {(['upcoming', 'active', 'past'] as const).map(value => <button type="button" key={value} aria-pressed={rentalTab === value} onClick={() => setRentalTab(value)}>
            {value === 'upcoming' ? 'Upcoming' : value === 'active' ? 'Active' : 'Past'} <span className="ml-1 tnum">{value === 'upcoming' ? upcomingRentals.length : value === 'active' ? activeRentals.length : pastRentals.length}</span>
          </button>)}
        </div>
        {rentalTab === 'upcoming' && <section className="p1-rental-list p1-space-bottom" aria-label="Upcoming owner rentals">
          {bookings === null ? <BookingRowSkeleton /> :
          upcomingRentals.length === 0 ? <p className="text-sm text-sec">No upcoming rentals.</p> : (
            <div className="space-y-2.5">
              {upcomingRentals.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onOpen={() => navigate({ name: 'listing', id: booking.listingId })} onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                  {booking.status === 'confirmed' && <Button size="sm" onClick={() => navigate({ name: 'check-in', id: booking.id })}>Open pickup handoff</Button>}
                  <PayoutControl booking={booking} />
                </BookingRow>
              ))}
            </div>
          )}
        </section>}

        {rentalTab === 'active' && <section className="p1-rental-list p1-space-bottom" aria-label="Active owner rentals">
          {activeRentals.length === 0 ? <p className="text-sm text-sec">No active rentals.</p> : (
            <div className="space-y-2.5">
              {activeRentals.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onOpen={() => navigate({ name: 'listing', id: booking.listingId })} onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                  {booking.status === 'return_pending' && <Button size="sm" onClick={() => navigate({ name: 'check-out', id: booking.id })}>Inspect return</Button>}
                  <PayoutControl booking={booking} />
                </BookingRow>
              ))}
            </div>
          )}
        </section>}

        {rentalTab === 'past' && <section className="p1-rental-list p1-space-bottom" aria-label="Past owner rentals">
          {pastRentals.length === 0 ? <p className="text-sm text-sec">Past rentals will appear here.</p> : (
            <div className="space-y-2.5">
              {pastRentals.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onOpen={() => navigate({ name: 'listing', id: booking.listingId })} onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                  <PayoutControl booking={booking} />
                  {booking.status === 'completed' && !reviewedBookingIds.has(booking.id) && (
                    <Button size="sm" variant="secondary" icon={<Star size={15} />} onClick={() => setReviewTarget(booking)}>Review {booking.counterpartName.split(' ')[0]}</Button>
                  )}
                </BookingRow>
              ))}
            </div>
          )}
        </section>}

        </div>}
        <div>
        <section className="p1-space-bottom" aria-labelledby="owner-inventory-title">
          <div className="p1-section-head"><div><h2 id="owner-inventory-title">{listingView ? 'Your inventory' : 'Gear with a second job'}</h2><p>Manage prices, publication status and the days your items are available.</p></div></div>
          <div className="p1-tabs p1-space-bottom" aria-label="Owner listing status">
            {(['all', 'live', 'review', 'offline'] as const).map(value => <button type="button" key={value} aria-pressed={listingTab === value} onClick={() => setListingTab(value)}>
              {value === 'all' ? 'All' : value === 'live' ? 'Live' : value === 'review' ? 'In review' : 'Not live'}
            </button>)}
          </div>
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
                  <Button size="sm" variant="ghost" onClick={() => setSelectedListingIds(new Set(visibleListings.map((item) => item.id)))}>
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
              className="workspace-owner-listing-empty"
            />
          ) : visibleListings.length === 0 ? (
            <p className="text-sm text-sec py-4">No listings with this status. Choose another status to manage your gear.</p>
          ) : (
            <div className="p1-owner-listings">
              {visibleListings.map((listing) => (
                <article key={listing.id} className="p1-owner-item">
                  {selectingListings ? (
                    <label className="relative p1-production-owner-photo cursor-pointer">
                      <ListingPhoto src={listing.images[0]} alt="" />
                      <span className="absolute top-1 left-1 grid place-items-center w-8 h-8 rounded-card bg-card shadow-xs">
                        <input type="checkbox" checked={selectedListingIds.has(listing.id)} onChange={() => toggleListingSelection(listing.id)} aria-label={`Select ${listing.title}`} className="w-5 h-5 accent-[var(--accent)] cursor-pointer" />
                      </span>
                    </label>
                  ) : (
                    <button onClick={() => navigate({ name: 'listing', id: listing.id })} className="p1-production-owner-photo" aria-label={`Open ${listing.title}`}>
                      <ListingPhoto src={listing.images[0]} alt="" />
                    </button>
                  )}
                  <div className="p1-owner-item-body">
                    <Badge tone={listing.listingStatus === 'published' ? 'success' : listing.listingStatus === 'pending_approval' ? 'warning' : 'neutral'}>
                      {listing.listingStatus === 'published' ? 'Live' : listing.listingStatus === 'pending_approval' ? 'In review' : listing.listingStatus === 'suspended' ? 'Suspended' : listing.listingStatus === 'archived' ? 'Archived' : 'Draft'}
                    </Badge>
                    <button onClick={() => selectingListings ? toggleListingSelection(listing.id) : navigate({ name: 'listing', id: listing.id })} aria-pressed={selectingListings ? selectedListingIds.has(listing.id) : undefined} className="text-left w-full">
                      <h3>{listing.title}</h3>
                    </button>
                    <p className="tnum">${listing.pricePerDay} / day</p>
                    <div className="p1-muted"><Rating value={listing.rating} count={listing.reviewCount} size="sm" /></div>
                    {!selectingListings && (
                      <div className="p1-actions p1-wrap">
                      <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'edit-listing',id: listing.id })}>Edit listing</Button>
                      <Button size="sm" variant="secondary" onClick={() => void handleOpenAvailability(listing)}>Availability</Button>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="text-error hover:bg-error-soft" onClick={() => setRemovalTarget([listing])}>
                        Remove listing
                      </Button>
                      {listing.listingStatus === 'published' && <>
                        <DurationDiscountControl listingId={listing.id} onSaved={reload} />
                        <OwnerPromotionControl listingId={listing.id} onSaved={reload} />
                      </>}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {!listingView && (myListings?.length ?? 0) > 0 && <section className="mb-8">
          <SectionHeader as="h2" title="Keep your dates in shape" className="mb-3" />
          <p className="text-sm text-sec mb-3">Block the days you need. Confirmed bookings stay protected.</p>
          {myListings === null ? (
            <Skeleton className="h-11 w-full max-w-xl" />
          ) : myListings.length > 0 ? (
            <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
              <label className="sr-only" htmlFor="availability-listing">Choose a listing</label>
              <Dropdown id="availability-listing" value={availabilityListingId} onChange={setAvailabilityListingId}
                className="flex-1" options={myListings.map((listing) => ({ value: listing.id, label: listing.title }))} />
              <Button icon={<CalendarCog size={15} />} onClick={handleOpenSelectedAvailability}>Manage dates</Button>
            </div>
          ) : (
            <p className="text-sm text-sec">Create a listing to set its available dates.</p>
          )}
        </section>}

        {!listingView && (myListings?.length ?? 0) > 0 && <section className="mb-8">
          <SectionHeader as="h2" title="Payments & payouts" className="mb-3" />
          <div className="p1-owner-metrics !grid-cols-2">
            <StatCard icon={Wallet} label="Earned to date" value={`$${earned.toLocaleString()}`} />
            <StatCard icon={CheckCircle2} label="Transferred to Stripe" value={payoutsVerified ? `$${paidOut.toLocaleString()}` : '—'} />
          </div>
          {paidOut > 0 && (
            <Alert tone="success" className="mt-3">
              <span className="tnum">${paidOut.toLocaleString()}</span> of <span className="tnum">${earned.toLocaleString()}</span> transferred to Stripe. This does not confirm a bank payout.
            </Alert>
          )}
          <Button className="mt-3" size="sm" variant="secondary" loading={busyId === 'connect'}
            onClick={() => void run('connect', async () => {
              window.location.href = await startConnectOnboarding();
            }, 'Could not open Stripe Connect setup.')}>
            Set up Stripe payouts
          </Button>
          <div className="mt-5 rounded-card-lg border border-app p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h4 className="text-sm font-semibold text-main">Bank payout status</h4>
                <p className="text-xs text-sec mt-1">Status comes from Stripe Connect. YBuy does not initiate payouts.</p></div>
              <Button size="sm" variant="secondary" loading={busyId === 'bank-payouts'} disabled={!bankPayoutConnected}
                onClick={() => void run('bank-payouts', async () => {
                  const result = await fetchBankPayoutStatus();
                  setBankPayoutConnected(result.connected);setBankPayouts(result.payouts);setBankPayoutError(null);
                }, 'Could not refresh bank payout status.')}>Refresh status</Button>
            </div>
            {bankPayoutError && <Alert tone="warning" className="mt-3">{bankPayoutError}</Alert>}
            {bankPayouts === null && !bankPayoutError && <p role="status" className="text-sm text-sec mt-3">Checking Stripe bank payout status…</p>}
            {bankPayouts !== null && !bankPayoutConnected && !bankPayoutError && <p className="text-sm text-sec mt-3">Complete Stripe Connect setup to see payouts.</p>}
            {bankPayoutConnected && bankPayouts?.length === 0 && <p className="text-sm text-sec mt-3">Stripe has no bank payouts to show yet.</p>}
            {!!bankPayouts?.length && <ul className="mt-3 divide-y divide-[var(--border)]">
              {bankPayouts.map((payout) => <li key={payout.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-main"><strong className="tnum">{new Intl.NumberFormat(undefined,{style:'currency',currency:payout.currency.toUpperCase()}).format(payout.amount)}</strong>
                  <span className="text-sec"> · {payout.status}</span></span>
                <span className="text-xs text-sec">{payout.arrival_date ? `Expected ${new Date(payout.arrival_date*1000).toLocaleDateString()}` : `Created ${new Date(payout.created*1000).toLocaleDateString()}`}
                  {payout.failure_code ? ` · ${payout.failure_code}` : ''}</span>
              </li>)}
            </ul>}
          </div>
        </section>}
        </div></div>
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
          {availabilityNotice && <SuccessNotice onDismiss={() => setAvailabilityNotice(false)}>Availability saved.</SuccessNotice>}
          <AvailabilityCalendar
            today={availabilityTarget.pickupTimeZone ? pickupToday(availabilityTarget.pickupTimeZone) : undefined}
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

function PayoutControl({ booking }: { booking: UiBooking }) {
  if (booking.status !== 'completed') return null;
  return <RentalSettlement bookingId={booking.id} isOwner autoProcess />;
}

export function OwnerPayoutsPage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [payouts, setPayouts] = useState<Map<string, DbPayoutRow> | null>(null);
  const [bankPayouts, setBankPayouts] = useState<BankPayoutStatus[] | null>(null);
  const [bankPayoutConnected, setBankPayoutConnected] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [bankPayoutError, setBankPayoutError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'connect' | 'bank-payouts' | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    setBookings(null);
    setPayouts(null);
    setBankPayouts(null);
    setBookingsError(null);
    setPayoutsError(null);
    setBankPayoutError(null);
    void Promise.allSettled([
      fetchBookingsAsOwner(userId),
      fetchPayoutsByOwner(userId),
      fetchBankPayoutStatus(),
    ]).then(([bookingResult, payoutResult, bankPayoutResult]) => {
      if (!active) return;
      if (bookingResult.status === 'fulfilled') setBookings(bookingResult.value);
      else {
        setBookings([]);
        setBookingsError(bookingResult.reason instanceof Error ? bookingResult.reason.message : 'Could not load rental earnings.');
      }
      if (payoutResult.status === 'fulfilled') setPayouts(payoutResult.value);
      else {
        setPayoutsError(payoutResult.reason instanceof Error ? payoutResult.reason.message : 'Could not verify Stripe transfers.');
      }
      if (bankPayoutResult.status === 'fulfilled') {
        setBankPayoutConnected(bankPayoutResult.value.connected);
        setBankPayouts(bankPayoutResult.value.payouts);
      } else {
        setBankPayoutError(bankPayoutResult.reason instanceof Error ? bankPayoutResult.reason.message : 'Could not load Stripe bank payout status.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, retryToken]);

  const rentalEarnings = (bookings ?? []).filter((booking) => PAID_OUT_ELIGIBLE_STATUSES.includes(booking.status));
  const earned = rentalEarnings.reduce((sum, booking) => sum + booking.subtotal, 0);
  const paidOut = payouts ? [...payouts.values()]
    .filter((payout) => payout.status === 'paid')
    .reduce((sum, payout) => sum + Number(payout.amount), 0) : null;

  async function connectPayouts() {
    setActionError(null);
    setBusy('connect');
    try { window.location.href = await startConnectOnboarding(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Could not open Stripe Connect setup.'); }
    finally { setBusy(null); }
  }

  async function refreshBankPayouts() {
    setActionError(null);
    setBusy('bank-payouts');
    try {
      const result = await fetchBankPayoutStatus();
      setBankPayoutConnected(result.connected);
      setBankPayouts(result.payouts);
      setBankPayoutError(null);
    } catch (reason) {
      setBankPayoutError(reason instanceof Error ? reason.message : 'Could not refresh bank payout status.');
    } finally { setBusy(null); }
  }

  if (!user) return null;

  return (
    <div className="ybuy-workspace">
      <div className="workspace-container">
        <WorkspaceHeader title="Your gear. Your returns." description="Understand what’s been earned, what reached your Stripe balance, and the bank payouts Stripe reports."
          action={<Button variant="secondary" onClick={() => navigate({ name: 'owner-listings' })}>Manage listings</Button>} />

        {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}
        {bookingsError && <Alert tone="error" className="mb-4">{bookingsError}
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setRetryToken((value) => value + 1)}>Retry rental activity</Button>
        </Alert>}
        {payoutsError && <Alert tone="error" className="mb-4">{payoutsError}
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setRetryToken((value) => value + 1)}>Retry transfer status</Button>
        </Alert>}

        <div className="p1-owner-metrics" aria-label="Payout summary" aria-busy={loading}>
          <StatCard icon={Wallet} label="Rental earnings" value={bookings === null || bookingsError ? '—' : `$${earned.toLocaleString()}`} />
          <StatCard icon={CheckCircle2} label="Transferred to Stripe" value={paidOut === null ? '—' : `$${paidOut.toLocaleString()}`} />
          <StatCard icon={Calendar} label="Bank payouts reported" value={bankPayoutConnected && bankPayouts ? bankPayouts.length : '—'} />
        </div>

        <section className="p1-space-bottom" aria-labelledby="owner-payout-activity">
          <div className="p1-section-head">
            <div><h2 id="owner-payout-activity">Rental activity</h2><p>Transfers shown here are sent to Stripe, not directly to your bank.</p></div>
            <Button size="sm" variant="secondary" onClick={() => setRetryToken((value) => value + 1)} loading={loading}>Refresh activity</Button>
          </div>
          {loading && bookings === null ? <BookingListSkeleton count={3} />
            : bookingsError ? <p className="text-sm text-sec">Rental activity is unavailable until your bookings can be loaded.</p>
            : rentalEarnings.length === 0 ? <EmptyState icon={<Wallet size={20} />}
              title="Your first earnings start with a rental."
              description="Rental earnings and verified transfers will appear here after a paid booking."
              actionLabel="Manage listings" onAction={() => navigate({ name: 'owner-listings' })} />
              : <div className="space-y-2.5">
                {rentalEarnings.map((booking) => {
                  const payout = payouts?.get(booking.id);
                  return <Surface key={booking.id} className="p1-rental-row">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="workspace-booking-photo"><ListingPhoto src={booking.listingImage} alt="" /></div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-main font-display">{booking.listingTitle}</h3>
                        <p className="mt-1.5 text-xs text-sec">{formatRange(booking.startDate, booking.endDate)} · {booking.days} {booking.days === 1 ? 'day' : 'days'}</p>
                        <Badge tone={STATUS_TONE[booking.status]} className="mt-2">{STATUS_LABEL[booking.status]}</Badge>
                      </div>
                      <div className="sm:text-right">
                        <p className="font-bold text-main tnum">${booking.subtotal.toLocaleString()} earned</p>
                        <p className="mt-1 text-xs text-sec">
                          {payouts === null ? payoutsError ? 'Transfer status unavailable' : 'Checking transfer status…'
                            : payout?.status === 'paid' ? `Transferred $${Number(payout.amount).toLocaleString()} to Stripe${payout.paid_at ? ` · ${new Date(payout.paid_at).toLocaleDateString()}` : ''}`
                              : payout ? `Stripe transfer pending · $${Number(payout.amount).toLocaleString()}`
                                : 'No Stripe transfer recorded'}
                        </p>
                      </div>
                    </div>
                  </Surface>;
                })}
              </div>}
        </section>

        <section className="p1-space-bottom" aria-labelledby="stripe-bank-payouts">
          <div className="p1-section-head">
            <div><h2 id="stripe-bank-payouts">Bank payout status</h2><p>Bank payout timing and status come directly from Stripe Connect. YBuy does not initiate bank payouts.</p></div>
            {bankPayoutConnected && <Button size="sm" variant="secondary" loading={busy === 'bank-payouts'} onClick={() => void refreshBankPayouts()}>Refresh status</Button>}
          </div>
          {bankPayoutError && <Alert tone="error">{bankPayoutError}
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setRetryToken((value) => value + 1)}>Try again</Button>
          </Alert>}
          {!bankPayoutError && bankPayouts === null && <p role="status" className="text-sm text-sec">Checking Stripe bank payout status…</p>}
          {!bankPayoutError && bankPayouts !== null && !bankPayoutConnected && <div className="rounded-card-lg border border-app p-5">
            <p className="text-sm text-sec">Complete Stripe Connect setup to see bank payouts.</p>
            <Button className="mt-3" size="sm" loading={busy === 'connect'} onClick={() => void connectPayouts()}>Set up Stripe payouts</Button>
          </div>}
          {bankPayoutConnected && bankPayouts?.length === 0 && <p className="text-sm text-sec">Stripe has no bank payouts to show yet.</p>}
          {!!bankPayouts?.length && <ul className="divide-y divide-[var(--border)] rounded-card-lg border border-app px-4">
            {bankPayouts.map((payout) => <li key={payout.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-main"><strong className="tnum">{new Intl.NumberFormat(undefined, { style: 'currency', currency: payout.currency.toUpperCase() }).format(payout.amount)}</strong>
                <span className="text-sec"> · {payout.status}</span></span>
              <span className="text-xs text-sec">{payout.arrival_date ? `Expected ${new Date(payout.arrival_date * 1000).toLocaleDateString()}` : `Created ${new Date(payout.created * 1000).toLocaleDateString()}`}
                {payout.failure_code ? ` · ${payout.failure_code}` : ''}</span>
            </li>)}
          </ul>}
        </section>
      </div>
    </div>
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
        maxLength={REVIEW_MAX_LENGTH}
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
