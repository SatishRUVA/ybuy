import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Heart, Star, Zap, ImageOff } from 'lucide-react';
import type { Listing } from '@/data';
import { Badge } from '@/main-site/components/ui';
import { ProtectionBadge } from '@/main-site/components/trust';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';

/** Shared heart control: same hit area, same pop, wherever a listing can be saved. */
function FavoriteButton({
  liked, onToggle, className = '',
}: { liked: boolean; onToggle: () => void; className?: string }) {
  const [popKey, setPopKey] = useState(0);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setPopKey((k) => k + 1); onToggle(); }}
      aria-label={liked ? 'Remove from favorites' : 'Save to favorites'}
      aria-pressed={liked}
      className={`grid place-items-center w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm shadow-xs transition-colors duration-fast ease-out hover:bg-white ${className}`}
    >
      <Heart
        key={popKey}
        size={16}
        className={`${liked ? 'fill-favorite text-favorite' : 'text-gray-900'} ${popKey > 0 ? 'animate-heart-pop' : ''}`}
      />
    </button>
  );
}

/** Category and location read as the item's provenance line - kept to one row, never wrapped. */
function MetaLine({ listing }: { listing: Listing }) {
  const place = listing.distance > 0 && Number.isFinite(listing.distance)
    ? `About ${listing.distance} ${listing.distanceUnit} away`
    : listing.pickup;
  return (
    <p className="h-4 flex items-center gap-1 text-xs text-sec truncate">
      {listing.category && <span className="truncate">{listing.category}</span>}
      {listing.category && place && <span className="text-muted">•</span>}
      {place && (
        <span className="flex items-center gap-0.5 truncate">
          <MapPin size={11} className="shrink-0" />
          {place}
        </span>
      )}
    </p>
  );
}

/** Rating, or an honest "New listing" when the owner has no reviews yet. */
function RatingLine({ listing }: { listing: Listing }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      {listing.reviewCount > 0 ? (
        <>
          <Star size={12} className="fill-[var(--star)] text-[var(--star)]" />
          <span className="font-semibold text-main tnum">{listing.rating.toFixed(1)}</span>
          <span className="text-sec">({listing.reviewCount})</span>
        </>
      ) : (
        <span className="text-sec">New listing</span>
      )}
      {listing.verifiedOwner && <span className="text-muted">•</span>}
      {listing.verifiedOwner && <span className="text-success font-medium">Verified owner</span>}
    </div>
  );
}

function PriceBlock({ value, size = 'md' }: { value: number; size?: 'md' | 'lg' }) {
  return (
    <p className="flex items-baseline gap-1">
      <span className={`font-bold text-main tnum ${size === 'lg' ? 'text-xl' : 'text-[17px]'}`}>${value}</span>
      <span className="text-xs text-sec font-medium">/day</span>
    </p>
  );
}

function handleListingLinkClick(e: MouseEvent<HTMLAnchorElement>, onClick?: () => void) {
  if (!onClick || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  onClick();
}

export function ListingPhoto({ images, className }: { images: string[]; className: string }) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const url = images.find(image => image && !failed.has(image));
  return url
    ? <img src={url} alt="" loading="lazy" className={className}
      onError={() => setFailed(previous => new Set(previous).add(url))} />
    : <span role="img" aria-label="Photo unavailable" className={`${className} flex flex-col items-center justify-center gap-2 text-sec`}>
      <ImageOff size={24} aria-hidden="true" /><span className="text-xs">Photo unavailable</span>
    </span>;
}

export function ListingCard({ listing, onClick, href, favorited, onToggleFavorite }: { listing: Listing; onClick?: () => void; href?: string; favorited?: boolean; onToggleFavorite?: () => void }) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = favorited ?? likedLocal;
  const toggleLiked = onToggleFavorite ?? (() => setLikedLocal(!likedLocal));
  return (
    <article
      className="group relative flex h-full flex-col bg-card rounded-card-lg overflow-hidden border border-app shadow-xs card-hover"
    >
      <a
        href={href ?? `/listing/${encodeURIComponent(listing.id)}`}
        aria-label={`View listing: ${listing.title}`}
        onClick={(e) => handleListingLinkClick(e, onClick)}
        className="flex h-full flex-col rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-accent"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-subtle">
          <ListingPhoto
            images={listing.images}
            className="w-full h-full object-cover zoom-media"
          />
          <div className="absolute top-2.5 left-2.5 flex gap-1.5">
            {listing.instantBooking && <Badge tone="inverse" icon={<Zap size={11} />}>Instant</Badge>}
            {!listing.available && <Badge tone="neutral" className="bg-card">Booked</Badge>}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-3.5 min-h-[152px]">
          <MetaLine listing={listing} />
          <h3 className="min-h-10 font-semibold text-main leading-5 line-clamp-2 text-[15px] font-display">{listing.title}</h3>
          <RatingLine listing={listing} />
          <div className="flex items-center justify-between gap-2 mt-auto pt-2">
            <PriceBlock value={listing.pricePerDay} />
            {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && <ProtectionBadge size="sm" />}
          </div>
        </div>
      </a>
      <FavoriteButton liked={liked} onToggle={toggleLiked} className="absolute top-2 right-2 z-10" />
    </article>
  );
}

export function ListingCardWide({ listing, onClick, favorited, onToggleFavorite }: { listing: Listing; onClick?: () => void; favorited?: boolean; onToggleFavorite?: () => void }) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = favorited ?? likedLocal;
  const toggleLiked = onToggleFavorite ?? (() => setLikedLocal(!likedLocal));
  return (
    <article
      className="group relative flex h-full min-h-[152px] gap-3.5 bg-card rounded-card-lg overflow-hidden border border-app shadow-xs card-hover p-3"
    >
      <a
        href={`/listing/${encodeURIComponent(listing.id)}`}
        aria-label={`View listing: ${listing.title}`}
        onClick={(e) => handleListingLinkClick(e, onClick)}
        className="flex min-w-0 flex-1 gap-3.5 rounded-[inherit] pr-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-accent"
      >
        <div className="relative w-28 sm:w-36 shrink-0 overflow-hidden rounded-card aspect-[4/3] bg-subtle self-start">
          <ListingPhoto images={listing.images} className="w-full h-full object-cover zoom-media" />
        </div>
        <div className="flex min-h-[126px] flex-1 min-w-0 flex-col gap-1">
          <div className="min-w-0">
            <MetaLine listing={listing} />
            <h3 className="min-h-10 font-semibold text-main leading-5 line-clamp-2 text-[15px] font-display mt-0.5">{listing.title}</h3>
          </div>
          <RatingLine listing={listing} />
          <div className="flex items-center justify-between gap-2 mt-auto pt-1.5">
            <PriceBlock value={listing.pricePerDay} />
            {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && <ProtectionBadge size="sm" />}
          </div>
        </div>
      </a>
      <FavoriteButton liked={liked} onToggle={toggleLiked} className="absolute top-2.5 right-2.5 z-10" />
    </article>
  );
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
