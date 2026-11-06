import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchListingById, toUiListing } from '@/lib/listings';
import { createBookingRequest, fetchBookingById, type DbBookingRow, type UiBooking } from '@/lib/bookings';
import { BookingPickup } from '@/main-site/components/booking-pickup';
import { getOrCreateConversation } from '@/lib/messages';
import type { Listing } from '@/data';
import { Rating, VerifiedBadge } from '@/main-site/components/trust';
import { Button, Alert, Surface, Badge } from '@/main-site/components/ui';
import { SuccessFeedback } from '@/main-site/components/success-feedback';
import { createCheckoutSession, fetchConfirmedPayment, type ConfirmedPayment } from '@/lib/payments';
import { Skeleton } from '@/main-site/components/skeleton';
import { RentalSettlement } from '@/main-site/components/rental-settlement';
import { CheckoutReservation } from '@/main-site/components/checkout-reservation';
import { RentalAgreement } from '@/main-site/components/rental-agreement';
import { ListingPhoto } from '@/main-site/components/listing-card';
import { ArrowLeft, CheckCircle2, Calendar, MapPin, Lock, MessageSquare, ShieldCheck } from 'lucide-react';
import { usePlatformFee } from '@/lib/settings';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { calculateRentalPricing } from '@/lib/rental-pricing';
import { insuranceAmountCents } from '@/lib/insurance-pricing';
import { InsuranceAmount } from '@/main-site/components/insurance-amount';
import { bookingTaxCents } from '@/lib/booking-tax';
import { fetchUnavailableDates } from '@/lib/availability';
import { addDaysIso, todayIso } from '@/lib/geo';
import { listingAvailabilityError } from '@/lib/listing-availability';
import { pickupToday } from '@/lib/pickup-timezone';
import { useUtcDay } from '@/lib/use-utc-day';
import { createDepositAuthorizationSession, createDepositSetupSession, recordDepositHoldConsent } from '@/lib/security-deposit';

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CheckoutPage({ id, startDate, endDate, quantity = 1 }: { id: string; startDate?: string; endDate?: string; quantity?: number }) {
  const utcDay = useUtcDay();
  const { navigate, back } = useRouter();
  const fee = usePlatformFee();
  const feePct = fee.pct ?? 0;
  const durationDiscounts = useFeatureFlag('duration_discounts');
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [availabilityStatus, setAvailabilityStatus] = useState<'checking' | 'available' | 'unavailable' | 'error'>('checking');
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<DbBookingRow | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<'pickup' | 'delivery'>('pickup');
  const [error, setError] = useState<string | null>(null);
  const [depositConsent, setDepositConsent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchListingById(id)
      .then((row) => { if (!cancelled) setListing(row ? toUiListing(row) : null); })
      .catch(() => { if (!cancelled) setListing(null); });
    return () => { cancelled = true; };
  }, [id, utcDay]);

  useEffect(() => {
    let cancelled = false;
    if (!startDate || !endDate || endDate <= startDate) {
      setAvailabilityStatus('unavailable');
      return () => { cancelled = true; };
    }
    setAvailabilityStatus('checking');
    fetchUnavailableDates(id, quantity).then(({ blocked, booked }) => {
      if (cancelled) return;
      const available = !Array.from({ length: Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) }, (_, index) =>
        addDaysIso(startDate, index)).some((date) => blocked.has(date) || booked.has(date));
      setAvailabilityStatus(available ? 'available' : 'unavailable');
    }).catch(() => { if (!cancelled) setAvailabilityStatus('error'); });
    return () => { cancelled = true; };
  }, [id, startDate, endDate, quantity, availabilityRetry]);

  if (listing === undefined || fee.loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28 w-full" rounded="rounded-card-lg" />
        <Skeleton className="h-48 w-full" rounded="rounded-card-lg" />
      </div>
    );
  }

  if (fee.error) return <div className="max-w-xl mx-auto px-4 py-16">
    <Alert tone="error" title="Could not verify the service fee">
      {fee.error}<Button variant="secondary" className="mt-3" onClick={() => window.location.reload()}>Retry pricing</Button>
    </Alert>
  </div>;

  if (!listing || (listing.availabilityExpired && !paymentBookingId)) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-main font-display">This listing is no longer available</h1>
        <Button className="mt-6" onClick={() => navigate({ name: 'search' })}>Browse other items</Button>
      </div>
    );
  }

  if (!startDate || !endDate || listingAvailabilityError(startDate, endDate,
    listing.pickupTimeZone ? pickupToday(listing.pickupTimeZone) : todayIso())) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-main font-display">Choose your dates first</h1>
        <p className="text-sec text-sm mt-2">Pick a pick-up and return date on the listing, then come back here.</p>
        <Button className="mt-6" onClick={() => navigate({ name: 'listing', id })}>Back to the listing</Button>
      </div>
    );
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return <div className="max-w-xl mx-auto px-4 py-10">
    <Alert tone="error" title="Invalid rental quantity">Choose between 1 and 100 units before continuing.</Alert>
    <Button className="mt-4" onClick={back}>Back to the listing</Button>
  </div>;
  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  const rentalPricing = calculateRentalPricing(listing.pricePerDay * quantity, days, {
    weeklyEnabled: durationDiscounts.enabled && listing.weeklyDiscountEnabled,
    weeklyPercent: listing.weeklyDiscountPercent,
    monthlyEnabled: durationDiscounts.enabled && listing.monthlyDiscountEnabled,
    monthlyPercent: listing.monthlyDiscountPercent,
  });
  const grossRental = rentalPricing.gross;
  const durationDiscount = rentalPricing.discountAmount;
  const selectedRentalOption = rentalPricing.packageKind === 'monthly' ? 'Monthly (30 days)'
    : rentalPricing.packageKind === 'weekly' ? 'Weekly (7 days)' : `${days} ${days === 1 ? 'day' : 'days'}`;
  const rental = createdBooking ? Number(createdBooking.subtotal) : Math.max(0, grossRental - durationDiscount);
  const serviceFee = createdBooking ? Number(createdBooking.service_fee_amount) : Math.round(rental * feePct * 100) / 100;
  const deliveryFeeAmount = createdBooking ? Number(createdBooking.delivery_fee_amount ?? 0)
    : deliveryMode === 'delivery' && listing.deliveryAvailable ? Number(listing.deliveryFee ?? 0) : 0;
  const insuranceAmount = createdBooking ? Number(createdBooking.insurance_amount)
    : insuranceAmountCents(listing.declaredValue, days, quantity) / 100;
  const deposit = createdBooking ? Number(createdBooking.deposit) : listing.deposit;
  const isTaxDemo = createdBooking?.sandbox_tax === true;
  const tax = createdBooking ? Number(createdBooking.tax_amount ?? 0) : bookingTaxCents(rental, serviceFee) / 100;
  const paymentEstimate = rental + serviceFee + insuranceAmount + deliveryFeeAmount;
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
      if (availabilityStatus !== 'available') {
        throw new Error(availabilityStatus === 'error'
          ? 'Availability could not be verified. Please retry before booking.'
          : 'These dates are not available for the selected quantity. Choose another range.');
      }
      const booking = createdBooking ?? await createBookingRequest({ listingId: id, startDate: startDate!, endDate: endDate!, quantity, deliveryMode });
      if (!createdBooking) setCreatedBooking(booking);
      if (!booking.payment_first && booking.deposit_collection_model === 'authorization' && Number(booking.deposit) > 0) {
        if (!depositConsent) throw new Error('Consent is required to save your card for a temporary security-deposit authorization.');
        await recordDepositHoldConsent(booking.id);
        const setupUrl = await createDepositSetupSession(booking.id);
        if (setupUrl) { window.location.href = setupUrl; return; }
        if (booking.status === 'pending_payment') {
          const authorization = await createDepositAuthorizationSession(booking.id);
          if (authorization.url) { window.location.href = authorization.url; return; }
          navigate({ name: 'confirmation', id: booking.id });
          return;
        }
      }
      if (booking.status === 'pending_payment') {
        setPaymentBookingId(booking.id);
        return;
      }
      navigate({ name: 'confirmation', id: booking.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create the booking request.';
      if (/not available for the requested dates and quantity/i.test(message)) setAvailabilityStatus('unavailable');
      setError(message);
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

        <h1 className="text-[26px] sm:text-[32px] font-extrabold text-main font-display leading-tight">{listing.instantBooking ? 'Review and book' : 'Review and request'}</h1>
        <p className="mt-2 text-sm text-sec">Rental quantity: {quantity} {quantity === 1 ? 'unit' : 'units'}</p>
        <p className="text-sec text-sm mt-1.5 mb-6">{listing.instantBooking
          ? 'This item books instantly. Your dates are reserved while you complete payment.'
          : `One last look before ${listing.owner.name.split(' ')[0]} gets your request.`}</p>

        {/* Item */}
        <Surface className="p-4 flex gap-4 mb-4">
          <ListingPhoto images={listing.images} className="w-24 h-24 rounded-card object-cover shrink-0 bg-subtle" />
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

        {listing.deliveryAvailable && !createdBooking && <Surface className="p-4 mb-4">
          <h2 className="font-semibold text-main">Handoff</h2>
          <fieldset className="mt-2 grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Choose pickup or delivery</legend>
            <label className={`flex min-h-11 items-center gap-2 rounded-card border p-3 text-sm ${deliveryMode === 'pickup' ? 'border-accent bg-accent-soft' : 'border-app'}`}>
              <input type="radio" name="booking-delivery-mode" checked={deliveryMode === 'pickup'} onChange={() => setDeliveryMode('pickup')} />
              <span>Local pickup · included</span>
            </label>
            <label className={`flex min-h-11 items-center gap-2 rounded-card border p-3 text-sm ${deliveryMode === 'delivery' ? 'border-accent bg-accent-soft' : 'border-app'}`}>
              <input type="radio" name="booking-delivery-mode" checked={deliveryMode === 'delivery'} onChange={() => setDeliveryMode('delivery')} />
              <span>Delivery · ${Number(listing.deliveryFee ?? 0).toFixed(2)}</span>
            </label>
          </fieldset>
        </Surface>}

        {/* Dates */}
        <Surface className="p-4 mb-4">
          <div className="flex items-center gap-4">
            <span className="grid place-items-center w-10 h-10 rounded-card bg-accent-soft text-accent shrink-0">
              <Calendar size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-main">{formatDay(startDate)} → {formatDay(endDate)}</p>
              <p className="text-xs text-sec mt-0.5 tnum">{days} {days === 1 ? 'day' : 'days'}</p>
              <p className="text-xs text-sec mt-1">Selected option: <strong className="text-main">{selectedRentalOption}</strong></p>
            </div>
            <Button size="sm" variant="ghost" disabled={submitting || Boolean(paymentBookingId)} onClick={() => navigate({ name: 'listing', id })}>Change</Button>
          </div>
        </Surface>

        {/* Price */}
        <Surface className="p-5 mb-5">
          <h2 className="font-semibold text-main font-display mb-4">Price breakdown</h2>
          <div className="space-y-3 text-sm">
            {createdBooking
              ? <Row label={`Rental · ${quantity} ${quantity === 1 ? 'unit' : 'units'}`} value={rental} />
              : !rentalPricing.packageKind
              ? <Row label={`$${formatMoney(listing.pricePerDay)} × ${days} ${days === 1 ? 'day' : 'days'} × ${quantity} ${quantity === 1 ? 'unit' : 'units'}`} value={grossRental} />
              : <>
                <Row label={`${rentalPricing.packageKind === 'monthly' ? 'Monthly' : 'Weekly'} package · ${rentalPricing.packageDays} days · ${quantity} units`} value={listing.pricePerDay * quantity * rentalPricing.packageDays} />
                {durationDiscount > 0 && <Row label={`${rentalPricing.packageKind === 'monthly' ? 'Monthly' : 'Weekly'} savings (${rentalPricing.discountPercent}%)`} value={-durationDiscount} />}
                {rentalPricing.extraDays > 0 && <Row label={`${rentalPricing.extraDays} extra days × $${formatMoney(listing.pricePerDay)} × ${quantity} units`} value={listing.pricePerDay * quantity * rentalPricing.extraDays} />}
              </>}
            <Row label="Service fee" value={serviceFee} />
            {deliveryFeeAmount > 0 && <Row label="Delivery fee" value={deliveryFeeAmount} />}
            {createdBooking ? <Row label="Insurance" value={insuranceAmount} />
              : <InsuranceAmount days={days} replacementValue={listing.declaredValue} quantity={quantity} />}
            <Row label={isTaxDemo ? 'Tax (7% test)' : createdBooking?.tax_rate === 0 ? 'Tax' : 'Tax (7%)'} value={tax} />
            <div className="pt-3 border-t border-app flex justify-between font-bold text-base text-main">
              <span>Rental and fees</span>
              <span className="tnum">${formatMoney(rental + serviceFee + insuranceAmount + deliveryFeeAmount)}</span>
            </div>
          </div>
          <div className="flex justify-between text-sm font-semibold text-main mt-3 pt-3 border-t border-app">
            <span>{createdBooking ? 'Backend-confirmed total' : 'Estimated total'}</span><span className="tnum">${formatMoney(total)}</span>
          </div>
          <p className="text-xs text-sec mt-2">{createdBooking ? 'Stored tax and total confirmed by the backend.' : 'Tax is 7% of discounted rental and service fees only. The server confirms the final amount.'}</p>
          <p className="text-xs text-sec mt-2 leading-relaxed">Rental payment only, including applicable fees, insurance and tax. The security hold is a separate check-in transaction.</p>
        </Surface>

          {deposit > 0 && (
            <Surface className="p-5 mb-5">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-1.5 text-sec"><Lock size={14} /> Temporary security-deposit authorization</span>
                <span className="font-semibold text-main tnum">${formatMoney(deposit)}</span>
              </div>
              <p className="text-xs text-muted mt-1.5 leading-relaxed">Not included in rental payment. After paying, propose a pickup or delivery slot for owner approval. Authorize this temporary hold within 24 hours before that slot. Only separately approved deductions may be captured; otherwise the hold is released.</p>
              {createdBooking && !createdBooking.payment_first && <label className="mt-3 flex min-h-11 items-start gap-2 text-xs text-sec">
                <input type="checkbox" checked={depositConsent} onChange={event => setDepositConsent(event.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                <span>I agree to save this card for the temporary security-deposit authorization and any separately approved claim.</span>
              </label>}
            </Surface>
          )}

        {error && <Alert tone="error" title={paymentBookingId ? 'Could not open payment' : 'Booking not created'} className="mb-4">
          {error}
          {paymentBookingId && <p className="mt-2">Your booking was created. Retry payment below, or open it from Bookings. Do not submit a new booking.</p>}
        </Alert>}
        {availabilityStatus !== 'available' && !paymentBookingId && <Alert
          tone={availabilityStatus === 'unavailable' ? 'warning' : 'info'}
          title={availabilityStatus === 'checking' ? 'Checking availability' : availabilityStatus === 'unavailable' ? 'Dates unavailable' : 'Could not verify availability'}
          className="mb-4"
        >
          {availabilityStatus === 'checking'
            ? 'Checking these dates and the selected quantity with the owner’s current availability.'
            : availabilityStatus === 'unavailable'
              ? <>These dates are no longer available for the selected quantity. <Button variant="secondary" className="mt-2" onClick={() => navigate({ name: 'listing', id })}>Choose other dates</Button></>
              : <>Booking is disabled until availability can be verified. <Button variant="secondary" className="mt-2" onClick={() => setAvailabilityRetry((value) => value + 1)}>Retry availability check</Button></>}
        </Alert>}

        <div className="hidden md:block">
          <Button fullWidth size="lg" loading={submitting} disabled={availabilityStatus !== 'available' && !paymentBookingId} loadingLabel={paymentBookingId ? 'Opening secure payment…' : listing.instantBooking ? 'Booking…' : 'Sending request…'} onClick={handleConfirm}>
            {paymentBookingId ? `Confirm $${formatMoney(total)} and pay` : listing.instantBooking ? 'Continue to payment' : 'Send booking request'}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-sec mt-3">
            <ShieldCheck size={14} /> {listing.instantBooking ? 'No charge now - pay securely to confirm.' : 'No charge now - you pay only if the owner approves.'}
          </p>
        </div>
      </div>

      {/* Mobile: the decision stays in reach */}
      <div className="md:hidden fixed bottom-[calc(4rem_+_env(safe-area-inset-bottom))] left-0 right-0 z-30 glass-surface border-t border-app px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-main tnum">${formatMoney(total)}</p>
            <p className="text-xs text-sec">{createdBooking ? 'Final total · no charge yet' : 'Est. total · no charge yet'}</p>
          </div>
          <Button className="flex-1" loading={submitting} disabled={availabilityStatus !== 'available' && !paymentBookingId} loadingLabel={paymentBookingId ? 'Opening secure payment…' : listing.instantBooking ? 'Booking…' : 'Sending…'} onClick={handleConfirm}>
            {paymentBookingId ? `Confirm $${formatMoney(total)} and pay` : listing.instantBooking ? 'Continue to payment' : 'Send request'}
          </Button>
        </div>
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
        {(booking.status==='pending_payment' || booking.status==='cancelled') && <CheckoutReservation
          bookingId={booking.id} canPay={!booking.isOwner}
          requiresDepositAuthorization={!booking.paymentFirst && booking.depositCollectionModel==='authorization' && booking.deposit>0} /> }
        {booking.status === 'pending_payment' && (
          <Alert tone="info" title="Payment is not confirmed yet" className="mb-4">
            {checking ? 'Checking for secure backend confirmation. You can leave this page safely.' : 'If you just paid, confirmation may still be processing.'}
          </Alert>
        )}
        {(booking.status === 'pending_payment' || confirmationError) && (
          <Button variant="secondary" className="mb-4" loading={checking} onClick={() => setRefresh((value) => value + 1)}>Check status again</Button>
        )}
        {verified && booking.status === 'confirmed' && <SuccessFeedback kind="booking" booking={booking} payment={payment}
          primary={{ label: booking.paymentFirst ? 'Check-in: choose a slot' : 'View Booking Details',
            onClick: () => booking.paymentFirst ? navigate({ name: 'check-in', id: booking.id }) : document.getElementById('booking-summary')?.focus() }}
          secondary={{ label: 'View Listing', onClick: () => navigate({ name: 'listing', id: booking.listingId }) }} />}

        {!verified && <Surface className="p-4 flex gap-4 mb-3">
          <button
            onClick={() => navigate({ name: 'listing', id: booking.listingId })}
            className="w-24 h-24 rounded-card overflow-hidden shrink-0 bg-subtle"
            aria-label={`Open ${booking.listingTitle}`}
          >
            <ListingPhoto images={[booking.listingImage]} className="w-full h-full object-cover" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-main font-display leading-snug">{booking.listingTitle}</h2>
            <p className="flex items-center gap-1.5 text-sm text-sec mt-1.5">
              <Calendar size={14} /> {formatDay(booking.startDate)} → {formatDay(booking.endDate)}
            </p>
            <div className="mt-2"><Badge tone="accent">{booking.counterpartName}</Badge></div>
          </div>
        </Surface>}

        <div className="mb-4"><BookingPickup bookingId={booking.id} status={booking.status} paymentFirst={booking.paymentFirst} /></div>
        <RentalAgreement bookingId={booking.id} isOwner={booking.isOwner} />
        <Surface id="booking-summary" tabIndex={-1} className="p-5 mb-6 space-y-3 text-sm">
          <p className="text-xs text-sec">Booking reference: {booking.bookingReference ?? 'Not assigned'}</p>
          <div className="flex justify-between">
            <span className="text-sec">Rental subtotal</span>
            <span className="font-semibold text-main tnum">${booking.subtotal + booking.ownerDiscountAmount}</span>
          </div>
          {booking.ownerDiscountAmount > 0 && <div className="flex justify-between"><span className="text-sec">Package savings</span><span className="font-semibold text-main tnum">-${booking.ownerDiscountAmount}</span></div>}
          <div className="flex justify-between"><span className="text-sec">Service fee</span><span className="font-semibold text-main tnum">${booking.serviceFeeAmount}</span></div>
          {booking.insuranceAmount > 0 && <div className="flex justify-between"><span className="text-sec">Insurance</span><span className="font-semibold text-main tnum">${booking.insuranceAmount.toFixed(2)}</span></div>}
          {(booking.taxRate > 0 || booking.sandboxTax) && <Row label={booking.sandboxTax ? 'Tax (7% test)' : 'Tax (7%)'} value={booking.taxAmount} />}
          <div className="flex justify-between"><span className="text-sec">Rental charge after discount</span><span className="font-semibold text-main tnum">${formatMoney(booking.depositCollectionModel === 'authorization' ? booking.total : booking.total - booking.deposit)}</span></div>
          <div className="flex justify-between pt-3 border-t border-app">
            <span className="text-sec">Status</span>
            <span className="font-semibold text-main">{booking.status.replace('_', ' ')}</span>
          </div>
        </Surface>
        {booking.deposit > 0 && <Surface className="p-4 mb-4">
          <h3 className="font-semibold text-main">Separate security-deposit transaction</h3>
          <p className="mt-2 text-sm text-sec">${booking.deposit.toFixed(2)} {booking.depositCollectionModel === 'authorization'
            ? 'temporary hold, not included in the rental total. Complete it at check-in before pickup or delivery.'
            : 'was collected with the original legacy payment; its refund is tracked separately.'}</p>
        </Surface>}
        {booking.paymentFirst && booking.status === 'confirmed' && <Button className="mb-4" onClick={() => navigate({ name: 'check-in', id: booking.id })}>Check-in: choose a slot</Button>}

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
