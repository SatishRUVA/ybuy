import { useEffect, useState } from 'react';
import { ImageGallery, ListingCard } from '@/components/listing-card';
import { Rating, VerifiedBadge, ProtectionBadge } from '@/components/trust';
import { Button, IconButton, Badge, Alert, SectionHeader, Surface } from '@/components/ui';
import { useRouter } from '@/router';
import type { Listing } from '@/data';
import { fetchListingById, toUiListing, searchListings, enrichListingsWithRatings, type DbListingRow } from '@/lib/listings';
import { getOrCreateConversation } from '@/lib/messages';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { fetchReviewsForUser } from '@/lib/reviews';
import { fetchUnavailableDates } from '@/lib/availability';
import { DateRangePicker } from '@/components/date-range-picker';
import { useAuth } from '@/auth-context';
import { formatFeePct, usePlatformFeePct } from '@/lib/settings';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { MAX_BOOKING_RANGE_DAYS, addDaysIso, todayIso } from '@/lib/geo';
import { ListingDetailSkeleton } from '@/components/skeleton';
import { MarketplaceOfferForm } from '@/components/marketplace-offer-form';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import {
  MapPin, CheckCircle2, Truck, FileText,
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
  const { enabled: offersEnabled, error: offersFlagError } = useFeatureFlag('bidding');
  const [offerSent, setOfferSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setListing(undefined);
    setListingError(false);
    setOfferSent(false);
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
      })
      .catch(() => { if (!cancelled) { setListingError(true); setListing(null); } });
    return () => { cancelled = true; };
  }, [id, listingRetry]);

  useEffect(() => {
    if (!listing) return;
    let cancelled = false;
    setReviewsError(false);
    fetchReviewsForUser(listing.owner.id)
      .then(({ reviews, rating, reviewCount }) => {
        if (cancelled) return;
        setListing((prev) => (prev ? {
          ...prev,
          reviews,
          rating,
          reviewCount,
          owner: { ...prev.owner, rating, rentals: reviewCount },
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
    fetchUnavailableDates(listing.id)
      .then(({ blocked, booked }) => {
        if (cancelled) return;
        setBlockedDates(blocked);
        setBookedDates(booked);
      })
      .catch(() => { if (!cancelled) setAvailabilityError(true); })
      .finally(() => { if (!cancelled) setAvailabilityLoading(false); });
    return () => { cancelled = true; };
  }, [listing?.id, availabilityRetry]);

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
  const rental = listing.pricePerDay * days;
  const serviceFee = Math.round(rental * feePct * 100) / 100;
  const total = rental + serviceFee + listing.deposit;
  const datesValid = Boolean(startDate && endDate && startDate >= todayIso() && endDate > startDate && days <= MAX_BOOKING_RANGE_DAYS);
  const rangeUnavailable = (() => {
    for (let iso = startDate; iso && iso < endDate; iso = addDaysIso(iso, 1)) {
      if (bookedDates.has(iso) || blockedDates.has(iso)) return true;
    }
    return false;
  })();
  const isOwner = listing.owner.id === user?.id;
  const canBook = !isOwner && listing.available && datesValid && !rangeUnavailable && !availabilityLoading && !availabilityError;

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

  const goToCheckout = () => { if (canBook) navigate({ name: 'checkout', id: listing.id, startDate, endDate }); };

  const bookingPanel = (
    <Surface id="listing-booking" className="listing-booking-panel p-5 sm:p-6">
      <div className="flex items-end justify-between gap-3">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[32px] leading-none font-extrabold text-main font-display tnum">${listing.pricePerDay}</span>
          <span className="text-sec text-sm font-medium">per day</span>
        </p>
        <span className="text-xs text-sec">Choose your dates</span>
      </div>

      <div className="mt-5">
        <p className="block text-[13px] font-semibold text-main mb-1.5">Rental dates</p>
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          bookedDates={bookedDates}
          blockedDates={blockedDates}
          onChange={(nextStart, nextEnd) => { setStartDate(nextStart); setEndDate(nextEnd); }}
        />
      </div>

      {availabilityLoading && <p className="mt-3 text-sm text-sec" role="status">Checking date availability…</p>}
      {availabilityError && (
        <Alert tone="error" className="mt-3">
          <p>We couldn't verify date availability. Booking is disabled until it can be checked.</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAvailabilityRetry((attempt) => attempt + 1)}>Try again</Button>
        </Alert>
      )}
      {!datesValid && (
        <Alert tone="warning" className="mt-3">Choose future rental dates with a return after pickup, up to {MAX_BOOKING_RANGE_DAYS} days.</Alert>
      )}
      {datesValid && rangeUnavailable && (
        <Alert tone="warning" className="mt-3">Those dates are already taken. Choose another available range.</Alert>
      )}

      {listing.pickup && <div className="mt-5 flex gap-2.5 text-sm">
        <MapPin size={18} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
        <div><p className="font-semibold text-main">{listing.pickup}</p>
          <p className="text-xs text-sec mt-1">Approximate pickup area. Exact address after confirmation.</p></div>
      </div>}

      {/* Totals re-render on every duration change; the cross-fade keeps the swap from snapping. */}
      {datesValid && <div key={`${days}-${listing.pricePerDay}`} className="mt-5 pt-5 border-t border-app space-y-3 text-sm animate-cross-fade" aria-label="Price breakdown">
        <PriceRow label={`$${formatMoney(listing.pricePerDay)} × ${days} ${days === 1 ? 'day' : 'days'}`} value={rental} />
        <PriceRow label={`Service fee (${formatFeePct(feePct)})`} value={serviceFee} />
        <PriceRow label="Refundable security deposit" value={listing.deposit} muted />
        <div className="pt-2.5 border-t border-app flex justify-between font-bold text-main text-base">
          <span>Estimated total</span>
          <span className="tnum">${formatMoney(total)}</span>
        </div>
      </div>}
      <p className="text-xs text-sec mt-3">Tax is not calculated in this estimate. Final charges are confirmed at checkout.</p>
      <Button fullWidth size="lg" className="mt-5" disabled={!canBook} onClick={goToCheckout}>
        {isOwner ? 'Your listing' : 'Request to book'}
      </Button>
      <p className="text-xs text-sec text-center mt-3 flex items-center justify-center gap-1.5">
        <Lock size={13} aria-hidden="true" /> No charge until the owner approves.
      </p>
      {listing.deposit > 0 && <p className="text-xs text-sec mt-3 leading-relaxed">Deposit charged at payment; refundable after owner-confirmed return when no unresolved dispute exists.</p>}
      {listing.negotiationEnabled && !isOwner && offersEnabled && <a href="#rental-offer" className="flex justify-center items-center min-h-11 text-sm font-semibold text-accent mt-2">Make an offer <ChevronRight size={15} aria-hidden="true" /></a>}
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
        {/* Title block - item identity first, actions second. */}
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h1 className="text-[26px] sm:text-[38px] leading-tight font-extrabold text-main font-display mt-1">
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
            <IconButton label={liked ? 'Remove from favorites' : 'Save to favorites'} onClick={() => void handleToggleFavorite()}>
              <Heart size={18} className={liked ? 'fill-favorite text-favorite' : 'text-sec'} />
            </IconButton>
            <IconButton label={shared ? 'Link copied' : 'Copy link'} onClick={() => void handleShare()}>
              {shared ? <CheckCircle2 size={18} className="text-success" /> : <Share2 size={18} className="text-sec" />}
            </IconButton>
          </div>
        </div>
        {favoriteError && (
          <Alert tone="warning" className="mb-4">
            <p>We couldn't confirm whether this item is saved.</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setFavoriteRetry((attempt) => attempt + 1)}>Check again</Button>
          </Alert>
        )}

        <div className="listing-detail-grid">
          {/* Left: gallery + detail */}
          <div className="listing-gallery min-w-0">
            <ImageGallery images={listing.images} title={listing.title} />
          </div>
          <aside className="listing-booking min-w-0" aria-label="Book this item">
            <div className="listing-booking-sticky">{bookingPanel}</div>
          </aside>
          <div className="listing-details min-w-0 space-y-7">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-sec">
              <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-accent" aria-hidden="true" />Owner approval required</span>
              <span className="inline-flex items-center gap-2"><Lock size={16} className="text-accent" aria-hidden="true" />{listing.deposit > 0 ? `$${formatMoney(listing.deposit)} refundable deposit` : 'No security deposit'}</span>
              <span className="inline-flex items-center gap-2"><FileText size={16} className="text-accent" aria-hidden="true" />{formatFeePct(feePct)} service fee</span>
              {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && (
                <span className="inline-flex items-center px-3 py-2 rounded-card bg-accent-soft"><ProtectionBadge size="md" /></span>
              )}
              {listing.deliveryAvailable && (
                <span className="inline-flex items-center gap-2 px-3 py-2 rounded-card bg-subtle text-sm text-sec">
                  <Truck size={16} /> Delivery available
                </span>
              )}
            </div>

            {listing.description && (
              <Block title="About this item">
                <p className="text-sec leading-relaxed whitespace-pre-line">{listing.description}</p>
              </Block>
            )}

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

            {/* Owner trust profile */}
            <Block title="Meet the owner">
              <div className="py-4 border-y border-app">
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
                <Button
                  variant="secondary"
                  className="mt-4"
                  disabled={isOwner}
                  icon={<MessageSquare size={16} />}
                  onClick={() => void handleMessageOwner()}
                >
                  Message {listing.owner.name.split(' ')[0]}
                </Button>
                {messageError && <Alert tone="error" className="mt-3">{messageError}</Alert>}
              </div>
            </Block>

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

            {listing.negotiationEnabled && listing.owner.id !== user?.id && offersFlagError && (
              <Alert tone="error" title="Could not check offer availability">
                {offersFlagError} Retrying automatically.
              </Alert>
            )}
            {listing.negotiationEnabled && listing.owner.id !== user?.id && offersEnabled && (
              <section id="rental-offer" className="scroll-mt-24">
                <h2 className="text-lg font-bold text-main">Make an offer</h2>
                {offerSent
                  ? <Alert tone="success">Your offer was sent. You can follow the negotiation from Requests &amp; offers.</Alert>
                  : user
                    ? <MarketplaceOfferForm
                      listingId={listing.id}
                      advertisedPrice={listing.pricePerDay}
                      rules={listing.offerRules}
                      onSent={() => setOfferSent(true)}
                    />
                    : <Button variant="secondary" onClick={openSignIn}>Sign in to make an offer</Button>}
              </section>
            )}
          </div>

        </div>

        {similarError && <Alert tone="warning" className="mt-8">Similar rentals couldn't be loaded. <Button size="sm" variant="secondary" onClick={() => setSimilarRetry(attempt => attempt + 1)}>Retry similar rentals</Button></Alert>}
        {!similarError && similar.length > 0 && (
          <div className="mt-14">
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
      <div className="listing-booking-bar lg:hidden fixed bottom-[calc(4rem_+_env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-30 bg-card border-t border-app px-4 py-3">
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
      </div>
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
  return (
    <div className="flex justify-between text-sec">
      <span>{label}</span>
      <span className={`font-medium tnum ${muted ? 'text-sec' : 'text-main'}`}>${formatMoney(value)}</span>
    </div>
  );
}
