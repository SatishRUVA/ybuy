import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchListingById, toUiListing } from '@/lib/listings';
import { createBookingRequest, fetchBookingById, type UiBooking } from '@/lib/bookings';
import { getOrCreateConversation } from '@/lib/messages';
import type { Listing } from '@/data';
import { Rating, VerifiedBadge } from '@/components/trust';
import { Button, Alert, Surface, Badge } from '@/components/ui';
import { SuccessFeedback } from '@/components/success-feedback';
import { fetchConfirmedPayment, type ConfirmedPayment } from '@/lib/payments';
import { Skeleton } from '@/components/skeleton';
import { RentalSettlement } from '@/components/rental-settlement';
import { CheckoutReservation } from '@/components/checkout-reservation';
import { RentalAgreement } from '@/components/rental-agreement';
import { ArrowLeft, CheckCircle2, Calendar, MapPin, Lock, MessageSquare, ShieldCheck } from 'lucide-react';
import { formatFeePct, usePlatformFeePct } from '@/lib/settings';

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CheckoutPage({ id, startDate, endDate }: { id: string; startDate?: string; endDate?: string }) {
  const { navigate, back } = useRouter();
  const feePct = usePlatformFeePct();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchListingById(id)
      .then((row) => { if (!cancelled) setListing(row ? toUiListing(row) : null); })
      .catch(() => { if (!cancelled) setListing(null); });
    return () => { cancelled = true; };
  }, [id]);

  if (listing === undefined) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28 w-full" rounded="rounded-card-lg" />
        <Skeleton className="h-48 w-full" rounded="rounded-card-lg" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-main font-display">This listing is no longer available</h1>
        <Button className="mt-6" onClick={() => navigate({ name: 'search' })}>Browse other items</Button>
      </div>
    );
  }

  if (!startDate || !endDate) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-main font-display">Choose your dates first</h1>
        <p className="text-sec text-sm mt-2">Pick a pick-up and return date on the listing, then come back here.</p>
        <Button className="mt-6" onClick={() => navigate({ name: 'listing', id })}>Back to the listing</Button>
      </div>
    );
  }

  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  const rental = listing.pricePerDay * days;
  const serviceFee = Math.round(rental * feePct * 100) / 100;
  const total = rental + serviceFee + listing.deposit;

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const booking = await createBookingRequest({ listingId: id, startDate: startDate!, endDate: endDate! });
      navigate({ name: 'confirmation', id: booking.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the booking request.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-in pb-24 md:pb-10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <button onClick={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-sec hover:text-main transition-colors duration-fast mb-5">
          <ArrowLeft size={18} /> Back
        </button>

        <h1 className="text-[26px] sm:text-[32px] font-extrabold text-main font-display leading-tight">Review and request</h1>
        <p className="text-sec text-sm mt-1.5 mb-6">One last look before {listing.owner.name.split(' ')[0]} gets your request.</p>

        {/* Item */}
        <Surface className="p-4 flex gap-4 mb-4">
          <img src={listing.images[0]} alt="" className="w-24 h-24 rounded-card object-cover shrink-0 bg-subtle" />
          <div className="flex-1 min-w-0">
            {listing.category && <p className="text-xs font-medium text-accent">{listing.category}</p>}
            <h2 className="font-semibold text-main font-display leading-snug mt-0.5">{listing.title}</h2>
            <div className="flex items-center gap-3 mt-1.5">
              <Rating value={listing.rating} count={listing.reviewCount} size="sm" />
              {listing.verifiedOwner && <VerifiedBadge size="xs" />}
            </div>
            {listing.pickup && (
              <p className="flex items-center gap-1 text-xs text-sec mt-1.5"><MapPin size={12} /> {listing.pickup}</p>
            )}
          </div>
        </Surface>

        {/* Dates */}
        <Surface className="p-4 mb-4">
          <div className="flex items-center gap-4">
            <span className="grid place-items-center w-10 h-10 rounded-card bg-accent-soft text-accent shrink-0">
              <Calendar size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-main">{formatDay(startDate)} → {formatDay(endDate)}</p>
              <p className="text-xs text-sec mt-0.5 tnum">{days} {days === 1 ? 'day' : 'days'}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'listing', id })}>Change</Button>
          </div>
        </Surface>

        {/* Price */}
        <Surface className="p-5 mb-5">
          <h2 className="font-semibold text-main font-display mb-4">Price breakdown</h2>
          <div className="space-y-3 text-sm">
            <Row label={`$${formatMoney(listing.pricePerDay)} × ${days} ${days === 1 ? 'day' : 'days'}`} value={rental} />
            <Row label={`Service fee (${formatFeePct(feePct)})`} value={serviceFee} />
            <div className="pt-3 border-t border-app flex justify-between font-bold text-base text-main">
              <span>Rental charge</span>
              <span className="tnum">${formatMoney(rental + serviceFee)}</span>
            </div>
          </div>
          {listing.deposit > 0 && (
            <div className="mt-4 pt-4 border-t border-app">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-1.5 text-sec"><Lock size={14} /> Refundable deposit (charged)</span>
                <span className="font-semibold text-warning tnum">${formatMoney(listing.deposit)}</span>
              </div>
              <p className="text-xs text-muted mt-1.5 leading-relaxed">
                Charged at checkout. Refunded after the owner confirms return when no unresolved dispute exists.
              </p>
              <div className="flex justify-between text-sm font-semibold text-main mt-3 pt-3 border-t border-app">
                <span>Total charged at payment</span>
                <span className="tnum">${formatMoney(total)}</span>
              </div>
            </div>
          )}
        </Surface>

        {error && <Alert tone="error" title="Request not sent" className="mb-4">{error}</Alert>}

        <div className="hidden md:block">
          <Button fullWidth size="lg" loading={submitting} loadingLabel="Sending request…" onClick={handleConfirm}>
            Send booking request
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-sec mt-3">
            <ShieldCheck size={14} /> No charge now - you pay only if the owner approves.
          </p>
        </div>
      </div>

      {/* Mobile: the decision stays in reach */}
      <div className="md:hidden fixed bottom-[calc(4rem_+_env(safe-area-inset-bottom))] left-0 right-0 z-30 glass-surface border-t border-app px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-main tnum">${formatMoney(rental + serviceFee)}</p>
            <p className="text-xs text-sec">No charge yet</p>
          </div>
          <Button className="flex-1" loading={submitting} loadingLabel="Sending…" onClick={handleConfirm}>
            Send request
          </Button>
        </div>
      </div>

    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sec">
      <span>{label}</span>
      <span className="text-main font-medium tnum">${formatMoney(value)}</span>
    </div>
  );
}

