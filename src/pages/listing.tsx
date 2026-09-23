import { useEffect, useState } from 'react';
import { ImageGallery } from '@/components/listing-card';
import { Rating, VerifiedBadge, ProtectionBadge, SecurityHoldNote, TrustChecklist, ShieldStamp } from '@/components/trust';
import { useRouter } from '@/router';
import type { Listing } from '@/data';
import { fetchListingById, toUiListing } from '@/lib/listings';
import { getOrCreateConversation } from '@/lib/messages';
import { fetchFavoriteListingIds, addFavorite, removeFavorite } from '@/lib/favorites';
import { fetchReviewsForUser } from '@/lib/reviews';
import { fetchUnavailableDates } from '@/lib/availability';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { useAuth } from '@/auth-context';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';
import { MAX_BOOKING_RANGE_DAYS, addDaysIso, todayIso } from '@/lib/geo';
import { ListingDetailSkeleton } from '@/components/skeleton';
import * as Icons from 'lucide-react';
import {
  MapPin, Shield, CheckCircle2, Truck, Package, FileText,
  ChevronRight, ArrowLeft, Lock, Star, MessageSquare, Heart, Share,
} from 'lucide-react';

const tomorrowIso = () => addDaysIso(todayIso(), 1);

export function ListingPage({ id }: { id: string }) {
  const { navigate, back } = useRouter();
  const { user, signInWithGoogle } = useAuth();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(tomorrowIso());
  const [liked, setLiked] = useState(false);
  const [bookedDates, setBookedDates] = useState<Set<string>>(new Set());
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchListingById(id)
      .then((row) => { if (!cancelled) setListing(row ? toUiListing(row) : null); })
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

  if (listing === undefined) {
    return <ListingDetailSkeleton />;
  }

  if (!listing) {
    return <div className="p-8 text-center text-sec">Listing not found.</div>;
  }

  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  const rental = listing.pricePerDay * days;
  const serviceFee = Math.round(rental * 0.1);
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

  const handleMessageOwner = async () => {
    if (!user) { await signInWithGoogle(); return; }
    const conversationId = await getOrCreateConversation({
      currentUserId: user.id,
      otherUserId: listing.owner.id,
      listingId: listing.id,
    });
    navigate({ name: 'conversation', id: conversationId });
  };

  return (
    <div className="animate-fade-in animate-cross-fade pb-20 md:pb-8">
      {/* Mobile back */}
      <div className="md:hidden sticky top-16 z-20 bg-app/90 backdrop-blur-lg border-b border-app px-4 py-2">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec">
          <ArrowLeft size={18} /> Back
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-main font-display">{listing.title}</h1>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-sm">
              <Rating value={listing.rating} count={listing.reviewCount} size="md" />
              <span className="text-muted">·</span>
              <span className="text-sec">{listing.rentalCount} rentals</span>
              {listing.distance > 0 && <span className="text-muted">·</span>}
              {listing.distance > 0 && (
                <span className="flex items-center gap-1 text-sec"><MapPin size={14} />{listing.distance} {listing.distanceUnit} away</span>
              )}
              {listing.verifiedOwner && <span className="text-muted">·</span>}
              {listing.verifiedOwner && <VerifiedBadge />}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => void handleToggleFavorite()} className="p-2.5 rounded-card-lg border border-app hover:bg-subtle transition-colors duration-fast ease-out">
              <Heart size={18} className={liked ? 'fill-accent text-accent' : 'text-sec'} />
            </button>
            <button className="p-2.5 rounded-card-lg border border-app hover:bg-subtle transition-colors">
              <Share size={18} className="text-sec" />
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: Gallery + details */}
          <div className="lg:col-span-2 space-y-6">
            <ImageGallery images={listing.images} title={listing.title} />

            {/* Trust strip */}
            <div className="flex flex-wrap gap-2">
              <ShieldStamp />
              {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && <ProtectionBadge size="md" />}
              {listing.deliveryAvailable && (
                <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-subtle border border-app text-sm text-sec">
                  <Truck size={16} /> Delivery available
                </span>
              )}
              {listing.instantBooking && (
                <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-accent-soft border border-app text-sm text-accent font-medium">
                  <Icons.Zap size={16} /> Instant booking
                </span>
              )}
            </div>

            {/* About */}
            <Section title="About this item">
              <p className="text-sec text-sm leading-relaxed">{listing.description}</p>
            </Section>

            {/* What's included */}
            {listing.whatsIncluded.length > 0 && (
              <Section title="What's included">
                <div className="grid grid-cols-2 gap-2">
                  {listing.whatsIncluded.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-sec">
                      <CheckCircle2 size={16} className="text-success shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Condition — gated: relies on damage-history/passport data not collected in Part 1 */}
            {SHOW_OUT_OF_SCOPE_PAGES && (
              <Section title="Condition">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1.5 rounded-card-lg bg-success-soft text-success text-sm font-semibold">{listing.condition}</span>
                  <span className="text-sm text-sec">{listing.damageHistory}</span>
                </div>
              </Section>
            )}

            {/* Item Passport — gated: §4 out-of-scope (asset/identity verification) */}
            {SHOW_OUT_OF_SCOPE_PAGES && (
              <Section title="Item Passport" action={
                <button onClick={() => navigate({ name: 'item-passport', id: listing.id })} className="text-sm text-accent font-medium flex items-center gap-1 hover:gap-2 transition-all">
                  View full passport <ChevronRight size={16} />
                </button>
              }>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <PassportField label="Asset ID" value={listing.assetId} />
                  <PassportField label="Declared value" value={`$${listing.declaredValue.toLocaleString()}`} />
                  <PassportField label="Serial" value={listing.serialPartial} />
                  <PassportField label="Ownership" value="Verified" icon={<CheckCircle2 size={14} className="text-success" />} />
                  <PassportField label="Rental history" value={`${listing.rentalHistory} completed`} />
                  <PassportField label="Components" value={`${listing.components.filter((c) => c.present).length} / ${listing.components.length}`} />
                </div>
              </Section>
            )}

            {/* Owner */}
            <Section title="Owner">
              <button
                onClick={handleMessageOwner}
                className="flex items-center gap-4 p-4 rounded-card-xl bg-card border border-app hover:shadow-card card-hover w-full text-left"
              >
                <img src={listing.owner.avatar} alt={listing.owner.name} className="w-14 h-14 rounded-full object-cover" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-main">{listing.owner.name}</h4>
                    {listing.owner.verified && <VerifiedBadge label="Identity verified" size="xs" />}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Rating value={listing.owner.rating} size="sm" />
                    <span className="text-xs text-sec">· {listing.owner.rentals} rentals</span>
                  </div>
                </div>
                <MessageSquare size={20} className="text-sec" />
              </button>
            </Section>

            {/* Reviews */}
            {listing.reviews.length > 0 && (
              <Section title={`Reviews (${listing.reviewCount})`}>
                <div className="space-y-4">
                  {listing.reviews.map((review) => (
                    <div key={review.id} className="flex gap-3 p-4 rounded-card-xl bg-card border border-app">
                      <img src={review.avatar} alt={review.author} className="w-10 h-10 rounded-full object-cover shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-main">{review.author}</span>
                          <span className="text-xs text-muted">{review.date}</span>
                        </div>
                        <div className="flex items-center gap-0.5 mt-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} size={12} className={i < review.rating ? 'fill-[var(--star)] text-[var(--star)]' : 'text-border-strong'} />
                          ))}
                        </div>
                        <p className="text-sm text-sec mt-2 leading-relaxed">{review.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Pickup / Delivery */}
            {(listing.pickup || listing.delivery) && (
              <Section title="Pickup / delivery">
                <div className="space-y-2 text-sm text-sec">
                  {listing.pickup && <div className="flex items-start gap-2"><MapPin size={16} className="shrink-0 mt-0.5 text-sec" /> {listing.pickup}</div>}
                  {listing.delivery && <div className="flex items-start gap-2"><Truck size={16} className="shrink-0 mt-0.5 text-sec" /> {listing.delivery}</div>}
                </div>
              </Section>
            )}

            {/* Cancellation */}
            {listing.cancellation && (
              <Section title="Cancellation">
                <p className="text-sm text-sec">{listing.cancellation}</p>
              </Section>
            )}

            {/* Availability */}
            <Section title="Availability">
              <AvailabilityCalendar bookedDates={bookedDates} blockedDates={blockedDates} />
            </Section>
          </div>

          {/* Right: Booking card */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-20 space-y-4">
              <div className="p-5 rounded-card-xl bg-card border border-app shadow-card">
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold text-main">${listing.pricePerDay}</span>
                  <span className="text-sec text-sm">/day</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-xs font-semibold text-sec uppercase tracking-wide">Pick up</label>
                    <input
                      type="date"
                      min={todayIso()}
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full mt-1 px-3 py-2 rounded-card-lg border border-app bg-card text-sm text-main outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-sec uppercase tracking-wide">Return</label>
                    <input
                      type="date"
                      min={startDate}
                      max={maxEndDate}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full mt-1 px-3 py-2 rounded-card-lg border border-app bg-card text-sm text-main outline-none focus:border-accent"
                    />
                  </div>
                </div>
                {!datesValid && <p className="text-xs text-warning mb-3">Return date must be after pick up date.</p>}
                {datesValid && rangeUnavailable && <p className="text-xs text-warning mb-3">Not available for the selected dates — see the calendar below.</p>}

                <button
                  onClick={() => navigate({ name: 'checkout', id: listing.id, startDate, endDate })}
                  disabled={!datesValid || rangeUnavailable}
                  className="w-full py-3 rounded-card-lg bg-accent text-accent-text font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Request to book
                </button>

                <p className="text-xs text-sec text-center mt-2">You won't be charged until the owner approves</p>

                {/* Price breakdown */}
                <div className="mt-4 pt-4 border-t border-app space-y-2 text-sm">
                  <PriceRow label={`$${listing.pricePerDay} × ${days} day${days > 1 ? 's' : ''}`} value={rental} />
                  <PriceRow label="Service fee" value={serviceFee} />
                  <div className="pt-2 border-t border-app flex justify-between font-bold text-main">
                    <span>Total</span>
                    <span>${total}</span>
                  </div>
                </div>

                <div className="mt-4">
                  <SecurityHoldNote amount={listing.deposit} />
                </div>
              </div>

              {/* Trust checklist */}
              {SHOW_OUT_OF_SCOPE_PAGES && (
                <div className="p-5 rounded-card-xl bg-card border border-app">
                  <h4 className="font-semibold text-sm text-main mb-3">Before you book</h4>
                  <TrustChecklist
                    items={[
                      { icon: <CheckCircle2 size={16} />, label: 'Owner identity verified' },
                      { icon: <Package size={16} />, label: 'Item documented with passport' },
                      { icon: <Lock size={16} />, label: 'Secure payment' },
                      { icon: <FileText size={16} />, label: 'Rental agreement' },
                      { icon: <Shield size={16} />, label: 'Return inspection' },
                    ]}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-main font-display">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function PassportField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="p-3 rounded-card-lg bg-subtle border border-app">
      <div className="text-xs text-muted font-medium uppercase tracking-wide">{label}</div>
      <div className="flex items-center gap-1.5 mt-1 text-sm font-semibold text-main">
        {icon}
        {value}
      </div>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sec">
      <span>{label}</span>
      <span className="text-main font-medium">${value}</span>
    </div>
  );
}
