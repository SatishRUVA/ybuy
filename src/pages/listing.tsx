import { useEffect, useState } from 'react';
import { ImageGallery, ListingCard } from '@/components/listing-card';
import { Rating, VerifiedBadge, ProtectionBadge, SecurityHoldNote, TrustChecklist, ShieldStamp } from '@/components/trust';
import { Button, IconButton, Badge, Alert, SectionHeader, Surface } from '@/components/ui';
import { useRouter } from '@/router';
import type { Listing } from '@/data';
import { fetchListingById, toUiListing, searchListings, enrichListingsWithRatings, type DbListingRow } from '@/lib/listings';
import { getOrCreateConversation } from '@/lib/messages';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { fetchReviewsForUser } from '@/lib/reviews';
import { fetchUnavailableDates } from '@/lib/availability';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { useAuth } from '@/auth-context';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { MAX_BOOKING_RANGE_DAYS, addDaysIso, todayIso } from '@/lib/geo';
import { ListingDetailSkeleton } from '@/components/skeleton';
import { fieldClass } from '@/components/form-classes';
import {
  MapPin, Shield, CheckCircle2, Truck, Package, FileText, Zap,
  ArrowLeft, Lock, Star, MessageSquare, Heart, Share2, ChevronRight,
} from 'lucide-react';

const tomorrowIso = () => addDaysIso(todayIso(), 1);
const SERVICE_FEE_PCT = 0.1;