const NEXT_STEP: Record<UiBooking['status'], string> = {
  requested: 'Waiting for the owner to approve your dates.',
  pending_payment: 'Approved - pay from your bookings to lock in these dates.',
  confirmed: 'Paid and confirmed. Arrange pickup in messages.',
  active: 'The rental is under way. Start the return when you are done.',
  return_pending: 'Return started - the owner confirms once they have it back.',
  completed: 'All done. Leave a review from your bookings.',
  cancelled: 'This booking was cancelled.',
  rejected: 'The owner declined this request.',
};

export function ConfirmationPage({ id }: { id: string }) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [booking, setBooking] = useState<UiBooking | null | undefined>(undefined);
  const [payment, setPayment] = useState<ConfirmedPayment | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!user) return;
    const currentUserId = user.id;
    let cancelled = false;
    let timer: number | undefined;
    setBooking(undefined);
    setPayment(null);
    setVerified(false);
    setConfirmationError(null);
    setChecking(true);
    async function check(attempt: number) {
      try {
        const next = await fetchBookingById(id, currentUserId);
        if (cancelled) return;
        setBooking(next);
        if (next?.status === 'confirmed') {
          const confirmedPayment = await fetchConfirmedPayment(id);
          if (cancelled) return;
          setPayment(confirmedPayment);
          setVerified(true);
        }
        if (next?.status === 'pending_payment' && attempt < 9) {
          timer = window.setTimeout(() => void check(attempt + 1), 2000);
        } else {
          setChecking(false);
        }
      } catch (err) {
        if (!cancelled) {
          setConfirmationError(err instanceof Error ? err.message : 'Could not verify your booking. Please try again.');
          setBooking((current) => current === undefined ? null : current);
          setChecking(false);
        }
      }
    }
    void check(0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [id, user, refresh]);

  if (booking === undefined) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-32 w-full" rounded="rounded-card-lg" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-main font-display">Booking not found</h1>
        {confirmationError && <Alert tone="error" className="mt-4">{confirmationError}</Alert>}
        <Button className="mt-4" variant="secondary" onClick={() => setRefresh((value) => value + 1)}>Check status again</Button>
        <Button className="mt-6" onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>Go to Bookings</Button>
      </div>
    );
  }

  const handleMessageOwner = async () => {
    if (!user) return;
    const conversationId = await getOrCreateConversation({
      currentUserId: user.id,
      otherUserId: booking.counterpartId,
      listingId: booking.listingId,
      bookingId: booking.id,
    });
    navigate({ name: 'conversation', id: conversationId });
  };

  return (
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className={verified ? 'mb-6' : 'text-center mb-8'}>
          {!verified && <div className={`w-16 h-16 rounded-full grid place-items-center mx-auto mb-4 ${booking.status === 'confirmed' ? 'bg-success-soft text-success' : 'bg-subtle text-sec'}`}>
            {booking.status === 'confirmed' ? <CheckCircle2 aria-hidden="true" size={34} /> : <Calendar aria-hidden="true" size={30} />}
          </div>}
          <h1 id="booking-details" tabIndex={-1} className="text-[26px] sm:text-[32px] font-extrabold text-main font-display leading-tight">
            {booking.status === 'requested' ? 'Request sent' : 'Your booking'}
          </h1>
          <p className="text-sec mt-2">{NEXT_STEP[booking.status]}</p>
        </div>

        {confirmationError && <Alert tone="error" className="mb-4">{confirmationError}</Alert>}
        {(booking.status==='pending_payment' || booking.status==='cancelled') && <CheckoutReservation bookingId={booking.id} canPay={!booking.isOwner} />}
        {booking.status === 'pending_payment' && (
          <Alert tone="info" title="Payment is not confirmed yet" className="mb-4">
            {checking ? 'Checking for secure backend confirmation. You can leave this page safely.' : 'If you just paid, confirmation may still be processing.'}
          </Alert>
        )}
        {(booking.status === 'pending_payment' || confirmationError) && (
          <Button variant="secondary" className="mb-4" loading={checking} onClick={() => setRefresh((value) => value + 1)}>Check status again</Button>
        )}
        {verified && booking.status === 'confirmed' && <SuccessFeedback kind="booking" booking={booking} payment={payment}
          primary={{ label: 'View Booking Details', onClick: () => document.getElementById('booking-summary')?.focus() }}
          secondary={{ label: 'View Listing', onClick: () => navigate({ name: 'listing', id: booking.listingId }) }} />}

        {!verified && <Surface className="p-4 flex gap-4 mb-3">
          <button
            onClick={() => navigate({ name: 'listing', id: booking.listingId })}
            className="w-24 h-24 rounded-card overflow-hidden shrink-0 bg-subtle"
            aria-label={`Open ${booking.listingTitle}`}
          >
            <img src={booking.listingImage} alt="" className="w-full h-full object-cover" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-main font-display leading-snug">{booking.listingTitle}</h2>
            <p className="flex items-center gap-1.5 text-sm text-sec mt-1.5">
              <Calendar size={14} /> {formatDay(booking.startDate)} → {formatDay(booking.endDate)}
            </p>
            <div className="mt-2"><Badge tone="accent">{booking.counterpartName}</Badge></div>
          </div>
        </Surface>}

        <RentalAgreement bookingId={booking.id} isOwner={booking.isOwner} />
        <Surface id="booking-summary" tabIndex={-1} className="p-5 mb-6 space-y-3 text-sm">
          <p className="text-xs text-sec break-all">Booking reference: {booking.id}</p>
          <div className="flex justify-between">
            <span className="text-sec">Rental charge</span>
            <span className="font-semibold text-main tnum">${booking.subtotal + booking.serviceFeeAmount}</span>
          </div>
          {booking.deposit > 0 && (
            <div className="flex justify-between">
              <span className="text-sec">Security deposit (charged)</span>
              <span className="font-semibold text-warning tnum">${booking.deposit}</span>
            </div>
          )}
          <div className="flex justify-between pt-3 border-t border-app">
            <span className="text-sec">Status</span>
            <span className="font-semibold text-main">{booking.status.replace('_', ' ')}</span>
          </div>
        </Surface>

        {booking.status === 'completed' && <RentalSettlement bookingId={booking.id} isOwner={booking.isOwner} autoProcess />}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button fullWidth onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>View Bookings</Button>
          <Button fullWidth variant="secondary" icon={<MessageSquare size={16} />} onClick={handleMessageOwner}>
            Message {booking.counterpartName.split(' ')[0]}
          </Button>
        </div>
      </div>
    </div>
  );
}
