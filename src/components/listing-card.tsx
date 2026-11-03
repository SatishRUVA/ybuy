import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Heart, Star, Zap, ImageOff, BadgeCheck, Package, Truck } from 'lucide-react';
import type { Listing } from '@/data';
import { Badge } from '@/components/ui';
import { ProtectionBadge } from '@/components/trust';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';

/** Shared heart control: same hit area, same pop, wherever a listing can be saved. */
function FavoriteButton({
  liked, onToggle, busy = false, className = '',
}: { liked: boolean; onToggle: () => void; busy?: boolean; className?: string }) {
  const [popKey, setPopKey] = useState(0);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setPopKey((k) => k + 1); onToggle(); }}
      aria-label={liked ? 'Remove from favorites' : 'Save to favorites'}
      aria-pressed={liked}
      disabled={busy}
      aria-busy={busy}
      className={`p1-save ${liked ? 'is-saved' : ''} ${className}`}
    >
      <Heart
        key={popKey}
        size={17}
        className={`${liked ? 'fill-current' : ''} ${popKey > 0 ? 'animate-heart-pop' : ''}`}
      />
    </button>
  );
}

/** Rating, or an honest "New listing" when the owner has no reviews yet. */
function RatingLine({ listing }: { listing: Listing }) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-xs">
      {listing.reviewCount > 0 ? (
        <>
          <Star size={12} className="p1-rating-star" fill="currentColor" />
          <span className="font-semibold text-main tnum">{listing.rating.toFixed(1)}</span>
          <span className="text-sec">({listing.reviewCount})</span>
        </>
      ) : (
        <span className="text-sec">New listing</span>
      )}
    </div>
  );
}

function OwnerLine({ listing }: { listing: Listing }) {
  const distance = listing.distance > 0 && Number.isFinite(listing.distance)
    ? `About ${listing.distance} ${listing.distanceUnit} away` : null;
  return (
    <div className="p1-owner-line flex min-w-0 items-center justify-between gap-2 text-xs">
      <span className="flex min-w-0 items-center gap-1 text-sec">
        <span className="truncate" title={`By ${listing.owner.name}`}>By {listing.owner.name}</span>
        {listing.verifiedOwner && <span className="shrink-0 text-accent" title="Verified owner">
          <BadgeCheck size={14} aria-hidden="true" /><span className="sr-only">Verified owner</span>
        </span>}
      </span>
      {distance && <span className="shrink-0 text-sec tnum" title={distance} aria-label={distance}>
        {listing.distance} {listing.distanceUnit}
      </span>}
    </div>
  );
}

function handleListingLinkClick(e: MouseEvent<HTMLAnchorElement>, onClick?: () => void) {
  if (!onClick || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  onClick();
}

export function ListingPhoto({ src, alt, loading = 'lazy', className = '' }: {
  src?: string; alt: string; loading?: 'lazy' | 'eager'; className?: string;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return src && failedImage !== src
    ? <img src={src} alt={alt} loading={loading} className={`w-full h-full object-cover ${className}`} onError={() => setFailedImage(src)} />
    : <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-subtle text-sec">
      <ImageOff size={24} aria-hidden="true" /><span className="text-[10px]">Photo unavailable</span>
    </div>;
}

export function ListingCard({ listing, onClick, favorited, favoriteBusy, onToggleFavorite, compact = false }: { listing: Listing; onClick?: () => void; favorited?: boolean; favoriteBusy?: boolean; onToggleFavorite?: () => void; compact?: boolean }) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = favorited ?? likedLocal;
  const toggleLiked = onToggleFavorite ?? (() => setLikedLocal(!likedLocal));
  return (
    <article className={`p1-item ${compact ? 'p1-item-compact' : ''}`}>
      <div className="p1-item-photo">
      <a
        href={`/listing/${encodeURIComponent(listing.id)}`}
        aria-label={`View listing: ${listing.title}`}
        onClick={(e) => handleListingLinkClick(e, onClick)}
      >
          <ListingPhoto
            src={listing.images[0]}
            alt=""
            className="zoom-media"
          />
      </a>
      <FavoriteButton liked={liked} onToggle={toggleLiked} busy={favoriteBusy} />
      {listing.instantBooking && <span className="p1-instant"><Zap size={12} aria-hidden="true" /> Instant booking</span>}
      {listing.available && listing.images.length > 0 && <span className="p1-photo-count" aria-label={`${listing.images.length} listing photos`}>1/{listing.images.length}</span>}
      {!listing.available && <Badge tone="neutral" className="absolute bottom-2 right-2 bg-card">Booked</Badge>}
      </div>
        <div className="p1-item-body">
          <div className="p1-item-category"><span>{listing.category}</span><RatingLine listing={listing} /></div>
          <a href={`/listing/${encodeURIComponent(listing.id)}`} className="p1-item-title" onClick={(event) => handleListingLinkClick(event, onClick)}>{listing.title}</a>
          <OwnerLine listing={listing} />
          <div className="p1-card-handoff"><span><Package size={14} aria-hidden="true" />Local Pickup</span>
            {listing.deliveryAvailable && <span><Truck size={15} aria-hidden="true" />Delivery</span>}</div>
          <div className="p1-card-bottom"><p className="p1-item-price"><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(listing.pricePerDay)}</strong><span>/ day</span></p>
            <a href={`/listing/${encodeURIComponent(listing.id)}`} className="p1-button p1-button-primary" onClick={(event) => handleListingLinkClick(event, onClick)}>View Details <ArrowRight size={16} aria-hidden="true" /></a></div>
            {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && <ProtectionBadge size="sm" />}
        </div>
    </article>
  );
}

