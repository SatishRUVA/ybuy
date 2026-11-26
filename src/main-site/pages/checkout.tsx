import { useEffect, useState } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchListingById, toUiListing } from '@/lib/listings';
import { createBookingRequest, fetchBookingById, type DbBookingRow, type UiBooking } from '@/lib/bookings';
import { BookingPickup } from '@/main-site/components/booking-pickup';
import { BookingDeliveryAddress } from '@/main-site/components/booking-delivery-address';
import { getOrCreateConversation } from '@/lib/messages';
import type { Listing } from '@/data';
import { Button, Alert, Surface, Badge } from '@/main-site/components/ui';
import { SuccessFeedback } from '@/main-site/components/success-feedback';
import { createCheckoutSession, fetchConfirmedPayment, type ConfirmedPayment } from '@/lib/payments';
import { Skeleton } from '@/main-site/components/skeleton';
import { RentalSettlement } from '@/main-site/components/rental-settlement';
import { CheckoutReservation } from '@/main-site/components/checkout-reservation';
import { RentalAgreement } from '@/main-site/components/rental-agreement';
import { ListingPhoto } from '@/main-site/components/listing-card';
import { CheckCircle2, Calendar, Lock, MessageSquare, ShieldCheck, Wrench } from 'lucide-react';
import { fetchCheckoutPriceQuote, type CheckoutPriceQuote } from '@/lib/listing-pricing';
import { InsuranceAmount } from '@/main-site/components/insurance-amount';
import { CheckoutRentalPrice, Row } from '@/main-site/components/checkout-rental-price';
import { Switch } from '@/main-site/components/shadcn/switch';
import { DELIVERY_WINDOW_LABELS, fetchDeliveryWindows, type DeliveryAddress, type DeliveryTrip, type DeliveryWindow, type DeliveryWindowAvailability } from '@/lib/delivery-checkout';
import { fetchUnavailableDates } from '@/lib/availability';
import { addDaysIso, todayIso } from '@/lib/geo';
import { listingAvailabilityError } from '@/lib/listing-availability';
import { pickupToday } from '@/lib/pickup-timezone';
import { useUtcDay } from '@/lib/use-utc-day';
import { createDepositAuthorizationSession, createDepositSetupSession, recordDepositHoldConsent } from '@/lib/security-deposit';
import { PageBackButton } from '@/main-site/components/page-back-button';
import { CheckoutPointsPicker, CheckoutRewards } from '@/main-site/components/rewards';
import { redeemTestRewardPoints } from '@/lib/rewards';

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTaxRate(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 4 }).format(value);
}

