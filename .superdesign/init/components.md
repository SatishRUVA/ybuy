# Components - shared UI primitives (full source)

Repository: YBuy, a local peer-to-peer rental marketplace (renters and owners; exactly two booking paths: regular booking or competitive bidding).

Detected stack:
- Framework: React 18.3 + TypeScript 5.5, bundled by Vite 5 (`vite.config.ts`, alias `@/` -> `src/`). No meta-framework (not Next.js).
- Routing: custom History-API router in `src/router.tsx` (see routes.md).
- Component library: custom. Primitives in `src/components/ui.tsx`; hand-written Radix wrappers in `src/components/shadcn/*` (dialog/sheet, alert-dialog, select, switch, card, table). Not a shadcn registry install.
- CSS: Tailwind CSS v3 utilities + semantic utility classes bound to CSS variables (`bg-app`, `bg-card`, `bg-subtle`, `text-main`, `text-sec`, `text-muted`, `border-app`, `border-strong`, `bg-accent`, `rounded-card*`, `shadow-*`, `tnum`) defined in `src/index.css`; variable values injected at runtime by `src/theme-context.tsx` from `src/themes.ts` (see theme.md).
- Icons: `lucide-react` stroke icons (11-26px). Motion: `motion/react` + CSS keyframes in `src/index.css`. Class merge helper: `cn()` (clsx + tailwind-merge).

Code rule (ui.tsx header): every button, badge, alert, section heading and empty state renders through these primitives; add a variant instead of hand-rolling classes.

## Index

| Component | File | What it renders | Key props |
|---|---|---|---|
| Button | `src/components/ui.tsx` | Action button (`rounded-card`, semibold, press scale 0.98) | variant primary/secondary/ghost/danger/success/inverse/onDark; size sm/md/lg; loading, loadingLabel, icon, trailingIcon, fullWidth |
| IconButton | `src/components/ui.tsx` | Square icon-only button (44px default) | label (required), variant, size |
| Badge | `src/components/ui.tsx` | Small pill label, 11px semibold | tone neutral/accent/success/warning/error/inverse, icon |
| Alert | `src/components/ui.tsx` | Inline status block (role=status), icon + text | tone warning/error/success/info, title |
| SectionHeader | `src/components/ui.tsx` | Heading row with optional right action link | title, subtitle, as h1/h2/h3, actionLabel+onAction or action |
| EmptyState | `src/components/ui.tsx` | Dashed panel with one next action | icon, title, description, actionLabel, onAction |
| Surface | `src/components/ui.tsx` | Bordered card surface (`bg-card border-app rounded-card-lg`) | interactive |
| Field | `src/components/ui.tsx` | Label + control + inline error | label, hint, error, htmlFor |
| Overlay | `src/components/ui.tsx` | Portal layer for modals/sheets | className |
| fieldClass / textareaClass | `src/components/form-classes.ts` | Input / textarea skins (h-11, border-strong, focus ring) | extra classes |
| cn | `src/lib/utils.ts` | clsx + tailwind-merge | - |
| FavoriteButton | `src/components/listing-card.tsx` | Round heart toggle with pop animation | liked, onToggle |
| ListingCard | `src/components/listing-card.tsx` | Grid card: 4:3 photo, Instant/Booked badges, meta line, 2-line title, rating line, price/day | listing, onClick, favorited, onToggleFavorite |
| ListingCardWide | `src/components/listing-card.tsx` | Horizontal row variant of ListingCard | same as ListingCard |
| ImageGallery | `src/components/listing-card.tsx` | Listing photo viewer: main image, arrows, counter, thumbnail rail, swipe | images, title |
| Rating, VerifiedBadge, TrustChip, ProtectionBadge, SecurityHoldNote, TrustChecklist, ShieldStamp | `src/components/trust.tsx` | Trust and rating atoms | value/count/size; label/size; icon/label/tone; amount; items |
| BrandLogo | `src/components/brand-logo.tsx` | Logo image `src/assets/ybuy-logo.png` (144x53 box); compact shows `src/assets/ybuy-icon.png` below sm | compact |
| CategoryIcon | `src/components/category-icon.tsx` | lucide icon chosen by category | see source |
| Skeleton family | `src/components/skeleton.tsx` | Fixed-size loading placeholders (listing grid/detail, bookings, conversations) | see source |
| SuccessIndicator / SuccessFeedback / SuccessNotice | `src/components/success-feedback.tsx` | Success confirmation visuals (check, halo, optional confetti) | see source |
| AvailabilityCalendar | `src/components/availability-calendar.tsx` | Month grid showing booked / blocked days | see source |
| DatePicker | `src/components/date-picker.tsx` | Single-date field | value, onChange, label, id, min, max, required, disabled |
| DateRangePicker / MonthGrid | `src/components/date-range-picker.tsx` | Date range trigger + calendar dialog (search and listing presentations) | startDate, endDate, bookedDates, blockedDates, minimumDate, maximumDate, onChange, presentation |
| SearchBar / SearchRadiusSelect / ThemeSwitcher | `src/components/search.tsx` | Keyword + location + radius + dates search control (hero and compact variants) | variant, defaultValue, initialStartDate, initialEndDate, initialRadius, onSearch |
| Dialog/SheetContent, AlertDialog, Select, Switch, Card, Table | `src/components/shadcn/*.tsx` | Radix wrappers | Radix props |

## ui.tsx - Overlay, Button, IconButton, Badge, Alert, SectionHeader, EmptyState, Surface, Field

- File: `src/components/ui.tsx` - 226 lines in file
- Design-system primitives used by every page.

```tsx
/**
 * YBuy design-system primitives.
 *
 * Every button, badge, alert, section heading and empty state in the app renders through one of
 * these so tone, size, radius, focus ring and loading behaviour stay identical everywhere.
 * Add a variant here rather than hand-rolling classes in a page.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

/**
 * Full-screen layer for modals and sheets, rendered at the document root.
 * The route wrapper animates opacity, which creates a stacking context - anything overlay-like
 * left inside it would paint underneath the sticky header and bottom nav.
 */
export function Overlay({ children, className = '' }: { children: ReactNode; className?: string }) {
  return createPortal(
    <div className={`fixed inset-0 z-[200] ${className}`}>{children}</div>,
    document.body,
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'inverse' | 'onDark';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex min-w-0 max-w-full items-center justify-center gap-2 font-semibold rounded-card whitespace-normal break-words text-center leading-snug [&>svg]:shrink-0 ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-fast ease-out ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-text shadow-xs hover:bg-accent-hover',
  secondary: 'bg-card text-main border border-strong hover:bg-subtle',
  ghost: 'text-sec hover:text-main hover:bg-subtle',
  danger: 'bg-card text-error border border-app hover:bg-error-soft',
  success: 'bg-success text-white shadow-xs hover:opacity-90',
  // For placement on an accent-filled panel.
  inverse: 'bg-card text-accent shadow-xs hover:bg-subtle',
  // For placement over photography.
  onDark: 'bg-white/10 text-white border border-white/35 backdrop-blur-sm hover:bg-white/20',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3.5 py-2 text-[13px]',
  md: 'min-h-11 px-4 py-2.5 text-sm',
  lg: 'min-h-12 px-6 py-3 text-[15px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Text shown in place of children while `loading` - keeps the same verb as the idle label. */
  loadingLabel?: string;
  fullWidth?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant = 'primary', size = 'md', loading = false, loadingLabel,
  fullWidth = false, icon, trailingIcon, className = '', children, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin shrink-0" /> : icon}
      {loading ? (loadingLabel ?? children) : children}
      {!loading && trailingIcon}
    </button>
  );
}

/** Square icon-only control. Always pass `label` - it becomes the accessible name. */
export function IconButton({
  label, variant = 'secondary', size = 'md', className = '', children, ...rest
}: Omit<ButtonProps, 'icon' | 'trailingIcon' | 'loading' | 'fullWidth'> & { label: string }) {
  const box = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-11 w-11';
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${box} shrink-0 p-0 ${className}`}
    >
      {children}
    </button>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'inverse';

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-subtle text-sec border-app',
  accent: 'bg-accent-soft text-accent border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  error: 'bg-error-soft text-error border-transparent',
  inverse: 'bg-[var(--text)] text-[var(--bg-card)] border-transparent',
};