export function ListingCardWide({ listing, onClick, favorited, favoriteBusy, onToggleFavorite }: { listing: Listing; onClick?: () => void; favorited?: boolean; favoriteBusy?: boolean; onToggleFavorite?: () => void }) {
  return <ListingCard compact listing={listing} onClick={onClick} favorited={favorited} favoriteBusy={favoriteBusy} onToggleFavorite={onToggleFavorite} />;
}

const SWIPE_THRESHOLD_PX = 40;

export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const touchStartX = useRef<number | null>(null);
  const count = images.length;

  const step = (delta: number) => setActive((a) => (a + delta + count) % count);

  useEffect(() => { setActive(0); }, [images]);

  return (
    <div className="listing-image-gallery">
      <div
        className="listing-image-main relative rounded-card-lg overflow-hidden bg-subtle group select-none"
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null || count < 2) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          if (Math.abs(dx) > SWIPE_THRESHOLD_PX) step(dx < 0 ? 1 : -1);
          touchStartX.current = null;
        }}
        onKeyDown={(e) => {
          if (count < 2) return;
          if (e.key === 'ArrowRight') step(1);
          if (e.key === 'ArrowLeft') step(-1);
        }}
        tabIndex={0}
        role="group"
        aria-label={count ? `${title} - image ${active + 1} of ${count}` : `${title} - no images`}
      >
        {images[active] && !failedImages.has(images[active])
          ? <img key={active} src={images[active]} alt={`${title} - photo ${active + 1}`} onError={() => setFailedImages(previous => new Set(previous).add(images[active]))} className="w-full h-full object-cover animate-cross-fade" />
          : <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sec"><ImageOff size={32} aria-hidden="true" /><p className="text-sm">Photo unavailable</p></div>}
        {count > 1 && (
          <>
            <button
              onClick={() => step(-1)}
              aria-label="Previous image"
              className="grid place-items-center absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 shadow-card"
            >
              <ChevronLeft size={20} className="text-gray-900" />
            </button>
            <button
              onClick={() => step(1)}
              aria-label="Next image"
              className="grid place-items-center absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 shadow-card"
            >
              <ChevronRight size={20} className="text-gray-900" />
            </button>
            <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] font-semibold tnum">
              {active + 1} / {count}
            </div>
            <div className="sm:hidden absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {images.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all duration-standard ${i === active ? 'w-5 bg-white' : 'w-1.5 bg-white/55'}`} />
              ))}
            </div>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="listing-image-thumbnails" aria-label="Listing photos">
          {images.map((img, i) => (
            <button
              key={img + i}
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              aria-pressed={i === active}
              className={`listing-image-thumbnail rounded-card overflow-hidden border-2 transition-colors duration-fast ${i === active ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100'}`}
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
