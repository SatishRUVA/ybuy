import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchListingById, toUiListing } from '@/lib/listings';
import { createBookingRequest, fetchBookingById, type DbBookingRow, type UiBooking } from '@/lib/bookings';
import { BookingPickup } from '@/components/booking-pickup';
import { ListingPhoto } from '@/components/listing-card';
import { getOrCreateConversation } from '@/lib/messages';
import type { Listing } from '@/data';
import { Rating, VerifiedBadge } from '@/components/trust';
import { Button, Alert, Surface } from '@/components/ui';
import { createCheckoutSession, fetchConfirmedPayment, type ConfirmedPayment } from '@/lib/payments';
import { Skeleton } from '@/components/skeleton';
import { RentalSettlement } from '@/components/rental-settlement';
import { CheckoutReservation } from '@/components/checkout-reservation';
import { RentalAgreement } from '@/components/rental-agreement';
import { ArrowLeft, ArrowRight, Check, Lock, MapPin, MessageSquare, PackageCheck, ShieldCheck } from 'lucide-react';
import { usePlatformFeePct } from '@/lib/settings';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { fieldClass } from '@/components/form-classes';
import { calculateRentalPricing, validRentalRange } from '@/lib/rental-pricing';
import { listingAvailabilityError } from '@/lib/listing-availability';
import { pickupToday } from '@/lib/pickup-timezone';
import { todayIso } from '@/lib/geo';
import { insuranceAmountCents } from '@/lib/insurance-pricing';
import { InsuranceAmount } from '@/components/insurance-amount';
import { bookingTaxCents } from '@/lib/booking-tax';
import { ConfirmationTemplate } from '@/preview-1/renting';
import { Action as PreviewAction, Button as PreviewButton, ErrorNote, Modal } from '@/preview-1/ui';

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
  const durationDiscounts = useFeatureFlag('duration_discounts');
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<DbBookingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<'pickup' | 'delivery'>('pickup');
  const [renterNote, setRenterNote] = useState('');
  const [step, setStep] = useState(0);
  const [reviewedTerms, setReviewedTerms] = useState(false);

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

  if (!startDate || !endDate || !validRentalRange(startDate, endDate)
    || listingAvailabilityError(startDate, endDate, listing.pickupTimeZone ? pickupToday(listing.pickupTimeZone) : todayIso())) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-main font-display">Choose your dates first</h1>
        <p className="text-sec text-sm mt-2">Pick a pick-up and return date on the listing, then come back here.</p>
        <Button className="mt-6" onClick={() => navigate({ name: 'listing', id })}>Back to the listing</Button>
      </div>
    );
  }

  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  const rentalPricing = calculateRentalPricing(listing.pricePerDay, days, {
    weeklyEnabled: durationDiscounts.enabled && listing.weeklyDiscountEnabled,
    weeklyPercent: listing.weeklyDiscountPercent,
    monthlyEnabled: durationDiscounts.enabled && listing.monthlyDiscountEnabled,
    monthlyPercent: listing.monthlyDiscountPercent,
  });
  const grossRental = rentalPricing.gross;
  const durationDiscount = rentalPricing.discountAmount;
  const selectedRentalOption = rentalPricing.packageKind === 'monthly' ? 'Monthly (30 days)'
    : rentalPricing.packageKind === 'weekly' ? 'Weekly (7 days)' : `${days} ${days === 1 ? 'day' : 'days'}`;
  const rental = Math.max(0, grossRental - durationDiscount);
  const serviceFee = Math.round(rental * feePct * 100) / 100;
  const deliveryFee = deliveryMode === 'delivery' && listing.deliveryAvailable ? Number(listing.deliveryFee ?? 0) : 0;
  const insuranceAmount = insuranceAmountCents(listing.declaredValue, days) / 100;
  const isTaxDemo = createdBooking?.sandbox_tax === true;
  const tax = createdBooking ? Number(createdBooking.tax_amount ?? 0) : bookingTaxCents(rental, serviceFee) / 100;
  const paymentEstimate = rental + serviceFee + insuranceAmount + deliveryFee;
  const total = createdBooking ? Number(createdBooking.total) : paymentEstimate + tax;

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (paymentBookingId) {
        window.location.href = await createCheckoutSession(paymentBookingId);
        return;
      }
      const booking = await createBookingRequest({
        listingId: id,
        startDate: startDate!,
        endDate: endDate!,
        deliveryMode,
        renterNote,
      });
      setCreatedBooking(booking);
      if (booking.status === 'pending_payment') {
        setPaymentBookingId(booking.id);
        window.location.href = await createCheckoutSession(booking.id);
        return;
      }
      navigate({ name: 'confirmation', id: booking.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the booking request.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p1-container p1-page">
      <div>
        <button onClick={back} className="p1-back">
          <ArrowLeft size={18} /> Back
        </button>

        <div className="p1-checkout-layout"><div>
        <ol className="p1-steps" aria-label="Booking steps">{['Your dates', 'Pickup', listing.instantBooking ? 'Review & payment' : 'Review request'].map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}><span className={index <= step ? 'done' : ''}>{index < step ? <Check size={15} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>
        <header className="p1-page-head" aria-live="polite" aria-atomic="true"><div>
          <h1>{step === 0 ? 'Make time for a good plan.' : step === 1 ? 'How will you get your gear?' : listing.instantBooking ? 'One last look. Then it’s yours.' : 'Send your plan to the owner.'}</h1>
          <p>{step === 0 ? 'Review the days you need. Availability is checked again when you book.' : step === 1 ? 'Keep the handoff simple.' : listing.instantBooking ? 'Continue to Stripe to pay securely. Only verified payment confirms your booking.' : 'Owner approval comes first. This sends a request, not a payment.'}</p>
        </div></header>
          {step === 0 && <section className="p1-panel p1-checkout-dates" aria-label="Your rental dates">
            <h2>Your dates</h2>
            <div className="p1-date-summary">
              <div><p className="text-main font-semibold">{formatDay(startDate)} → {formatDay(endDate)}</p>
                <p className="text-sm text-sec mt-2">{days} {days === 1 ? 'day' : 'days'} · {selectedRentalOption}</p></div>
              <Button variant="secondary" disabled={submitting || Boolean(paymentBookingId)} onClick={() => navigate({ name: 'listing', id })}>Change dates</Button>
            </div>
            <p className="text-sm text-sec mt-5">Choose another range on the listing to see the owner’s available window, blocked days and existing bookings.</p>
          </section>}
          {step === 1 && <section aria-label="Handoff details">
            <h2>Pickup & return</h2>
            <div className="p1-choice-grid">
              <button type="button" aria-pressed={deliveryMode === 'pickup'} disabled={submitting || Boolean(paymentBookingId)} onClick={() => setDeliveryMode('pickup')}>
                <MapPin aria-hidden="true" /><strong>Pick it up</strong><span>Free · {listing.pickup || 'Coordinate pickup with the owner after booking.'}</span>{deliveryMode === 'pickup' && <Check size={17} aria-hidden="true" />}
              </button>
              {listing.deliveryAvailable && (
                <button type="button" aria-pressed={deliveryMode === 'delivery'} disabled={submitting || Boolean(paymentBookingId)} onClick={() => setDeliveryMode('delivery')}>
                  <PackageCheck aria-hidden="true" /><strong>Have it delivered</strong><span>
                    ${formatMoney(listing.deliveryFee ?? 0)} · {' '}
                    {listing.delivery || 'Delivery details confirmed in messages after booking.'}
                  </span>{deliveryMode === 'delivery' && <Check size={17} aria-hidden="true" />}
                </button>
              )}
            </div>
            <label className="p1-field mt-5">
              <span className="block text-sm font-semibold text-main mb-2">Note for owner (optional)</span>
              <textarea
                className={fieldClass('w-full min-h-24')}
                maxLength={500}
                disabled={submitting || Boolean(paymentBookingId)}
                value={renterNote}
                onChange={(event) => setRenterNote(event.target.value)}
                placeholder="Share any pickup or delivery detail that helps with handoff."
              />
            </label>
            <p className="mt-3 text-xs text-sec">This note is saved on your booking and shown to both renter and owner.</p>
          </section>}
          {step === 2 && <section className="p1-panel" aria-label="Review your booking">
            <h2>{listing.instantBooking ? 'Review & payment' : 'Review your request'}</h2>
            <p className="text-sm text-main">{formatDay(startDate)} → {formatDay(endDate)} · {days} {days === 1 ? 'day' : 'days'}</p>
            <div className="flex justify-between gap-4 mt-5 py-4 border-y border-app text-main font-semibold"><span>Estimated total</span><span className="tnum">${formatMoney(total)}</span></div>
            <Alert tone="info" className="mt-5" title={listing.instantBooking ? 'Secure payment is next' : 'Owner approval comes first'}>
              {listing.instantBooking ? 'Your dates are reserved while you complete Stripe checkout. The booking is confirmed only after the backend verifies payment.' : `Your request goes to ${listing.owner.name}. Pay only after approval to confirm the rental.`}
            </Alert>
            <details className="mt-5 text-sm text-sec"><summary className="min-h-11 cursor-pointer font-semibold text-main">Rental & cancellation terms</summary>
              <p className="mt-2 whitespace-pre-wrap">{listing.cancellation || 'Review the rental agreement in your booking before the handoff.'}</p>
              <p className="mt-3">Return the item and its included components in the agreed condition. Your charged deposit is refunded after the owner confirms the return and any disputes are resolved.</p>
            </details>
            <label className="flex items-start gap-3 mt-5 text-sm text-main min-h-11">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-accent" checked={reviewedTerms} disabled={submitting || Boolean(paymentBookingId)} onChange={event => setReviewedTerms(event.target.checked)} />
              <span>I have reviewed the dates, estimated cost, and rental terms.</span>
            </label>
          </section>}
          {error && <Alert tone="error" title={paymentBookingId ? 'Could not open payment' : 'Booking not created'} className="mt-5">
            {error}
            {paymentBookingId && <p className="mt-2">Your booking was created. Retry payment below, or open it from Bookings. Do not submit a new booking.</p>}
          </Alert>}
          <div className="p1-actions p1-checkout-actions">
            {step > 0 && <Button variant="secondary" disabled={submitting || Boolean(paymentBookingId)} onClick={() => setStep(value => value - 1)}>Back</Button>}
            <Button size="lg" loading={submitting} disabled={step === 2 && !reviewedTerms && !paymentBookingId} loadingLabel={listing.instantBooking ? 'Opening payment…' : 'Sending request…'}
              onClick={() => step < 2 ? setStep(value => value + 1) : void handleConfirm()}>
              {step < 2 ? 'Continue' : paymentBookingId ? 'Retry secure payment' : listing.instantBooking ? 'Continue to payment' : 'Send booking request'}
              <ArrowRight size={17} aria-hidden="true" />
            </Button>
          </div>
          <p className="flex items-start gap-2 text-xs text-sec mt-4"><ShieldCheck size={15} className="shrink-0" aria-hidden="true" />{listing.instantBooking ? 'Payment is completed securely with Stripe.' : 'No charge now — you pay only if the owner approves.'}</p>
        </div>
        <aside className="p1-order-summary" aria-label="Rental order summary">
          <ListingPhoto src={listing.images[0]} alt={listing.title} />
          <h2>{listing.title}</h2>
          <p className="text-sm text-sec mt-2">From {listing.owner.name}</p>
          <div className="flex flex-wrap gap-3 mt-3"><Rating value={listing.rating} count={listing.reviewCount} size="sm" />{listing.verifiedOwner && <VerifiedBadge size="xs" />}</div>
          <p className="text-sm text-main mt-4">{formatDay(startDate)} → {formatDay(endDate)}</p>
          <h3 className="font-semibold text-main font-display mt-5 mb-4">Price breakdown</h3>
          <div className="space-y-3 text-sm">
            {!rentalPricing.packageKind
              ? <Row label={`$${formatMoney(listing.pricePerDay)} × ${days} ${days === 1 ? 'day' : 'days'}`} value={grossRental} />
              : <>
                <Row label={`${rentalPricing.packageKind === 'monthly' ? 'Monthly' : 'Weekly'} package · ${rentalPricing.packageDays} days`} value={listing.pricePerDay * rentalPricing.packageDays} />
                {durationDiscount > 0 && <Row label={`${rentalPricing.packageKind === 'monthly' ? 'Monthly' : 'Weekly'} savings (${rentalPricing.discountPercent}%)`} value={-durationDiscount} />}
                {rentalPricing.extraDays > 0 && <Row label={`${rentalPricing.extraDays} extra ${rentalPricing.extraDays === 1 ? 'day' : 'days'} × $${formatMoney(listing.pricePerDay)}`} value={listing.pricePerDay * rentalPricing.extraDays} />}
              </>}
            <Row label="Service fee" value={serviceFee} />
            {deliveryFee > 0 && <Row label="Delivery fee" value={deliveryFee} />}
            <InsuranceAmount days={days} replacementValue={listing.declaredValue} />
            <Row label={isTaxDemo ? 'Tax (7% test)' : createdBooking?.tax_rate === 0 ? 'Tax' : 'Tax (7%)'} value={tax} />
            <div className="pt-3 border-t border-app flex justify-between font-bold text-base text-main">
              <span>Rental and fees</span>
              <span className="tnum">${formatMoney(rental + serviceFee + insuranceAmount + deliveryFee)}</span>
            </div>
          </div>
          <div className="flex justify-between text-sm font-semibold text-main mt-3 pt-3 border-t border-app">
            <span>{createdBooking ? 'Backend-confirmed total' : 'Estimated total'}</span><span className="tnum">${formatMoney(total)}</span>
          </div>
          <p className="text-xs text-sec mt-2">{createdBooking ? 'Stored tax and total confirmed by the backend.' : 'Tax is 7% of discounted rental and service fees only. The server confirms the final amount.'}</p>
          <p className="text-xs text-sec mt-2 leading-relaxed">Includes rental, applicable fees, insurance and tax only. The security hold is separate.</p>
          {listing.deposit > 0 && (
            <div className="mt-4 pt-4 border-t border-app">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-1.5 text-sec"><Lock size={14} /> Separate security hold at check-in</span>
                <span className="font-semibold text-main tnum">${formatMoney(listing.deposit)}</span>
              </div>
              <p className="text-xs text-muted mt-1.5 leading-relaxed">
                Not included in rental payment. Propose a slot after paying; the owner approves it. Authorize this temporary hold within 24 hours before pickup or delivery.
              </p>
            </div>
          )}
        </aside></div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  const isCredit = value < 0;
  return (
    <div className={`flex justify-between ${isCredit ? 'text-success' : 'text-sec'}`}>
      <span>{label}</span>
      <span className={`font-medium tnum ${isCredit ? 'text-success' : 'text-main'}`}>{isCredit ? '-' : ''}${formatMoney(Math.abs(value))}</span>
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
  const [detailsOpen, setDetailsOpen] = useState(false);

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
          const confirmedPayment = await fetchConfirmedPayment(id, next.total);
          if (cancelled) return;
          if (!confirmedPayment) {
            throw new Error('Payment could not be verified against this booking. Check status again before continuing.');
          }
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
        <h1 className="text-xl font-bold text-main font-display">{confirmationError ? 'Could not verify your booking' : 'Booking not found'}</h1>
        {confirmationError && <Alert tone="error" className="mt-4">{confirmationError}</Alert>}
        <Button className="mt-4" variant="secondary" onClick={() => setRefresh((value) => value + 1)}>Check status again</Button>
        <Button className="mt-6" onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>Go to Bookings</Button>
      </div>
    );
  }

  const handleMessageOwner = async () => {
    if (!user) return;
    try {
      const conversationId = await getOrCreateConversation({
        currentUserId: user.id,
        otherUserId: booking.counterpartId,
        listingId: booking.listingId,
        bookingId: booking.id,
      });
      navigate({ name: 'conversation', id: conversationId });
    } catch (reason) {
      setConfirmationError(reason instanceof Error ? reason.message : 'Could not open your conversation. Try again.');
    }
  };

  const confirmed = verified && booking.status === 'confirmed';
  const status = confirmed ? 'Payment confirmed' : booking.status === 'requested' ? 'Awaiting approval'
    : booking.status === 'confirmed' ? 'Payment verification pending' : booking.status.replace('_', ' ');
  return <ConfirmationTemplate title={confirmed ? 'Go make something of it.' : booking.status === 'requested' ? 'Good plans are on their way.' : 'Your booking'}
    description={confirmed ? 'Your payment is verified and your rental is confirmed. All that’s left is the adventure.'
      : booking.status === 'confirmed' ? 'Confirmation is not complete until the backend payment receipt is verified.' : NEXT_STEP[booking.status]}
    status={status} pending={!confirmed} item={{ title: booking.listingTitle, image: booking.listingImage }}
    start={booking.startDate} end={booking.endDate} total={booking.depositCollectionModel === 'authorization' ? booking.total : booking.total - booking.deposit}
    feedback={<>{confirmationError && <ErrorNote>{confirmationError}</ErrorNote>}
      {(booking.status === 'pending_payment' || confirmationError) && <PreviewButton variant="secondary" disabled={checking} onClick={() => setRefresh((value) => value + 1)}>Check status again</PreviewButton>}
    </>}
    actions={<>{booking.paymentFirst && confirmed && <PreviewButton onClick={() => navigate({ name: 'check-in', id: booking.id })}>Check-in: choose a slot</PreviewButton>}
      <PreviewAction to={booking.isOwner ? 'owner' : 'renter'}>View my rentals</PreviewAction>
      <PreviewButton variant="secondary" onClick={() => { void handleMessageOwner(); }}><MessageSquare size={17} aria-hidden="true" /> Message {booking.isOwner ? 'renter' : 'owner'}</PreviewButton></>}
    note={<>{confirmed && payment ? `Paid ${payment.currency} ${payment.amount.toFixed(2)}. ` : 'Check booking details for the next step. '}
      <PreviewButton variant="quiet" onClick={() => setDetailsOpen(true)}>Booking details</PreviewButton>
      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Booking details" description="Payment, pickup, agreement and settlement.">
        {(booking.status === 'pending_payment' || booking.status === 'cancelled') && <CheckoutReservation bookingId={booking.id} canPay={!booking.isOwner} />}
        <BookingPickup bookingId={booking.id} status={booking.status} paymentFirst={booking.paymentFirst} />
        <RentalAgreement bookingId={booking.id} isOwner={booking.isOwner} />
        <Surface id="booking-summary" tabIndex={-1} className="p1-panel text-left mb-6 space-y-3 text-sm">
          <p className="text-xs text-sec">Booking reference: {booking.bookingReference ?? 'Not assigned'}</p>
          <div className="flex justify-between">
            <span className="text-sec">Rental subtotal</span>
            <span className="font-semibold text-main tnum">${booking.subtotal + booking.ownerDiscountAmount}</span>
          </div>
          {booking.ownerDiscountAmount > 0 && <div className="flex justify-between"><span className="text-sec">Package savings</span><span className="font-semibold text-main tnum">-${booking.ownerDiscountAmount}</span></div>}
          <div className="flex justify-between"><span className="text-sec">Service fee</span><span className="font-semibold text-main tnum">${booking.serviceFeeAmount}</span></div>
          {booking.deliveryFeeAmount > 0 && <div className="flex justify-between"><span className="text-sec">Delivery fee</span><span className="font-semibold text-main tnum">${booking.deliveryFeeAmount.toFixed(2)}</span></div>}
          {booking.insuranceAmount > 0 && <div className="flex justify-between"><span className="text-sec">Insurance</span><span className="font-semibold text-main tnum">${booking.insuranceAmount.toFixed(2)}</span></div>}
          {(booking.taxRate > 0 || booking.sandboxTax) && <Row label={booking.sandboxTax ? 'Tax (7% test)' : 'Tax (7%)'} value={booking.taxAmount} />}
          <div className="flex justify-between"><span className="text-sec">Rental charge after discount</span><span className="font-semibold text-main tnum">${(booking.depositCollectionModel === 'authorization' ? booking.total : booking.total - booking.deposit).toFixed(2)}</span></div>
          {booking.renterNote && <div className="pt-2 border-t border-app"><p className="text-sec">Note for owner</p><p className="text-main mt-1 whitespace-pre-wrap">{booking.renterNote}</p></div>}
          <div className="flex justify-between pt-3 border-t border-app">
            <span className="text-sec">Status</span>
            <span className="font-semibold text-main">{booking.status.replace('_', ' ')}</span>
          </div>
        </Surface>
        {booking.deposit > 0 && <Surface className="p-4 mb-4 text-left">
          <h3 className="font-semibold text-main">Separate security-deposit transaction</h3>
          <p className="mt-2 text-sm text-sec">${booking.deposit.toFixed(2)} {booking.depositCollectionModel === 'authorization'
            ? 'temporary hold, not included in the rental total. Complete it at check-in before pickup or delivery.'
            : 'was collected with the original legacy payment; its refund is tracked separately.'}</p>
        </Surface>}
        {booking.paymentFirst && booking.status === 'confirmed' && <Button className="mb-4" onClick={() => navigate({ name: 'check-in', id: booking.id })}>Check-in: choose a slot</Button>}

        {booking.status === 'completed' && <RentalSettlement bookingId={booking.id} isOwner={booking.isOwner} autoProcess />}
      </Modal></>} />;
}
