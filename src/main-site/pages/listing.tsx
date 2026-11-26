import { useEffect, useState } from 'react';
import { ImageGallery, ListingCard } from '@/main-site/components/listing-card';
import { Rating, VerifiedBadge, ProtectionBadge } from '@/main-site/components/trust';
import { Button, Badge, Alert, SectionHeader, Surface } from '@/main-site/components/ui';
import { useRouter } from '@/router';
import type { Listing } from '@/data';
import { fetchListingById, toUiListing, searchListings, enrichListingsWithRatings } from '@/lib/listings';
import { getOrCreateConversation } from '@/lib/messages';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { fetchReviewsForUser } from '@/lib/reviews';
import { fetchUnavailableDates } from '@/lib/availability';
import { DateRangePicker } from '@/main-site/components/date-range-picker';
import { useAuth } from '@/auth-context';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { MAX_BOOKING_RANGE_DAYS, addDaysIso, todayIso } from '@/lib/geo';
import { pickupToday } from '@/lib/pickup-timezone';
import { ListingDetailSkeleton } from '@/main-site/components/skeleton';
import { useUtcDay } from '@/lib/use-utc-day';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { fetchListingPricingQuotes, type ListingPriceQuote } from '@/lib/listing-pricing';
import { ALLOW_SAME_DAY_BOOKINGS } from '@/lib/feature-flags';
import { fetchMainItemRequest } from '../request-flow';
import {
  MapPin, CheckCircle2, Truck,
  Lock, Star, MessageSquare, Heart, Share2, ChevronRight,
} from 'lucide-react';

