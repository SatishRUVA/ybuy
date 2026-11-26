import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { useUtcDay } from '@/lib/use-utc-day';
import { claims, type Listing } from '@/data';
import { fetchCancellationRefundDetails, type CancellationRefundDetails } from '@/lib/cancellation-refunds';
import {
  fetchBookingsAsRenter, fetchBookingsAsOwner, respondToBookingRequest,
  startBookingReturn, type UiBooking,
} from '@/lib/bookings';
import { startBookingPickup } from '@/lib/booking-handoff';
import { getOrCreateConversation } from '@/lib/messages';
import { createReview, fetchReviewedBookingIds, REVIEW_MAX_LENGTH } from '@/lib/reviews';
import { deleteOwnerListing, fetchListingsByOwner, fetchListingTimeZone, toUiListing } from '@/lib/listings';
import { pickupToday } from '@/lib/pickup-timezone';
import { fetchBankPayoutStatus, fetchPayoutsByOwner, startConnectOnboarding, type BankPayoutStatus, type DbPayoutRow } from '@/lib/payouts';
import { RentalSettlement } from '@/main-site/components/rental-settlement';
import { BookingPickup } from '@/main-site/components/booking-pickup';
import { BookingDeliveryAddress } from '@/main-site/components/booking-delivery-address';
import { fetchUnavailableDates, setDateAvailability } from '@/lib/availability';
import { AvailabilityCalendar } from '@/main-site/components/availability-calendar';
import { DurationDiscountControl } from '@/main-site/components/duration-discount-control';
import { OwnerPromotionControl } from '@/main-site/components/owner-promotion-control';
import { ListingNegotiationSettings } from '@/main-site/components/listing-negotiation-settings';
import { BookingListSkeleton, BookingRowSkeleton, Skeleton } from '@/main-site/components/skeleton';
import { DepositAuthorizationStatus } from '@/main-site/components/deposit-authorization-status';
import { BookingCancellationAction } from '@/main-site/components/booking-cancellation-action';
import { RewardsPanel } from '@/main-site/components/rewards';
import { Button, Badge, Alert, EmptyState, Surface, SectionHeader, Overlay } from '@/main-site/components/ui';
import { textareaClass } from '@/main-site/components/form-classes';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { Rating } from '@/main-site/components/trust';
import { SuccessNotice } from '@/main-site/components/success-feedback';
import {
  Calendar, ChevronRight, Package, CheckCircle2, AlertCircle,
  Inbox, Star, X, CalendarCog, MessageSquare, CreditCard, Search, Bell, Trash2,
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
  completed: 'Returned',
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

const REFUND_STATUS_LABEL: Record<CancellationRefundDetails['status'], string> = {
  not_applicable: 'No refund applies',
  pending_policy_review: 'Policy review',
  pending_review: 'Pending review',
  approved: 'Approved · awaiting provider',
  processing: 'Processing',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  failed: 'Failed · needs review',
  rejected: 'Not approved',
};

function RefundStatusSummary({ details, loading, onSupport }: {
  details: CancellationRefundDetails | null; loading: boolean; onSupport?: () => void;
}) {
  if (loading) return <p role="status" className="mt-3 text-xs text-sec">Loading saved refund status…</p>;
  if (!details) return <p className="mt-3 text-xs text-sec">Refund details are unavailable right now. The booking remains cancelled; contact support if you need an update.</p>;
  const tone = ['refunded', 'partially_refunded'].includes(details.status) ? 'success'
    : ['failed', 'rejected'].includes(details.status) ? 'error'
      : ['pending_policy_review', 'pending_review', 'approved', 'processing'].includes(details.status) ? 'warning' : 'neutral';
  const amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: details.currency.toUpperCase() });
  const amountLine = details.status === 'pending_review'
    ? details.eligibleAmount > 0 ? `Potential eligible amount: ${amount.format(details.eligibleAmount)}; not confirmed.` : 'Refund eligibility is being reviewed; no amount is confirmed.'
    : ['approved', 'processing'].includes(details.status)
      ? `${amount.format(details.refundAmount)} approved; payment-provider confirmation is pending.`
      : ['partially_refunded', 'refunded'].includes(details.status)
        ? `Payment provider confirmed ${amount.format(details.refundAmount)}.`
        : details.status === 'failed' && details.refundAmount > 0
          ? `${amount.format(details.refundAmount)} could not be confirmed by the payment provider.`
          : details.status === 'pending_policy_review' ? 'Eligibility is under policy review; no amount is confirmed.'
            : details.status === 'rejected' ? 'No refund was approved.' : 'No payment refund applies.';
  return (
    <div className="mt-3 rounded-card bg-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-main">Booking payment refund</h4>
        <Badge tone={tone}>{REFUND_STATUS_LABEL[details.status]}</Badge>
      </div>
      <p className="mt-1.5 text-xs text-sec">{amountLine}</p>
      {details.originalPaymentAmount > 0 && <p className="mt-1 text-xs text-sec">Original payment: {amount.format(details.originalPaymentAmount)}</p>}
      {details.providerRefundId && <p className="mt-1 text-xs text-sec">Payment reference: <span className="font-medium text-main">{details.providerRefundId}</span></p>}
      <p className="mt-1 text-xs text-sec">Cancellation reason: {details.reason}</p>
      {details.decisionReason && <p className="mt-1 text-xs text-sec">Update: {details.decisionReason}</p>}
      {['failed', 'rejected'].includes(details.status) && onSupport && <Button size="sm" variant="ghost" className="mt-1" onClick={onSupport}>Contact support</Button>}
    </div>
  );
}

