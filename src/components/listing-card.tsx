import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Heart, Star, Zap } from 'lucide-react';
import type { Listing } from '@/data';
import { Badge } from '@/components/ui';
import { ProtectionBadge } from '@/components/trust';
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
    ? `${listing.distance} ${listing.distanceUnit} away`
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

export function ListingCard({ listing, onClick, favorited, onToggleFavorite }: { listing: Listing; onClick?: () => void; favorited?: boolean; onToggleFavorite?: () => void }) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = favorited ?? likedLocal;
  const toggleLiked = onToggleFavorite ?? (() => setLikedLocal(!likedLocal));
  return (
    <article
      onClick={onClick}
      className="group flex h-full flex-col bg-card rounded-card-lg overflow-hidden border border-app shadow-xs card-hover cursor-pointer"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-subtle">
        <img
          src={listing.images[0]}
          alt={listing.title}
          loading="lazy"
          className="w-full h-full object-cover zoom-media"
        />
        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          {listing.instantBooking && <Badge tone="inverse" icon={<Zap size={11} />}>Instant</Badge>}
          {!listing.available && <Badge tone="neutral" className="bg-card">Booked</Badge>}
        </div>
        <FavoriteButton liked={liked} onToggle={toggleLiked} className="absolute top-2 right-2" />
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
    </article>
  );
}

export function ListingCardWide({ listing, onClick, favorited, onToggleFavorite }: { listing: Listing; onClick?: () => void; favorited?: boolean; onToggleFavorite?: () => void }) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = favorited ?? likedLocal;
  const toggleLiked = onToggleFavorite ?? (() => setLikedLocal(!likedLocal));
  return (
    <article
      onClick={onClick}
      className="group flex h-full min-h-[152px] gap-3.5 bg-card rounded-card-lg overflow-hidden border border-app shadow-xs card-hover cursor-pointer p-3"
    >
      <div className="relative w-28 sm:w-36 shrink-0 overflow-hidden rounded-card aspect-[4/3] bg-subtle self-start">
        <img src={listing.images[0]} alt={listing.title} loading="lazy" className="w-full h-full object-cover zoom-media" />
      </div>
      <div className="flex min-h-[126px] flex-1 min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <MetaLine listing={listing} />
            <h3 className="min-h-10 font-semibold text-main leading-5 line-clamp-2 text-[15px] font-display mt-0.5">{listing.title}</h3>
          </div>
          <FavoriteButton liked={liked} onToggle={toggleLiked} className="shrink-0 -mt-0.5 -mr-0.5" />
        </div>
        <RatingLine listing={listing} />
        <div className="flex items-center justify-between gap-2 mt-auto pt-1.5">
          <PriceBlock value={listing.pricePerDay} />
          {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && <ProtectionBadge size="sm" />}
        </div>
      </div>
    </article>
  );
}

const SWIPE_THRESHOLD_PX = 40;

export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const count = images.length;

  const step = (delta: number) => setActive((a) => (a + delta + count) % count);

  useEffect(() => { setActive(0); }, [images]);

  return (
    <div className="space-y-3">
      <div
        className="relative aspect-[4/3] sm:aspect-[16/10] rounded-card-xl overflow-hidden bg-subtle group select-none"
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
        aria-label={`${title} - image ${active + 1} of ${count}`}
      >
        <img key={active} src={images[active]} alt={title} className="w-full h-full object-cover animate-cross-fade" />
        {count > 1 && (
          <>
            <button
              onClick={() => step(-1)}
              aria-label="Previous image"
              className="hidden sm:grid place-items-center absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-standard"
            >
              <ChevronLeft size={20} className="text-gray-900" />
            </button>
            <button
              onClick={() => step(1)}
              aria-label="Next image"
              className="hidden sm:grid place-items-center absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-standard"
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
        <div className="hidden sm:flex gap-2 overflow-x-auto no-scrollbar">
          {images.map((img, i) => (
            <button
              key={img + i}
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              className={`w-20 h-16 rounded-card shrink-0 overflow-hidden border-2 transition-all duration-fast ${i === active ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-100'}`}
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