export function Badge({
  tone = 'neutral', icon, children, className = '',
}: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold leading-5 whitespace-nowrap ${BADGE_TONE[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Inline, in-context feedback. Used instead of floating toasts so the message sits next to the thing it describes. */
export function Alert({
  tone = 'warning', title, children, className = '',
}: { tone?: 'warning' | 'error' | 'success' | 'info'; title?: string; children?: ReactNode; className?: string }) {
  const map = {
    warning: { cls: 'bg-warning-soft text-warning', Icon: AlertTriangle },
    error: { cls: 'bg-error-soft text-error', Icon: AlertTriangle },
    success: { cls: 'bg-success-soft text-success', Icon: CheckCircle2 },
    info: { cls: 'bg-accent-soft text-accent', Icon: Info },
  }[tone];
  const { Icon } = map;
  return (
    <div role="status" className={`flex items-start gap-2.5 p-3 rounded-card-lg ${map.cls} ${className}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div className="text-sm leading-relaxed min-w-0 [overflow-wrap:anywhere]">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** Page/section heading with an optional right-hand action. One heading rhythm across the app. */
export function SectionHeader({
  title, subtitle, action, actionLabel, onAction, as: Tag = 'h2', className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  const size = Tag === 'h1' ? 'text-[26px] sm:text-[32px]' : Tag === 'h2' ? 'text-xl sm:text-2xl' : 'text-lg';
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-3 ${className}`}>
      <div className="min-w-0 flex-1 basis-56">
        <Tag className={`${size} font-bold text-main font-display leading-tight`}>{title}</Tag>
        {subtitle && <p className="text-sec text-sm mt-1 leading-relaxed [overflow-wrap:anywhere]">{subtitle}</p>}
      </div>
      {action ??
        (actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="shrink-0 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent hover:text-accent-hover transition-colors duration-fast"
          >
            {actionLabel}
            <ArrowRight size={15} />
          </button>
        ) : null)}
    </div>
  );
}

/** Helpful, actionable empty state - never a bare "No results". */
export function EmptyState({
  icon, title, description, actionLabel, onAction, className = '',
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center text-center py-14 px-6 rounded-card-xl border border-dashed border-strong bg-card ${className}`}>
      {icon && (
        <div className="w-12 h-12 rounded-full bg-subtle flex items-center justify-center text-sec mb-3">{icon}</div>
      )}
      <h3 className="font-semibold text-main">{title}</h3>
      {description && <p className="text-sm text-sec mt-1.5 max-w-sm leading-relaxed">{description}</p>}
      {actionLabel && onAction && (
        <Button size="sm" className="mt-5" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  );
}

/** Standard bordered surface. Pass `interactive` for cards that are clickable. */
export function Surface({
  interactive = false, className = '', children, ...rest
}: { interactive?: boolean; className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`bg-card border border-app rounded-card-lg ${interactive ? 'card-hover cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/** Form field wrapper: label, control, and inline validation message in one consistent rhythm. */
export function Field({
  label, hint, error, htmlFor, children,
}: { label: string; hint?: ReactNode; error?: string | null; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-main mb-1.5">{label}</label>
      {hint}
      {children}
      {error && <p id={htmlFor ? `${htmlFor}-error` : undefined} className="text-xs text-error mt-1.5">{error}</p>}
    </div>
  );
}
```

## form-classes.ts - fieldClass, textareaClass

- File: `src/components/form-classes.ts` - 12 lines in file
- Shared input/textarea class skins used with Field.

```ts
/**
 * Shared form-control skins. Kept out of `ui.tsx` so that file exports components only
 * (react-refresh requirement). Import alongside `Field` from `@/components/ui`.
 */
const FIELD_BASE =
  'w-full min-w-0 max-w-full bg-card border border-strong rounded-card text-base sm:text-sm text-main placeholder:text-muted ' +
  'outline-none transition-[border-color,box-shadow] duration-fast ease-out ' +
  'focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)] ' +
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-[var(--error)]';

export const fieldClass = (extra = '') => `${FIELD_BASE} px-3 h-11 ${extra}`;
export const textareaClass = (extra = '') => `${FIELD_BASE} px-3 py-2.5 resize-none ${extra}`;
```

## utils.ts - cn

- File: `src/lib/utils.ts` - 6 lines in file
- Class name merge helper.

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## listing-card.tsx - FavoriteButton, ListingCard, ListingCardWide, ImageGallery

- File: `src/components/listing-card.tsx` - 238 lines in file
- Listing presentation used on search, listing detail (similar rentals, gallery), favorites, home (FavoriteButton).

```tsx
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Heart, Star, Zap, ImageOff } from 'lucide-react';
import type { Listing } from '@/data';
import { Badge } from '@/components/ui';
import { ProtectionBadge } from '@/components/trust';
import { SHOW_OUT_OF_SCOPE_PAGES } from '@/lib/feature-flags';

/** Shared heart control: same hit area, same pop, wherever a listing can be saved. */
export function FavoriteButton({
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

export function ListingCard({ listing, onClick, favorited, onToggleFavorite }: { listing: Listing; onClick?: () => void; favorited?: boolean; onToggleFavorite?: () => void }) {
  const [likedLocal, setLikedLocal] = useState(false);
  const liked = favorited ?? likedLocal;
  const toggleLiked = onToggleFavorite ?? (() => setLikedLocal(!likedLocal));
  return (
    <article
      className="group relative flex h-full flex-col bg-card rounded-card-lg overflow-hidden border border-app shadow-xs card-hover"
    >
      <a
        href={`/listing/${encodeURIComponent(listing.id)}`}
        aria-label={`View listing: ${listing.title}`}
        onClick={(e) => handleListingLinkClick(e, onClick)}
        className="flex h-full flex-col rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-accent"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-subtle">
          <img
            src={listing.images[0]}
            alt=""
            loading="lazy"
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
          <img src={listing.images[0]} alt="" loading="lazy" className="w-full h-full object-cover zoom-media" />
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
```

## trust.tsx - Rating, VerifiedBadge, TrustChip, ProtectionBadge, SecurityHoldNote, TrustChecklist, ShieldStamp

- File: `src/components/trust.tsx` - 96 lines in file
- Trust and rating atoms.

```tsx
import { Star, ShieldCheck, BadgeCheck, Lock, Shield } from 'lucide-react';
import type { ReactNode } from 'react';

export function Rating({ value, count, size = 'sm' }: { value: number; count?: number; size?: 'sm' | 'md' | 'lg' }) {
  const starSize = size === 'lg' ? 18 : size === 'md' ? 16 : 14;
  const textSize = size === 'lg' ? 'text-base' : size === 'md' ? 'text-sm' : 'text-xs';
  // No reviews yet is stated plainly rather than shown as a 0.0 score.
  if (count === 0 || (count === undefined && value === 0)) {
    return <span className={`text-sec ${textSize}`}>No reviews yet</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <Star size={starSize} className="fill-[var(--star)] text-[var(--star)]" />
      <span className={`font-semibold text-main tnum ${textSize}`}>{value.toFixed(1)}</span>
      {count !== undefined && (
        <span className={`text-sec tnum ${textSize}`}>({count})</span>
      )}
    </div>
  );
}

export function VerifiedBadge({ label = 'Verified owner', size = 'sm' }: { label?: string; size?: 'sm' | 'xs' }) {
  const iconSize = size === 'xs' ? 12 : 14;
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs';
  return (
    <span className={`inline-flex items-center gap-1 ${textSize} font-medium text-success`}>
      <BadgeCheck size={iconSize} className="text-success" />
      {label}
    </span>
  );
}

export function TrustChip({ icon, label, tone = 'default' }: { icon: ReactNode; label: string; tone?: 'default' | 'success' | 'warning' | 'accent' }) {
  const toneClass = {
    default: 'bg-subtle text-sec border-app',
    success: 'bg-success-soft text-success border-app',
    warning: 'bg-warning-soft text-warning border-app',
    accent: 'bg-accent-soft text-accent border-app',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${toneClass}`}>
      {icon}
      {label}
    </span>
  );
}

export function ProtectionBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const iconSize = size === 'md' ? 18 : 14;
  const textSize = size === 'md' ? 'text-sm' : 'text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 ${textSize} font-semibold text-accent`}>
      <Shield size={iconSize} className="text-accent" />
      Rental Protection
    </span>
  );
}

export function SecurityHoldNote({ amount }: { amount: number }) {
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-card-lg bg-warning-soft">
      <Lock size={16} className="text-warning shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold text-main tnum">${amount} refundable security deposit</p>
        <p className="text-sec mt-0.5 text-xs leading-relaxed">
          Charged at checkout, not rental revenue. Refunded after owner-confirmed return when no unresolved dispute exists.
        </p>
      </div>
    </div>
  );
}

export function TrustChecklist({ items }: { items: { icon: ReactNode; label: string }[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5 text-sm">
          <span className="text-success shrink-0">{item.icon}</span>
          <span className="text-sec">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function ShieldStamp() {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-card bg-accent-soft">
      <ShieldCheck size={18} className="text-accent shrink-0" />
      <div className="text-xs">
        <p className="font-semibold text-accent">Secure payment</p>
        <p className="text-sec">Your card is charged only after the owner approves</p>
      </div>
    </div>
  );
}
```

## brand-logo.tsx - BrandLogo

- File: `src/components/brand-logo.tsx` - 11 lines in file
- The only logo renderer (header, home footer). Asset: src/assets/ybuy-logo.png (1882x697 transparent PNG: mint-to-teal Y mark + harbor-ink "Buy" wordmark + "RENT ANYTHING LOCALLY").

```tsx
import logo from '@/assets/ybuy-logo.png';
import icon from '@/assets/ybuy-icon.png';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <span className="inline-flex shrink-0 items-center" role="img" aria-label="YBuy">
    {compact && <img src={icon} alt="" width={36} height={36} className="h-9 w-9 object-contain sm:hidden" />}
    <span className={compact ? 'hidden sm:block' : 'block'}>
      <img src={logo} alt="" width={144} height={53} className="h-12 w-36 rounded-card object-contain [.dark_&]:bg-white [.dark_&]:px-1" />
    </span>
  </span>;
}
```

## category-icon.tsx - CategoryIcon

- File: `src/components/category-icon.tsx` - 54 lines in file
- Maps a category to a lucide icon.

```tsx
import {
  Baby, Camera, Car, Dumbbell, Home, Leaf, Monitor, Music, Package,
  PartyPopper, Tent, Trees, Wrench, type LucideIcon,
} from 'lucide-react';
import type { Category } from '@/data';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Baby,
  Camera,
  Car,
  Dumbbell,
  Home,
  Leaf,
  Monitor,
  Music,
  Package,
  PartyPopper,
  Tent,
  Trees,
  Wrench,
};

const NAMED_ICONS: Record<string, LucideIcon> = {
  tools: Wrench,
  toolsequipment: Wrench,
  electronics: Monitor,
  camping: Tent,
  outdoorcamping: Tent,
  outdoors: Tent,
  party: PartyPopper,
  partyevents: PartyPopper,
  events: PartyPopper,
  sports: Dumbbell,
  sportsfitness: Dumbbell,
  fitness: Dumbbell,
  vehicle: Car,
  vehicles: Car,
  homegarden: Leaf,
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function CategoryIcon({
  category, size = 18, className,
}: { category: Pick<Category, 'id' | 'name' | 'icon'>; size?: number; className?: string }) {
  const iconKey = [category.id, category.name].map(normalize).find((key) => NAMED_ICONS[key]);
  const Icon = (iconKey ? NAMED_ICONS[iconKey] : undefined)
    ?? CATEGORY_ICONS[category.icon]
    ?? Package;

  return <Icon size={size} className={className} aria-hidden="true" />;
}
```

## skeleton.tsx - Skeleton and page skeletons

- File: `src/components/skeleton.tsx` - 144 lines in file
- Loading placeholders matching final layouts.

```tsx
/**
 * Base skeleton rectangle. Compose every loading screen from this instead of
 * hand-building each one - pass sizing via `className` and shape via `rounded`.
 */
export function Skeleton({ className = '', rounded = 'rounded-card' }: { className?: string; rounded?: string }) {
  return <div className={`skeleton ${rounded} ${className}`} />;
}

export function ListingAiSkeleton() {
  return (
    <div role="status" aria-label="Generating AI suggestions" aria-live="polite" aria-busy="true" className="space-y-3 rounded-card border border-app p-4">
      <span className="sr-only">Generating suggestions from your photos. You can keep editing.</span>
      <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

/** Mirrors ListingCard: 4:3 media, meta line, two-line title, rating, price. */
export function ListingCardSkeleton() {
  return (
    <div className="flex h-full flex-col bg-card rounded-card-lg overflow-hidden border border-app shadow-xs">
      <Skeleton className="w-full aspect-[4/3]" rounded="rounded-none" />
      <div className="flex min-h-[152px] flex-1 flex-col gap-1.5 p-3.5">
        <Skeleton className="h-4 w-1/2" rounded="rounded-card-sm" />
        <div className="flex h-10 flex-col justify-center gap-1">
          <Skeleton className="h-4 w-full" rounded="rounded-card-sm" />
          <Skeleton className="h-4 w-2/3" rounded="rounded-card-sm" />
        </div>
        <Skeleton className="h-4 w-1/3" rounded="rounded-card-sm" />
        <div className="mt-auto pt-2">
          <Skeleton className="h-5 w-16" rounded="rounded-card-sm" />
        </div>
      </div>
    </div>
  );
}

/** Mirrors ListingCardWide's row layout (4:3 thumb + stacked text lines). */
export function ListingCardWideSkeleton() {
  return (
    <div className="flex h-full min-h-[152px] gap-3.5 bg-card rounded-card-lg overflow-hidden border border-app shadow-xs p-3">
      <Skeleton className="w-28 sm:w-36 shrink-0 aspect-[4/3]" rounded="rounded-card" />
      <div className="flex min-h-[126px] flex-1 flex-col gap-1">
        <Skeleton className="h-4 w-1/3" rounded="rounded-card-sm" />
        <div className="flex h-10 flex-col justify-center gap-1">
          <Skeleton className="h-4 w-3/4" rounded="rounded-card-sm" />
          <Skeleton className="h-4 w-1/2" rounded="rounded-card-sm" />
        </div>
        <Skeleton className="h-4 w-1/2" rounded="rounded-card-sm" />
        <div className="mt-auto pt-1.5">
          <Skeleton className="h-5 w-16" rounded="rounded-card-sm" />
        </div>
      </div>
    </div>
  );
}

export function ListingGridSkeleton({ count = 10, className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4' }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => <ListingCardSkeleton key={i} />)}
    </div>
  );
}

/** Mirrors ListingPage: title block, 16:10 gallery, detail blocks, sticky booking panel. */
export function ListingDetailSkeleton() {
  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 sm:py-8">
      <div className="space-y-2.5 mb-5">
        <Skeleton className="h-3 w-24" rounded="rounded-card-sm" />
        <Skeleton className="h-9 w-2/3" rounded="rounded-card-sm" />
        <Skeleton className="h-4 w-1/3" rounded="rounded-card-sm" />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-8 lg:gap-10">
        <div className="space-y-5">
          <Skeleton className="w-full aspect-[4/3] sm:aspect-[16/10]" rounded="rounded-card-xl" />
          <div className="flex gap-2">
            <Skeleton className="h-11 w-52" rounded="rounded-card" />
            <Skeleton className="h-11 w-40" rounded="rounded-card" />
          </div>
          <div className="space-y-2 pt-3">
            <Skeleton className="h-4 w-full" rounded="rounded-card-sm" />
            <Skeleton className="h-4 w-5/6" rounded="rounded-card-sm" />
            <Skeleton className="h-4 w-2/3" rounded="rounded-card-sm" />
          </div>
        </div>
        <div>
          <Skeleton className="w-full h-[420px]" rounded="rounded-card-lg" />
        </div>
      </div>
    </div>
  );
}

/** Mirrors a dashboard booking row: thumbnail + title/date lines + price column. */
export function BookingRowSkeleton() {
  return (
    <div className="p-3.5 rounded-card-lg bg-card border border-app">
      <div className="flex gap-3.5">
        <Skeleton className="w-20 h-20 shrink-0" rounded="rounded-card" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" rounded="rounded-card-sm" />
          <Skeleton className="h-3 w-1/3" rounded="rounded-card-sm" />
          <Skeleton className="h-5 w-28" rounded="rounded-full" />
        </div>
        <Skeleton className="h-4 w-12 shrink-0" rounded="rounded-card-sm" />
      </div>
    </div>
  );
}

export function BookingListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => <BookingRowSkeleton key={i} />)}
    </div>
  );
}

/** Mirrors a conversation-list row: avatar circle + name/preview lines. */
export function ConversationRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-card-lg border border-app bg-card">
      <Skeleton className="w-11 h-11 shrink-0" rounded="rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" rounded="rounded-card-sm" />
        <Skeleton className="h-3 w-2/3" rounded="rounded-card-sm" />
      </div>
    </div>
  );
}

export function ConversationListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => <ConversationRowSkeleton key={i} />)}
    </div>
  );
}
```

## success-feedback.tsx - SuccessIndicator, SuccessFeedback, SuccessNotice

- File: `src/components/success-feedback.tsx` - 164 lines in file
- Success states (uses .success-* CSS in index.css).

```tsx
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, Check, Plus, Settings2, Share2, X } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Button, IconButton, Surface } from '@/components/ui';
import type { UiBooking } from '@/lib/bookings';
import type { ConfirmedPayment } from '@/lib/payments';