function useCancellationRefunds(bookings: UiBooking[] | null) {
  const cancelledIds = useMemo(
    () => (bookings ?? []).filter((booking) => booking.status === 'cancelled').map((booking) => booking.id).sort(),
    [bookings],
  );
  const idsKey = cancelledIds.join(',');
  const [details, setDetails] = useState<Map<string, CancellationRefundDetails>>(new Map());
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) {
      setDetails(new Map());
      setLoading(false);
      return () => { current = false; };
    }
    setLoading(true);
    void fetchCancellationRefundDetails(ids).then((result) => {
      if (current) setDetails(result);
    }).catch(() => {
      if (current) setDetails(new Map());
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [idsKey]);
  return { details, loading };
}

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function ownerNetEstimate(booking: UiBooking): number {
  return booking.subtotal + booking.deliveryFeeAmount - booking.ownerServiceFeeAmount;
}

function formatUSD(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
}

type EarningsGrouping = 'day' | 'week' | 'month';

function earningsGroupKey(date: string, grouping: EarningsGrouping): string {
  if (grouping === 'day') return date;
  const [year, month, day] = date.split('-').map(Number);
  if (grouping === 'month') return `${year}-${String(month).padStart(2, '0')}`;
  const monday = new Date(Date.UTC(year, month - 1, day));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function earningsGroupLabel(key: string, grouping: EarningsGrouping): string {
  const formatDay = (date: Date) => new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
  if (grouping === 'month') return new Intl.DateTimeFormat(undefined, {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${key}-01T00:00:00Z`));
  const start = new Date(`${key}T00:00:00Z`);
  if (grouping === 'day') return formatDay(start);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  if (start.getUTCMonth() === end.getUTCMonth()) {
    const month = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(start);
    return `${month} ${start.getUTCDate()}–${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  return `${formatDay(start)} – ${formatDay(end)}`;
}

function StatCard({ label, value }: {
  label: string; value: string | number;
}) {
  return (
    <div className="rental-stat">
      <p className="text-sm text-sec">{label}</p>
      <p className="text-2xl font-semibold text-main mt-1 tnum">{value}</p>
    </div>
  );
}

/** The one row layout every booking uses, on both dashboards. */
function BookingRow({
  booking, onOpen, onMessage, onSupport, refundDetails, refundLoading = false, children,
}: {
  booking: UiBooking;
  onOpen?: () => void;
  onMessage?: () => void;
  onSupport?: () => void;
  refundDetails?: CancellationRefundDetails | null;
  refundLoading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Surface className="rental-booking-row p-4">
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
          <p className="text-xs text-sec mt-1">Booking reference: {booking.bookingReference ?? 'Not assigned'}</p>
        </div>
      </div>
      {booking.deliveryTrip !== 'both' && ['confirmed', 'active', 'return_pending'].includes(booking.status) && <div className="mt-3.5"><BookingPickup bookingId={booking.id} status={booking.status} paymentFirst={booking.paymentFirst} /></div>}
      {booking.deliveryTrip && ['confirmed', 'active', 'return_pending'].includes(booking.status) && <div className="mt-3.5"><BookingDeliveryAddress bookingId={booking.id} /></div>}
      {booking.deposit > 0 && <div className="mt-3.5"><DepositAuthorizationStatus bookingId={booking.id} deposit={booking.deposit}
        collectionModel={booking.depositCollectionModel} isOwner={booking.isOwner} paymentFirst={booking.paymentFirst} /></div>}
      {booking.status === 'cancelled' && <RefundStatusSummary details={refundDetails ?? null} loading={refundLoading} onSupport={onSupport} />}
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

export function BookingsPage({ initialTab = 'renting', ownerView }: {
  initialTab?: 'renting' | 'lending';
  ownerView?: 'listings' | 'earnings';
}) {
  const { route, navigate } = useRouter();
  const tab = route.name === 'owner-dashboard' ? 'lending'
    : route.name === 'renter-dashboard' ? 'renting'
      : route.name === 'dashboard' ? route.tab ?? initialTab : initialTab;

  const active = ownerView ?? tab;
  const title = ownerView === 'listings' ? 'My listings' : ownerView === 'earnings' ? 'Earnings & payouts'
    : tab === 'renting' ? 'My rentals' : 'Lending activity';
  const subtitle = ownerView === 'listings' ? 'Your inventory, pricing, and available dates.'
    : ownerView === 'earnings' ? 'Rental income, Stripe transfers, and bank payout status.'
      : tab === 'renting' ? 'Keep track of your requests, pickups, and returns.' : 'Review requests and keep every handoff on track.';
  return (
    <div className="rental-workspace">
      <div className="rental-page-header">
        <SectionHeader as="h1" title={title} subtitle={subtitle}
          action={ownerView !== 'earnings' ? <Button onClick={() => navigate({ name: tab === 'renting' && !ownerView ? 'search' : 'create-listing' })}>
            {tab === 'renting' && !ownerView ? 'Browse rentals' : 'List an item'}
          </Button> : undefined} />
      </div>
      <nav className="rental-workspace-tabs" aria-label="Rental workspace">
        <button type="button" aria-current={active === 'renting' ? 'page' : undefined} onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>My rentals</button>
        <button type="button" aria-current={active === 'lending' ? 'page' : undefined} onClick={() => navigate({ name: 'dashboard', tab: 'lending' })}>Lending</button>
        <button type="button" aria-current={active === 'listings' ? 'page' : undefined} onClick={() => navigate({ name: 'owner-listings' })}>Listings</button>
        <button type="button" aria-current={active === 'earnings' ? 'page' : undefined} onClick={() => navigate({ name: 'owner-payouts' })}>Earnings</button>
      </nav>
      {ownerView ? <OwnerDashboard key={ownerView} view={ownerView} />
        : tab === 'renting' ? <RenterDashboard /> : <OwnerDashboard />}
    </div>
  );
}

export function RenterDashboard({ onAttentionCount }: { onAttentionCount?: (count: number) => void } = {}) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [successNotice, setSuccessNotice] = useState<{ message: string; eventKey: string } | null>(null);
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [tab, setTab] = useState<'requests' | 'upcoming' | 'active' | 'past' | 'claims'>('requests');
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
  const cancellationRefunds = useCancellationRefunds(bookings);
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
    ...all.filter((b) => b.status === 'active' || b.status === 'return_pending').map((b) => ({ booking: b, kind: 'return' as const })),
    ...all.filter((b) => b.status === 'completed' && !reviewedBookingIds.has(b.id)).map((b) => ({ booking: b, kind: 'review' as const })),
  ], [all, reviewedBookingIds]);

  useEffect(() => { onAttentionCount?.(needsAttention.length); }, [onAttentionCount, needsAttention.length]);

  async function run(bookingId: string, fn: () => Promise<void>, fallback: string) {
    setActionError(null);
    setBusyId(bookingId);
    try { await fn(); } catch (err) { setActionError(err instanceof Error ? err.message : fallback); }
    finally { setBusyId(null); }
  }

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
    <div className="rental-dashboard">
      <div>
        {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}
        {successNotice && <SuccessNotice key={successNotice.eventKey} eventKey={successNotice.eventKey} onDismiss={() => setSuccessNotice(null)}>{successNotice.message}</SuccessNotice>}
        {loadError && <Alert tone="warning" className="mb-4">{loadError}</Alert>}

        <div className="rental-stats">
          <StatCard label="Upcoming" value={bookings === null ? '-' : upcoming.length} />
          <StatCard label="Active now" value={bookings === null ? '-' : active.length} />
          <StatCard label="Needs attention" value={bookings === null ? '-' : needsAttention.length} />
        </div>
        <div className={`rental-activity-grid ${needsAttention.length > 0 || bookings === null ? '' : 'rental-activity-single'}`}>
        <div className="rental-attention">
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
                      <Button size="sm" loading={busyId === booking.id} onClick={() => void handleStartCheckIn(booking.id)}>
                        {booking.paymentFirst ? 'Check-in: choose a slot' : "I'm Here – Start Pickup"}
                      </Button>
                    ) : kind === 'return' ? (
                      <Button size="sm" variant="secondary" loading={busyId === booking.id} onClick={() => void handleStartReturn(booking.id)}>
                        {booking.status === 'return_pending' ? 'Continue return' : 'Start return'}
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

        <div className="mb-2"><RewardsPanel compact /></div>
        </div>
        <section className="rental-panel rental-history">
        <h2 className="text-base font-semibold text-main mb-4">Rental activity</h2>
        <div className="rental-filters">
          {(['requests', 'upcoming', 'active', 'past', ...(SHOW_OUT_OF_SCOPE_PAGES ? ['claims' as const] : [])] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className="capitalize"
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
            className="rental-empty"
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
                refundDetails={cancellationRefunds.details.get(booking.id) ?? null}
                refundLoading={cancellationRefunds.loading}
                onOpen={() => navigate({ name: 'listing', id: booking.listingId })}
                onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}
                onSupport={() => navigate({ name: 'support' })}
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
                  <BookingCancellationAction booking={booking} onCancelled={(message) => {
                    setSuccessNotice({ message, eventKey: `booking-cancel:${booking.id}` });
                    reload();
                  }} />
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
        </section>
        </div>
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
    <div className="rental-attention-row">
      {image && <img src={image} alt="" className="w-11 h-11 rounded-card object-cover shrink-0 bg-subtle" />}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-main truncate">{title}</p>
        <p className="text-xs text-sec mt-1">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export function OwnerDashboard({ onRequestCount, view = 'activity' }: {
  onRequestCount?: (count: number) => void;
  view?: 'activity' | 'listings' | 'earnings';
} = {}) {
  const utcDay = useUtcDay();
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [successNotice, setSuccessNotice] = useState<{ message: string; eventKey: string } | null>(null);
  const [availabilityNotice, setAvailabilityNotice] = useState(false);
  const [bookings, setBookings] = useState<UiBooking[] | null>(null);
  const [myListings, setMyListings] = useState<Listing[] | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [inventoryStatus, setInventoryStatus] = useState<'all' | 'published' | 'draft'>('all');
  const [payouts, setPayouts] = useState<Map<string, DbPayoutRow>>(new Map());
  const [payoutsLoading, setPayoutsLoading] = useState(view === 'earnings');
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
  const [negotiationListing, setNegotiationListing] = useState<Listing | null>(null);
  const [removingListings, setRemovingListings] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [activityTab, setActivityTab] = useState<'upcoming' | 'active' | 'past'>('upcoming');
  const [earningsGrouping, setEarningsGrouping] = useState<EarningsGrouping>('month');

  function reload() {
    if (!user) return;
    setLoadError(null);
    if (view !== 'listings') {
      fetchBookingsAsOwner(user.id).then((rows) => {
        setBookings(rows);
        if (view === 'activity') {
          const completedIds = rows.filter((b) => b.status === 'completed').map((b) => b.id);
          fetchReviewedBookingIds(user.id, completedIds).then(setReviewedBookingIds).catch(() => {});
        }
      }).catch((err: unknown) => { setBookings([]); setLoadError(err instanceof Error ? err.message : 'Could not load your bookings.'); });
    }
    if (view === 'listings') {
      fetchListingsByOwner(user.id).then((rows) => {
        const listings = rows.map(toUiListing);
        setMyListings(listings);
        setAvailabilityListingId((current) => current || listings[0]?.id || '');
      }).catch((err: unknown) => {
        setMyListings([]);
        setLoadError(err instanceof Error ? err.message : 'Could not load your listings.');
      });
    }
    if (view === 'earnings') {
      setPayoutsLoading(true);
      fetchPayoutsByOwner(user.id).then(setPayouts).catch((err: unknown) => {
        setActionError(err instanceof Error ? err.message : 'Could not verify your Stripe transfers.');
      }).finally(() => setPayoutsLoading(false));
      fetchBankPayoutStatus().then((result) => {
        setBankPayoutConnected(result.connected);
        setBankPayouts(result.payouts);
        setBankPayoutError(null);
      }).catch((err: unknown) => {
        setBankPayoutError(err instanceof Error ? err.message : 'Could not load your Stripe bank payout status.');
      });
    }
  }

  useEffect(reload, [user, utcDay, view]);

  const all = useMemo(() => bookings ?? [], [bookings]);
  const cancellationRefunds = useCancellationRefunds(bookings);
  const pending = all.filter((b) => b.status === 'requested');
  const upcomingRentals = all.filter((b) => b.status === 'pending_payment' || b.status === 'confirmed');
  const activeRentals = all.filter((b) => b.status === 'active' || b.status === 'return_pending');
  const pastRentals = all.filter((b) => PAST_STATUSES.includes(b.status));
  const visibleListings = useMemo(() => {
    const query = inventoryQuery.trim().toLocaleLowerCase();
    return (myListings ?? []).filter((listing) =>
      (!query || listing.title.toLocaleLowerCase().includes(query))
      && (inventoryStatus === 'all' || listing.listingStatus === inventoryStatus),
    );
  }, [myListings, inventoryQuery, inventoryStatus]);
  const publishedListingCount = myListings?.filter((listing) => listing.listingStatus === 'published').length ?? 0;
  const draftListingCount = myListings?.filter((listing) => listing.listingStatus === 'draft').length ?? 0;

  useEffect(() => { onRequestCount?.(pending.length); }, [onRequestCount, pending.length]);

  // These estimates use the booking's saved amounts; fee rules remain authoritative in the backend.
  const bookedOwnerEarnings = useMemo(
    () => all.filter((b) => PAID_OUT_ELIGIBLE_STATUSES.includes(b.status)).reduce((sum, booking) => sum + ownerNetEstimate(booking), 0),
    [all],
  );
  const pendingTransferAmount = useMemo(
    () => [...payouts.values()].filter((payout) => payout.status === 'pending' || payout.status === 'processing').reduce((sum, payout) => sum + payout.amount, 0),
    [payouts],
  );
  const reversedTransferAmount = useMemo(
    () => [...payouts.values()].filter((payout) => payout.status === 'reversed').reduce((sum, payout) => sum + payout.amount, 0),
    [payouts],
  );
  const paidOut = useMemo(
    () => [...payouts.values()].filter((p) => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount), 0),
    [payouts],
  );
  const completedEarningsGroups = useMemo(() => {
    const groups = new Map<string, { rentalCount: number; netAmount: number }>();
    for (const booking of all.filter((item) => item.status === 'completed')) {
      const key = earningsGroupKey(booking.endDate, earningsGrouping);
      const group = groups.get(key) ?? { rentalCount: 0, netAmount: 0 };
      group.rentalCount += 1;
      group.netAmount += ownerNetEstimate(booking);
      groups.set(key, group);
    }
    const limit = earningsGrouping === 'day' ? 30 : 12;
    return [...groups.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, limit)
      .map(([key, value]) => ({ key, label: earningsGroupLabel(key, earningsGrouping), ...value }));
  }, [all, earningsGrouping]);

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
    <div className="rental-dashboard">
      <div>
        {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}
        {listingNotice && <Alert tone="success" className="mb-4">{listingNotice}</Alert>}
        {successNotice && <SuccessNotice key={successNotice.eventKey} eventKey={successNotice.eventKey} onDismiss={() => setSuccessNotice(null)}>{successNotice.message}</SuccessNotice>}
        {loadError && <Alert tone="warning" className="mb-4">{loadError}</Alert>}

        {view === 'activity' && <>
        <div className="rental-stats">
          <StatCard label="To review" value={bookings === null ? '-' : pending.length} />
          <StatCard label="Upcoming" value={bookings === null ? '-' : upcomingRentals.length} />
          <StatCard label="Out on rental" value={bookings === null ? '-' : activeRentals.length} />
        </div>
        <div className="mb-6"><RewardsPanel compact /></div>
        <div className="rental-activity-grid">
        <section className="rental-panel">
          <h2 className="flex items-center gap-2 text-sm font-bold text-main mb-2.5">
            <Inbox size={15} className="text-accent" />
            Incoming requests
            {pending.length > 0 && <span className="tnum text-sec font-semibold">({pending.length})</span>}
          </h2>
          {bookings === null ? (
            <BookingRowSkeleton />
          ) : pending.length === 0 ? (
            <div className="rental-quiet-state">
              <h3 className="text-base font-semibold text-main">You're all caught up</h3>
              <p className="text-sm text-sec mt-2">New requests will appear here.</p>
              <Button className="mt-4" variant="secondary" onClick={() => navigate({ name: 'owner-listings' })}>Manage listings</Button>
            </div>
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
                      </p>
                      <p className="mt-1 text-xs text-sec">
                        Expected owner net: ${booking.subtotal.toFixed(2)} rental
                        {booking.deliveryFeeAmount > 0 && ` + $${booking.deliveryFeeAmount.toFixed(2)} delivery`}
                        {booking.ownerServiceFeeAmount > 0 && ` − $${booking.ownerServiceFeeAmount.toFixed(2)} owner service fee`}
                        {' = '}<strong className="text-main tnum">{formatUSD(ownerNetEstimate(booking))}</strong>
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
                    <BookingCancellationAction booking={booking} onCancelled={(message) => {
                      setSuccessNotice({ message, eventKey: `booking-cancel:${booking.id}` });
                      reload();
                    }} />
                    <Button size="sm" variant="ghost" icon={<MessageSquare size={15} />} onClick={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                      Message
                    </Button>
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </section>

        <section className="rental-panel rental-history">
        <h2 className="text-base font-semibold text-main mb-4">Rental activity</h2>
        <div className="rental-filters">
          {(['upcoming', 'active', 'past'] as const).map(filter => (
            <button key={filter} type="button" aria-pressed={activityTab === filter} onClick={() => setActivityTab(filter)}>
              {filter === 'upcoming' ? 'Upcoming' : filter === 'active' ? 'Active' : 'Past'}
              <span className="ml-2 tnum">{bookings === null ? '-' : { upcoming: upcomingRentals, active: activeRentals, past: pastRentals }[filter].length}</span>
            </button>
          ))}
        </div>
        {activityTab === 'upcoming' && <section>
          <h3 className="sr-only">Upcoming rentals</h3>
          {bookings === null ? <BookingListSkeleton count={2} /> : upcomingRentals.length === 0 ? <div className="rental-quiet-state"><h4 className="text-base font-semibold text-main">No upcoming rentals</h4><p className="text-sm text-sec mt-2">Approved bookings will appear here with their pickup details.</p><Button className="mt-4" variant="ghost" onClick={() => navigate({ name: 'requests', tab: 'browse' })}>Explore nearby requests <ChevronRight size={16} /></Button></div> : (
            <div className="space-y-2.5">
              {upcomingRentals.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onOpen={() => navigate({ name: 'listing', id: booking.listingId })} onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}>
                  <BookingCancellationAction booking={booking} onCancelled={(message) => {
                    setSuccessNotice({ message, eventKey: `booking-cancel:${booking.id}` });
                    reload();
                  }} />
                  {booking.status === 'confirmed' && <Button size="sm" onClick={() => navigate({ name: 'check-in', id: booking.id })}>Open pickup handoff</Button>}
                  <PayoutControl booking={booking} />
                </BookingRow>
              ))}
            </div>
          )}
        </section>}

        {activityTab === 'active' && <section>
          <h3 className="sr-only">Active rentals</h3>
          {bookings === null ? <BookingListSkeleton count={2} /> : activeRentals.length === 0 ? <div className="rental-quiet-state"><p className="text-sm text-sec">No active rentals right now.</p></div> : (
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

        {activityTab === 'past' && <section>
          <h3 className="sr-only">Past rentals</h3>
          {bookings === null ? <BookingListSkeleton count={2} /> : pastRentals.length === 0 ? <div className="rental-quiet-state"><p className="text-sm text-sec">Your past rentals will appear here.</p></div> : (
            <div className="space-y-2.5">
              {pastRentals.map((booking) => (
                <BookingRow key={booking.id} booking={booking}
                  refundDetails={cancellationRefunds.details.get(booking.id) ?? null}
                  refundLoading={cancellationRefunds.loading}
                  onOpen={() => navigate({ name: 'listing', id: booking.listingId })}
                  onMessage={() => void handleMessage(booking.counterpartId, booking.listingId, booking.id)}
                  onSupport={() => navigate({ name: 'support' })}>
                  <PayoutControl booking={booking} />
                  {booking.status === 'completed' && !reviewedBookingIds.has(booking.id) && (
                    <Button size="sm" variant="secondary" icon={<Star size={15} />} onClick={() => setReviewTarget(booking)}>Review {booking.counterpartName.split(' ')[0]}</Button>
                  )}
                </BookingRow>
              ))}
            </div>
          )}
        </section>}
        </section>
        </div>
        </>}
        {view === 'listings' && <section className="mb-8">
          <SectionHeader
            as="h3"
            title="Inventory"
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
                  <Button size="sm" variant="ghost" onClick={() => setSelectedListingIds(new Set(visibleListings.map((item) => item.id)))}>
                    Select visible
                  </Button>
                  <Button size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={selectedListingIds.size === 0} onClick={() => setRemovalTarget(myListings.filter((item) => selectedListingIds.has(item.id)))}>
                    Remove selected ({selectedListingIds.size})
                  </Button>
                </>
              )}
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
              description="List an item and choose when it's available."
              actionLabel="List an item"
              onAction={() => navigate({ name: 'create-listing' })}
            />
          ) : (
            <>
            <div className="rental-inventory-controls">
              <label className="rental-inventory-search">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">Search listings</span>
                <input value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} placeholder="Find a listing" type="search" />
              </label>
              <div className="rental-inventory-filters" role="group" aria-label="Filter listings by status">
                {([
                  ['all', 'All', myListings.length],
                  ['published', 'Published', publishedListingCount],
                  ['draft', 'Drafts', draftListingCount],
                ] as const).map(([value, label, count]) => (
                  <button key={value} type="button" aria-pressed={inventoryStatus === value}
                    onClick={() => setInventoryStatus(value)}>
                    {label}<span>{count}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-sec mb-3">Showing {visibleListings.length} of {myListings.length} listings</p>
            {visibleListings.length === 0 ? (
              <div className="rental-inventory-empty">
                <p>No listings match these filters.</p>
                <Button size="sm" variant="secondary" onClick={() => { setInventoryQuery(''); setInventoryStatus('all'); }}>Clear filters</Button>
              </div>
            ) : (
            <div className="rental-inventory">
              {visibleListings.map((listing) => (
                <Surface key={listing.id} className="rental-inventory-row p-4 flex gap-4">
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
                      <Badge tone={listing.available ? 'success' : listing.listingStatus === 'pending_approval' ? 'warning' : 'neutral'}>
                        {listing.listingStatus === 'published' && listing.availabilityExpired ? 'Expired' : listing.available ? 'Published' : listing.listingStatus === 'pending_approval' ? 'Pending approval' : listing.listingStatus === 'suspended' ? 'Suspended' : listing.listingStatus === 'archived' ? 'Archived' : 'Draft'}
                      </Badge>
                    </div>
                    {!selectingListings && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                      <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'edit-listing',id: listing.id })}>Edit listing</Button>
                      {listing.available && <Button size="sm" variant="secondary" onClick={() => setNegotiationListing(listing)}>Bidding settings</Button>}
                      <details className="rental-listing-tools">
                      <summary>More options</summary>
                      <div className="rental-listing-tools-body">
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="text-error hover:bg-error-soft" onClick={() => setRemovalTarget([listing])}>
                        Remove listing
                      </Button>
                      {listing.listingStatus === 'published' && listing.availabilityExpired && <p className="text-xs text-sec">Hidden from search. Edit availability to make this listing available again.</p>}
                      {listing.available && <>
                        <DurationDiscountControl listingId={listing.id} onSaved={reload} />
                        <OwnerPromotionControl listingId={listing.id} onSaved={reload} />
                      </>}
                      </div>
                      </details>
                      </div>
                    )}
                  </div>
                </Surface>
              ))}
            </div>
            )}
            </>
          )}
        </section>}

        {view === 'listings' && (myListings?.length ?? 0) > 0 && <section className="mb-8">
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

        {view === 'earnings' && <section className="mb-8">
          <SectionHeader as="h3" title="Earnings" className="mb-3" />
          {bookings === null ? <div role="status" aria-busy="true" className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <span className="sr-only">Loading rental earnings</span>
            <Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" />
          </div> : loadError ? <Alert tone="warning">Earnings totals are unavailable until rental history can be loaded.</Alert> : <>
            <div className="rental-stats owner-earnings-stats">
            <StatCard label="Estimated owner net" value={formatUSD(bookedOwnerEarnings)} />
            <StatCard label="Awaiting Stripe transfer" value={payoutsLoading ? '—' : formatUSD(pendingTransferAmount)} />
            <StatCard label="Transferred to Stripe" value={payoutsLoading ? '—' : formatUSD(paidOut)} />
            <StatCard label="Upcoming & active" value={upcomingRentals.length + activeRentals.length} />
            </div>
            <p className="mb-3 text-xs text-sec">Estimated earnings include rental and delivery fees, less the owner service fee. A Stripe transfer is not a bank payout.</p>
          </>}
          {reversedTransferAmount > 0 && <Alert tone="error" className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p><strong>Reversed Stripe transfers: {formatUSD(reversedTransferAmount)}.</strong> This amount is excluded from pending and completed transfer totals and needs manual reconciliation.</p>
              <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'support' })}>Contact support</Button>
            </div>
          </Alert>}
          {paidOut > 0 && (
            <Alert tone="success" className="mt-3">
              <span className="tnum">{formatUSD(paidOut)}</span> transferred to Stripe Connect. This does not confirm a bank payout.
            </Alert>
          )}
          <section className="mt-6" aria-labelledby="owner-completed-earnings-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 id="owner-completed-earnings-title" className="text-sm font-semibold text-main">Completed rental earnings</h4>
                <p className="mt-1 text-xs text-sec">Net amounts grouped by rental return date.</p>
              </div>
              <div className="rental-filters flex" role="group" aria-label="Group earnings by">
                {(['day', 'week', 'month'] as const).map((grouping) => (
                  <button key={grouping} type="button" aria-pressed={earningsGrouping === grouping}
                    onClick={() => setEarningsGrouping(grouping)}>{grouping[0].toUpperCase() + grouping.slice(1)}</button>
                ))}
              </div>
            </div>
            {bookings === null ? <p role="status" className="py-6 text-center text-sm text-sec">Loading completed rentals…</p>
              : loadError ? null
                : completedEarningsGroups.length === 0 ? <p className="rounded-card-lg border border-dashed border-strong px-4 py-6 text-center text-sm text-sec">Completed rental earnings will appear here after an item is returned.</p>
                  : <div className="overflow-x-auto rounded-card-lg border border-app bg-card">
                    <table className="w-full min-w-[440px] text-left text-sm">
                      <caption className="sr-only">Completed owner rental earnings, grouped by return date</caption>
                      <thead className="bg-subtle text-xs text-sec">
                        <tr><th scope="col" className="px-4 py-3 font-semibold">Return period</th><th scope="col" className="px-4 py-3 text-right font-semibold">Rentals</th><th scope="col" className="px-4 py-3 text-right font-semibold">Owner net</th></tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {completedEarningsGroups.map((group) => <tr key={group.key}>
                          <th scope="row" className="px-4 py-3 font-medium text-main">{group.label}</th>
                          <td className="px-4 py-3 text-right text-sec tnum">{group.rentalCount}</td>
                          <td className="px-4 py-3 text-right font-semibold text-main tnum">{formatUSD(group.netAmount)}</td>
                        </tr>)}
                      </tbody>
                    </table>
                  </div>}
          </section>
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
            {!bankPayoutConnected && !bankPayoutError && <p className="text-sm text-sec mt-3">Complete Stripe Connect setup to see payouts.</p>}
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
      </div>

      {reviewTarget && (
        <ReviewModal title={reviewTarget.counterpartName} onSubmit={handleSubmitReview} onClose={() => setReviewTarget(null)} />
      )}

      {negotiationListing && <Sheet title={`Bidding: ${negotiationListing.title}`} onClose={() => setNegotiationListing(null)}>
        <ListingNegotiationSettings listingId={negotiationListing.id} onSaved={reload} />
      </Sheet>}
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
  return <RentalSettlement bookingId={booking.id} isOwner autoProcess
    expectedOwnerNet={ownerNetEstimate(booking)}
    ownerServiceFeeAmount={booking.ownerServiceFeeAmount} />;
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
