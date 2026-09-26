import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchListingById, toUiListing } from '@/lib/listings';
import { createBookingRequest, fetchBookingById, type UiBooking } from '@/lib/bookings';
import { getOrCreateConversation } from '@/lib/messages';
import type { Listing } from '@/data';
import { Rating, VerifiedBadge } from '@/components/trust';
import { Button, Alert, Surface, Badge, Overlay } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { ArrowLeft, CheckCircle2, Calendar, MapPin, ArrowRight, Lock, MessageSquare, ShieldCheck } from 'lucide-react';

const SERVICE_FEE_PCT = 0.1;

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function CheckoutPage({ id, startDate, endDate }: { id: string; startDate?: string; endDate?: string }) {
  const { navigate, back } = useRouter();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

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
  const serviceFee = Math.round(rental * SERVICE_FEE_PCT);
  const total = rental + serviceFee + listing.deposit;

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const booking = await createBookingRequest({ listingId: id, startDate: startDate!, endDate: endDate! });
      setBookingId(booking.id);
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
            <Row label={`$${listing.pricePerDay} × ${days} ${days === 1 ? 'day' : 'days'}`} value={rental} />
            <Row label={`Service fee (${Math.round(SERVICE_FEE_PCT * 100)}%)`} value={serviceFee} />
            <div className="pt-3 border-t border-app flex justify-between font-bold text-base text-main">
              <span>Rental charge</span>
              <span className="tnum">${rental + serviceFee}</span>
            </div>
          </div>
          {listing.deposit > 0 && (
            <div className="mt-4 pt-4 border-t border-app">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-1.5 text-sec"><Lock size={14} /> Refundable security hold</span>
                <span className="font-semibold text-warning tnum">${listing.deposit}</span>
              </div>
              <p className="text-xs text-muted mt-1.5 leading-relaxed">
                Authorised, not charged. Released after the item comes back and is checked.
              </p>
              <div className="flex justify-between text-sm font-semibold text-main mt-3 pt-3 border-t border-app">
                <span>Maximum on your card</span>
                <span className="tnum">${total}</span>
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
      <div className="md:hidden fixed bottom-16 left-0 right-0 z-30 glass-surface border-t border-app px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-main tnum">${rental + serviceFee}</p>
            <p className="text-xs text-sec">No charge yet</p>
          </div>
          <Button className="flex-1" loading={submitting} loadingLabel="Sending…" onClick={handleConfirm}>
            Send request
          </Button>
        </div>
      </div>

      {/* Booking-confirmed is the one moment motion is allowed to be noticed. */}
      {bookingId && (
        <Overlay className="flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => navigate({ name: 'confirmation', id: bookingId })} />
          <div role="dialog" aria-modal="true" className="relative bg-card rounded-card-xl border border-app shadow-pop max-w-md w-full p-8 text-center animate-modal">
            <div className="w-16 h-16 rounded-full bg-success-soft grid place-items-center mx-auto mb-4 animate-booking-confirmed">
              <CheckCircle2 size={34} className="text-success" />
            </div>
            <h2 className="text-2xl font-bold text-main font-display">Request sent</h2>
            <p className="text-sec text-sm mt-2 mb-6 leading-relaxed">
              {listing.owner.name.split(' ')[0]} has your dates. You'll be able to pay as soon as they approve.
            </p>
            <Button fullWidth trailingIcon={<ArrowRight size={16} />} onClick={() => navigate({ name: 'confirmation', id: bookingId })}>
              View booking
            </Button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sec">
      <span>{label}</span>
      <span className="text-main font-medium tnum">${value}</span>
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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchBookingById(id, user.id)
      .then((b) => { if (!cancelled) setBooking(b); })
      .catch(() => { if (!cancelled) setBooking(null); });
    return () => { cancelled = true; };
  }, [id, user]);

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
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-success-soft grid place-items-center mx-auto mb-4">
            <CheckCircle2 size={34} className="text-success" />
          </div>
          <h1 className="text-[26px] sm:text-[32px] font-extrabold text-main font-display leading-tight">
            {booking.status === 'requested' ? 'Request sent' : 'Your booking'}
          </h1>
          <p className="text-sec mt-2">{NEXT_STEP[booking.status]}</p>
        </div>

        <Surface className="p-4 flex gap-4 mb-3">
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
        </Surface>

        <Surface className="p-5 mb-6 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-sec">Rental charge</span>
            <span className="font-semibold text-main tnum">${booking.subtotal + booking.serviceFeeAmount}</span>
          </div>
          {booking.deposit > 0 && (
            <div className="flex justify-between">
              <span className="text-sec">Security hold (authorised)</span>
              <span className="font-semibold text-warning tnum">${booking.deposit}</span>
            </div>
          )}
          <div className="flex justify-between pt-3 border-t border-app">
            <span className="text-sec">Status</span>
            <span className="font-semibold text-main">{booking.status.replace('_', ' ')}</span>
          </div>
        </Surface>

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