export function CheckoutPage({ id, startDate, endDate, quantity = 1, initialDeliveryMode = 'pickup' }: {
  id: string; startDate?: string; endDate?: string; quantity?: number; initialDeliveryMode?: 'pickup' | 'delivery';
}) {
  const utcDay = useUtcDay();
  const { navigate, back } = useRouter();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [availabilityStatus, setAvailabilityStatus] = useState<'checking' | 'available' | 'unavailable' | 'error'>('checking');
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<DbBookingRow | null>(null);
  const [quoteResult, setPriceQuote] = useState<CheckoutPriceQuote | null>(null);
  const [priceQuoteKey, setPriceQuoteKey] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [deliveryMode, setDeliveryMode] = useState<'pickup' | 'delivery'>(initialDeliveryMode);
  const [deliveryTrip, setDeliveryTrip] = useState<DeliveryTrip>('both');
  const [setupSelected, setSetupSelected] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>({
    address_line1: '', address_line2: '', city: '', state: '', postal_code: '',
  });
  const [dropoffWindow, setDropoffWindow] = useState<DeliveryWindow | null>(null);
  const [returnWindow, setReturnWindow] = useState<DeliveryWindow | null>(null);
  const [deliveryWindows, setDeliveryWindows] = useState<DeliveryWindowAvailability[] | null>(null);
  const [windowTimeZone, setWindowTimeZone] = useState('');
  const [windowError, setWindowError] = useState<string | null>(null);
  const [windowRetry, setWindowRetry] = useState(0);
  const [deliveryUnavailable, setDeliveryUnavailable] = useState(false);
  const [insuranceSelected, setInsuranceSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositConsent, setDepositConsent] = useState(false);
  const [pointsSelected, setPointsSelected] = useState(false);
  const [pointsApplied, setPointsApplied] = useState(false);
  const localRewards = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const guaranteedDelivery = deliveryMode === 'delivery' && Boolean(listing?.deliveryGuaranteedWindows?.length);
  const currentQuoteKey = JSON.stringify([id, startDate, endDate, quantity, deliveryMode, insuranceSelected,
    guaranteedDelivery ? deliveryTrip : null, guaranteedDelivery && setupSelected]);
  const priceQuote = priceQuoteKey === currentQuoteKey ? quoteResult : null;

  useEffect(() => {
    let cancelled = false;
    fetchListingById(id)
      .then((row) => { if (!cancelled) setListing(row ? toUiListing(row) : null); })
      .catch(() => { if (!cancelled) setListing(null); });
    return () => { cancelled = true; };
  }, [id, utcDay]);

  useEffect(() => {
    if (listing && !listing.deliveryAvailable && deliveryMode === 'delivery' && !createdBooking) {
      setDeliveryMode('pickup');
      setDeliveryUnavailable(true);
    }
  }, [listing, deliveryMode, createdBooking]);

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

  useEffect(() => {
    let active = true;
    if (!guaranteedDelivery || !startDate || !endDate || endDate <= startDate || createdBooking) {
      setDeliveryWindows(null);
      setWindowError(null);
      return () => { active = false; };
    }
    setDeliveryWindows(null);
    setWindowError(null);
    fetchDeliveryWindows(id, startDate, endDate).then(result => {
      if (!active) return;
      setWindowTimeZone(result.timeZone);
      setDeliveryWindows(result.windows);
      setDropoffWindow(current => result.windows.some(item => item.window === current && item.dropoff_available)
        ? current : result.windows.find(item => item.window === 'afternoon' && item.dropoff_available)?.window
          ?? result.windows.find(item => item.dropoff_available)?.window ?? null);
      setReturnWindow(current => result.windows.some(item => item.window === current && item.return_available)
        ? current : result.windows.find(item => item.window === 'afternoon' && item.return_available)?.window
          ?? result.windows.find(item => item.return_available)?.window ?? null);
    }).catch(reason => {
      if (active) setWindowError(reason instanceof Error ? reason.message : 'Could not load delivery windows.');
    });
    return () => { active = false; };
  }, [guaranteedDelivery, id, startDate, endDate, createdBooking, windowRetry]);

  useEffect(() => {
    let active = true;
    if (createdBooking) {
      setQuoteLoading(false);
      return () => { active = false; };
    }
    if (!listing || (deliveryMode === 'delivery' && !listing.deliveryAvailable)
      || !startDate || !endDate || endDate <= startDate || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      setPriceQuote(null);
      setQuoteLoading(false);
      setQuoteError(null);
      return () => { active = false; };
    }
    setQuoteLoading(true);
    setQuoteError(null);
    fetchCheckoutPriceQuote({
      listingId: id, startDate, endDate, quantity, deliveryMode, insuranceSelected,
      deliveryTrip: guaranteedDelivery ? deliveryTrip : undefined,
      setupSelected: guaranteedDelivery && setupSelected,
    }).then(quote => {
      if (active) { setPriceQuote(quote); setPriceQuoteKey(currentQuoteKey); }
    }).catch(error => {
      if (active) {
        setPriceQuote(null);
        setQuoteError(error instanceof Error ? error.message : 'Could not verify the checkout price.');
      }
    }).finally(() => { if (active) setQuoteLoading(false); });
    return () => { active = false; };
  }, [id, startDate, endDate, quantity, deliveryMode, insuranceSelected, createdBooking, quoteRetry, listing,
    guaranteedDelivery, deliveryTrip, setupSelected, currentQuoteKey]);

  if (listing === undefined) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28 w-full" rounded="rounded-card-lg" />
        <Skeleton className="h-48 w-full" rounded="rounded-card-lg" />
      </div>
    );
  }

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
        <p className="text-sec text-sm mt-2">Choose pickup and return dates on the listing to continue.</p>
        <Button className="mt-6" onClick={() => navigate({ name: 'listing', id })}>Back to the listing</Button>
      </div>
    );
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return <div className="max-w-xl mx-auto px-4 py-10">
    <Alert tone="error" title="Invalid rental quantity">Choose between 1 and 100 units before continuing.</Alert>
    <Button className="mt-4" onClick={() => back({ name: 'listing', id })}>Back to the listing</Button>
  </div>;
  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  const selectedRentalOption = priceQuote?.package_kind === 'monthly' ? 'Monthly (30 days)'
    : priceQuote?.package_kind === 'weekly' ? 'Weekly (7 days)' : `${days} ${days === 1 ? 'day' : 'days'}`;
  const rental = createdBooking ? Number(createdBooking.subtotal) : priceQuote?.rental_subtotal ?? 0;
  const serviceFee = createdBooking ? Number(createdBooking.service_fee_amount) : priceQuote?.renter_service_fee_amount ?? 0;
  const deliveryFeeAmount = createdBooking ? Number(createdBooking.delivery_fee_amount ?? 0)
    : priceQuote?.delivery_fee_amount ?? 0;
  const setupAmount = createdBooking ? Number(createdBooking.delivery_setup_amount ?? 0)
    : priceQuote?.delivery_setup_amount ?? 0;
  const insuranceAmount = createdBooking ? Number(createdBooking.insurance_amount)
    : priceQuote?.insurance_amount ?? 0;
  const deposit = createdBooking ? Number(createdBooking.deposit) : priceQuote?.deposit ?? listing.deposit;
  const isTaxDemo = createdBooking?.sandbox_tax === true;
  const tax = createdBooking ? Number(createdBooking.tax_amount ?? 0) : priceQuote?.tax_amount ?? 0;
  const total = createdBooking ? Number(createdBooking.total) : priceQuote?.renter_checkout_total ?? 0;
  const renterServiceFeePct = createdBooking?.service_fee_pct == null
    ? priceQuote?.service_fee_renter_pct : Number(createdBooking.service_fee_pct);
  const ownerServiceFeeAmount = createdBooking
    ? Number(createdBooking.owner_service_fee_amount ?? 0) : priceQuote?.owner_service_fee_amount ?? 0;

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!createdBooking && !priceQuote) {
        throw new Error(quoteError ?? 'Please wait while we verify your total.');
      }
      if (!paymentBookingId && availabilityStatus !== 'available') {
        throw new Error(availabilityStatus === 'error'
          ? 'Availability could not be verified. Please retry before booking.'
          : 'These dates are not available for the selected quantity. Choose another range.');
      }
      if (guaranteedDelivery && !createdBooking) {
        if (!deliveryAddress.address_line1.trim() || !deliveryAddress.city.trim()
          || !deliveryAddress.state.trim() || !deliveryAddress.postal_code.trim()) {
          throw new Error('Enter your delivery street address, city, state, and ZIP code.');
        }
        if (!deliveryWindows || ((deliveryTrip === 'dropoff' || deliveryTrip === 'both')
          && !deliveryWindows.some(item => item.window === dropoffWindow && item.dropoff_available))
          || ((deliveryTrip === 'return' || deliveryTrip === 'both')
          && !deliveryWindows.some(item => item.window === returnWindow && item.return_available))) {
          throw new Error('Choose an available window for each delivery trip.');
        }
      }
      const booking = createdBooking ?? await createBookingRequest({
        listingId: id, startDate: startDate!, endDate: endDate!, quantity, deliveryMode, insuranceSelected,
        delivery: guaranteedDelivery ? {
          trip: deliveryTrip, setup: setupSelected, address: deliveryAddress,
          dropoff_window: deliveryTrip === 'return' ? null : dropoffWindow,
          return_window: deliveryTrip === 'dropoff' ? null : returnWindow,
        } : undefined,
      });
      if (!createdBooking) {
        setCreatedBooking(booking);
        const quotedTotal = priceQuote?.renter_checkout_total;
        const bookedRentalTotal = Number(booking.total)
          - (booking.deposit_collection_model === 'captured' ? Number(booking.deposit) : 0);
        if (quotedTotal == null || Math.round(bookedRentalTotal * 100) !== Math.round(quotedTotal * 100)) {
          throw new Error('The price changed while creating your booking. Review the confirmed total before continuing.');
        }
      }
      if (pointsSelected && !pointsApplied) {
        await redeemTestRewardPoints(booking.id);
        setPointsApplied(true);
      }
      if (paymentBookingId) {
        window.location.href = await createCheckoutSession(paymentBookingId);
        return;
      }
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
      if (/delivery window|overlaps another owner commitment/i.test(message)) setWindowRetry(value => value + 1);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-in pb-24 md:pb-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <PageBackButton fallback={{ name: 'listing', id }}>Back to the listing</PageBackButton>

        <header className="mb-6 sm:mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Booking · Review</p>
          <h1 className="mt-2 text-[26px] sm:text-[32px] font-extrabold text-main font-display leading-tight">Review your booking</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sec">{listing.instantBooking
            ? "This item books instantly. Next, you'll pay securely with Stripe."
            : `One last look before ${listing.owner.name.split(' ')[0]} gets your request.`}</p>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)] lg:gap-8">
          <section aria-label="Rental details" className="space-y-4">
            <Surface className="p-4 flex gap-4">
              <ListingPhoto images={listing.images} className="w-16 h-16 rounded-card object-cover shrink-0 bg-subtle" />
              <div className="flex-1 min-w-0">
                {listing.category && <p className="text-xs font-medium text-accent">{listing.category}</p>}
                <h2 className="font-semibold text-main font-display leading-snug mt-0.5">{listing.title}</h2>
                <p className="text-xs text-sec mt-1">
                  {listing.pickup && `${listing.pickup} · `}{quantity} {quantity === 1 ? 'unit' : 'units'} · {formatDay(startDate)} – {formatDay(endDate)} · {selectedRentalOption}
                </p>
              </div>
              <Button size="sm" variant="ghost" disabled={submitting || Boolean(paymentBookingId)} onClick={() => navigate({ name: 'listing', id })}>Change</Button>
            </Surface>

            {deliveryUnavailable && <Alert tone="warning">Delivery is no longer available for this item. Pickup is selected; please review your booking.</Alert>}
            {listing.deliveryAvailable && !createdBooking && <Surface className="p-4">
              <h2 className="font-semibold text-main">Handoff</h2>
              <fieldset className="mt-2 grid gap-2 sm:grid-cols-2" disabled={submitting || Boolean(paymentBookingId)}>
                <legend className="sr-only">Choose pickup or delivery</legend>
                <label className={`flex min-h-11 items-center gap-2 rounded-card border p-3 text-sm ${deliveryMode === 'pickup' ? 'border-accent bg-accent-soft' : 'border-app'}`}>
                  <input type="radio" name="booking-delivery-mode" checked={deliveryMode === 'pickup'} onChange={() => setDeliveryMode('pickup')} className="accent-[var(--accent)]" />
                  <span className="flex-1"><strong className="block text-main">Pickup</strong><span className="text-xs text-sec">You collect it{listing.pickup ? ` · ${listing.pickup}` : ''}</span></span>
                  <strong className="text-xs text-main">Free</strong>
                </label>
                <label className={`flex min-h-11 items-center gap-2 rounded-card border p-3 text-sm ${deliveryMode === 'delivery' ? 'border-accent bg-accent-soft' : 'border-app'}`}>
                  <input type="radio" name="booking-delivery-mode" checked={deliveryMode === 'delivery'} onChange={() => setDeliveryMode('delivery')} className="accent-[var(--accent)]" />
                  <span className="flex-1"><strong className="block text-main">Delivery</strong><span className="text-xs text-sec">{listing.deliveryGuaranteedWindows?.length ? 'To your address' : 'Arrange with the owner'}</span></span>
                  <strong className="text-xs text-main">{listing.deliveryFee == null ? 'See quote' : `${listing.deliveryGuaranteedWindows?.length ? 'From ' : ''}$${formatMoney(listing.deliveryGuaranteedWindows?.length
                    ? Math.min(listing.deliveryFee, 2 * listing.deliveryFee - (listing.deliveryRoundTripDiscount ?? 0)) : listing.deliveryFee)}`}</strong>
                </label>
              </fieldset>
              {guaranteedDelivery ? <>
                <fieldset className="mt-4 border-t border-app pt-4" disabled={submitting || Boolean(paymentBookingId)}>
                  <legend className="sr-only">What delivery service do you need?</legend>
                  <p className="mb-2 text-sm font-semibold text-main">What do you need?</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      ['dropoff', 'Drop-off only', 'At the start'],
                      ['return', 'Return pickup only', 'At the end'],
                      ['both', 'Both ways', 'Drop-off and return'],
                    ] as const).map(([value, title, detail]) => {
                      const fee = value === 'both'
                        ? 2 * (listing.deliveryFee ?? 0) - (listing.deliveryRoundTripDiscount ?? 0)
                        : listing.deliveryFee ?? 0;
                      return <label key={value} className={`flex min-h-12 items-center gap-2 rounded-card border p-3 text-sm ${value === 'both' ? 'sm:col-span-2' : ''} ${deliveryTrip === value ? 'border-accent bg-accent-soft' : 'border-app'}`}>
                        <input type="radio" name="delivery-trip" value={value} checked={deliveryTrip === value}
                          onChange={() => { setDeliveryTrip(value); if (value === 'return') setSetupSelected(false); }}
                          className="accent-[var(--accent)]" />
                        <span className="flex-1"><strong className="block text-main">{title}{value === 'both' && (listing.deliveryRoundTripDiscount ?? 0) > 0
                          && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">Save ${formatMoney(listing.deliveryRoundTripDiscount ?? 0)}</span>}</strong>
                          <span className="block text-xs text-sec">{detail}</span></span>
                        <strong className="text-xs text-main">+${formatMoney(fee)}</strong>
                      </label>;
                    })}
                  </div>
                </fieldset>
                <p className="mt-3 text-xs text-sec">{listing.deliveryRadiusMiles
                  ? `The owner offers delivery within ${listing.deliveryRadiusMiles} miles of ${listing.pickup}. `
                  : ''}The owner sets the trip fee and any round-trip discount.</p>
              </> : deliveryMode === 'delivery' && <p className="mt-3 text-xs text-sec">Delivery details and handoff times are arranged with the owner after booking.</p>}
            </Surface>}

            {guaranteedDelivery && !createdBooking && <>
              <Surface className="p-4">
                <h2 className="font-semibold text-main">Delivery address</h2>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-6">
                  {([
                    ['address_line1', 'Street address', 'address-line1', true, 'sm:col-span-4'],
                    ['address_line2', 'Apt / suite (optional)', 'address-line2', false, 'sm:col-span-2'],
                    ['city', 'City', 'address-level2', true, 'sm:col-span-3'],
                    ['state', 'State', 'address-level1', true, 'sm:col-span-1'],
                    ['postal_code', 'ZIP', 'postal-code', true, 'sm:col-span-2'],
                  ] as const).map(([key, label, autocomplete, required, width]) => <div key={key} className={width}>
                    <label htmlFor={`delivery-${key}`} className="block text-xs font-semibold text-main">{label}</label>
                    <input id={`delivery-${key}`} name={key} autoComplete={autocomplete} required={required}
                      maxLength={key === 'postal_code' ? 20 : key === 'state' || key === 'city' ? 100 : 200}
                      value={deliveryAddress[key]} disabled={submitting || Boolean(paymentBookingId)}
                      onChange={event => setDeliveryAddress(current => ({ ...current, [key]: event.target.value }))}
                      className="mt-1 min-h-11 w-full rounded-card border border-strong bg-card px-3 text-base text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                  </div>)}
                </div>
              </Surface>
              <Surface className="p-4">
                <h2 className="font-semibold text-main">Time windows</h2>
                {!deliveryWindows && !windowError && <p role="status" className="mt-3 text-sm text-sec">Checking available delivery windows…</p>}
                {windowError && <Alert tone="error" className="mt-3" title="Could not check delivery windows">
                  {windowError}<Button variant="secondary" size="sm" className="mt-2" onClick={() => setWindowRetry(value => value + 1)}>Retry</Button>
                </Alert>}
                {deliveryWindows && <>
                  {(deliveryTrip === 'dropoff' || deliveryTrip === 'both') && <DeliveryWindowPicker
                    title={`Drop-off · ${formatDay(startDate)}`} kind="dropoff" windows={deliveryWindows}
                    selected={dropoffWindow} onChange={setDropoffWindow} disabled={submitting || Boolean(paymentBookingId)} />}
                  {(deliveryTrip === 'return' || deliveryTrip === 'both') && <DeliveryWindowPicker
                    title={`Return pickup · ${formatDay(endDate)}`} kind="return" windows={deliveryWindows}
                    selected={returnWindow} onChange={setReturnWindow} disabled={submitting || Boolean(paymentBookingId)} />}
                  <p className="mt-3 text-xs text-sec">Times are in {windowTimeZone}. The owner commits to the selected windows.</p>
                </>}
              </Surface>
              {listing.deliverySetupAvailable && deliveryTrip !== 'return' && <Surface className={`p-4 ${setupSelected ? 'border-accent bg-accent-soft' : ''}`}>
                <div className="flex min-h-11 items-center gap-3">
                  <div className="rounded-card bg-accent-soft p-2 text-accent"><Wrench size={18} aria-hidden="true" /></div>
                  <div className="min-w-0 flex-1">
                    <label htmlFor="delivery-setup" className="block font-semibold text-main">Installation assistance</label>
                    <p className="text-xs text-sec">Provided by the owner at your address during drop-off.</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-main">+${formatMoney(listing.deliverySetupFee ?? 0)}</span>
                  <Switch id="delivery-setup" checked={setupSelected} onCheckedChange={setSetupSelected}
                    disabled={submitting || Boolean(paymentBookingId)}
                    className="relative before:absolute before:-inset-x-1 before:-inset-y-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2" />
                </div>
              </Surface>}
            </>}

            {!createdBooking && <Surface className="p-4">
              <InsuranceAmount days={days} replacementValue={listing.declaredValue} quantity={quantity}
                selected={insuranceSelected} onSelectionChange={setInsuranceSelected}
                disabled={submitting || Boolean(paymentBookingId)} />
            </Surface>}

            {availabilityStatus !== 'available' && !paymentBookingId && <Alert
              tone={availabilityStatus === 'unavailable' ? 'warning' : 'info'}
              title={availabilityStatus === 'checking' ? 'Checking availability' : availabilityStatus === 'unavailable' ? 'Dates unavailable' : 'Could not verify availability'}
            >
              {availabilityStatus === 'checking'
                ? 'Checking these dates and the selected quantity with the owner’s current availability.'
                : availabilityStatus === 'unavailable'
                  ? <>These dates are no longer available for the selected quantity. <Button variant="secondary" className="mt-2" onClick={() => navigate({ name: 'listing', id })}>Choose other dates</Button></>
                  : <>We couldn't check availability. Please try again. <Button variant="secondary" className="mt-2" onClick={() => setAvailabilityRetry((value) => value + 1)}>Check again</Button></>}
            </Alert>}
          </section>

          <aside aria-label="Booking summary" className="space-y-4 lg:sticky lg:top-6">
            <Surface className="p-5 sm:p-6">
              <h2 id="checkout-summary-heading" className="font-semibold text-main font-display mb-4">Your price</h2>
              {quoteLoading && <p role="status" className="text-sm text-sec">Verifying the current price…</p>}
              {quoteError && <Alert tone="error" title="Could not verify the checkout price">
                {quoteError}<Button size="sm" variant="secondary" className="mt-2" onClick={() => setQuoteRetry(value => value + 1)}>Retry price</Button>
              </Alert>}
              {(createdBooking || priceQuote) && <>
                <div className="space-y-3 text-sm">
                  <CheckoutRentalPrice quantity={quantity} days={days}
                    dailyRate={priceQuote?.daily_rate ?? listing.pricePerDay} rental={rental}
                    createdBooking={Boolean(createdBooking)} quote={priceQuote} />
                  <Row label={`Service fee${renterServiceFeePct == null ? '' : ` · ${(renterServiceFeePct * 100).toFixed(2)}%`}`} value={serviceFee} />
                  {deliveryFeeAmount > 0 && <Row label="Delivery fee" value={deliveryFeeAmount} />}
                  {setupAmount > 0 && <Row label="Installation assistance" value={setupAmount} />}
                  {insuranceAmount > 0 && <Row label="Rental protection" value={insuranceAmount} />}
                  <Row label={`Tax (${formatTaxRate(Number(createdBooking?.tax_rate ?? priceQuote?.tax_rate ?? 0))}${isTaxDemo ? ' test' : ''})`} value={tax} />
                </div>
                <div className="flex items-baseline justify-between gap-3 text-sm font-semibold text-main mt-3 pt-3 border-t border-app">
                  <span>{createdBooking ? 'Confirmed total' : listing.instantBooking ? 'Due today' : 'Estimated total'}</span><span className="text-2xl text-accent tnum">${formatMoney(total)}</span>
                </div>
                {(createdBooking || !listing.instantBooking) && <p className="text-xs text-sec mt-2">
                  {createdBooking ? 'Your fees and tax are confirmed.' : 'Tax applies to the rental and service fee.'}
                </p>}
                {ownerServiceFeeAmount > 0 && <p className="text-xs text-sec mt-2">The owner’s service fee (${formatMoney(ownerServiceFeeAmount)}) comes from their earnings and is not added to your total.</p>}
                <p className="text-xs text-sec mt-2 leading-relaxed">Includes rental, fees, selected extras and tax. The security hold is separate.</p>
                {localRewards && <CheckoutPointsPicker
                  selected={pointsSelected} applied={pointsApplied} onSelectionChange={setPointsSelected}
                  rentalSubtotal={rental} total={total} disabled={submitting} />}
              </>}
            {deposit > 0 && (
              <div className="mt-4 rounded-card bg-accent-soft p-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="flex items-center gap-1.5 text-sec"><Lock size={14} /> Temporary security-deposit authorization</span>
                  <span className="font-semibold text-main tnum">${formatMoney(deposit)}</span>
                </div>
                <p className="text-xs text-muted mt-1.5 leading-relaxed">
                  {createdBooking?.deposit_collection_model === 'captured'
                    ? 'Charged separately at checkout and refundable after return unless deductions are approved.'
                    : `Not charged today. It’s authorized within 24 hours before ${deliveryMode} and released after return unless deductions are approved.`}
                </p>
                {createdBooking && !createdBooking.payment_first && <label className="mt-3 flex min-h-11 items-start gap-2 text-xs text-sec">
                  <input type="checkbox" checked={depositConsent} onChange={event => setDepositConsent(event.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  <span>I agree to save this card for the temporary security-deposit authorization and any separately approved claim.</span>
                </label>}
              </div>
            )}

            {error && <Alert tone="error" title={createdBooking ? 'Booking saved - action required' : 'Booking not created'}>
              {error}
              {createdBooking && <p className="mt-2">Your booking was created. Retry below, or open it from Bookings. Do not submit a new booking.</p>}
            </Alert>}

            <div className="hidden md:block">
              <Button fullWidth size="lg" className="mt-4" loading={submitting} disabled={(availabilityStatus !== 'available' && !paymentBookingId) || (quoteLoading || (!priceQuote && !createdBooking && !paymentBookingId))} loadingLabel={paymentBookingId ? 'Opening secure payment…' : listing.instantBooking ? 'Booking…' : 'Sending request…'} onClick={handleConfirm}>
                {paymentBookingId ? `Confirm $${formatMoney(total)} and pay` : listing.instantBooking ? 'Continue to payment' : 'Send booking request'}
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-xs text-sec mt-3">
                <ShieldCheck size={14} /> {listing.instantBooking
                  ? "You'll pay on a secure Stripe page. Tax applies to rental and service fee."
                  : 'No charge now - you pay only if the owner approves.'}
              </p>
            </div>
            </Surface>
          </aside>
        </div>
      </div>

      {/* Mobile: the decision stays in reach */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 glass-surface border-t border-app px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-main tnum">{createdBooking || priceQuote ? `$${formatMoney(total)}` : '—'}</p>
            <p className="text-xs text-sec">{createdBooking ? 'Final total · no charge yet' : priceQuote ? 'Est. total · no charge yet' : quoteLoading ? 'Verifying total' : 'Price unavailable'}</p>
          </div>
          <Button className="flex-1" loading={submitting} disabled={(availabilityStatus !== 'available' && !paymentBookingId) || (quoteLoading || (!priceQuote && !createdBooking && !paymentBookingId))} loadingLabel={paymentBookingId ? 'Opening secure payment…' : listing.instantBooking ? 'Booking…' : 'Sending…'} onClick={handleConfirm}>
            {paymentBookingId ? `Confirm $${formatMoney(total)} and pay` : listing.instantBooking ? 'Continue to payment' : 'Send request'}
          </Button>
        </div>
      </div>

    </div>
  );
}

function DeliveryWindowPicker({ title, kind, windows, selected, onChange, disabled }: {
  title: string;
  kind: 'dropoff' | 'return';
  windows: DeliveryWindowAvailability[];
  selected: DeliveryWindow | null;
  onChange: (window: DeliveryWindow) => void;
  disabled: boolean;
}) {
  return <fieldset className="mt-4" disabled={disabled}>
    <legend className="text-sm font-semibold text-main">{title}</legend>
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {windows.map(item => {
        const available = kind === 'dropoff' ? item.dropoff_available : item.return_available;
        return <label key={item.window} className={`flex min-h-11 items-center justify-center rounded-card border px-2 py-2 text-center text-sm font-medium focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 ${selected === item.window && available
          ? 'border-accent bg-accent-soft text-main ring-1 ring-accent' : 'border-app text-main'} ${!available ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
          <input type="radio" name={`delivery-${kind}-window`} value={item.window}
            checked={selected === item.window && available} disabled={!available}
            onChange={() => onChange(item.window)} className="sr-only peer" />
          <span>{DELIVERY_WINDOW_LABELS[item.window]}{!available && <span className="block text-xs">Unavailable</span>}</span>
        </label>;
      })}
    </div>
    {!windows.some(item => kind === 'dropoff' ? item.dropoff_available : item.return_available)
      && <p role="status" className="mt-2 text-xs text-error">No delivery windows are available on this date.</p>}
  </fieldset>;
}

const NEXT_STEP: Record<UiBooking['status'], string> = {
  requested: 'Waiting for the owner to approve your dates.',
  pending_payment: 'Approved - pay from your bookings to lock in these dates.',
  confirmed: 'Paid and confirmed. Arrange pickup in messages.',
  active: 'The rental is under way. Start the return when you are done.',
  return_pending: 'Return started - the owner confirms once they have it back.',
  completed: 'Item returned. Condition review and financial processing are tracked separately.',
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
        {!booking.isOwner && booking.status === 'pending_payment' && <CheckoutRewards key={booking.id} bookingId={booking.id} rentalSubtotal={booking.subtotal} />}
        {(booking.status==='pending_payment' || booking.status==='cancelled') && <CheckoutReservation
          bookingId={booking.id} canPay={!booking.isOwner}
          requiresDepositAuthorization={!booking.paymentFirst && booking.depositCollectionModel==='authorization' && booking.deposit>0} /> }
        {booking.status === 'pending_payment' && (
          <Alert tone="info" title="Payment is not confirmed yet" className="mb-4">
            {checking ? 'Confirming your payment. You can leave this page safely.' : 'If you just paid, confirmation may still be processing.'}
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

        {booking.deliveryTrip !== 'both' && <div className="mb-4"><BookingPickup bookingId={booking.id} status={booking.status} paymentFirst={booking.paymentFirst} /></div>}
        {booking.deliveryTrip && ['confirmed', 'active', 'return_pending'].includes(booking.status)
          && <div className="mb-4"><BookingDeliveryAddress bookingId={booking.id} /></div>}
        <RentalAgreement bookingId={booking.id} isOwner={booking.isOwner} />
        <Surface id="booking-summary" tabIndex={-1} className="p-5 mb-6 space-y-3 text-sm">
          <p className="text-xs text-sec">Booking reference: {booking.bookingReference ?? 'Not assigned'}</p>
          <div className="flex justify-between">
            <span className="text-sec">Rental subtotal</span>
            <span className="font-semibold text-main tnum">${booking.subtotal + booking.ownerDiscountAmount}</span>
          </div>
          {booking.ownerDiscountAmount > 0 && <div className="flex justify-between"><span className="text-sec">Package savings</span><span className="font-semibold text-main tnum">-${booking.ownerDiscountAmount}</span></div>}
          <div className="flex justify-between"><span className="text-sec">Renter service fee</span><span className="font-semibold text-main tnum">${booking.serviceFeeAmount.toFixed(2)}</span></div>
          {booking.deliveryFeeAmount > 0 && <Row label="Delivery" value={booking.deliveryFeeAmount} />}
          {booking.deliverySetupAmount > 0 && <Row label="Installation assistance" value={booking.deliverySetupAmount} />}
          {booking.insuranceAmount > 0 && <div className="flex justify-between"><span className="text-sec">Insurance</span><span className="font-semibold text-main tnum">${booking.insuranceAmount.toFixed(2)}</span></div>}
          {(booking.taxRate > 0 || booking.sandboxTax) && <Row label={`Tax (${formatTaxRate(booking.taxRate)}${booking.sandboxTax ? ' test' : ''})`} value={booking.taxAmount} />}
          <div className="flex justify-between"><span className="text-sec">Rental charge after discount</span><span className="font-semibold text-main tnum">${formatMoney(booking.depositCollectionModel === 'authorization' ? booking.total : booking.total - booking.deposit)}</span></div>
          {booking.isOwner && <div className="space-y-1 pt-3 border-t border-app">
            <p className="font-semibold text-main">Expected owner earnings · fee snapshot</p>
            <div className="flex justify-between"><span className="text-sec">Rental subtotal</span><span className="tnum">${booking.subtotal.toFixed(2)}</span></div>
            {booking.deliveryFeeAmount > 0 && <div className="flex justify-between"><span className="text-sec">Delivery fee</span><span className="tnum">+${booking.deliveryFeeAmount.toFixed(2)}</span></div>}
            {booking.deliverySetupAmount > 0 && <div className="flex justify-between"><span className="text-sec">Installation assistance</span><span className="tnum">+${booking.deliverySetupAmount.toFixed(2)}</span></div>}
            <div className="flex justify-between"><span className="text-sec">Owner service fee{booking.ownerServiceFeePct > 0 ? ` · ${(booking.ownerServiceFeePct * 100).toFixed(2)}%` : ''}</span><span className="tnum">−${booking.ownerServiceFeeAmount.toFixed(2)}</span></div>
            <div className="flex justify-between font-semibold text-main"><span>Expected owner net</span><span className="tnum">${(booking.subtotal + booking.deliveryFeeAmount + booking.deliverySetupAmount - booking.ownerServiceFeeAmount).toFixed(2)}</span></div>
            <p className="text-xs text-sec">Taxes, renter service fee, insurance and deposit are not deducted from owner earnings.</p>
          </div>}
          <div className="flex justify-between pt-3 border-t border-app">
            <span className="text-sec">Status</span>
            <span className="font-semibold text-main">{booking.status === 'completed' ? 'returned' : booking.status.replace('_', ' ')}</span>
          </div>
        </Surface>
        {booking.deposit > 0 && <Surface className="p-4 mb-4">
          <h3 className="font-semibold text-main">Separate security-deposit transaction</h3>
          <p className="mt-2 text-sm text-sec">${booking.deposit.toFixed(2)} {booking.depositCollectionModel === 'authorization'
            ? 'temporary hold, not included in the rental total. Complete it at check-in before pickup or delivery.'
            : 'was collected with the original legacy payment; its refund is tracked separately.'}</p>
        </Surface>}
        {booking.paymentFirst && booking.status === 'confirmed' && <Button className="mb-4" onClick={() => navigate({ name: 'check-in', id: booking.id })}>Check-in: choose a slot</Button>}

        {booking.status === 'completed' && <RentalSettlement bookingId={booking.id} isOwner={booking.isOwner}
          expectedOwnerNet={booking.subtotal + booking.deliveryFeeAmount + booking.deliverySetupAmount - booking.ownerServiceFeeAmount}
          ownerServiceFeeAmount={booking.ownerServiceFeeAmount} />}
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
