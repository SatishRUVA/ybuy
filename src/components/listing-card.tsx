import { useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Heart, Share } from 'lucide-react';
import type { Listing } from '@/data';
import { Rating, VerifiedBadge, ProtectionBadge } from '@/components/trust';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';

export function ListingCard({ listing, onClick, compact = false, favorited, onToggleFavorite }: { listing: Listing; onClick?: () => void; compact?: boolean; favorited?: boolean; onToggleFavorite?: () => void }) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = favorited ?? likedLocal;
  const toggleLiked = onToggleFavorite ?? (() => setLikedLocal(!likedLocal));
  return (
    <div
      onClick={onClick}
      className="group bg-card rounded-card-xl overflow-hidden border border-app shadow-card card-hover cursor-pointer animate-fade-up"
    >
      <div className={`relative overflow-hidden ${compact ? 'aspect-[4/3]' : 'aspect-[5/4]'}`}>
        <img
          src={listing.images[0]}
          alt={listing.title}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          {listing.instantBooking && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent text-accent-text shadow-sm">
              Instant
            </span>
          )}
          {!listing.available && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-subtle text-sec border border-app">
              Booked
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); toggleLiked(); }}
          className="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-card/80 backdrop-blur-sm shadow-sm hover:scale-110 transition-transform duration-fast ease-out"
        >
          <Heart size={16} className={liked ? 'fill-accent text-accent' : 'text-main'} />
        </button>
      </div>
      <div className="p-3.5 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm text-main leading-snug line-clamp-1">{listing.title}</h3>
          <Rating value={listing.rating} size="sm" />
        </div>
        {listing.distance > 0 && (
          <div className="flex items-center gap-1 text-xs text-sec">
            <MapPin size={12} />
            {listing.distance} {listing.distanceUnit} away
          </div>
        )}
        {listing.verifiedOwner && <VerifiedBadge size="xs" />}
        <div className="flex items-center justify-between pt-1.5">
          <div className="flex items-baseline gap-0.5">
            <span className="font-bold text-base text-main">${listing.pricePerDay}</span>
            <span className="text-xs text-sec">/day</span>
          </div>
          {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && <ProtectionBadge size="sm" />}
        </div>
      </div>
    </div>
  );
}

export function ListingCardWide({ listing, onClick, favorited, onToggleFavorite }: { listing: Listing; onClick?: () => void; favorited?: boolean; onToggleFavorite?: () => void }) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = favorited ?? likedLocal;
  const toggleLiked = onToggleFavorite ?? (() => setLikedLocal(!likedLocal));
  return (
    <div
      onClick={onClick}
      className="group flex gap-3 bg-card rounded-card-xl overflow-hidden border border-app shadow-card card-hover cursor-pointer animate-fade-up p-2.5"
    >
      <div className="relative w-32 sm:w-40 shrink-0 overflow-hidden rounded-card-lg aspect-square">
        <img src={listing.images[0]} alt={listing.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
      </div>
      <div className="flex-1 min-w-0 py-1 flex flex-col justify-between">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-main leading-snug">{listing.title}</h3>
            <button onClick={(e) => { e.stopPropagation(); toggleLiked(); }} className="shrink-0 transition-transform duration-fast ease-out hover:scale-110">
              <Heart size={16} className={liked ? 'fill-accent text-accent' : 'text-muted'} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-sec">
            {listing.distance > 0 && (
              <>
                <span className="flex items-center gap-0.5"><MapPin size={12} />{listing.distance} {listing.distanceUnit}</span>
                <span className="text-muted">·</span>
              </>
            )}
            <Rating value={listing.rating} count={listing.reviewCount} size="sm" />
          </div>
          {listing.verifiedOwner && <VerifiedBadge size="xs" />}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-0.5">
            <span className="font-bold text-base text-main">${listing.pricePerDay}</span>
            <span className="text-xs text-sec">/day</span>
          </div>
          {SHOW_OUT_OF_SCOPE_PAGES && listing.protectionEligible && <ProtectionBadge size="sm" />}
        </div>
      </div>
    </div>
  );
}

export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] rounded-card-xl overflow-hidden bg-subtle group">
        <img src={images[active]} alt={title} className="w-full h-full object-cover animate-fade-in" />
        {images.length > 1 && (
          <>
            <button
              onClick={() => setActive((a) => (a - 1 + images.length) % images.length)}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-card/80 backdrop-blur-sm shadow-card hover:scale-110 transition-transform"
            >
              <ChevronLeft size={20} className="text-main" />
            </button>
            <button
              onClick={() => setActive((a) => (a + 1) % images.length)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-card/80 backdrop-blur-sm shadow-card hover:scale-110 transition-transform"
            >
              <ChevronRight size={20} className="text-main" />
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`h-1.5 rounded-full transition-all ${i === active ? 'w-6 bg-card' : 'w-1.5 bg-card/50'}`}
                />
              ))}
            </div>
          </>
        )}
        <button className="absolute top-3 right-3 p-2 rounded-full bg-card/80 backdrop-blur-sm shadow-card hover:scale-110 transition-transform">
          <Share size={16} className="text-main" />
        </button>
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`w-20 h-20 rounded-card shrink-0 overflow-hidden border-2 transition-all ${i === active ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-100'}`}
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
