import { useEffect, useState } from 'react';
import { ListingCard } from '@/components/listing-card';
import { MarketplaceGallery } from '@/components/marketplace-gallery';
import { Rating, VerifiedBadge, ProtectionBadge } from '@/components/trust';
import { Button, Badge, Alert, SectionHeader, Surface } from '@/components/ui';
import { useRouter } from '@/router';
import type { Listing } from '@/data';
import { fetchListingById, toUiListing, searchListings, enrichListingsWithRatings, type DbListingRow } from '@/lib/listings';
import { getOrCreateConversation } from '@/lib/messages';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { fetchReviewsForUser } from '@/lib/reviews';
import { fetchUnavailableDates } from '@/lib/availability';
import { DateRangePicker } from '@/components/date-range-picker';
import { useAuth } from '@/auth-context';
import { usePlatformFeePct } from '@/lib/settings';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { MAX_BOOKING_RANGE_DAYS, addDaysIso, todayIso } from '@/lib/geo';
import { pickupToday } from '@/lib/pickup-timezone';
import { ListingDetailSkeleton } from '@/components/skeleton';
import { InsuranceAmount } from '@/components/insurance-amount';
import { insuranceAmountCents } from '@/lib/insurance-pricing';
import { bookingTaxCents } from '@/lib/booking-tax';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { calculateRentalPricing } from '@/lib/rental-pricing';
import { savedSearchState, saveSearchState } from '@/lib/search-state';
import { listingAvailabilityError } from '@/lib/listing-availability';
import './marketplace.css';
import {
  MapPin, CheckCircle2, Truck,
  Lock, Star, MessageSquare, Heart, Share2, ChevronRight, ShieldCheck,
} from 'lucide-react';

