import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { BadgeCheck, Heart, ImageOff, Star, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { Listing } from '@/data';
import { useP } from './ctx';
import { distanceMi } from './dates';

export const EASE = [0.16, 1, 0.3, 1] as const;
export const money = (value: number) => `$${Math.round(value).toLocaleString()}`;

type Tone = 'solid' | 'dark' | 'soft' | 'ghost' | 'yellow' | 'outline';
const TONES: Record<Tone, string> = {
  solid: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
  dark: 'bg-[var(--ink)] text-white hover:opacity-90',
  soft: 'bg-subtle text-main hover:bg-[var(--border)]',
  ghost: 'text-main hover:bg-subtle',
  yellow: 'bg-[var(--highlight)] text-[var(--ink)] hover:brightness-95',
  outline: 'border border-[var(--border-strong)] bg-card text-main hover:bg-subtle',
};
const SIZES = { sm: 'h-10 px-4 text-sm', md: 'h-12 px-6 text-[15px]', lg: 'h-14 px-8 text-base' };

export function Btn({ tone = 'solid', size = 'md', icon, full, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone; size?: keyof typeof SIZES; icon?: ReactNode; full?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-fast active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${SIZES[size]} ${full ? 'w-full' : ''} ${className}`}
    >
      {icon}{children}
    </button>
  );
}

/** The one recurring device: a luggage tag that carries a price or a label. */
export function PriceTag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`absolute left-0 inline-flex items-baseline gap-1 bg-[var(--highlight)] pl-7 pr-4 py-2 text-[var(--ink)] [clip-path:polygon(0.95rem_0,100%_0,100%_100%,0.95rem_100%,0_50%)] ${className}`}>
      <span aria-hidden="true" className="absolute left-[0.62rem] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[var(--ink)]" />
      {children}
    </span>
  );
}

const TINTS: [RegExp, string][] = [
  [/camera/i, '#DCE8F7'], [/camp|outdoor|garden/i, '#DCEBDC'], [/tool/i, '#F6E8B9'], [/sport/i, '#F6D8C5'],
  [/home/i, '#F5DFE4'], [/music|party|fashion/i, '#E7E1F2'], [/baby/i, '#D9EEE8'], [/vehicle|electronic/i, '#E5E6E2'],
];
/** Pastel surface for a category, from the YBuy palette. */
export const catTint = (name: string): string | undefined => TINTS.find(([pattern]) => pattern.test(name))?.[1];

export function Chip({ active, onClick, children, className = '', tint }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string; tint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={!active && tint ? { background: tint } : undefined}
      className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-semibold transition duration-fast ${active ? 'bg-[var(--ink)] text-white' : 'bg-card text-main hover:brightness-95'} ${className}`}
    >
      {children}
    </button>
  );
}