export function ListingPage({ id }: { id: string }) {
  const { navigate, back } = useRouter();
  const { user, signInWithGoogle } = useAuth();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Listing[]>([]);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(tomorrowIso());
  const [liked, setLiked] = useState(false);
  const [shared, setShared] = useState(false);
  const [bookedDates, setBookedDates] = useState<Set<string>>(new Set());
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setListing(undefined);
    fetchListingById(id)
      .then((row: DbListingRow | null) => {
        if (cancelled) return;
        setListing(row ? toUiListing(row) : null);
        setCategoryId(row?.category_id ?? null);
      })
      .catch(() => { if (!cancelled) setListing(null); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!listing) return;
    fetchReviewsForUser(listing.owner.id)
      .then(({ reviews, rating, reviewCount }) => {
        setListing((prev) => (prev ? {
          ...prev,
          reviews,
          rating,
          reviewCount,
          rentalCount: reviewCount,
          verifiedOwner: reviewCount > 0,
          owner: { ...prev.owner, rating, rentals: reviewCount, verified: reviewCount > 0 },
        } : prev));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, listing?.owner.id]);

  useEffect(() => {
    if (!user || !listing) { setLiked(false); return; }
    fetchFavoriteListingIds(user.id).then((ids) => setLiked(ids.has(listing.id))).catch(() => {});
  }, [user, listing?.id]);

  useEffect(() => {
    if (!listing) return;
    fetchUnavailableDates(listing.id)
      .then(({ blocked, booked }) => { setBlockedDates(blocked); setBookedDates(booked); })
      .catch(() => {});
  }, [listing?.id]);

  // "Similar rentals" is a real query against the same category, minus this listing.
  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    searchListings({ categoryId, sortBy: 'recommended', pageSize: 5 })
      .then((result) => enrichListingsWithRatings(result.rows.map(toUiListing)))
      .then((rows) => { if (!cancelled) setSimilar(rows.filter((l) => l.id !== id).slice(0, 4)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [categoryId, id]);

  async function handleToggleFavorite() {
    if (!user || !listing) { await signInWithGoogle(); return; }
    const next = !liked;
    setLiked(next);
    try {
      if (next) await addFavorite(user.id, listing.id); else await removeFavorite(user.id, listing.id);
    } catch {
      setLiked(!next);
    }
  }

  async function handleShare() {
    await navigator.clipboard.writeText(window.location.href).catch(() => {});
    setShared(true);
    window.setTimeout(() => setShared(false), 2000);
  }

  if (listing === undefined) return <ListingDetailSkeleton />;

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
  const serviceFee = Math.round(rental * SERVICE_FEE_PCT);
  const total = rental + serviceFee + listing.deposit;
  const datesValid = endDate > startDate;
  const maxEndDate = addDaysIso(startDate, MAX_BOOKING_RANGE_DAYS);
  const rangeUnavailable = (() => {
    for (let d = new Date(startDate); d.toISOString().slice(0, 10) < endDate; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (bookedDates.has(iso) || blockedDates.has(iso)) return true;
    }
    return false;
  })();
  const canBook = datesValid && !rangeUnavailable;

  const handleMessageOwner = async () => {
    if (!user) { await signInWithGoogle(); return; }
    const conversationId = await getOrCreateConversation({
      currentUserId: user.id,
      otherUserId: listing.owner.id,
      listingId: listing.id,
    });
    navigate({ name: 'conversation', id: conversationId });
  };

  const goToCheckout = () => navigate({ name: 'checkout', id: listing.id, startDate, endDate });

  const bookingPanel = (
    <Surface className="p-5">
      <div className="flex items-end justify-between gap-3">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[32px] leading-none font-extrabold text-main font-display tnum">${listing.pricePerDay}</span>
          <span className="text-sec text-sm font-medium">per day</span>
        </p>
        <Rating value={listing.rating} count={listing.reviewCount} size="sm" />
      </div>

      <div className="grid grid-cols-2 gap-2.5 mt-5">
        <div>
          <label htmlFor="pickup-date" className="block text-[13px] font-semibold text-main mb-1.5">Pick up</label>
          <input
            id="pickup-date"
            type="date"
            min={todayIso()}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={fieldClass()}
          />
        </div>
        <div>
          <label htmlFor="return-date" className="block text-[13px] font-semibold text-main mb-1.5">Return</label>
          <input
            id="return-date"
            type="date"
            min={startDate}
            max={maxEndDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={fieldClass()}
          />
        </div>
      </div>

      {!datesValid && (
        <Alert tone="warning" className="mt-3">Pick a return date after your pick-up date.</Alert>
      )}
      {datesValid && rangeUnavailable && (
        <Alert tone="warning" className="mt-3">Those dates are already taken - the calendar below shows what's free.</Alert>
      )}

      <Button fullWidth size="lg" className="mt-4" disabled={!canBook} onClick={goToCheckout}>
        Request to book
      </Button>
      <p className="text-xs text-sec text-center mt-2.5">
        No charge yet. You pay only after {listing.owner.name.split(' ')[0]} approves.
      </p>

      {/* Totals re-render on every duration change; the cross-fade keeps the swap from snapping. */}
      <div key={`${days}-${listing.pricePerDay}`} className="mt-5 pt-5 border-t border-app space-y-2.5 text-sm animate-cross-fade">
        <PriceRow label={`$${listing.pricePerDay} × ${days} ${days === 1 ? 'day' : 'days'}`} value={rental} />
        <PriceRow label="Service fee" value={serviceFee} />
        {listing.deposit > 0 && <PriceRow label="Refundable security hold" value={listing.deposit} muted />}
        <div className="pt-2.5 border-t border-app flex justify-between font-bold text-main text-base">
          <span>Total</span>
          <span className="tnum">${total}</span>
        </div>
      </div>

      {listing.deposit > 0 && <div className="mt-4"><SecurityHoldNote amount={listing.deposit} /></div>}
    </Surface>
  );

  return (
    <div className="animate-fade-in pb-28 md:pb-10">
      {/* Mobile back */}
      <div className="md:hidden sticky top-16 z-20 glass-surface border-b border-app px-4 py-2">
        <button onClick={back} className="flex items-center gap-1.5 text-sm font-medium text-sec">
          <ArrowLeft size={18} /> Back
        </button>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {/* Title block - item identity first, actions second. */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            {listing.category && <p className="text-sm font-medium text-accent">{listing.category}</p>}
            <h1 className="text-[26px] sm:text-[38px] leading-tight font-extrabold text-main font-display mt-1">
              {listing.title}
            </h1>
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mt-2.5 text-sm">
              <Rating value={listing.rating} count={listing.reviewCount} size="md" />
              {listing.rentalCount > 0 && <span className="text-sec tnum">{listing.rentalCount} completed rentals</span>}
              {listing.pickup && (
                <span className="flex items-center gap-1 text-sec"><MapPin size={14} />{listing.pickup}</span>
              )}
              {listing.verifiedOwner && <VerifiedBadge />}
            </div>
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

        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-8 lg:gap-10">
          {/* Left: gallery + detail */}
          <div className="min-w-0 space-y-9">
            <ImageGallery images={listing.images} title={listing.title} />

            <div className="flex flex-wrap gap-2">
              <ShieldStamp />
              {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && (
                <span className="inline-flex items-center px-3 py-2 rounded-card bg-accent-soft"><ProtectionBadge size="md" /></span>
              )}
              {listing.deliveryAvailable && (
                <span className="inline-flex items-center gap-2 px-3 py-2 rounded-card bg-subtle text-sm text-sec">
                  <Truck size={16} /> Delivery available
                </span>
              )}
              {listing.instantBooking && (
                <span className="inline-flex items-center gap-2 px-3 py-2 rounded-card bg-accent-soft text-sm font-medium text-accent">
                  <Zap size={16} /> Instant booking
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

            {/* Rules are the real platform terms for this booking, not invented per-listing copy. */}
            <Block title="Rental terms">
              <ul className="grid sm:grid-cols-2 gap-3">
                <Term icon={<CheckCircle2 size={16} />} title="Owner approval required">
                  Every request is reviewed by the owner before any payment is taken.
                </Term>
                <Term icon={<Lock size={16} />} title={listing.deposit > 0 ? `$${listing.deposit} security hold` : 'No security hold'}>
                  {listing.deposit > 0
                    ? 'Refundable, released after the item is returned and checked.'
                    : 'This owner does not ask for a deposit on this item.'}
                </Term>
                <Term icon={<FileText size={16} />} title={`${Math.round(SERVICE_FEE_PCT * 100)}% service fee`}>
                  Added to the rental price and shown in full before you confirm.
                </Term>
                <Term icon={<Package size={16} />} title={`Up to ${MAX_BOOKING_RANGE_DAYS} days`}>
                  Longer rentals can be arranged directly with the owner in messages.
                </Term>
              </ul>
            </Block>

            {SHOW_OUT_OF_SCOPE_PAGES && (
              <Block title="Condition">
                <div className="flex items-center gap-3">
                  <Badge tone="success">{listing.condition}</Badge>
                  <span className="text-sm text-sec">{listing.damageHistory}</span>
                </div>
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
                  <PassportField label="Ownership" value="Verified" />
                  <PassportField label="Rental history" value={`${listing.rentalHistory} completed`} />
                  <PassportField label="Components" value={`${listing.components.filter((c) => c.present).length} / ${listing.components.length}`} />
                </div>
              </Block>
            )}

            {/* Owner trust profile */}
            <Block title="Meet the owner">
              <Surface className="p-5">
                <div className="flex items-center gap-4">
                  <img src={listing.owner.avatar} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-main text-lg font-display">{listing.owner.name}</h3>
                      {listing.owner.verified && <VerifiedBadge label="Identity verified" size="xs" />}
                    </div>
                    <p className="text-sm text-sec mt-0.5">Joined {listing.owner.joinedYear}</p>
                    <div className="flex items-center gap-4 mt-2">
                      <Rating value={listing.owner.rating} count={listing.owner.rentals} size="sm" />
                    </div>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="mt-4"
                  icon={<MessageSquare size={16} />}
                  onClick={() => void handleMessageOwner()}
                >
                  Message {listing.owner.name.split(' ')[0]}
                </Button>
              </Surface>
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

            <Block title="Availability">
              <Surface className="p-4">
                <AvailabilityCalendar bookedDates={bookedDates} blockedDates={blockedDates} />
              </Surface>
            </Block>

            <Block title={listing.reviewCount > 0 ? `Reviews (${listing.reviewCount})` : 'Reviews'}>
              {listing.reviews.length === 0 ? (
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

          {/* Right: booking */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-4">
              {bookingPanel}
              {SHOW_OUT_OF_SCOPE_PAGES && (
                <Surface className="p-5">
                  <h3 className="font-semibold text-sm text-main mb-3">Before you book</h3>
                  <TrustChecklist
                    items={[
                      { icon: <CheckCircle2 size={16} />, label: 'Owner identity verified' },
                      { icon: <Package size={16} />, label: 'Item documented with passport' },
                      { icon: <Lock size={16} />, label: 'Secure payment' },
                      { icon: <FileText size={16} />, label: 'Rental agreement' },
                      { icon: <Shield size={16} />, label: 'Return inspection' },
                    ]}
                  />
                </Surface>
              )}
            </div>
          </aside>

          {/* The booking panel still has to be reachable on small screens, below the content. */}
          <div className="lg:hidden">{bookingPanel}</div>
        </div>

        {similar.length > 0 && (
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
      <div className="lg:hidden fixed bottom-16 left-0 right-0 z-30 glass-surface border-t border-app px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="flex items-baseline gap-1">
              <span className="text-lg font-bold text-main tnum">${total}</span>
              <span className="text-xs text-sec">total</span>
            </p>
            <p className="text-xs text-sec tnum truncate">${listing.pricePerDay}/day · {days} {days === 1 ? 'day' : 'days'}</p>
          </div>
          <Button className="flex-1" disabled={!canBook} onClick={goToCheckout}>Request to book</Button>
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

function Term({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 p-3.5 rounded-card-lg bg-subtle">
      <span className="text-accent shrink-0 mt-0.5">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-main">{title}</p>
        <p className="text-xs text-sec mt-0.5 leading-relaxed">{children}</p>
      </div>
    </li>
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
      <span className={`font-medium tnum ${muted ? 'text-sec' : 'text-main'}`}>${value}</span>
    </div>
  );
}