// One shared burst: every success moment plays it on each mount, including reload.
function Confetti({ eventKey }: { eventKey: string }) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setVisible(!media.matches);
    const stop = () => { if (media.matches) setVisible(false); };
    media.addEventListener('change', stop);
    const timer = window.setTimeout(() => setVisible(false), 2800);
    return () => { window.clearTimeout(timer); media.removeEventListener('change', stop); };
  }, [eventKey, userId]);
  if (!visible) return null;
  return (
    <div aria-hidden="true" className="success-confetti listing-hero-confetti">
      {Array.from({ length: 64 }, (_, index) => {
        return <span key={index} style={{
          '--burst-x': `${(index % 2 ? -1 : 1) * (40 + (index * 31) % 300)}px`,
          '--burst-y': `${-80 - (index * 17) % 140}px`,
          '--fall': `${280 + (index * 13) % 100}px`,
          left: index % 2 ? '92%' : '8%', top: '36%',
          '--turn': `${index % 2 ? 180 + index * 11 : -180 - index * 9}deg`,
          '--particle-size': `${5 + index % 4}px`,
          animationDelay: `${(index % 8) * 35}ms`,
          borderRadius: index % 3 === 0 ? '50%' : '1px',
          '--particle-color': ['var(--accent)', 'var(--success)', 'var(--accent-soft)', 'var(--success-soft)', 'var(--star)'][index % 5],
        } as CSSProperties}><i /></span>;
      })}
    </div>
  );
}

export function SuccessIndicator({ eventKey, level = 'subtle' }: {
  eventKey?: string;
  level?: 'subtle' | 'standard' | 'major';
}) {
  return (
    <div aria-hidden="true" className={`success-indicator relative grid h-12 w-12 shrink-0 place-items-center ${level === 'subtle' ? 'success-indicator-subtle' : ''}`}>
      <span className="success-halo absolute inset-0 rounded-full bg-success-soft" />
      <span className="success-check relative grid h-full w-full place-items-center rounded-full bg-success-soft text-success">
        <Check size={26} strokeWidth={2.5} className="success-checkmark" />
      </span>
      {eventKey && level !== 'subtle' && <Confetti key={eventKey} eventKey={eventKey} />}
    </div>
  );
}

type Action = { label: string; onClick: () => void };
type SuccessFeedbackProps = {
  primary: Action;
  secondary?: Action;
  tertiary?: Action;
} & (
  | { kind: 'listing'; id: string; title: string; image?: string; onListAnother?: () => void }
  | { kind: 'booking'; booking: UiBooking; payment: ConfirmedPayment | null }
);

export function SuccessFeedback(props: SuccessFeedbackProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const booking = props.kind === 'booking' ? props.booking : null;
  const payment = props.kind === 'booking' ? props.payment : null;
  const eventKey = props.kind === 'listing' ? `listing:${props.id}` : `booking:${props.booking.id}`;
  useEffect(() => {
    if (props.kind === 'listing' || payment) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      heading.current?.focus({ preventScroll: true });
    }
  }, [props.kind, payment]);
  if (booking && booking.status !== 'confirmed') return null;
  const title = props.kind === 'listing' ? 'Your listing is live!' : payment ? 'Payment confirmed' : 'Booking confirmed';
  if (props.kind === 'listing') return (
    <Surface role="region" aria-labelledby={headingId} className="success-card listing-success-hero relative isolate overflow-hidden px-5 py-9 sm:px-12 sm:py-12">
      <Confetti eventKey={eventKey} />
      <div className="relative z-10 mx-auto max-w-xl text-center">
        <div aria-hidden="true" className="listing-achievement mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-text">
          <Check size={30} strokeWidth={2.5} />
        </div>
        <h2 ref={heading} tabIndex={-1} id={headingId} className="mt-7 text-3xl sm:text-5xl font-bold tracking-tight text-main leading-tight">Your listing is live!</h2>
        <p role="status" className="mx-auto mt-4 max-w-sm text-sm sm:text-base text-sec leading-relaxed">People nearby can find your item and request a rental.</p>
        <div className="mt-8">
          {props.image && <img src={props.image} alt={props.title} className="mx-auto h-44 w-56 sm:h-52 sm:w-64 rounded-card-lg object-cover bg-subtle" />}
          <p className="mx-auto mt-5 max-w-md text-lg sm:text-xl font-semibold text-main break-words leading-snug">{props.title}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success"><Check aria-hidden="true" size={13} />Published</span>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Button size="lg" trailingIcon={<ArrowUpRight aria-hidden="true" size={18} />} onClick={props.primary.onClick}>{props.primary.label}</Button>
          {props.secondary && <Button size="lg" variant="secondary" icon={<Settings2 aria-hidden="true" size={17} />} onClick={props.secondary.onClick}>{props.secondary.label}</Button>}
          {props.tertiary && <Button className="sm:col-span-2 sm:justify-self-center" variant="ghost" icon={<Share2 aria-hidden="true" size={17} />} onClick={props.tertiary.onClick}>{props.tertiary.label}</Button>}
        </div>
        {props.onListAnother && <div className="mt-6 border-t border-app pt-4">
          <Button size="sm" variant="ghost" icon={<Plus aria-hidden="true" size={16} />} onClick={props.onListAnother}>List another item</Button>
        </div>}
      </div>
    </Surface>
  );
  return (
    <Surface role="region" aria-labelledby={headingId} className={`success-card relative isolate overflow-hidden mb-6 ${payment ? 'listing-success-hero px-5 py-9 sm:px-12 sm:py-12' : 'p-6 sm:p-8'}`}>
      {payment && <Confetti eventKey={eventKey} />}
      <div className={`relative z-10 ${payment ? 'mx-auto max-w-xl text-center' : ''}`}>
        <div className={payment ? '' : 'flex items-start gap-4'}>
          {payment ? <div aria-hidden="true" className="listing-achievement mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-text">
            <Check size={30} strokeWidth={2.5} />
          </div> : <SuccessIndicator eventKey={eventKey} level="major" />}
          <div className="success-content min-w-0">
            <h2 ref={heading} tabIndex={-1} id={headingId} className={payment ? 'mt-7 text-3xl sm:text-5xl font-bold tracking-tight text-main leading-tight' : 'text-xl sm:text-2xl font-bold text-main'}>{title}</h2>
            <p role="status" className="mt-2 text-sm text-sec leading-relaxed">
              Your dates are confirmed. Arrange pickup with the owner when you are ready.
            </p>
          </div>
        </div>
        {booking && (
          <div className="success-content mt-5 rounded-card-lg border border-app bg-subtle p-4">
            <div className={payment ? '' : 'flex gap-3 items-center'}>
              <img src={booking.listingImage} alt="" className={payment ? 'mx-auto mb-5 h-44 w-56 sm:h-52 sm:w-64 rounded-card-lg object-cover bg-subtle' : 'h-16 w-16 rounded-card object-cover shrink-0'} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-main break-words">{booking.listingTitle}</p>
                <p className="mt-1 text-sm text-sec">{formatDate(booking.startDate)} - {formatDate(booking.endDate)}</p>
                <p className="mt-1 text-xs text-sec">With {booking.counterpartName}</p>
              </div>
            </div>
            <p className="mt-4 border-t border-app pt-3 text-xs text-sec">Booking reference <span className="block mt-1 text-main break-all">{booking.id}</span></p>
          </div>
        )}
        {payment && (
          <div className="success-content mt-4 rounded-card-lg bg-success-soft p-4">
            <p className="text-sm text-main">Confirmed payment</p>
            <p className="mt-1 text-2xl font-bold text-main tnum">{new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.currency }).format(payment.amount)}</p>
            <p className="mt-2 text-xs text-sec">Receipt delivery status is not available yet.</p>
          </div>
        )}
        <div className={payment ? 'mt-8 grid gap-3 sm:grid-cols-2' : 'mt-6 flex flex-col sm:flex-row gap-3'}>
          <Button size={payment ? 'lg' : 'md'} onClick={props.primary.onClick}>{props.primary.label}</Button>
          {props.secondary && <Button size={payment ? 'lg' : 'md'} variant="secondary" onClick={props.secondary.onClick}>{props.secondary.label}</Button>}
          {props.tertiary && <Button variant="ghost" onClick={props.tertiary.onClick}>{props.tertiary.label}</Button>}
        </div>
      </div>
    </Surface>
  );
}

