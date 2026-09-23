import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchListingById, toUiListing } from '@/lib/listings';
import { createBookingRequest, fetchBookingById, type UiBooking } from '@/lib/bookings';
import { getOrCreateConversation } from '@/lib/messages';
import type { Listing } from '@/data';
import { Rating, VerifiedBadge } from '@/components/trust';
import { ArrowLeft, CheckCircle2, Calendar, MapPin, ArrowRight } from 'lucide-react';

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

  if (listing === undefined) return <div className="p-8 text-center text-sec">Loading…</div>;
  if (!listing) return <div className="p-8 text-center text-sec">Listing not found.</div>;
  if (!startDate || !endDate) return <div className="p-8 text-center text-sec">Choose your dates on the listing page first.</div>;

  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  const rental = listing.pricePerDay * days;
  const serviceFee = Math.round(rental * 0.1);
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
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors">
          <ArrowLeft size={18} /> Back
        </button>

        <h1 className="text-2xl sm:text-3xl font-bold text-main font-display mb-6">Review and book</h1>

        {/* Item summary */}
        <div className="flex gap-4 p-4 rounded-card-xl bg-card border border-app mb-6">
          <img src={listing.images[0]} alt="" className="w-24 h-24 rounded-card-lg object-cover shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-main">{listing.title}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Rating value={listing.rating} size="sm" />
              {listing.verifiedOwner && <VerifiedBadge size="xs" />}
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs text-sec">
              <span className="flex items-center gap-1"><Calendar size={13} /> {startDate} → {endDate}</span>
              {listing.pickup && <span className="flex items-center gap-1"><MapPin size={13} /> {listing.pickup}</span>}
            </div>
          </div>
        </div>

        {/* Price breakdown */}
        <div className="p-5 rounded-card-xl bg-card border border-app mb-6">
          <h3 className="font-semibold text-main mb-4">Price breakdown</h3>
          <div className="space-y-3 text-sm">
            <Row label={`${days} day${days > 1 ? 's' : ''} × $${listing.pricePerDay}/day`} value={rental} />
            <Row label="Service fee" value={serviceFee} />
            <div className="pt-3 border-t border-app flex justify-between font-bold text-base text-main">
              <span>Rental charge</span>
              <span>${total}</span>
            </div>
          </div>
          {listing.deposit > 0 && (
            <div className="mt-4 pt-4 border-t border-app">
              <div className="flex justify-between text-sm">
                <span className="text-sec">Refundable security hold</span>
                <span className="font-semibold text-warning">${listing.deposit}</span>
              </div>
              <p className="text-xs text-muted mt-1">Authorized on your card, not charged. Released after return inspection.</p>
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 rounded-card-lg bg-warning-soft border border-app text-sm text-warning mb-4">{error}</div>
        )}

        {/* CTA */}
        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="w-full py-3.5 rounded-card-xl bg-accent text-accent-text font-bold text-base hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {submitting ? 'Sending request…' : 'Send booking request'}
        </button>
        <p className="text-xs text-sec text-center mt-3">
          You won't be charged until the owner approves — this sends a request, not a payment.
        </p>
      </div>

      {/* Success modal — booking-confirmed is the one place motion is allowed to be noticed */}
      {bookingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => navigate({ name: 'confirmation', id: bookingId })} />
          <div className="relative bg-card rounded-card-xl border border-app shadow-hover max-w-md w-full p-8 text-center animate-modal">
            <div className="w-16 h-16 rounded-full bg-success-soft flex items-center justify-center mx-auto mb-4 animate-booking-confirmed">
              <CheckCircle2 size={36} className="text-success" />
            </div>
            <h2 className="text-2xl font-bold text-main font-display mb-2">Request sent!</h2>
            <p className="text-sec text-sm mb-6">
              Your rental request has been sent to the owner. You will be notified when they respond.
            </p>
            <button
              onClick={() => navigate({ name: 'confirmation', id: bookingId })}
              className="w-full py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm flex items-center justify-center gap-2"
            >
              View booking <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sec">
      <span>{label}</span>
      <span className="text-main font-medium">${value}</span>
    </div>
  );
}

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

  if (booking === undefined) return <div className="p-8 text-center text-sec">Loading…</div>;
  if (!booking) return <div className="p-8 text-center text-sec">Booking not found.</div>;

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
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-full bg-success-soft flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={44} className="text-success" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-main font-display">Request sent!</h1>
          <p className="text-sec mt-2">We'll notify you when {booking.counterpartName} responds.</p>
        </div>

        <div className="p-5 rounded-card-xl bg-card border border-app mb-4">
          <div className="flex gap-4">
            <img src={booking.listingImage} alt="" className="w-28 h-28 rounded-card-lg object-cover shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-main text-lg">{booking.listingTitle}</h3>
              <div className="flex items-center gap-3 mt-2 text-sm text-sec">
                <span className="flex items-center gap-1"><Calendar size={14} /> {booking.startDate} → {booking.endDate}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-card-xl bg-card border border-app mb-6 space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-sec">Rental charge</span><span className="font-semibold text-main">${booking.subtotal + booking.serviceFeeAmount}</span></div>
          {booking.deposit > 0 && (
            <div className="flex justify-between"><span className="text-sec">Security hold (authorized)</span><span className="font-semibold text-warning">${booking.deposit}</span></div>
          )}
          <div className="flex justify-between"><span className="text-sec">Status</span><span className="font-semibold text-main capitalize">{booking.status.replace('_', ' ')}</span></div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => navigate({ name: 'renter-dashboard' })}
            className="flex-1 py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm"
          >
            View my bookings
          </button>
          <button
            onClick={handleMessageOwner}
            className="flex-1 py-3 rounded-card-lg border border-app text-main font-semibold text-sm hover:bg-subtle transition-colors"
          >
            Message owner
          </button>
        </div>
      </div>
    </div>
  );
}