const tomorrowIso = () => addDaysIso(todayIso(), 1);

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateShort(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ListingPage({ id }: { id: string }) {
  const { navigate } = useRouter();
  const { user, openSignIn } = useAuth();
  const feePct = usePlatformFeePct();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [listingError, setListingError] = useState(false);
  const [listingRetry, setListingRetry] = useState(0);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Listing[]>([]);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(tomorrowIso());
  const [liked, setLiked] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteBusyIds, setFavoriteBusyIds] = useState<Set<string>>(new Set());
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
  const { enabled: biddingEnabled, error: biddingFlagError } = useFeatureFlag('bidding');
  const durationDiscounts = useFeatureFlag('duration_discounts');
  const loadedListingId = listing?.id;

  useEffect(() => {
    let cancelled = false;
    setListing(undefined);
    setListingError(false);
    setSimilar([]);
    setCategoryId(null);
    setOwnerAvatarFailed(false);
    setMessageError(null);
    setShareError(false);
    fetchListingById(id)
      .then((row: DbListingRow | null) => {
        if (cancelled) return;
        setListing(row ? toUiListing(row) : null);
        setCategoryId(row?.category_id ?? null);
        const today = row?.pickup_time_zone ? pickupToday(row.pickup_time_zone) : todayIso();
        const start = row?.availability_start && row.availability_start > today ? row.availability_start : today;
        const saved = savedSearchState();
        const keepDates = !listingAvailabilityError(saved.start, saved.end, today) && saved.start >= start
          && (!row?.availability_end || saved.end <= row.availability_end);
        setStartDate(keepDates ? saved.start : start);
        setEndDate(keepDates ? saved.end : addDaysIso(start, 1));
      })
      .catch(() => { if (!cancelled) { setListingError(true); setListing(null); } });
    return () => { cancelled = true; };
  }, [id, listingRetry]);

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
    if (!user || !loadedListingId) { setLiked(false); setFavoriteIds(new Set()); setFavoritesLoading(false); setFavoriteError(false); return; }
    let cancelled = false;
    setFavoritesLoading(true);
    setFavoriteError(false);
    fetchFavoriteListingIds(user.id)
      .then((ids) => { if (!cancelled) { setLiked(ids.has(loadedListingId)); setFavoriteIds(ids); } })
      .catch(() => { if (!cancelled) setFavoriteError(true); })
      .finally(() => { if (!cancelled) setFavoritesLoading(false); });
    return () => { cancelled = true; };
  }, [user, loadedListingId, favoriteRetry]);

  useEffect(() => {
    if (!loadedListingId) return;
    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError(false);
    fetchUnavailableDates(loadedListingId)
      .then(({ blocked, booked }) => {
        if (cancelled) return;
        setBlockedDates(blocked);
        setBookedDates(booked);
      })
      .catch(() => { if (!cancelled) setAvailabilityError(true); })
      .finally(() => { if (!cancelled) setAvailabilityLoading(false); });
    return () => { cancelled = true; };
  }, [loadedListingId, availabilityRetry]);

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
  }, [categoryId, id, similarRetry]);

  async function handleToggleFavorite(listingId = listing?.id) {
    if (!user) { openSignIn(); return; }
    if (!listingId || favoritesLoading || favoriteError || favoriteBusyIds.has(listingId)) return;
    const next = !favoriteIds.has(listingId);
    setFavoriteBusyIds(previous => new Set(previous).add(listingId));
    setFavoriteError(false);
    try {
      if (next) await addFavorite(user.id, listingId); else await removeFavorite(user.id, listingId);
      setFavoriteIds(previous => { const ids = new Set(previous); if (next) ids.add(listingId); else ids.delete(listingId); return ids; });
      if (listingId === listing?.id) setLiked(next);
    } catch {
      setFavoriteError(true);
    } finally {
      setFavoriteBusyIds(previous => { const ids = new Set(previous); ids.delete(listingId); return ids; });
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
      <p>Please try again. No booking has been created.</p>
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

  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  const rentalPricing = calculateRentalPricing(listing.pricePerDay, days, {
    weeklyEnabled: durationDiscounts.enabled && listing.weeklyDiscountEnabled,
    weeklyPercent: listing.weeklyDiscountPercent,
    monthlyEnabled: durationDiscounts.enabled && listing.monthlyDiscountEnabled,
    monthlyPercent: listing.monthlyDiscountPercent,
  });
  const grossRental = rentalPricing.gross;
  const durationDiscount = rentalPricing.discountAmount;
  const rental = rentalPricing.subtotal;
  const serviceFee = Math.round(rental * feePct * 100) / 100;
  const insuranceAmount = insuranceAmountCents(listing.declaredValue, days) / 100;
  const tax = bookingTaxCents(rental, serviceFee) / 100;
  const paymentEstimate = rental + serviceFee + insuranceAmount;
  const total = paymentEstimate + tax;
  const today = listing.pickupTimeZone ? pickupToday(listing.pickupTimeZone) : todayIso();
  const datesValid = Boolean(startDate && endDate && startDate >= today && endDate > startDate && days <= MAX_BOOKING_RANGE_DAYS
    && (!listing.availabilityStart || startDate >= listing.availabilityStart)
    && (!listing.availabilityEnd || endDate <= listing.availabilityEnd));
  const rangeUnavailable = (() => {
    for (let iso = startDate; iso && iso < endDate; iso = addDaysIso(iso, 1)) {
      if (bookedDates.has(iso) || blockedDates.has(iso)) return true;
    }
    return false;
  })();
  const isOwner = listing.owner.id === user?.id;
  const canBook = !isOwner && listing.listingStatus === 'published' && listing.available && datesValid && !rangeUnavailable && !availabilityLoading && !availabilityError;
  const rentalOptions = [1, 3, 7, 30].map((optionDays) => {
    const optionPrice = calculateRentalPricing(listing.pricePerDay, optionDays, {
      weeklyEnabled: durationDiscounts.enabled && listing.weeklyDiscountEnabled,
      weeklyPercent: listing.weeklyDiscountPercent,
      monthlyEnabled: durationDiscounts.enabled && listing.monthlyDiscountEnabled,
      monthlyPercent: listing.monthlyDiscountPercent,
    });
    return { days: optionDays, price: optionPrice.subtotal, discount: optionPrice.discountAmount,
      disabled: Boolean(listing.availabilityEnd && addDaysIso(startDate, optionDays) > listing.availabilityEnd)
        || optionDays > MAX_BOOKING_RANGE_DAYS
        || Array.from({ length: optionDays }, (_, index) => addDaysIso(startDate, index)).some(date => bookedDates.has(date) || blockedDates.has(date)) };
  });

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
    if (!canBook) return;
    saveSearchState({ ...savedSearchState(), start: startDate, end: endDate });
    navigate({ name: 'checkout', id: listing.id, startDate, endDate });
  };

  const bookingPanel = (
    <section id="listing-booking" className="p1-booking-panel">
      <div className="flex items-end justify-between gap-3">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[32px] leading-none font-extrabold text-main font-display tnum">${listing.pricePerDay}</span>
          <span className="text-sec text-sm font-medium">per day</span>
        </p>
        <span className="text-xs text-sec">{isOwner ? 'Your listing · view only' : 'Choose your dates'}</span>
      </div>

      <div id="listing-availability" className="mt-5 scroll-mt-24">
        <p className="block text-[13px] font-semibold text-main mb-1.5">{isOwner ? 'Listing availability' : 'Rental dates'}</p>
        {isOwner ? <p className="text-sm text-sec">
          {listing.availabilityStart && listing.availabilityEnd
            ? `${formatDateShort(listing.availabilityStart)} – ${formatDateShort(listing.availabilityEnd)} (return by)`
            : 'No fixed availability window'}
        </p> : <DateRangePicker
          presentation="listing"
          startDate={startDate}
          endDate={endDate}
          bookedDates={bookedDates}
          blockedDates={blockedDates}
          minimumDate={listing.availabilityStart}
          timeZone={listing.pickupTimeZone}
          maximumDate={listing.availabilityEnd}
          onChange={(nextStart, nextEnd) => { setStartDate(nextStart); setEndDate(nextEnd); }}
        />}
      </div>

      {!isOwner && <div className="mt-4" aria-label="Choose rental length">
        <p className="mb-2 text-xs font-semibold text-sec">Rental options</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {rentalOptions.map(option => <button key={option.days} type="button" disabled={option.disabled}
            aria-pressed={days === option.days}
            onClick={() => setEndDate(addDaysIso(startDate, option.days))}
            className={`min-h-[76px] rounded-card border p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${days === option.days ? 'border-accent bg-accent-soft' : 'border-app bg-card hover:border-accent/60'} disabled:cursor-not-allowed disabled:opacity-45`}>
            <span className="block text-xs text-sec">{option.days} {option.days === 1 ? 'day' : 'days'}</span>
            <strong className="mt-1 block text-base text-main tnum">${formatMoney(option.price)}</strong>
            {option.discount > 0 && <span className="block text-[11px] font-semibold text-success">Save ${formatMoney(option.discount)}</span>}
          </button>)}
        </div>
      </div>}

      {availabilityLoading && <p className="mt-3 text-sm text-sec" role="status">Checking date availability…</p>}
      {availabilityError && (
        <Alert tone="error" className="mt-3">
          <p>We couldn't verify date availability. Booking is disabled until it can be checked.</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAvailabilityRetry((attempt) => attempt + 1)}>Try again</Button>
        </Alert>
      )}
      {!isOwner && !datesValid && (
        <Alert tone="warning" className="mt-3">Choose future rental dates with a return after pickup, up to {MAX_BOOKING_RANGE_DAYS} days.</Alert>
      )}
      {listing.availabilityStart && listing.availabilityEnd && <p className="text-xs text-sec mt-3">Available {listing.availabilityStart} through {addDaysIso(listing.availabilityEnd, -1)}. Return by {listing.availabilityEnd}. Your rental must fit within this window.</p>}
      {!listing.available && <Alert tone="warning" className="mt-3">{listing.availabilityExpired ? 'This listing has expired. The owner must update availability before it can be booked again.' : 'This listing is not currently available for booking.'}</Alert>}
      {!isOwner && datesValid && rangeUnavailable && (
        <Alert tone="warning" className="mt-3">Those dates are already taken. Choose another available range.</Alert>
      )}

      {listing.pickup && <div className="mt-5 flex gap-2.5 text-sm">
        <MapPin size={18} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
        <div><p className="font-semibold text-main">{listing.pickup}</p>
          <p className="text-xs text-sec mt-1">Approximate pickup area. Exact address after confirmation.</p></div>
      </div>}

      <div className="mt-4 flex items-center justify-between text-xs text-sec">
        <span>Rental quantity</span><strong className="text-main">1 unit</strong>
      </div>
      {datesValid && <div key={`${days}-${listing.pricePerDay}`} className="listing-rental-estimate mt-4 space-y-3 text-sm animate-cross-fade" aria-label="Price breakdown">
        <div>
          <h2 className="text-sm font-bold text-main">{isOwner ? '1-day price preview' : 'Estimated rental cost'}</h2>
          <p className="text-xs text-sec mt-1">Rental payment only; security hold is separate</p>
        </div>
        {rentalPricing.packageKind ? <>
          <PriceRow label={`${rentalPricing.packageKind === 'monthly' ? 'Monthly' : 'Weekly'} package · ${rentalPricing.packageDays} days`} value={listing.pricePerDay * rentalPricing.packageDays} />
          {durationDiscount > 0 && <PriceRow label={`${rentalPricing.packageKind === 'monthly' ? 'Monthly' : 'Weekly'} savings (${rentalPricing.discountPercent}%)`} value={-durationDiscount} />}
          {rentalPricing.extraDays > 0 && <PriceRow label={`${rentalPricing.extraDays} extra ${rentalPricing.extraDays === 1 ? 'day' : 'days'} × $${formatMoney(listing.pricePerDay)}`} value={listing.pricePerDay * rentalPricing.extraDays} />}
        </> : <PriceRow label={`$${formatMoney(listing.pricePerDay)} × ${days} ${days === 1 ? 'day' : 'days'}`} value={grossRental} />}
        <PriceRow label="Service fee" value={serviceFee} />
        {isOwner
          ? <PriceRow label="Insurance" value={insuranceAmount} />
          : <InsuranceAmount days={days} replacementValue={listing.declaredValue} />}
        <PriceRow label="Tax (7%)" value={tax} />
        <div className="pt-3 border-t border-app flex justify-between gap-3 font-bold text-main">
          <span>Rental and fees</span><span className="tnum">${formatMoney(rental + serviceFee + insuranceAmount)}</span>
        </div>
        <p className="text-xs text-sec leading-relaxed">Tax is 7% of discounted rental and service fees only. Insurance is calculated from the owner-declared item value and included in the total.</p>
      </div>}
      <div className="listing-deposit-box mt-4 flex gap-3">
        <ShieldCheck size={26} className="shrink-0 text-accent mt-0.5" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-bold text-main">Separate security hold at check-in</h2>
          <p className="mt-1 font-bold text-accent tnum">${formatMoney(listing.deposit)}</p>
          <p className="text-xs text-sec mt-2 leading-relaxed">{listing.deposit > 0 ? 'Not included in rental payment. Authorize the temporary hold within 24 hours before an owner-approved pickup or delivery slot.' : 'No security deposit is required for this item.'}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-between gap-3 text-sm text-sec">
        <span>Security hold</span><span>No card hold placed</span>
      </div>
      {datesValid && <div className="mt-4 flex justify-between gap-3 text-sm font-bold text-main">
        <span>Estimated total</span><span className="tnum">${formatMoney(total)}</span>
      </div>}
      <p className="text-xs text-sec mt-2">Includes rental, service fee, insurance and estimated tax only. Review the backend-confirmed total before paying.</p>
      {!isOwner && <><Button fullWidth size="lg" className="mt-5" disabled={!canBook} onClick={goToCheckout}>
        {listing.instantBooking ? 'Book instantly' : 'Request to book'}
      </Button>
      <p className="text-xs text-sec text-center mt-3 flex items-center justify-center gap-1.5">
        <Lock size={13} aria-hidden="true" /> {listing.instantBooking ? 'Dates reserve now; payment confirms the rental.' : 'No charge until the owner approves.'}
      </p></>}
      {listing.auctionEnabled && biddingEnabled && (isOwner
        ? <button type="button" onClick={() => navigate({ name: 'bidding' })} className="flex justify-center items-center min-h-11 text-sm font-semibold text-accent mt-2">Manage competitive bidding <ChevronRight size={15} aria-hidden="true" /></button>
        : <a href={`/bidding/${listing.id}`} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          navigate({ name: 'bidding-detail', id: listing.id });
        }} className="flex justify-center items-center min-h-11 text-sm font-semibold text-accent mt-2">View auction in Bidding <ChevronRight size={15} aria-hidden="true" /></a>)}
    </section>
  );

  return (
    <div className="listing-detail marketplace-listing">

      <div className="p1-container p1-page p1-details">
        <nav aria-label="Breadcrumb" className="p1-breadcrumb">
          <a href="/" className="hover:text-accent">Home</a><ChevronRight size={12} aria-hidden="true" />
          <a href={categoryId ? `/search?category=${encodeURIComponent(categoryId)}` : '/search'} className="text-accent font-medium">{listing.category || 'Rentals'}</a>
          <ChevronRight size={12} aria-hidden="true" /><span aria-current="page" className="truncate max-w-60">{listing.title}</span>
        </nav>
        <MarketplaceGallery images={listing.images} title={listing.title} />
        <div className="p1-detail-layout">
        <div className="p1-detail-content min-w-0">
        <div className="listing-heading min-w-0">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <h1>
              {listing.title}
            </h1>
            <div className="p1-detail-meta">
              <span className="inline-flex items-center gap-1.5"><Rating value={listing.rating} count={listing.reviewCount} size="md" />{listing.reviewCount > 0 && <span className="text-sec">owner reviews</span>}</span>
              {listing.pickup && (
                <span className="flex items-center gap-1 text-sec"><MapPin size={14} />{listing.pickup}</span>
              )}
            </div>
            {shareError && <Alert tone="warning" className="mb-4">Couldn't copy the link. You can copy the address from your browser.</Alert>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isOwner && <button type="button" className="listing-text-action" disabled={!!user && (favoritesLoading || favoriteError || favoriteBusyIds.has(listing.id))}
              aria-busy={favoriteBusyIds.has(listing.id)} aria-label={liked ? 'Remove from favorites' : 'Save to favorites'} onClick={() => void handleToggleFavorite()}>
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
          <div className="listing-details min-w-0">
            <section className="p1-detail-owner" aria-label="Rental owner">
              {ownerAvatarFailed || !listing.owner.avatar
                ? <span className="w-12 h-12 rounded-full bg-accent-soft text-accent grid place-items-center font-bold shrink-0" aria-hidden="true">{listing.owner.name.trim().slice(0, 1).toUpperCase()}</span>
                : <img src={listing.owner.avatar} alt="" onError={() => setOwnerAvatarFailed(true)} className="w-12 h-12 rounded-full object-cover shrink-0" />}
              <div><p className="text-sm text-sec">Rent from</p><p className="flex items-center gap-2 font-semibold text-main">{listing.owner.name}
                {listing.verifiedOwner && <VerifiedBadge />}</p><p className="text-xs text-sec mt-1">{listing.reviewCount ? `${listing.reviewCount} owner reviews` : 'No owner reviews yet'}</p></div>
              {!isOwner && <Button variant="secondary" icon={<MessageSquare size={16} aria-hidden="true" />} onClick={() => void handleMessageOwner()}>Message owner</Button>}
              {isOwner && <Button variant="secondary" onClick={() => navigate({ name: 'edit-listing', id: listing.id })}>Edit your listing</Button>}
              {messageError && <Alert tone="error" className="w-full">{messageError}</Alert>}
            </section>
            {listing.auctionEnabled && biddingFlagError && <Alert tone="error" title="Could not check competitive bidding">{biddingFlagError} Retrying automatically.</Alert>}
            <div className="listing-trust-strip flex flex-wrap gap-x-5 gap-y-2 text-xs text-sec">
              <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-accent" aria-hidden="true" />{listing.instantBooking ? 'Instant booking rules apply' : 'Owner approval required'}</span>
              <span className="inline-flex items-center gap-2"><Lock size={16} className="text-accent" aria-hidden="true" />{listing.deposit > 0 ? `$${formatMoney(listing.deposit)} refundable deposit` : 'No security deposit'}</span>
              {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && (
                <span className="inline-flex items-center px-3 py-2 rounded-card bg-accent-soft"><ProtectionBadge size="md" /></span>
              )}
              {listing.deliveryAvailable && (
                <span className="inline-flex items-center gap-2 px-3 py-2 rounded-card bg-subtle text-sm text-sec">
                  <Truck size={16} /> Delivery available
                </span>
              )}
            </div>

            <nav aria-label="Listing sections" className="listing-section-nav">
              <a href="#listing-overview">Overview</a>
              <a href="#listing-specifications">Specifications</a>
              <a href="#listing-availability">Availability</a>
              <a href="#listing-reviews">Reviews{listing.reviewCount > 0 ? ` (${listing.reviewCount})` : ''}</a>
              {similar.length > 0 && <a href="#listing-similar">Similar items</a>}
            </nav>
            <div id="listing-overview" className="scroll-mt-24">
            {listing.description && (
              <Block title="About this item">
                <p className="text-sec leading-relaxed whitespace-pre-line">{listing.description}</p>
              </Block>
            )}
            </div>
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
                <ul className="p1-included">
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

            {(listing.pickup || listing.delivery) && (
              <Block title="Pickup and delivery">
                <ul className="space-y-2.5 text-sm text-sec">
                  {listing.pickup && (
                    <li className="flex items-start gap-2.5"><MapPin size={16} className="shrink-0 mt-0.5" />{listing.pickup}</li>
                  )}
                  {listing.delivery && (
                    <li className="flex items-start gap-2.5"><Truck size={16} className="shrink-0 mt-0.5" />{listing.delivery}</li>
                  )}
                </ul>
                <p className="text-xs text-muted mt-3">Exact address is shared once the booking is confirmed.</p>
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
                <div className="p1-reviews">
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
          <aside className="min-w-0" aria-label="Book this item">{bookingPanel}</aside>
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
            <div className="p1-item-grid">
              {similar.map((item) => (
                <ListingCard key={item.id} listing={item} onClick={() => navigate({ name: 'listing', id: item.id })}
                  favorited={favoriteIds.has(item.id)} favoriteBusy={!!user && (favoritesLoading || favoriteError || favoriteBusyIds.has(item.id))}
                  onToggleFavorite={() => void handleToggleFavorite(item.id)} />
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
              <span className="text-lg font-bold text-main tnum">{datesValid ? `$${formatMoney(total)}` : `$${formatMoney(listing.pricePerDay)}`}</span>
              <span className="text-xs text-sec">{datesValid ? 'est. total' : '/day'}</span>
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
    <div className={`flex justify-between ${isCredit ? 'text-success' : 'text-sec'}`}>
      <span>{label}</span>
      <span className={`font-medium tnum ${isCredit ? 'text-success' : muted ? 'text-sec' : 'text-main'}`}>{isCredit ? '-' : ''}${formatMoney(Math.abs(value))}</span>
    </div>
  );
}