export function Photo({ src, alt = '', className = '' }: { src?: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={`grid place-items-center bg-subtle text-muted ${className}`}><ImageOff size={22} aria-hidden="true" /></span>;
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}

export function Avatar({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  return src
    ? <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    : <span className="grid shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] font-bold text-accent" style={{ width: size, height: size }}>{name.slice(0, 1)}</span>;
}

export function Stars({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-main">
      <Star size={14} aria-hidden="true" className="fill-[var(--star)] text-[var(--star)]" />
      {rating.toFixed(1)}{count !== undefined && <span className="hidden font-normal text-sec min-[480px]:inline">({count})</span>}
    </span>
  );
}

export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function Shell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1400px] px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function Title({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-editorial text-5xl leading-[0.92] tracking-[-0.03em] text-main sm:text-7xl">{children}</h1>
        {sub && <p className="mt-3 max-w-xl text-base text-sec sm:text-lg">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function SaveButton({ id, className = '' }: { id: string; className?: string }) {
  const { favs, toggleFav } = useP();
  const on = favs.has(id);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? 'Remove from saved' : 'Save to favorites'}
      onClick={(event) => { event.stopPropagation(); toggleFav(id); }}
      className={`grid h-11 w-11 place-items-center rounded-full bg-white/90 text-[var(--ink)] transition hover:scale-105 ${className}`}
    >
      <Heart size={18} aria-hidden="true" className={on ? 'fill-[var(--favorite)] text-[var(--favorite)]' : ''} />
    </button>
  );
}

export function ListingTile({ listing, aspect = 'aspect-[4/5]', large = false, delay = 0 }: { listing: Listing; aspect?: string; large?: boolean; delay?: number }) {
  const { go, search } = useP();
  const miles = distanceMi(listing, search.loc);
  return (
    <Reveal delay={delay}>
      <article className="group relative">
        <button type="button" onClick={() => go('listing', listing.id)} className="block w-full text-left" aria-label={`View listing: ${listing.title}`}>
          <span className={`relative block overflow-hidden rounded-[1.5rem] bg-subtle ${aspect}`}>
            <Photo src={listing.images[0]} className="absolute inset-0 h-full w-full transition duration-[400ms] group-hover:scale-[1.03]" />
            <span className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
              {!listing.available && <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-main">Booked</span>}
              <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold text-main min-[640px]:hidden">
                <Star size={12} aria-hidden="true" className="fill-[var(--star)] text-[var(--star)]" />{listing.rating.toFixed(1)}
              </span>
            </span>
            <PriceTag className={large ? 'bottom-6' : 'bottom-4'}>
              <span className={`font-display font-extrabold tnum ${large ? 'text-3xl' : 'text-lg'}`}>{money(listing.pricePerDay)}</span>
              <span className="text-xs font-semibold">/ day</span>
            </PriceTag>
          </span>
          <span className="mt-3 block px-1">
            <span className={`block font-display font-bold leading-snug line-clamp-2 ${large ? 'text-2xl' : 'text-base'}`}>{listing.title}</span>
            <span className="mt-1.5 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="hidden min-[480px]:inline-flex"><Avatar src={listing.owner.avatar} name={listing.owner.name} size={large ? 24 : 20} /></span>
                <b className={`min-w-0 truncate font-semibold ${large ? 'text-[15px]' : 'text-sm'}`}>by {listing.owner.name.split(' ')[0]}</b>
                {listing.verifiedOwner && <BadgeCheck size={large ? 17 : 15} aria-label="Verified owner" className="shrink-0 text-accent" />}
                <span className={`shrink-0 whitespace-nowrap text-sec ${large ? 'text-[15px]' : 'text-sm'}`}>· {miles} mi</span>
              </span>
              <span className="hidden shrink-0 min-[640px]:block"><Stars rating={listing.rating} count={listing.reviewCount} /></span>
            </span>
          </span>
        </button>
        <SaveButton id={listing.id} className="absolute right-3 top-3" />
      </article>
    </Reveal>
  );
}

export function Pill({ children, tone = 'soft' }: { children: ReactNode; tone?: 'soft' | 'accent' | 'yellow' | 'ink' | 'good' | 'warn' }) {
  const cls = {
    soft: 'bg-subtle text-main', accent: 'bg-[var(--accent-soft)] text-accent', yellow: 'bg-[var(--highlight)] text-[var(--ink)]',
    ink: 'bg-[var(--ink)] text-white', good: 'bg-success-soft text-success', warn: 'bg-warning-soft text-warning',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{children}</span>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-[1.25rem] ${className}`} />;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg rounded-[1.75rem] bg-card px-8 py-14 text-center">
      <p className="font-editorial text-4xl leading-none text-main">{title}</p>
      <p className="mt-3 text-base text-sec">{body}</p>
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Centered dialog with a scrim. Closes on Escape or a tap outside. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [onClose]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[85] grid place-items-end bg-[var(--text)]/55 sm:place-items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className={`max-h-[94dvh] w-full overflow-y-auto rounded-t-[1.75rem] bg-[var(--bg)] shadow-xl sm:rounded-[1.75rem] ${wide ? 'sm:max-w-[56rem]' : 'sm:max-w-xl'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-[var(--bg)] px-5 py-4 sm:px-8">
          <h2 className="font-editorial text-3xl leading-none sm:text-4xl">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full bg-subtle"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="px-5 pb-6 sm:px-8 sm:pb-8">{children}</div>
      </motion.div>
    </motion.div>
  );
}