const tomorrowIso = () => addDaysIso(todayIso(), 1);

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateShort(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ListingPage({ id, requestId }: { id: string; requestId?: string }) {
  const utcDay = useUtcDay();
  const { navigate } = useRouter();
  const { user, openSignIn } = useAuth();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [listingError, setListingError] = useState(false);
  const [listingRetry, setListingRetry] = useState(0);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Listing[]>([]);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(tomorrowIso());
  const [liked, setLiked] = useState(false);
  const [shared, setShared] = useState(false);
  const [ownerAvatarFailed, setOwnerAvatarFailed] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [similarError, setSimilarError] = useState(false);
  const [similarRetry, setSimilarRetry] = useState(0);
  const [bookedDates, setBookedDates] = useState<Set<string>>(new Set());
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [reviewsError, setReviewsError] = useState(false);
  const [reviewsRetry, setReviewsRetry] = useState(0);
  const [favoriteError, setFavoriteError] = useState(false);
  const [favoriteRetry, setFavoriteRetry] = useState(0);
  const sameDayBookings = useFeatureFlag(ALLOW_SAME_DAY_BOOKINGS);
  const { enabled: biddingEnabled, error: biddingFlagError } = useFeatureFlag('bidding');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [deliveryMode, setDeliveryMode] = useState<'pickup' | 'delivery'>('pickup');
  const [pricing, setPricing] = useState<{ key: string; quotes: ListingPriceQuote[] | null; error: string | null } | null>(null);
  const [pricingRetry, setPricingRetry] = useState(0);
  const today = listing?.pickupTimeZone ? pickupToday(listing.pickupTimeZone) : todayIso();
  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  const pricingKey = `${id}:${days}:${quantity}`;
  const listingId = listing?.id;

  useEffect(() => {
    if (!listingId || !Number.isInteger(days) || days > MAX_BOOKING_RANGE_DAYS
      || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return;
    let active = true;
    fetchListingPricingQuotes(id, [days], quantity)
      .then(({ quotes }) => {
        if (!quotes.some(quote => quote.days === days && typeof quote.renter_service_fee_amount === 'number'
          && Number.isFinite(quote.renter_service_fee_amount) && quote.renter_service_fee_amount >= 0
          && typeof quote.tax_amount === 'number' && Number.isFinite(quote.tax_amount) && quote.tax_amount >= 0)) {
          throw new Error('The server returned an incomplete price estimate.');
        }
        if (active) setPricing({ key: pricingKey, quotes, error: null });
      })
      .catch(error => {
        if (active) setPricing({ key: pricingKey, quotes: null, error: error instanceof Error ? error.message : 'Could not load the price estimate.' });
      });
    return () => { active = false; };
  }, [id, listingId, days, quantity, pricingKey, pricingRetry]);

  useEffect(() => {
    if (!listing || sameDayBookings.loading || sameDayBookings.error || sameDayBookings.enabled) return;
    const firstAllowedDate = addDaysIso(today, 1);
    if (startDate < firstAllowedDate) {
      const duration = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
      setStartDate(firstAllowedDate);
      setEndDate(addDaysIso(firstAllowedDate, duration));
    }
  }, [endDate, listing, sameDayBookings.enabled, sameDayBookings.error, sameDayBookings.loading, startDate, today]);

  useEffect(() => {
    let cancelled = false;
    setListing(undefined);
    setListingError(false);
    setSimilar([]);
    setCategoryId(null);
    setOwnerAvatarFailed(false);
    setMessageError(null);
    setShareError(false);
    setDeliveryMode('pickup');
    Promise.all([fetchListingById(id), requestId ? fetchMainItemRequest(requestId) : Promise.resolve(null)])
      .then(([row, request]) => {
        if (cancelled) return;
        if (request && request.renter_id !== user?.id) throw new Error('This request does not belong to your account.');
        setRequestError(null);
        setQuantity(request?.requested_quantity ?? 1);
        setListing(row ? toUiListing(row) : null);
        setCategoryId(row?.category_id ?? null);
        const today = row?.pickup_time_zone ? pickupToday(row.pickup_time_zone) : todayIso();
        const start = row?.availability_start && row.availability_start > today ? row.availability_start : today;
        setStartDate(request?.preferred_start_date ?? start);
        setEndDate(request?.preferred_end_date ?? addDaysIso(start, 1));
      })
      .catch((reason: unknown) => { if (!cancelled) { setListingError(true); setListing(null); if (requestId) setRequestError(reason instanceof Error ? reason.message : 'Could not load the request details.'); } });
    return () => { cancelled = true; };
  }, [id, requestId, user?.id, listingRetry, utcDay]);

  useEffect(() => {
    if (!listing) return;
    let cancelled = false;
    setReviewsError(false);
    fetchReviewsForUser(listing.owner.id)
      .then(({ reviews, rating, reviewCount, missedDecisionCount }) => {
        if (cancelled) return;
        setListing((prev) => (prev ? {
          ...prev,
          reviews,
          rating,
          reviewCount,
          owner: { ...prev.owner, rating, rentals: reviewCount, missedAuctionDecisionCount: missedDecisionCount },
        } : prev));
      })
      .catch(() => { if (!cancelled) setReviewsError(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, listing?.owner.id, reviewsRetry]);

  useEffect(() => {
    if (!user || !listing) { setLiked(false); setFavoriteError(false); return; }
    let cancelled = false;
    setFavoriteError(false);
    fetchFavoriteListingIds(user.id)
      .then((ids) => { if (!cancelled) setLiked(ids.has(listing.id)); })
      .catch(() => { if (!cancelled) setFavoriteError(true); });
    return () => { cancelled = true; };
  }, [user, listing?.id, favoriteRetry]);

  useEffect(() => {
    if (!listing) return;
    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError(false);
    fetchUnavailableDates(listing.id, quantity)
      .then(({ blocked, booked }) => {
        if (cancelled) return;
        setBlockedDates(blocked);
        setBookedDates(booked);
      })
      .catch(() => { if (!cancelled) setAvailabilityError(true); })
      .finally(() => { if (!cancelled) setAvailabilityLoading(false); });
    return () => { cancelled = true; };
  }, [listing?.id, availabilityRetry, quantity]);

  // "Similar rentals" is a real query against the same category, minus this listing.
  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    setSimilarError(false);
    searchListings({ categoryId, sortBy: 'recommended', pageSize: 5 })
      .then((result) => enrichListingsWithRatings(result.rows.map(toUiListing)))
      .then((rows) => { if (!cancelled) setSimilar(rows.filter((l) => l.id !== id).slice(0, 4)); })
      .catch(() => { if (!cancelled) setSimilarError(true); });
    return () => { cancelled = true; };
  }, [categoryId, id, similarRetry, utcDay]);

  async function handleToggleFavorite() {
    if (!user) { openSignIn(); return; }
    if (!listing) return;
    const next = !liked;
    setLiked(next);
    setFavoriteError(false);
    try {
      if (next) await addFavorite(user.id, listing.id); else await removeFavorite(user.id, listing.id);
    } catch {
      setLiked(!next);
      setFavoriteError(true);
    }
  }

  async function handleShare() {
    setShareError(false);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      setShareError(true);
    }
  }

  if (listing === undefined) return <ListingDetailSkeleton />;

  if (listingError) return <div className="max-w-xl mx-auto px-4 py-16">
    <Alert tone="error" title="Couldn't load this listing">
      <p>{requestError ?? 'Please try again. No booking has been created.'}</p>
      <Button variant="secondary" className="mt-3" onClick={() => setListingRetry(attempt => attempt + 1)}>Retry listing</Button>
    </Alert>
  </div>;

  if (!listing) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-main font-display">This listing is no longer available</h1>
        <p className="text-sec text-sm mt-2">It may have been removed by the owner.</p>
        <Button className="mt-6" onClick={() => navigate({ name: 'search' })}>Browse other items</Button>
      </div>
    );
  }

  const currentPricing = pricing?.key === pricingKey ? pricing : null;
  const rentalPricing = currentPricing?.quotes?.find(quote => quote.days === days);
  const isOwner = listing.owner.id === user?.id;
  const deliveryMinimum = listing.deliveryFee == null ? null : listing.deliveryGuaranteedWindows?.length
    ? Math.min(listing.deliveryFee, 2 * listing.deliveryFee - (listing.deliveryRoundTripDiscount ?? 0))
    : listing.deliveryFee;
  const deliveryFee = deliveryMode === 'delivery' && listing.deliveryAvailable ? deliveryMinimum : 0;
  const total = rentalPricing
    ? rentalPricing.rental_subtotal + (rentalPricing.renter_service_fee_amount ?? 0)
      + (rentalPricing.tax_amount ?? 0) + (deliveryFee ?? 0)
    : null;
  const firstAllowedDate = addDaysIso(today, sameDayBookings.enabled ? 0 : 1);
  const minimumBookingDate = listing.availabilityStart && listing.availabilityStart > firstAllowedDate
    ? listing.availabilityStart : firstAllowedDate;
  const datesValid = Boolean(startDate && endDate && startDate >= minimumBookingDate && endDate > startDate && days <= MAX_BOOKING_RANGE_DAYS
    && (!listing.availabilityStart || startDate >= listing.availabilityStart)
    && (!listing.availabilityEnd || endDate <= listing.availabilityEnd));
  const rangeUnavailable = (() => {
    for (let iso = startDate; iso && iso < endDate; iso = addDaysIso(iso, 1)) {
      if (bookedDates.has(iso) || blockedDates.has(iso)) return true;
    }
    return false;
  })();
  const nextAvailableRange = (() => {
    if (!rangeUnavailable || !datesValid || availabilityLoading || availabilityError || !listing.availabilityEnd) return null;
    const lastStart = addDaysIso(listing.availabilityEnd, -days);
    for (let candidate = addDaysIso(startDate, 1); candidate <= lastStart; candidate = addDaysIso(candidate, 1)) {
      if (candidate < minimumBookingDate) continue;
      const unavailable = Array.from({ length: days }, (_, index) => addDaysIso(candidate, index))
        .some((date) => bookedDates.has(date) || blockedDates.has(date));
      if (!unavailable) return { start: candidate, end: addDaysIso(candidate, days) };
    }
    return null;
  })();
  const canBook = !isOwner && listing.available && quantity <= Math.min(listing.availableQuantity ?? 1, 100) && datesValid && !rangeUnavailable && !availabilityLoading && !availabilityError
    && !sameDayBookings.loading && !sameDayBookings.error && Boolean(rentalPricing);
  const handleMessageOwner = async () => {
    if (!user) { openSignIn(); return; }
    setMessageError(null);
    try {
      const conversationId = await getOrCreateConversation({
        currentUserId: user.id,
        otherUserId: listing.owner.id,
        listingId: listing.id,
      });
      navigate({ name: 'conversation', id: conversationId });
    } catch (reason) {
      setMessageError(reason instanceof Error ? reason.message : 'Could not open a conversation.');
    }
  };

  const goToCheckout = () => {
    if (canBook) navigate({ name: 'checkout', id: listing.id, startDate, endDate, quantity, deliveryMode });
  };

  const bookingPanel = (
    <Surface id="listing-booking" className="listing-booking-panel p-5 sm:p-6">
      <div className="flex items-end justify-between gap-3">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[32px] leading-none font-extrabold text-main font-display tnum">${listing.pricePerDay}</span>
          <span className="text-sec text-sm font-medium">per day</span>
        </p>
        {isOwner && <span className="text-xs text-sec">Your listing · view only</span>}
      </div>

      <div id="listing-availability" className="mt-5 scroll-mt-24">
        <p className="block text-[13px] font-semibold text-main mb-1.5">{isOwner ? 'Listing availability' : 'Rental dates'}</p>
        {isOwner ? <p className="text-sm text-sec">
          {listing.availabilityStart && listing.availabilityEnd
            ? `${formatDateShort(listing.availabilityStart)} – ${formatDateShort(listing.availabilityEnd)} (return by)`
            : 'No fixed availability window'}
        </p> : <DateRangePicker
          presentation="listing"
          compactTrigger
          startDate={startDate}
          endDate={endDate}
          bookedDates={bookedDates}
          blockedDates={blockedDates}
          minimumDate={minimumBookingDate}
          timeZone={listing.pickupTimeZone}
          maximumDate={listing.availabilityEnd}
          onChange={(nextStart, nextEnd) => { setStartDate(nextStart); setEndDate(nextEnd); }}
        />}
        {sameDayBookings.error && <Alert tone="error" className="mt-3" title="Could not verify booking-date settings">
          <p>{sameDayBookings.error}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={sameDayBookings.reload}>Try again</Button>
        </Alert>}
      </div>

      {availabilityLoading && <p className="mt-3 text-sm text-sec" role="status">Checking date availability…</p>}
      {availabilityError && (
        <Alert tone="error" className="mt-3">
          <p>We couldn't check availability. Please try again.</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAvailabilityRetry((attempt) => attempt + 1)}>Try again</Button>
        </Alert>
      )}
      {!isOwner && !datesValid && (
        <Alert tone="warning" className="mt-3">Choose future rental dates with a return after pickup, up to {MAX_BOOKING_RANGE_DAYS} days.</Alert>
      )}
      {!datesValid && listing.availabilityStart && listing.availabilityEnd && <p className="text-xs text-sec mt-3">Available {formatDateShort(listing.availabilityStart)} through {formatDateShort(addDaysIso(listing.availabilityEnd, -1))}. Return by {formatDateShort(listing.availabilityEnd)}.</p>}
      {!listing.available && <Alert tone="warning" className="mt-3">{listing.availabilityExpired ? 'This listing has expired. The owner must update availability before it can be booked again.' : 'This listing is not currently available for booking.'}</Alert>}
      {!isOwner && datesValid && rangeUnavailable && (
        <Alert tone="warning" className="mt-3">
          <p>Those dates aren't available for the selected quantity. Choose another range or fewer units.</p>
          {nextAvailableRange && <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs">Next available for {days} {days === 1 ? 'day' : 'days'}: {formatDateShort(nextAvailableRange.start)} – {formatDateShort(nextAvailableRange.end)}.</p>
            <Button size="sm" variant="secondary" onClick={() => { setStartDate(nextAvailableRange.start); setEndDate(nextAvailableRange.end); }}>Use suggested dates</Button>
          </div>}
        </Alert>
      )}

      {!isOwner && ((listing.availableQuantity ?? 1) > 1 || quantity > 1) ? (
        <div className="mt-4">
          <label htmlFor="listing-quantity" className="block text-xs font-semibold text-sec">Quantity</label>
          <select id="listing-quantity" name="quantity" value={quantity}
            onChange={(event) => {
              setAvailabilityLoading(true);
              setQuantity(Number(event.target.value));
            }}
            className="listing-quantity-select mt-1 min-h-12 w-full rounded-card border border-app bg-card px-3 text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {Array.from({ length: Math.min(listing.availableQuantity ?? 1, 100) }, (_, index) => index + 1).map(value =>
              <option key={value} value={value}>{value} {value === 1 ? 'unit' : 'units'}</option>)}
            {quantity > Math.min(listing.availableQuantity ?? 1, 100) && <option value={quantity} disabled>{quantity} units requested</option>}
          </select>
          <p className="mt-1 text-xs text-sec">{listing.availableQuantity ?? 1} {(listing.availableQuantity ?? 1) === 1 ? 'unit' : 'units'} listed. Availability depends on your dates.</p>
          {quantity > Math.min(listing.availableQuantity ?? 1, 100) && <p className="mt-1 text-xs text-sec">Choose no more than 100 units or the number of units listed, whichever is less.</p>}
        </div>
      ) : <div className="mt-4 flex items-center justify-between text-xs text-sec">
        <span>Quantity</span><strong className="text-main">{quantity} {quantity === 1 ? 'unit' : 'units'}</strong>
      </div>}
      <fieldset className="mt-4">
        <legend className="text-xs font-semibold text-sec">How you'll get it</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className={`listing-handoff-option ${deliveryMode === 'pickup' ? 'is-selected' : ''}`}>
            <input type="radio" name="listing-delivery-mode" checked={deliveryMode === 'pickup'} onChange={() => setDeliveryMode('pickup')} />
            <span><strong>Pickup</strong><small>{listing.pickup || 'Local pickup'}</small><strong>Free</strong></span>
          </label>
          <label className={`listing-handoff-option ${deliveryMode === 'delivery' ? 'is-selected' : ''} ${!listing.deliveryAvailable ? 'is-unavailable' : ''}`}>
            <input type="radio" name="listing-delivery-mode" checked={deliveryMode === 'delivery'} disabled={!listing.deliveryAvailable} onChange={() => setDeliveryMode('delivery')} />
            <span><strong>Delivery</strong><small>{!listing.deliveryAvailable ? 'Not available'
              : listing.deliverySetupAvailable && listing.deliveryGuaranteedWindows?.length ? 'Setup help available' : 'Arrange with owner'}</small>
              {listing.deliveryAvailable && <strong>{deliveryMinimum == null ? 'Fee confirmed at checkout'
                : `${listing.deliveryGuaranteedWindows?.length ? 'From ' : ''}$${formatMoney(deliveryMinimum)}`}</strong>}
            </span>
          </label>
        </div>
      </fieldset>
      {datesValid && <div className="listing-rental-estimate mt-4 space-y-2 text-sm" aria-label="Price breakdown">
        <h2 className="sr-only">{isOwner ? 'Rental price preview' : 'Your rental summary'}</h2>
        {!currentPricing && quantity <= 100 && <p role="status" className="text-sec">Checking the current price…</p>}
        {currentPricing?.error && <Alert tone="error" title="Could not verify the price estimate">
          {currentPricing.error}<Button size="sm" variant="secondary" className="mt-2" onClick={() => { setPricing(null); setPricingRetry(value => value + 1); }}>Retry price</Button>
        </Alert>}
        {rentalPricing && total != null && <>
        {rentalPricing.package_kind ? <>
          <PriceRow label={`${rentalPricing.package_kind === 'monthly' ? 'Monthly' : 'Weekly'} package · ${rentalPricing.package_days} days · ${quantity} units`} value={rentalPricing.package_amount} />
          {rentalPricing.discount_amount > 0 && <PriceRow label="Package savings" value={-rentalPricing.discount_amount} />}
          {rentalPricing.extra_days > 0 && <PriceRow label={`${rentalPricing.extra_days} extra days at the daily rate`} value={rentalPricing.extra_days_amount} />}
        </> : <PriceRow label={`Rental · $${formatMoney(listing.pricePerDay)} × ${days} ${days === 1 ? 'day' : 'days'} × ${quantity} ${quantity === 1 ? 'unit' : 'units'}`} value={rentalPricing.rental_subtotal} />}
        <PriceRow label="Service fee" value={rentalPricing.renter_service_fee_amount ?? 0} />
        {deliveryMode === 'delivery' && <div className="flex justify-between gap-3 text-sec">
          <span>Delivery{listing.deliveryGuaranteedWindows?.length ? ' · from' : ''}</span><span className="font-medium text-main">{deliveryFee == null ? 'Confirmed at checkout' : `$${formatMoney(deliveryFee)}`}</span>
        </div>}
        <PriceRow label={rentalPricing.tax_rate == null ? 'Estimated tax' : `Estimated tax · ${new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 4 }).format(Number(rentalPricing.tax_rate))}`} value={rentalPricing.tax_amount ?? 0} />
        <div className="border-t border-app pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-bold text-main">Estimated total</p>
            <strong className="text-2xl text-accent tnum">${formatMoney(total)}</strong>
          </div>
          <p className="mt-2 text-xs text-sec">{deliveryMode === 'delivery' && listing.deliveryGuaranteedWindows?.length
            ? 'Delivery type, address and extras are chosen on the next page.'
            : deliveryMode === 'delivery' && deliveryFee == null
              ? 'Delivery fee confirmed at checkout.' : 'Final price is confirmed at checkout.'}</p>
        </div>
        </>}
      </div>}
      <div className="mt-4 flex gap-2 text-xs text-sec">
        <Lock size={15} className="shrink-0 text-accent mt-0.5" aria-hidden="true" />
        <div>
          <p>{listing.deposit > 0 ? `$${formatMoney(listing.deposit)} separate security hold. Not placed yet.` : 'No security deposit is required for this item.'}</p>
        </div>
      </div>
      {!isOwner && <><Button fullWidth size="lg" className="mt-4" disabled={!canBook} onClick={goToCheckout}>
        {listing.instantBooking ? 'Book instantly' : 'Request to book'}
      </Button>
      <p className="text-xs text-sec text-center mt-3">
        {listing.instantBooking ? 'No reservation or charge yet. Review on the next page.' : 'Review your request on the next page. No charge until the owner approves.'}
      </p></>}
      {listing.auctionEnabled && biddingEnabled && (isOwner
        ? <button type="button" onClick={() => navigate({ name: 'bidding' })} className="flex justify-center items-center min-h-11 text-sm font-semibold text-accent mt-2">Manage competitive bidding <ChevronRight size={15} aria-hidden="true" /></button>
        : <a href={`/bidding/${listing.id}`} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          navigate({ name: 'bidding-detail', id: listing.id });
        }} className="flex justify-center items-center min-h-11 text-sm font-semibold text-accent mt-2">View bidding details <ChevronRight size={15} aria-hidden="true" /></a>)}
    </Surface>
  );

  return (
    <div className="listing-detail animate-fade-in">

      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-sec mb-5">
          <a href="/" className="hover:text-accent">Home</a><ChevronRight size={12} aria-hidden="true" />
          <a href={categoryId ? `/search?category=${encodeURIComponent(categoryId)}` : '/search'} className="text-accent font-medium">{listing.category || 'Rentals'}</a>
          <ChevronRight size={12} aria-hidden="true" /><span aria-current="page" className="truncate max-w-60">{listing.title}</span>
        </nav>
        <div className="listing-detail-grid">
        <div className="listing-heading min-w-0">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] sm:text-[32px] leading-tight font-extrabold text-main font-display mt-1">
              {listing.title}
            </h1>
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mt-2.5 text-sm">
              <span className="inline-flex items-center gap-1.5"><Rating value={listing.rating} count={listing.reviewCount} size="md" />{listing.reviewCount > 0 && <span className="text-sec">owner reviews</span>}</span>
              {listing.pickup && (
                <span className="flex items-center gap-1 text-sec"><MapPin size={14} />{listing.pickup}</span>
              )}
              {listing.verifiedOwner && <VerifiedBadge />}
            </div>
            {shareError && <Alert tone="warning" className="mb-4">Couldn't copy the link. You can copy the address from your browser.</Alert>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isOwner && <button type="button" className="listing-text-action" aria-label={liked ? 'Remove from favorites' : 'Save to favorites'} onClick={() => void handleToggleFavorite()}>
              <Heart size={17} aria-hidden="true" className={liked ? 'fill-favorite text-favorite' : 'text-sec'} />{liked ? 'Saved' : 'Save'}
            </button>}
            <button type="button" className="listing-text-action" aria-label={shared ? 'Link copied' : 'Copy link'} onClick={() => void handleShare()}>
              {shared ? <CheckCircle2 size={17} aria-hidden="true" className="text-success" /> : <Share2 size={17} aria-hidden="true" className="text-sec" />}{shared ? 'Copied!' : 'Share'}
            </button>
          </div>
        </div>
        {favoriteError && (
          <Alert tone="warning" className="mb-4">
            <p>We couldn't confirm whether this item is saved.</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setFavoriteRetry((attempt) => attempt + 1)}>Check again</Button>
          </Alert>
        )}
        </div>
          {/* Left: gallery + detail */}
          <div className="listing-gallery min-w-0">
            <ImageGallery images={listing.images} title={listing.title} />
          </div>
          {listing.description && <section id="listing-overview" className="listing-highlights min-w-0 scroll-mt-24">
            <h2 className="text-xl font-bold text-main font-display">About this item</h2>
            <p className="mt-3 text-sm text-sec leading-relaxed whitespace-pre-line">{listing.description}</p>
          </section>}
          <aside className="listing-booking min-w-0" aria-label="Book this item">
            <div className="listing-booking-sticky">{bookingPanel}</div>
          </aside>
          <div className="listing-details min-w-0 space-y-7">
            {listing.auctionEnabled && biddingFlagError && <Alert tone="error" title="Could not check competitive bidding">{biddingFlagError} Retrying automatically.</Alert>}
            <div className="listing-trust-strip flex flex-wrap gap-x-5 gap-y-2 text-xs text-sec">
              <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-accent" aria-hidden="true" />{listing.instantBooking ? 'Instant booking' : 'Owner approval required'}</span>
              {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && (
                <span className="inline-flex items-center px-3 py-2 rounded-card bg-accent-soft"><ProtectionBadge size="md" /></span>
              )}
            </div>

            <nav aria-label="Listing sections" className="listing-section-nav">
              {listing.description && <a href="#listing-overview">Overview</a>}
              <a href="#listing-specifications">Specifications</a>
              <a href="#listing-availability">Availability</a>
              <a href="#listing-reviews">Reviews{listing.reviewCount > 0 ? ` (${listing.reviewCount})` : ''}</a>
              {similar.length > 0 && <a href="#listing-similar">Similar items</a>}
            </nav>
            <div id="listing-specifications" className="scroll-mt-24 space-y-6">
            {(listing.brand || listing.model || listing.additionalDetails) && <Block title="Specifications">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {listing.brand && <div><dt className="text-sec">Brand</dt><dd className="mt-1 font-semibold text-main break-words">{listing.brand}</dd></div>}
                {listing.model && <div><dt className="text-sec">Model</dt><dd className="mt-1 font-semibold text-main break-words">{listing.model}</dd></div>}
              </dl>
              {listing.additionalDetails && <p className="mt-4 text-sm text-sec whitespace-pre-line">{listing.additionalDetails}</p>}
            </Block>}

            {listing.whatsIncluded.length > 0 && (
              <Block title="What's included">
                <ul className="grid sm:grid-cols-2 gap-2.5">
                  {listing.whatsIncluded.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-sec">
                      <CheckCircle2 size={16} className="text-success shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {(listing.condition || listing.declaredValue > 0) && (
              <Block title="Condition">
                <div className="flex items-center gap-3">
                  {listing.condition && <Badge tone="neutral">{listing.condition}</Badge>}
                  <span className="text-sm text-sec">{listing.damageHistory}</span>
                </div>
                {listing.declaredValue > 0 && <p className="text-sm text-sec mt-2">Owner-declared replacement value: ${listing.declaredValue.toLocaleString()}. Not independently verified. The deposit is not a guarantee of full recovery.</p>}
              </Block>
            )}

            {SHOW_OUT_OF_SCOPE_PAGES && (
              <Block
                title="Item passport"
                action={
                  <button
                    onClick={() => navigate({ name: 'item-passport', id: listing.id })}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-accent"
                  >
                    View full passport <ChevronRight size={15} />
                  </button>
                }
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <PassportField label="Asset ID" value={listing.assetId} />
                  <PassportField label="Declared value" value={`$${listing.declaredValue.toLocaleString()}`} />
                  <PassportField label="Serial" value={listing.serialPartial} />
                  {listing.ownershipVerified && <PassportField label="Ownership" value="Verified" />}
                  <PassportField label="Rental history" value={`${listing.rentalHistory} completed`} />
                  <PassportField label="Components" value={`${listing.components.filter((c) => c.present).length} / ${listing.components.length}`} />
                </div>
              </Block>
            )}
            </div>

            {/* Owner trust profile */}
            <Block title="Meet the owner">
              <div className="listing-owner-card">
                <div className="flex items-center gap-4">
                  {ownerAvatarFailed
                    ? <span className="w-12 h-12 rounded-full bg-accent-soft text-accent grid place-items-center font-bold shrink-0" aria-hidden="true">{listing.owner.name.trim().slice(0, 1).toUpperCase()}</span>
                    : <img src={listing.owner.avatar} alt="" onError={() => setOwnerAvatarFailed(true)} className="w-12 h-12 rounded-full object-cover shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-main text-lg font-display">{listing.owner.name}</h3>
                      {listing.owner.verified && <VerifiedBadge label="Identity verified" size="xs" />}
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <Rating value={listing.owner.rating} count={listing.owner.rentals} size="sm" />
                    </div>
                  </div>
                </div>
                {!isOwner && <Button
                  variant="secondary"
                  className="mt-4"
                  icon={<MessageSquare size={16} />}
                  onClick={() => void handleMessageOwner()}
                >
                  Message {listing.owner.name.split(' ')[0]}
                </Button>}
                {messageError && <Alert tone="error" className="mt-3">{messageError}</Alert>}
              </div>
            </Block>

            {listing.delivery && (
              <Block title="Delivery details">
                <ul className="space-y-2.5 text-sm text-sec">
                  <li className="flex items-start gap-2.5"><Truck size={16} className="shrink-0 mt-0.5" />{listing.delivery}</li>
                </ul>
              </Block>
            )}

            {listing.cancellation && (
              <Block title="Cancellation"><p className="text-sm text-sec">{listing.cancellation}</p></Block>
            )}

            <div id="listing-reviews" className="scroll-mt-24">
            <Block title={listing.reviewCount > 0 ? `Reviews (${listing.reviewCount})` : 'Reviews'}>
              {reviewsError ? (
                <Alert tone="warning">
                  <p>Reviews couldn't be loaded. The listing is still available.</p>
                  <Button size="sm" variant="secondary" className="mt-2" onClick={() => setReviewsRetry((attempt) => attempt + 1)}>Try again</Button>
                </Alert>
              ) : listing.reviews.length === 0 ? (
                <p className="text-sm text-sec">
                  No reviews for this owner yet. Reviews appear here once a rental is completed.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {listing.reviews.map((review) => (
                    <Surface key={review.id} className="p-4">
                      <div className="flex items-center gap-3">
                        <img src={review.avatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-main truncate">{review.author}</p>
                          <p className="text-xs text-muted">{review.date}</p>
                        </div>
                        <div className="ml-auto flex items-center gap-0.5 shrink-0">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} size={12} className={i < review.rating ? 'fill-[var(--star)] text-[var(--star)]' : 'text-[var(--border-strong)]'} />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-sec mt-3 leading-relaxed">{review.text}</p>
                    </Surface>
                  ))}
                </div>
              )}
            </Block>
            </div>

          </div>

        </div>

        {similarError && <Alert tone="warning" className="mt-8">Similar rentals couldn't be loaded. <Button size="sm" variant="secondary" onClick={() => setSimilarRetry(attempt => attempt + 1)}>Retry similar rentals</Button></Alert>}
        {!similarError && similar.length > 0 && (
          <div id="listing-similar" className="mt-12 scroll-mt-24">
            <SectionHeader
              title="Similar rentals"
              subtitle={listing.category ? `More in ${listing.category}` : undefined}
              actionLabel="See all"
              onAction={() => navigate({ name: 'search', category: categoryId ?? undefined })}
              className="mb-5"
            />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {similar.map((item) => (
                <ListingCard key={item.id} listing={item} onClick={() => navigate({ name: 'listing', id: item.id })} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mobile sticky booking bar - price stays visible while reading the page. */}
      {!isOwner && <div className="listing-booking-bar lg:hidden fixed bottom-[calc(4rem_+_env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-30 bg-card border-t border-app px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="flex items-baseline gap-1">
              <span className="text-lg font-bold text-main tnum">{datesValid ? (total == null ? '—' : `$${formatMoney(total)}`) : `$${formatMoney(listing.pricePerDay)}`}</span>
              <span className="text-xs text-sec">{datesValid ? (deliveryMode === 'delivery' && deliveryFee == null ? 'est. excl. delivery' : 'est. total') : '/day'}</span>
            </p>
            <p className="text-xs text-sec tnum truncate">{datesValid ? `${formatDateShort(startDate)} - ${formatDateShort(endDate)}` : 'Choose rental dates'}</p>
          </div>
          <a className="inline-flex items-center justify-center min-h-11 px-5 rounded-card bg-accent text-accent-text font-semibold text-sm shrink-0" href="#listing-booking">Review booking</a>
        </div>
      </div>}
    </div>
  );
}

function Block({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <h2 className="text-lg sm:text-xl font-bold text-main font-display">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PassportField({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-card bg-subtle">
      <p className="text-xs text-muted font-medium">{label}</p>
      <p className="text-sm font-semibold text-main mt-0.5">{value}</p>
    </div>
  );
}

function PriceRow({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  const isCredit = value < 0;
  return (
    <div className={`flex justify-between gap-3 ${isCredit ? 'text-success' : 'text-sec'}`}>
      <span>{label}</span>
      <span className={`shrink-0 font-semibold tnum ${isCredit ? 'text-success' : muted ? 'text-sec' : 'text-main'}`}>{isCredit ? '-' : ''}${formatMoney(Math.abs(value))}</span>
    </div>
  );
}