export function SuccessNotice({ children, onDismiss, eventKey }: { children: ReactNode; onDismiss: () => void; eventKey?: string }) {
  return (
    <div className="success-notice relative flex items-center gap-3 overflow-hidden rounded-card-lg bg-success-soft p-3 mb-4">
      <SuccessIndicator eventKey={eventKey} level={eventKey ? 'standard' : 'subtle'} />
      <p role="status" className="text-sm text-main flex-1">{children}</p>
      <IconButton variant="ghost" label="Dismiss notification" onClick={onDismiss}><X aria-hidden="true" size={18} /></IconButton>
    </div>
  );
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
```

## availability-calendar.tsx - AvailabilityCalendar

- File: `src/components/availability-calendar.tsx` - 96 lines in file
- Month availability grid.

```tsx
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayIso } from '@/lib/geo';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Small month-at-a-time calendar grid. Read-only mode shows booked/blocked dates for a renter;
 * editable mode (owner-only, backed by `listing_availability` RLS) lets an owner toggle a date
 * between available/blocked by clicking it.
 */
export function AvailabilityCalendar({
  bookedDates, blockedDates, editable = false, onToggleDate, monthsAhead = 6,
}: {
  bookedDates: Set<string>;
  blockedDates: Set<string>;
  editable?: boolean;
  onToggleDate?: (date: string) => void;
  monthsAhead?: number;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const today = new Date();
  const viewMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstWeekday = viewMonth.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const todayStr = todayIso();

  const cells: (string | null)[] = [...Array(firstWeekday).fill(null)];
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }

  return (
    <div className="w-full max-w-md p-3 sm:p-4 rounded-card-xl bg-card border border-app shadow-xs">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
          disabled={monthOffset === 0}
          className="grid place-items-center h-11 w-11 rounded-card text-sec hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft size={15} />
        </button>
        <span aria-live="polite" className="text-sm font-bold text-main">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.min(monthsAhead - 1, o + 1))}
          disabled={monthOffset >= monthsAhead - 1}
          className="grid place-items-center h-11 w-11 rounded-card text-sec hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next month"
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-sec mb-2">
        {WEEKDAY_LABELS.map((w, i) => <div key={i}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isPast = date < todayStr;
          const isBooked = bookedDates.has(date);
          const isBlocked = blockedDates.has(date);
          const canClick = editable && !isPast && !isBooked;
          const dayNum = Number(date.slice(-2));
          let tone = 'text-main hover:bg-subtle';
          if (isPast) tone = 'text-muted opacity-40';
          else if (isBooked) tone = 'bg-accent-soft text-accent font-semibold cursor-default';
          else if (isBlocked) tone = 'bg-warning-soft text-warning font-semibold';
          return (
            <button
              key={date}
              type="button"
              disabled={!canClick}
              aria-label={`${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${isBooked ? 'booked' : isBlocked ? 'blocked' : 'available'}`}
              aria-pressed={isBlocked}
              aria-current={date === todayStr ? 'date' : undefined}
              onClick={() => canClick && onToggleDate?.(date)}
              title={isBooked ? 'Booked' : isBlocked ? 'Blocked by owner' : undefined}
              className={`aspect-square min-h-11 rounded-full text-sm transition-colors ${tone} ${canClick ? 'cursor-pointer' : ''}`}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-app text-xs text-sec">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-soft border border-accent" /> Booked</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning-soft border border-warning" /> Blocked</span>
        {editable && <span className="ml-auto">Click a date to block/unblock it</span>}
      </div>
    </div>
  );
}
```

## date-picker.tsx - DatePicker

- File: `src/components/date-picker.tsx` - 93 lines in file
- Single date field.

```tsx
import { useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/shadcn/dialog';
import { Button, IconButton } from '@/components/ui';
import { MonthGrid } from '@/components/date-range-picker';
import { addDaysIso, todayIso, MAX_BOOKING_RANGE_DAYS } from '@/lib/geo';
import { fieldClass } from '@/components/form-classes';

const NO_DATES = new Set<string>();
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function DatePicker({ value, onChange, label, id, min, max, required = false, disabled = false, windowDays, invalid, describedBy, className = '' }: {
  value: string;
  onChange: (date: string) => void;
  label: string;
  id?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  windowDays?: number;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const [month, setMonth] = useState(() => new Date(`${value || min || todayIso()}T12:00:00`));
  const trigger = useRef<HTMLButtonElement>(null);
  const minimum = min || todayIso();
  const maximum = max || addDaysIso(todayIso(), MAX_BOOKING_RANGE_DAYS);
  const firstMonth = new Date(`${minimum}T12:00:00`);
  const lastMonth = new Date(`${maximum}T12:00:00`);
  const canPrevious = month.getFullYear() * 12 + month.getMonth() > firstMonth.getFullYear() * 12 + firstMonth.getMonth();
  const canNext = month.getFullYear() * 12 + month.getMonth() < lastMonth.getFullYear() * 12 + lastMonth.getMonth();
  const valid = Boolean(selected && selected >= minimum && selected <= maximum);
  const end = selected && windowDays ? addDaysIso(selected, windowDays) : selected;

  return <Dialog open={open} onOpenChange={(next) => {
    if (next) {
      setSelected(value);
      const initial = value >= minimum && value <= maximum ? value : minimum;
      const date = new Date(`${initial}T12:00:00`);
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
    setOpen(next);
  }}>
    <DialogTrigger asChild>
      <button ref={trigger} id={id} type="button" disabled={disabled} aria-label={label} aria-required={required}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        className={fieldClass(`flex items-center justify-between gap-2 text-left font-normal ${className}`)}>
        <CalendarDays aria-hidden="true" size={18} className="shrink-0 text-accent" />
        <span className={`min-w-0 flex-1 truncate ${value ? 'text-main' : 'text-muted'}`}>{value ? dateLabel(value) : 'Choose date'}</span>
        <ChevronDown aria-hidden="true" size={15} className="shrink-0 text-sec" />
      </button>
    </DialogTrigger>
    {required && <input aria-hidden="true" tabIndex={-1} className="sr-only" value={value} required disabled={disabled}
      onChange={() => {}} onInvalid={(event) => { event.preventDefault(); trigger.current?.focus(); trigger.current?.click(); }} />}
    <DialogContent className="w-[calc(100vw_-_1rem)] max-w-[440px] overflow-hidden rounded-[24px] border border-app bg-card p-0 shadow-pop">
      <div className="border-b border-app bg-subtle px-5 py-5 sm:px-6">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><CalendarDays size={20} aria-hidden="true" /></span>
          <div className="min-w-0">
            <DialogTitle className="text-lg font-bold tracking-tight text-main">{label}</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-sec">{windowDays ? `Choose the first day of your ${windowDays}-day listing window.` : 'Choose a day. Earlier dates are unavailable.'}</DialogDescription>
          </div>
        </DialogHeader>
      </div>
      <div className="px-4 pt-4 sm:px-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-base font-bold tracking-tight text-main">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
          <div className="flex items-center gap-1">
            <IconButton label="Previous month" variant="ghost" disabled={!canPrevious} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft aria-hidden="true" size={19} /></IconButton>
            <IconButton label="Next month" variant="ghost" disabled={!canNext} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight aria-hidden="true" size={19} /></IconButton>
          </div>
        </div>
        <MonthGrid monthDate={month} todayStr={todayIso()} minDate={minimum} maxDate={maximum} draftStart={selected}
          draftEnd={windowDays ? end : null} bookedDates={NO_DATES} blockedDates={NO_DATES} onPick={setSelected} showMonthLabel={false} />
      </div>
      <div className="mt-4 border-t border-app px-5 py-4 sm:px-6">
        <div className="mb-4 flex min-h-11 items-center justify-between gap-3" role="status" aria-live="polite">
          <div className="min-w-0"><p className="text-xs font-medium text-sec">Selected day</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-main">{selected ? `${dateLabel(selected)}${windowDays ? ` – ${dateLabel(end)}` : ''}` : 'Choose a day'}</p></div>
          {!required && <Button size="sm" variant="ghost" onClick={() => { onChange(''); setOpen(false); }}>Clear</Button>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { if (valid) { onChange(selected); setOpen(false); } }}>Use this date</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
```

## date-range-picker.tsx - MonthGrid, DateRangePicker

- File: `src/components/date-range-picker.tsx` - 435 lines in file
- Range picker trigger + calendar dialog (.calendar-* and .listing-date-range-* CSS in index.css).

```tsx
import { useState, useRef, useEffect } from 'react';
import { Calendar, CalendarDays, ChevronLeft, ChevronRight, ChevronDown, X, ArrowRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { todayIso, addDaysIso, MAX_BOOKING_RANGE_DAYS } from '@/lib/geo';
import { Overlay } from '@/components/ui';

type PresetKey = 'custom' | 'today' | 'tomorrow' | 'weekend' | 'next7' | 'next30';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'custom', label: 'Custom dates' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'next7', label: 'Next 7 days' },
  { key: 'next30', label: 'Next 30 days' },
];

function presetRange(key: PresetKey): { start: string; end: string } {
  const today = todayIso();
  switch (key) {
    case 'today': return { start: today, end: addDaysIso(today, 1) };
    case 'tomorrow': { const t = addDaysIso(today, 1); return { start: t, end: addDaysIso(t, 1) }; }
    case 'weekend': {
      const dow = parseIsoLocal(today).getDay();
      const toSat = (6 - dow + 7) % 7;
      const sat = addDaysIso(today, toSat);
      return { start: sat, end: addDaysIso(sat, 2) };
    }
    case 'next7': return { start: today, end: addDaysIso(today, 7) };
    case 'next30': return { start: today, end: addDaysIso(today, Math.min(30, MAX_BOOKING_RANGE_DAYS)) };
    default: return { start: today, end: addDaysIso(today, 1) };
  }
}

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatIsoLocal(iso: string, options: Intl.DateTimeFormatOptions): string {
  return parseIsoLocal(iso).toLocaleDateString(undefined, options);
}

function daysBetweenIso(start: string, end: string): number {
  const s = parseIsoLocal(start);
  const e = parseIsoLocal(end);
  const sUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const eUtc = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.max(0, Math.round((eUtc - sUtc) / 86400000));
}

function monthLabel(d: Date) { return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function fmtRangeShort(start: string, end: string) {
  if (!start || !end) return 'Add dates';
  const s = formatIsoLocal(start, { month: 'short', day: 'numeric' });
  const e = formatIsoLocal(end, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s} – ${e}`;
}
function fmtRangeTiny(start: string, end: string) {
  const s = formatIsoLocal(start, { month: 'short', day: 'numeric' });
  const e = formatIsoLocal(end, { month: 'short', day: 'numeric' });
  return `${s} – ${e}`;
}

function rangeHasUnavailable(start: string, end: string, bookedDates: Set<string>, blockedDates: Set<string>): boolean {
  for (let date = start; date < end; date = addDaysIso(date, 1)) {
    if (bookedDates.has(date) || blockedDates.has(date)) return true;
  }
  return false;
}

export function MonthGrid({
  monthDate, todayStr, minDate, draftStart, draftEnd, maxDate, bookedDates, blockedDates, onPick, showMonthLabel = true,
}: {
  monthDate: Date; todayStr: string; minDate: string; draftStart: string | null; draftEnd: string | null; maxDate: string; bookedDates: Set<string>; blockedDates: Set<string>; onPick: (iso: string) => void; showMonthLabel?: boolean;
}) {
  const firstWeekday = monthDate.getDay();
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null)];
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return (
    <div className="flex-1">
      {showMonthLabel && <p aria-live="polite" className="text-base font-bold tracking-tight text-main mb-5 text-center">{monthLabel(monthDate)}</p>}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-x-1 gap-y-1.5 sm:gap-y-2">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isBooked = bookedDates.has(date);
          const isBlocked = blockedDates.has(date);
          const disabled = date < minDate || date > maxDate || isBooked || isBlocked;
          const isStart = date === draftStart;
          const isEnd = date === draftEnd;
          const isToday = date === todayStr;
          const inRange = draftStart && draftEnd && date > draftStart && date < draftEnd;
          const [year, month, day] = date.split('-').map(Number);
          const accessibleDate = new Date(year, month - 1, day).toLocaleDateString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          });
          const selection = isStart ? 'start date of selected range'
            : isEnd ? 'end date of selected range'
              : inRange ? 'within selected range'
                : undefined;
          let tone = 'text-main hover:bg-subtle hover:text-accent';
          if (isBooked) tone = 'text-muted opacity-45 cursor-not-allowed line-through';
          else if (isBlocked) tone = 'text-warning opacity-55 cursor-not-allowed';
          else if (disabled) tone = 'text-muted opacity-30 cursor-not-allowed';
          else if (isStart || isEnd) tone = 'bg-accent text-accent-text font-semibold shadow-sm';
          else if (inRange) tone = 'bg-accent-soft text-accent font-semibold';
          else if (isToday) tone = 'text-accent font-semibold ring-1 ring-inset ring-accent hover:bg-accent-soft';
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              aria-label={`${accessibleDate}${selection ? `, ${selection}` : ''}${isBooked ? ', booked' : isBlocked ? ', unavailable' : ''}`}
              aria-pressed={Boolean(isStart || isEnd || inRange)}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onPick(date)}
              onKeyDown={(event) => {
                const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -new Date(`${date}T12:00:00`).getDay(), End: 6 - new Date(`${date}T12:00:00`).getDay() }[event.key];
                if (offset === undefined) return;
                event.preventDefault();
                const next = addDaysIso(date, offset);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button[data-date="${next}"]:not(:disabled)`)?.focus();
              }}
              data-date={date}
              title={isBooked ? 'Booked' : isBlocked ? 'Blocked' : undefined}
              className={`relative aspect-square min-h-11 sm:min-h-12 rounded-xl text-sm sm:text-[15px] font-medium transition-[color,background-color,box-shadow] duration-fast focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${tone}`}
            >
              {Number(date.slice(-2))}
              {(isBooked || isBlocked) && <span aria-hidden="true" className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isBooked ? 'bg-muted' : 'bg-warning'}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Premium dual-month date-range picker with quick presets, replacing plain native date inputs. */
const NO_DATES: Set<string> = new Set();

export function DateRangePicker({
  startDate, endDate, onChange,
  mode = 'dual', bookedDates = NO_DATES, blockedDates = NO_DATES,
  minimumDate, maximumDate,
  presentation = 'dialog',
}: {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  mode?: 'dual' | 'range';
  bookedDates?: Set<string>;
  blockedDates?: Set<string>;
  minimumDate?: string | null;
  maximumDate?: string | null;
  presentation?: 'dialog' | 'listing';
}) {
  const [open, setOpen] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState<string | null>(endDate);
  const [activePreset, setActivePreset] = useState<PresetKey>('custom');
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const reduceMotion = useReducedMotion();
  const [position, setPosition] = useState<{ left: number; top: number } | undefined>();
  const compact = presentation === 'listing';
  const todayStr = todayIso();
  const minDate = minimumDate && minimumDate > todayStr ? minimumDate : todayStr;
  const horizon = addDaysIso(todayStr, MAX_BOOKING_RANGE_DAYS);
  const maxDate = maximumDate && maximumDate < horizon ? maximumDate : horizon;
  const validRange = (start: string, end: string) => start >= minDate && end > start && end <= maxDate
    && !rangeHasUnavailable(start, end, bookedDates, blockedDates);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!open || !compact) return;
    function placePanel() {
      if (!window.matchMedia('(min-width: 641px)').matches) { setPosition(undefined); return; }
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!trigger || !panel) return;
      const below = trigger.bottom + 10;
      const above = trigger.top - panel.height - 10;
      setPosition({
        left: Math.max(12, Math.min(trigger.right - panel.width, window.innerWidth - panel.width - 12)),
        top: Math.max(12, Math.min(below + panel.height <= window.innerHeight - 12 ? below : above, window.innerHeight - panel.height - 12)),
      });
    }
    const frame = requestAnimationFrame(placePanel);
    window.addEventListener('resize', placePanel);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', placePanel); };
  }, [open, compact, monthOffset]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const frame = requestAnimationFrame(() => {
        const firstDate = panelRef.current?.querySelector<HTMLButtonElement>('button[data-date]:not(:disabled)');
        // The first enabled date can be several rows below the start of the month.
        // Focusing it normally scrolls both the calendar and page on smaller screens,
        // hiding the month header as soon as the dialog opens.
        firstDate?.focus({ preventScroll: true });
        const calendarBody = panelRef.current?.querySelector<HTMLElement>('.calendar-dialog-body');
        if (firstDate && calendarBody && window.matchMedia('(max-height: 600px)').matches) {
          const dateTop = firstDate.getBoundingClientRect().top;
          const bodyTop = calendarBody.getBoundingClientRect().top;
          calendarBody.scrollTop += dateTop - bodyTop - 88;
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function openPicker() {
    const safeStart = startDate >= minDate && startDate <= maxDate ? startDate : '';
    setDraftStart(safeStart);
    setDraftEnd(safeStart && endDate > safeStart && endDate <= maxDate ? endDate : null);
    const firstMonth = parseIsoLocal(safeStart || minDate);
    const currentMonth = parseIsoLocal(todayStr);
    setMonthOffset(Math.max(0, (firstMonth.getFullYear() - currentMonth.getFullYear()) * 12 + firstMonth.getMonth() - currentMonth.getMonth()));
    setOpen(true);
  }

  function handlePick(date: string) {
    if (date < minDate || date > maxDate) return;
    setActivePreset('custom');
    if (!draftStart || (draftStart && draftEnd)) { setDraftStart(date); setDraftEnd(null); return; }
    if (date <= draftStart) { setDraftStart(date); setDraftEnd(null); return; }
    const end = date > maxDate ? maxDate : date;
    // A range can't span a taken date, so restart the selection from the clicked day.
    if (rangeHasUnavailable(draftStart, end, bookedDates, blockedDates)) { setDraftStart(date); setDraftEnd(null); return; }
    setDraftEnd(end);
  }

  function handlePreset(key: PresetKey) {
    setActivePreset(key);
    if (key === 'custom') return;
    const range = presetRange(key);
    setDraftStart(range.start);
    setDraftEnd(range.end);
  }

  function handleApply() {
    if (!draftStart || !draftEnd || !validRange(draftStart, draftEnd)) return;
    onChange(draftStart, draftEnd);
    setOpen(false);
  }

  function handleClear() {
    setDraftStart('');
    setDraftEnd(null);
    setActivePreset('custom');
    onChange('', '');
    setOpen(false);
  }

  const leftMonth = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const rightMonth = new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1);
  const nights = draftStart && draftEnd ? daysBetweenIso(draftStart, draftEnd) : 0;
  const triggerDateLabel = fmtRangeShort(startDate, endDate);
  const datePickerPanel = (
    <Overlay className={`flex ${compact ? 'items-center justify-center p-3 listing-calendar-layer' : 'items-end justify-center sm:items-center sm:p-5'} ${open ? '' : 'pointer-events-none'}`}>
      <AnimatePresence initial={false}>
        {open && <motion.button
          key="calendar-backdrop"
          type="button"
          aria-label="Close date picker"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 ${compact ? 'bg-black/20' : 'bg-black/50'}`}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
        />}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {open && <motion.div
          key="date-range-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Choose rental dates"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
            if (event.key === 'Tab') {
              const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)');
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}
          initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 18, scale: 0.99 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          style={compact && position ? { position: 'fixed', ...position } : undefined}
          className={`calendar-dialog relative z-[201] flex w-full max-w-[960px] flex-col overflow-hidden rounded-t-card-xl border border-app bg-card shadow-pop sm:rounded-card-xl${compact ? ' listing-calendar-popover' : ''}`}
        >
          <header className="calendar-dialog-header shrink-0">
            <div className="calendar-dialog-heading">
              <span className="calendar-dialog-icon"><CalendarDays size={20} aria-hidden="true" /></span>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-main">Choose rental dates</h2>
                <p className="mt-1 text-sm text-sec">Pick your pickup and return days.</p>
              </div>
            </div>
            <div className="calendar-range-pair" aria-live="polite">
              <div className={draftStart ? 'calendar-range-value is-selected' : 'calendar-range-value'}>
                <span>Pickup</span><strong>{draftStart ? formatIsoLocal(draftStart, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Add date'}</strong>
              </div>
              <ArrowRight size={16} className="calendar-range-arrow" aria-hidden="true" />
              <div className={draftEnd ? 'calendar-range-value is-selected' : 'calendar-range-value'}>
                <span>Return</span><strong>{draftEnd ? formatIsoLocal(draftEnd, { month: 'short', day: 'numeric', year: 'numeric' }) : draftStart ? 'Choose date' : 'Add date'}</strong>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close calendar" className="calendar-close grid h-11 w-11 place-items-center rounded-full text-sec hover:bg-subtle">
              <X size={19} />
            </button>
          </header>

          {!compact && <div className="calendar-dialog-presets shrink-0" aria-label="Quick date choices">
            {PRESETS.filter((preset) => preset.key !== 'custom').map((preset) => (
              <button
                key={preset.key}
                type="button"
                disabled={!validRange(presetRange(preset.key).start, presetRange(preset.key).end)}
                onClick={() => handlePreset(preset.key)}
                className={`calendar-preset${activePreset === preset.key ? ' is-active' : ''}`}
              >
                {preset.label}
              </button>
            ))}
          </div>}

          <div className="calendar-dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="calendar-dialog-toolbar">
              <span>{compact ? 'Select pickup, then return' : 'Dates before today are unavailable'}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setMonthOffset((offset) => Math.max(0, offset - 1))} disabled={monthOffset === 0} className="calendar-month-nav" aria-label="Previous month">
                  <ChevronLeft size={18} />
                </button>
                <button type="button" onClick={() => setMonthOffset((offset) => offset + 1)} disabled={new Date(rightMonth.getFullYear(), rightMonth.getMonth(), 1) > parseIsoLocal(maxDate)} className="calendar-month-nav" aria-label="Next month">
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="calendar-months">
              <MonthGrid monthDate={leftMonth} todayStr={todayStr} minDate={minDate} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} bookedDates={bookedDates} blockedDates={blockedDates} onPick={handlePick} />
              <MonthGrid monthDate={rightMonth} todayStr={todayStr} minDate={minDate} draftStart={draftStart} draftEnd={draftEnd} maxDate={maxDate} bookedDates={bookedDates} blockedDates={blockedDates} onPick={handlePick} />
            </div>
          </div>

          <footer className="calendar-dialog-footer shrink-0">
            <button type="button" onClick={handleClear} className="calendar-clear min-h-11 px-2 text-sm font-semibold">Clear dates</button>
            <div className="calendar-footer-summary" aria-live="polite">
              <span>{draftStart && draftEnd ? `${nights} ${compact ? `rental day${nights === 1 ? '' : 's'}` : `night${nights === 1 ? '' : 's'}`}` : draftStart ? 'Select your return date' : 'No dates selected'}</span>
              <strong>{draftStart && draftEnd ? fmtRangeTiny(draftStart, draftEnd) : draftStart ? formatIsoLocal(draftStart, { month: 'short', day: 'numeric' }) : ''}</strong>
            </div>
            <button type="button" onClick={handleApply} disabled={!draftStart || !draftEnd || !validRange(draftStart, draftEnd)} className="calendar-apply">Use these dates</button>
          </footer>
        </motion.div>}
      </AnimatePresence>
    </Overlay>
  );

  return (
    // No z-index here: it would cap the panel below the shared dim Overlay (z-200).
    <div ref={ref} className="relative">
      {compact ? (
        <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open}
          aria-label={`Choose a date range${startDate ? `, ${triggerDateLabel}` : ''}`}
          onClick={() => open ? setOpen(false) : openPicker()}
          className={`listing-date-range-trigger${open ? ' is-open' : ''}`}>
          <CalendarDays size={19} aria-hidden="true" />
          <span className="listing-date-range-value"><strong>{startDate ? formatIsoLocal(startDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Add date'}</strong><span>Pickup</span></span>
          <ChevronRight size={17} aria-hidden="true" className="text-muted shrink-0" />
          <span className="listing-date-range-value"><strong>{endDate ? formatIsoLocal(endDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Add date'}</strong><span>Return</span></span>
          <ChevronDown size={16} aria-hidden="true" className="text-sec shrink-0" />
        </button>
      ) : mode === 'range' ? (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Choose a date range${startDate ? `, ${triggerDateLabel}` : ''}`}
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="calendar-trigger w-full min-h-11 flex items-center justify-between gap-2 px-0 py-1 text-sm text-main"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Calendar size={16} className="text-accent shrink-0" />
            <span className="min-w-0 text-left"><span className="calendar-trigger-kicker">Date range</span><span className="block truncate">{triggerDateLabel}</span></span>
          </span>
          <ChevronDown size={14} className={`text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Choose a date range${startDate ? `, ${triggerDateLabel}` : ''}`}
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="calendar-trigger flex min-w-0 items-center gap-2 px-3.5 min-h-12 rounded-full text-sm font-medium text-main hover:bg-subtle transition-colors duration-fast whitespace-nowrap"
        >
          <Calendar size={16} className="text-accent shrink-0" />
          <span className="min-w-0 text-left"><span className="calendar-trigger-kicker">Date range</span><span className="block truncate">{triggerDateLabel}</span></span>
          <ChevronDown size={14} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {datePickerPanel}
    </div>
  );
}
```

## search.tsx - SearchBar, SearchRadiusSelect, ThemeSwitcher

- File: `src/components/search.tsx` - 496 lines in file
- Main search control (home hero variant + compact) and the demo theme switcher.

```tsx
import { useState, useRef, useEffect } from 'react';
import { Search, MapPin, ChevronDown, Check, LocateFixed } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTheme } from '@/theme-context';
import { Palette, Moon, Check as CheckIcon } from 'lucide-react';
import { findCities, haversineMiles, locationLabel, todayIso, type MarketplaceLocation } from '@/lib/geo';
import { useMarketplaceLocation } from '@/location-context';
import { DateRangePicker } from '@/components/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select';
import { SEARCH_RADII, parseSearchRadius, savedSearchState, saveSearchState, type SearchRadius } from '@/lib/search-state';

export interface SearchParams {
  keyword: string;
  location: MarketplaceLocation;
  startDate: string;
  endDate: string;
  radius: SearchRadius;
}

export function SearchRadiusSelect({ value, onChange, label = 'Search radius', disabled = false }: {
  value: SearchRadius; onChange: (value: SearchRadius) => void; label?: string; disabled?: boolean;
}) {
  return (
    <div className="search-radius-wrap relative min-w-0">
      <MapPin size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent" />
      <Select value={value === null ? 'any' : String(value)} disabled={disabled} onValueChange={(next) => onChange(parseSearchRadius(next))}>
        <SelectTrigger aria-label={`${label}: ${value === null ? 'any distance' : `within ${value} miles`}`}
          title={disabled ? 'Choose a location before setting a distance' : label}
          className="search-radius-select h-11 pl-9 pr-3 text-sm font-semibold">
          <SelectValue>{value === null ? 'Any distance' : `${value} mi`}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="search-radius-content min-w-[11rem]">
          {SEARCH_RADII.map((miles) => <SelectItem key={miles} value={String(miles)} className="min-h-11">Within {miles} miles</SelectItem>)}
          <SelectItem value="any" className="min-h-11">Any distance</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

const PLACEHOLDER_EXAMPLES = [
  'Camera, drill, projector...',
  'Camping tent, mountain bike...',
  'Party tables, DJ speaker...',
  'Lawn mower, power tools...',
  'VR headset, stand mixer...',
];

export function SearchBar({ onSearch, onLocationChange, variant = 'hero', defaultValue = '', initialStartDate, initialEndDate, initialRadius = 5, radius: controlledRadius, onRadiusChange }: {
  onSearch?: (params: SearchParams) => void;
  onLocationChange?: (location: MarketplaceLocation) => void;
  variant?: 'hero' | 'compact'; defaultValue?: string; initialStartDate?: string; initialEndDate?: string;
  initialRadius?: SearchRadius; radius?: SearchRadius; onRadiusChange?: (radius: SearchRadius) => void;
}) {
  const { location, selectCity, requestBrowserLocation, resolveInitialLocation } = useMarketplaceLocation();
  const [what, setWhat] = useState(defaultValue);
  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<MarketplaceLocation[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchingCities, setSearchingCities] = useState(false);
  const [locating, setLocating] = useState(false);
  const [initialLocationStatus, setInitialLocationStatus] = useState<'idle' | 'locating' | 'manual'>('idle');
  const [locationPermission, setLocationPermission] = useState<PermissionState | 'unavailable'>('prompt');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [startDate, setStartDate] = useState(initialStartDate ?? '');
  const [endDate, setEndDate] = useState(initialEndDate ?? '');
  const [selectedRadius, setSelectedRadius] = useState(initialRadius);
  const radius = controlledRadius === undefined ? selectedRadius : controlledRadius;
  const [showLocMenu, setShowLocMenu] = useState(false);
  // On small screens the compact variant starts as a one-line summary and expands on tap,
  // so the search page keeps its results above the fold.
  const [mobileExpanded, setMobileExpanded] = useState(variant === 'hero');
  const reduceMotion = useReducedMotion();
  const desktopLocRef = useRef<HTMLDivElement>(null);
  const mobileLocRef = useRef<HTMLDivElement>(null);
  const locationTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (variant !== 'hero' || location.source !== 'NONE') return;
    let active = true;
    setInitialLocationStatus('locating');
    void resolveInitialLocation().then((resolved) => {
      if (active) setInitialLocationStatus(resolved ? 'idle' : 'manual');
    }).catch(() => {
      if (active) setInitialLocationStatus('manual');
    });
    return () => { active = false; };
  }, [variant, location.source, resolveInitialLocation]);

  useEffect(() => { setWhat(defaultValue); }, [defaultValue]);
  useEffect(() => {
    const today = todayIso();
    const safeStart = initialStartDate && initialStartDate >= today ? initialStartDate : '';
    const safeEnd = safeStart && initialEndDate && initialEndDate > safeStart ? initialEndDate : '';
    setStartDate(safeStart);
    setEndDate(safeEnd);
  }, [initialStartDate, initialEndDate]);
  useEffect(() => {
    if (variant === 'hero') saveSearchState({ ...savedSearchState(), q: what, start: startDate, end: endDate, radius });
  }, [variant, what, startDate, endDate, radius]);

  useEffect(() => {
    if (showLocMenu) {
      const container = window.matchMedia('(min-width: 640px)').matches ? desktopLocRef.current : mobileLocRef.current;
      container?.querySelector('input')?.focus();
    } else {
      locationTriggerRef.current?.focus();
    }
  }, [showLocMenu]);

  useEffect(() => {
    if (what) return; // don't distract the user once they've started typing
    const id = setInterval(() => setPlaceholderIndex((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), 2000);
    return () => clearInterval(id);
  }, [what]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const inDesktopMenu = desktopLocRef.current?.contains(target) ?? false;
      const inMobileMenu = mobileLocRef.current?.contains(target) ?? false;
      if (!inDesktopMenu && !inMobileMenu) setShowLocMenu(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!showLocMenu) return;
    setLocationError(null);
    const controller = new AbortController();
    const query = cityQuery.trim();
    if (query.length < 2 && location.source !== 'BROWSER') {
      setCities([]);
      setSearchingCities(false);
      return () => controller.abort();
    }
    setSearchingCities(true);
    setCities([]);
    const nearbyLookup = !query && location.source === 'BROWSER'
      && location.latitude !== undefined && location.longitude !== undefined;
    const timer = setTimeout(() => {
      void findCities(
        query || location.city,
        controller.signal,
        nearbyLookup ? { latitude: location.latitude!, longitude: location.longitude! } : undefined,
      )
        .then((results) => {
          if (!nearbyLookup) {
            setCities(results);
            return;
          }
          const nearby = results
            .filter((result) => result.latitude !== undefined && result.longitude !== undefined)
            .map((result) => ({
              result,
              distance: haversineMiles(location.latitude!, location.longitude!, result.latitude!, result.longitude!),
            }))
            .filter(({ distance }) => distance <= 100)
            .sort((first, second) => first.distance - second.distance)
            .map(({ result }) => result);
          setCities(nearby);
        })
        .catch(() => { if (!controller.signal.aborted) setLocationError('City search is unavailable. Try again.'); })
        .finally(() => { if (!controller.signal.aborted) setSearchingCities(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cityQuery, location.city, location.latitude, location.longitude, location.source, showLocMenu]);

  useEffect(() => {
    if (!showLocMenu || !navigator.permissions) {
      setLocationPermission('unavailable');
      return;
    }
    let active = true;
    let status: PermissionStatus | undefined;
    void navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
      if (!active) return;
      status = permission;
      setLocationPermission(permission.state);
      permission.onchange = () => setLocationPermission(permission.state);
    }).catch(() => setLocationPermission('unavailable'));
    return () => {
      active = false;
      if (status) status.onchange = null;
    };
  }, [showLocMenu]);

  function runSearch() {
    if (location.source === 'NONE') {
      setLocationError('Choose a city or ZIP code, or enable location access, to search nearby.');
      setShowLocMenu(true);
      return;
    }
    onSearch?.({ keyword: what, location, startDate, endDate, radius });
    if (variant === 'compact') setMobileExpanded(false);
  }

  async function chooseBrowserLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const nextLocation = await requestBrowserLocation();
      if (nextLocation) onLocationChange?.(nextLocation);
      setShowLocMenu(false);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not use your location.');
    } finally {
      setLocating(false);
    }
  }

  async function chooseCity(city: MarketplaceLocation) {
    try {
      await selectCity(city);
      onLocationChange?.(city);
      setLocationError(null);
      setCityQuery('');
      setShowLocMenu(false);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not select this city.');
    }
  }

  const displayLocation = location.source === 'IP' ? `Near ${locationLabel(location)}` : location.city ? locationLabel(location) : initialLocationStatus === 'locating' ? 'Finding nearby…' : 'Choose your area';

  const isSelectedCity = (city: MarketplaceLocation) =>
    location.source === 'USER_SELECTED' && city.city === location.city && city.state === location.state && city.postalCode === location.postalCode;
  const suggestions = cities;
  function changeRadius(next: SearchRadius) {
    setSelectedRadius(next);
    onRadiusChange?.(next);
  }

  function toggleLocation(event: React.MouseEvent<HTMLButtonElement>) {
    locationTriggerRef.current = event.currentTarget;
    setShowLocMenu(!showLocMenu);
  }

  // z-[210] clears the shared dim Overlay (z-200) so the menu never renders under its own backdrop.
  const locationMenu = (
    <motion.div role="dialog" aria-modal="true" aria-label="Choose location"
      initial={reduceMotion ? false : { opacity: 0, y: 7, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); setShowLocMenu(false); }
      if (event.key === 'Tab') {
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)');
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }} className="absolute top-full mt-2 left-0 z-[210] w-[min(19rem,calc(100vw-2rem))] max-h-[min(22rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain bg-card border border-app rounded-card-lg shadow-pop p-2 animate-modal">
      <input aria-label="Search city or ZIP" autoComplete="off" value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !searchingCities && suggestions[0]) chooseCity(suggestions[0]);
      }} placeholder="City or ZIP/postal code" className="w-full min-w-0 h-11 px-3 rounded-card border border-strong bg-card text-base sm:text-sm text-main focus:border-accent" />
      <div className="mt-1">
        {searchingCities && <p role="status" className="px-2 py-2 text-xs text-sec">Searching cities…</p>}
        {suggestions.map((city) => {
          const selected = isSelectedCity(city);
          return (
            <button
              type="button"
              key={`${city.city}|${city.state}|${city.country}|${city.postalCode ?? ''}`}
              onClick={() => chooseCity(city)}
              className={`w-full flex items-center justify-between gap-2 min-h-11 px-2 rounded-card text-left text-sm transition-colors duration-fast ${
                selected ? 'bg-accent-soft text-accent font-semibold' : 'text-main hover:bg-subtle'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <MapPin size={14} className={selected ? 'text-accent' : 'text-muted'} />
                {locationLabel(city)}
              </span>
              {selected && <Check size={15} className="text-accent shrink-0" />}
            </button>
          );
        })}
        {!searchingCities && cityQuery.trim().length >= 2 && cities.length === 0 && !locationError && <p role="status" className="px-2 py-2 text-xs text-sec">No matching location. Try another search.</p>}
        {locationError && <p role="status" className="px-2 py-2 text-xs text-error">{locationError}</p>}
      </div>
      <div className="mt-1 pt-2 border-t border-app">
        <button type="button" onClick={() => void chooseBrowserLocation()} disabled={locating || locationPermission === 'denied'} className="w-full flex items-center gap-2.5 min-h-11 px-2 rounded-card text-left text-sm font-medium text-main hover:bg-subtle disabled:opacity-60">
          <LocateFixed size={16} className="text-accent shrink-0" />
          {locating ? 'Finding your location…' : locationPermission === 'denied' ? 'Location blocked in browser settings' : 'Use current location'}
        </button>
      </div>
    </motion.div>
  );

  return (
    // No z-index here: it would cap the location/date popovers below the shared dim Overlay (z-200).
    <div className="relative w-full min-w-0">
      {/* Not portaled: a portaled backdrop lives in a different stacking context than this menu,
          so its z-index can't be trusted to lose against the menu's z-[210]. Staying in the same
          local tree keeps the two comparable and the menu reliably clickable. */}
      {showLocMenu && (
        <button type="button" className="fixed inset-0 z-[200] bg-black/45 animate-fade-in" onClick={() => setShowLocMenu(false)} aria-label="Close location picker" />
      )}
      {/* Desktop: one pill, three segments, one action. Segments light up on hover/focus. */}
      <div
        className={`search-control hidden sm:grid items-center w-full min-w-0 glass-surface border border-app rounded-card-lg shadow-xs
          transition-shadow duration-standard ease-out focus-within:shadow-hover hover:shadow-hover
          ${variant === 'hero' ? 'p-1.5' : 'p-1'}`}
      >
        <div className="search-input-shell search-field-keyword flex min-w-0 items-center gap-2.5 pl-4 pr-3 h-12 rounded-card transition-colors duration-fast hover:bg-subtle focus-within:bg-subtle">
          <Search size={18} className="text-sec shrink-0" />
          <div className="flex-1 min-w-0">
            <label htmlFor="search-what" className="sr-only">Search for items to rent</label>
            <input
              id="search-what"
              name="search-what"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
              aria-label="Search for items to rent"
              className="search-input w-full bg-transparent outline-none text-sm font-medium text-main placeholder:text-muted placeholder:font-normal min-w-0"
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </div>
        </div>

        <span className="search-field-divider w-px h-7 bg-[var(--border)] shrink-0" aria-hidden="true" />

        <div ref={desktopLocRef} className="search-field-location relative min-w-0">
          <button
            onClick={toggleLocation}
            aria-haspopup="dialog"
            aria-expanded={showLocMenu}
            className="flex w-full min-w-0 items-center gap-2 px-3 h-12 rounded-card text-sm font-medium text-main transition-colors duration-fast hover:bg-subtle"
          >
            {location.source === 'BROWSER' ? <LocateFixed size={16} className="shrink-0 text-accent" /> : <MapPin size={16} className="shrink-0 text-accent" />}
            <span className="min-w-0 flex-1 truncate text-left">{displayLocation}</span>
            <ChevronDown size={14} className={`text-muted transition-transform duration-fast ${showLocMenu ? 'rotate-180' : ''}`} />
          </button>
          {showLocMenu && locationMenu}
        </div>

        <div className="search-field-radius min-w-0">
          <SearchRadiusSelect value={radius} onChange={changeRadius} disabled={location.source === 'NONE' || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)} />
        </div>
        <div className="search-field-dates min-w-0">
          <DateRangePicker startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
        </div>

        <button
          onClick={runSearch}
          disabled={location.source === 'NONE'}
          title={location.source === 'NONE' ? 'Choose a location before searching' : undefined}
          className="search-field-submit inline-flex items-center justify-center gap-2 h-12 px-5 rounded-card bg-accent text-accent-text font-semibold text-sm hover:bg-accent-hover active:scale-[0.98] transition-all duration-fast disabled:cursor-not-allowed disabled:opacity-55"
        >
          <Search size={16} />
          <span>Search</span>
        </button>
      </div>

      {/* Mobile: compact summary that expands into the full form. */}
      <div className="sm:hidden">
        <AnimatePresence initial={false} mode="wait">
        {!mobileExpanded ? (
          <motion.div key="search-summary" initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
          <button
            onClick={() => setMobileExpanded(true)}
            className="w-full flex items-center gap-3 h-12 px-4 rounded-card-lg glass-surface border border-app shadow-xs text-left active:scale-[0.99] transition-transform duration-fast"
          >
            <Search size={17} className="text-accent shrink-0" />
            <span className="flex-1 min-w-0 truncate text-sm font-semibold text-main">
              {what || 'Search rentals'}
            </span>
            <span className="text-xs text-sec min-w-0 max-w-40 text-right">
              <span className="block truncate">{displayLocation}</span>
              <span className="block">{radius === null ? 'Any distance' : `Within ${radius} miles`}</span>
            </span>
          </button></motion.div>
        ) : (
          <motion.div key="search-expanded" initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: -5 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} className="rounded-card-xl glass-surface border border-app shadow-card p-3.5 space-y-3">
            <div className="search-input-shell flex items-center gap-2.5 h-11 px-3 rounded-card bg-subtle">
              <Search size={16} className="text-sec shrink-0" />
              <input
                value={what}
                onChange={(e) => setWhat(e.target.value)}
                placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
                aria-label="What do you need?"
                className="search-input w-full bg-transparent outline-none text-sm font-medium text-main placeholder:text-muted placeholder:font-normal"
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
            </div>

            <div ref={mobileLocRef} className="relative">
              <button
                onClick={toggleLocation}
                aria-haspopup="dialog"
                aria-expanded={showLocMenu}
                className="w-full flex items-center justify-between h-11 px-3 rounded-card bg-subtle text-sm font-medium text-main"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {location.source === 'BROWSER' ? <LocateFixed size={15} className="text-accent" /> : <MapPin size={15} className="text-accent" />}
                  <span className="truncate">{displayLocation}</span>
                </span>
                <ChevronDown size={14} className={`text-muted transition-transform duration-fast ${showLocMenu ? 'rotate-180' : ''}`} />
              </button>
              {showLocMenu && locationMenu}
            </div>

            <SearchRadiusSelect value={radius} onChange={changeRadius} disabled={location.source === 'NONE' || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)} />

            <div className="px-1">
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
                mode="range"
              />
            </div>
            <button
              onClick={runSearch}
              disabled={location.source === 'NONE'}
              title={location.source === 'NONE' ? 'Choose a location before searching' : undefined}
              className="w-full h-12 rounded-card bg-accent text-accent-text font-semibold text-sm active:scale-[0.99] transition-transform duration-fast flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Search size={16} />
              Search
            </button>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
      <p role={initialLocationStatus === 'locating' ? 'status' : undefined} className={`mt-2 text-xs ${variant === 'compact' && !mobileExpanded ? 'hidden sm:block' : ''} text-sec`}>
        {initialLocationStatus === 'locating' && location.source === 'NONE'
          ? 'Finding your area… You can still search while we check.'
          : location.source === 'IP'
            ? `Approximate area: ${locationLabel(location)}. Choose a city to refine your distance.`
            : location.source === 'NONE'
              ? 'We couldn’t determine your location. Choose a city or ZIP code before searching nearby.'
              : 'Dates are optional. Distances are approximate; exact pickup addresses stay private.'}
      </p>
    </div>
  );
}


export function ThemeSwitcher() {
  const { themes, themeId, setThemeId, theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-card-lg border border-app bg-card hover:bg-subtle transition-colors text-sm font-medium text-main"
        title="Switch theme"
      >
        {theme.dark ? <Moon size={16} className="text-accent" /> : <Palette size={16} className="text-accent" />}
        <span className="hidden lg:inline">{theme.name}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-[100] w-72 bg-card border border-app rounded-card-xl shadow-hover p-2 animate-modal">
          <div className="px-2 py-1.5 text-xs font-semibold text-muted uppercase tracking-wide">10 Demo Themes</div>
          <div className="max-h-80 overflow-y-auto space-y-0.5">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => { setThemeId(t.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-card text-left transition-colors ${t.id === themeId ? 'bg-accent-soft' : 'hover:bg-subtle'}`}
              >
                <div className="flex gap-1 shrink-0">
                  <span className="w-4 h-4 rounded-full border border-app" style={{ background: t.vars['--bg'] }} />
                  <span className="w-4 h-4 rounded-full border border-app" style={{ background: t.vars['--accent'] }} />
                  <span className="w-4 h-4 rounded-full border border-app" style={{ background: t.vars['--text'] }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-main">{t.name}</span>
                    {t.dark && <Moon size={11} className="text-muted" />}
                  </div>
                  <div className="text-xs text-sec truncate">{t.tagline}</div>
                </div>
                {t.id === themeId && <CheckIcon size={16} className="text-accent shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

## shadcn/dialog.tsx - Dialog, DialogTrigger, DialogContent, SheetContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription

- File: `src/components/shadcn/dialog.tsx` - 89 lines in file
- Radix dialog + bottom sheet wrapper.

```tsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-[200] bg-black/50 animate-cross-fade', className)} {...props} />
));
DialogOverlay.displayName = 'DialogOverlay';

const CloseButton = () => (
  <DialogPrimitive.Close
    className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-card-sm text-sec transition-colors duration-fast hover:bg-subtle hover:text-main"
    aria-label="Close"
  >
    <X size={16} />
  </DialogPrimitive.Close>
);

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-[201] w-[calc(100%_-_2rem)] max-w-lg max-h-[calc(100dvh_-_2rem)] overflow-y-auto overscroll-contain',
        '-translate-x-1/2 -translate-y-1/2 bg-card border border-app rounded-card-xl shadow-pop p-5 sm:p-6 animate-cross-fade [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    >
      {children}
      <CloseButton />
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

/** Left-edge sheet used for the mobile admin navigation. */
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn('fixed inset-y-0 left-0 z-[201] w-72 max-w-[85vw] overflow-y-auto bg-card border-r border-app shadow-pop animate-slide-right', className)}
      {...props}
    >
      {children}
      <CloseButton />
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 pr-9', className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
);

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('font-display text-lg font-semibold text-main', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-sec', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';
```

## shadcn/alert-dialog.tsx - AlertDialog family

- File: `src/components/shadcn/alert-dialog.tsx` - 45 lines in file
- Radix alert dialog wrapper.

```tsx
import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;

export const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-black/50 animate-cross-fade" />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-[201] w-[calc(100%_-_2rem)] max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto overscroll-contain -translate-x-1/2 -translate-y-1/2',
        'bg-card border border-app rounded-card-xl shadow-pop p-5 sm:p-6 animate-cross-fade [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  </AlertDialogPrimitive.Portal>
));
AlertDialogContent.displayName = 'AlertDialogContent';

export const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn('font-display text-lg font-semibold text-main', className)} {...props} />
));
AlertDialogTitle.displayName = 'AlertDialogTitle';

export const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description ref={ref} className={cn('mt-1.5 text-sm text-sec', className)} {...props} />
));
AlertDialogDescription.displayName = 'AlertDialogDescription';

export const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
);
```

## shadcn/select.tsx - Select family

- File: `src/components/shadcn/select.tsx` - 55 lines in file
- Radix select wrapper.

```tsx
import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fieldClass } from '@/components/form-classes';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger ref={ref} className={cn(fieldClass('flex items-center justify-between gap-2 text-left data-[placeholder]:text-muted [&>span]:truncate'), className)} {...props}>
    {children}
    <SelectPrimitive.Icon asChild><ChevronDown size={16} className="text-muted shrink-0" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn('relative z-[210] max-h-[min(18rem,var(--radix-select-content-available-height))] min-w-[8rem] max-w-[calc(100vw_-_2rem)] overflow-y-auto overscroll-contain rounded-card border border-app bg-card text-main shadow-pop animate-scale-in', className)}
      {...props}
    >
      <SelectPrimitive.Viewport className={cn('p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]')}>
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn('relative flex w-full cursor-pointer select-none items-center rounded-card-sm py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-subtle data-[disabled]:opacity-50', className)}
    {...props}
  >
    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator><Check size={14} /></SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';
```

## shadcn/switch.tsx - Switch

- File: `src/components/shadcn/switch.tsx` - 21 lines in file
- Radix switch wrapper.

```tsx
import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-fast',
      'disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-[var(--border-strong)]',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-xs transition-transform duration-fast data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';
```

## shadcn/card.tsx - Card family

- File: `src/components/shadcn/card.tsx` - 30 lines in file
- Card wrapper.

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

// shadcn/ui source, skinned with YBuy design tokens (bg-card, border-app, text-main ...).
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('min-w-0 bg-card border border-app rounded-card-lg shadow-card [overflow-wrap:anywhere]', className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />,
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h3 ref={ref} className={cn('font-display text-base font-semibold text-main', className)} {...props} />,
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn('text-sm text-sec', className)} {...props} />,
);
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';
```

## shadcn/table.tsx - Table family

- File: `src/components/shadcn/table.tsx` - 40 lines in file
- Table wrapper (admin).

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto overscroll-x-contain" tabIndex={0} role="region" aria-label="Scrollable data table">
      <table ref={ref} className={cn('w-full caption-bottom text-sm text-main', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />,
);
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />,
);
TableBody.displayName = 'TableBody';

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn('border-b border-app transition-colors duration-fast hover:bg-subtle', className)} {...props} />
  ),
);
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th ref={ref} className={cn('h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted whitespace-nowrap', className)} {...props} />
  ),
);
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <td ref={ref} className={cn('px-3 py-3 align-middle [overflow-wrap:anywhere]', className)} {...props} />,
);
TableCell.displayName = 'TableCell';
```
