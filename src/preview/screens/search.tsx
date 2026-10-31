import { useEffect, useMemo, useState } from 'react';
import { List, Map as MapIcon, RotateCcw, Search, X } from 'lucide-react';
import { listings, type Listing } from '@/data';
import { DEFAULT_SEARCH, useP, type Sort } from '../ctx';
import { DateRangeField, LocationField, RadiusField } from '../fields';
import { RADII, distanceMi, isOpen, radiusLabel, rangeLabel } from '../dates';
import { Btn, Chip, Empty, ListingTile, Photo, Shell, Skeleton, Stars, Title, catTint, money } from '../ui';

function MapView({ items }: { items: Listing[] }) {
  const { go, search } = useP();
  const [selected, setSelected] = useState<string | null>(null);
  const bounds = useMemo(() => {
    const lats = listings.map((l) => l.lat), lngs = listings.map((l) => l.lng);
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  }, []);
  const positions = useMemo(() => {
    const placed: { id: string; x: number; y: number }[] = [];
    for (const item of items) {
      const x = 8 + ((item.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * 84;
      let y = 10 + (1 - (item.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) * 78;
      // Nudge pins that would sit on top of each other so every price stays tappable.
      while (placed.some((p) => Math.abs(p.x - x) < 9 && Math.abs(p.y - y) < 7) && y < 94) y += 7;
      placed.push({ id: item.id, x, y });
    }
    return new Map(placed.map((p) => [p.id, p]));
  }, [items, bounds]);
  const active = items.find((item) => item.id === selected);
  return (
    <div className="relative h-[34rem] overflow-hidden rounded-[1.75rem] bg-subtle sm:h-[40rem]">
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full text-[var(--border-strong)]" preserveAspectRatio="none" viewBox="0 0 100 100">
        <path d="M0 62 C25 55 40 70 60 48 S90 30 100 36" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M18 0 C22 30 40 40 42 100" fill="none" stroke="currentColor" strokeWidth="1" />
        <path d="M70 0 C66 30 80 60 74 100" fill="none" stroke="currentColor" strokeWidth="1" />
        <path d="M0 20 L100 12" fill="none" stroke="currentColor" strokeWidth="0.8" />
      </svg>
      {items.map((item) => {
        const { x, y } = positions.get(item.id) ?? { x: 50, y: 50 };
        const on = selected === item.id;
        return (
          <button key={item.id} type="button" onClick={() => setSelected(on ? null : item.id)} aria-pressed={on} aria-label={`${item.title}, ${money(item.pricePerDay)} per day`} style={{ left: `${x}%`, top: `${y}%` }} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-3.5 py-2 text-sm font-bold shadow-hover transition active:scale-95 ${on ? 'z-10 scale-110 bg-[var(--ink)] text-white' : 'bg-card text-main hover:scale-105'}`}>
            {money(item.pricePerDay)}
          </button>
        );
      })}
      {active && (
        <div className="absolute inset-x-3 bottom-3 flex gap-3 rounded-[1.5rem] bg-card p-3 shadow-pop sm:inset-x-auto sm:left-4 sm:w-96">
          <Photo src={active.images[0]} className="h-24 w-24 shrink-0 rounded-[1rem]" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-display font-bold leading-snug">{active.title}</p>
            <p className="mt-1 flex items-center gap-2 text-sm text-sec"><Stars rating={active.rating} /> · {distanceMi(active, search.loc)} mi</p>
            <Btn size="sm" onClick={() => go('listing', active.id)} className="mt-2">View · {money(active.pricePerDay)}/day</Btn>
          </div>
          <button type="button" onClick={() => setSelected(null)} aria-label="Close preview" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-subtle"><X size={16} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}

export function SearchScreen() {
  const { go, search: s, setSearch, availFor } = useP();
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [loading, setLoading] = useState(false);
  const cats = ['All', ...new Set(listings.map((l) => l.category))];
  const hasDates = Boolean(s.start && s.end);

  const key = JSON.stringify(s);
  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 380);
    return () => window.clearTimeout(timer);
  }, [key]);

  const results = useMemo(() => {
    const q = s.q.trim().toLowerCase();
    const rows = listings
      .map((listing) => ({ listing, miles: distanceMi(listing, s.loc) }))
      .filter(({ listing, miles }) =>
        (!q || listing.title.toLowerCase().includes(q) || listing.category.toLowerCase().includes(q))
        && (s.cat === 'All' || listing.category === s.cat)
        && (s.radius === null || miles <= s.radius)
        && isOpen(listing.id, availFor(listing.id), s.start, s.end)
        && (!s.instant || listing.instantBooking) && (!s.openOnly || listing.available) && listing.pricePerDay <= s.maxPrice);
    const order: Record<Sort, (a: typeof rows[number], b: typeof rows[number]) => number> = {
      recommended: (a, b) => b.listing.reviewCount - a.listing.reviewCount,
      price: (a, b) => a.listing.pricePerDay - b.listing.pricePerDay,
      distance: (a, b) => a.miles - b.miles,
      rating: (a, b) => b.listing.rating - a.listing.rating,
    };
    return rows.sort(order[s.sort]).map((row) => row.listing);
  }, [s, availFor]);

  const dirty = s.q || s.cat !== 'All' || s.instant || s.openOnly || s.maxPrice < 130 || hasDates || s.radius !== DEFAULT_SEARCH.radius;
  const reset = () => setSearch({ ...DEFAULT_SEARCH, loc: s.loc });
  const wider = RADII.filter((r) => s.radius !== null && (r === null || r > s.radius));

  return (
    <Shell className="pb-16 pt-6 sm:pt-10">
      <Title sub="Set where and when, then refine. Everything here works on sample data.">Find your thing</Title>

      <form role="search" onSubmit={(event) => event.preventDefault()} className="mt-8 flex items-center gap-2 rounded-full bg-card p-2 pl-6 shadow-hover">
        <Search size={18} aria-hidden="true" className="shrink-0 text-sec" />
        <label className="min-w-0 flex-1"><span className="sr-only">Search rentals</span>
          <input value={s.q} onChange={(event) => setSearch({ q: event.target.value })} placeholder="Search cameras, tents, tools…" className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted" />
        </label>
        {s.q && <button type="button" onClick={() => setSearch({ q: '' })} aria-label="Clear search" className="grid h-10 w-10 place-items-center rounded-full hover:bg-subtle"><X size={16} aria-hidden="true" /></button>}
      </form>

      <div className="relative mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Where and when">
        <LocationField value={s.loc} onChange={(loc) => setSearch({ loc })} />
        <RadiusField value={s.radius} onChange={(radius) => setSearch({ radius })} />
        <DateRangeField start={s.start} end={s.end} onChange={(start, end) => setSearch({ start, end })} placeholder="Add dates (optional)" />
      </div>

      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar sm:mx-0 sm:px-0" role="group" aria-label="Categories">
        {cats.map((name) => <Chip key={name} active={s.cat === name} onClick={() => setSearch({ cat: name })} tint={name === 'All' ? undefined : catTint(name)}>{name}</Chip>)}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Chip active={s.instant} onClick={() => setSearch({ instant: !s.instant })}>Instant booking</Chip>
        <Chip active={s.openOnly} onClick={() => setSearch({ openOnly: !s.openOnly })}>Available now</Chip>
        <label className="flex h-11 items-center gap-3 rounded-full bg-card px-5 text-sm font-semibold">
          Up to {money(s.maxPrice)}/day
          <input type="range" min={10} max={130} step={5} value={s.maxPrice} onChange={(event) => setSearch({ maxPrice: Number(event.target.value) })} aria-label="Max price per day" className="w-28 accent-accent" />
        </label>
        <label className="flex h-11 items-center gap-2 rounded-full bg-card pl-5 pr-3 text-sm font-semibold">
          Sort
          <select value={s.sort} onChange={(event) => setSearch({ sort: event.target.value as Sort })} className="h-9 bg-transparent pr-1 text-sm font-semibold outline-none">
            <option value="recommended">Recommended</option><option value="price">Price: low to high</option><option value="distance">Nearest</option><option value="rating">Top rated</option>
          </select>
        </label>
        <div className="ml-auto flex rounded-full bg-card p-1" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold ${view === 'grid' ? 'bg-[var(--ink)] text-white' : ''}`}><List size={15} aria-hidden="true" />List</button>
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')} className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold ${view === 'map' ? 'bg-[var(--ink)] text-white' : ''}`}><MapIcon size={15} aria-hidden="true" />Map</button>
        </div>
      </div>

      <div className="mt-8 flex items-end justify-between gap-4">
        <div>
          <p aria-live="polite" className="font-editorial text-4xl leading-none">{loading ? 'Searching…' : `${results.length} ${results.length === 1 ? 'item' : 'items'}`}</p>
          <p className="mt-2 text-sm text-sec">{radiusLabel(s.radius)} of {s.loc}{hasDates ? ` · open ${rangeLabel(s.start, s.end)}` : ''}</p>
        </div>
        {dirty && <button type="button" onClick={reset} className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-bold underline underline-offset-4"><RotateCcw size={14} aria-hidden="true" />Clear filters</button>}
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[4/5]" />)}</div>
        ) : results.length === 0 ? (
          <Empty
            title="Nothing open nearby"
            body={`Nothing matches ${radiusLabel(s.radius).toLowerCase()} of ${s.loc}${hasDates ? ` on ${rangeLabel(s.start, s.end)}` : ''}. Widen the search or ask your neighbours.`}
            action={<>
              {wider.map((r) => <Btn key={String(r)} size="sm" tone="soft" onClick={() => setSearch({ radius: r })}>{r === null ? 'Any distance' : `Search ${r} miles`}</Btn>)}
              {hasDates && <Btn size="sm" tone="soft" onClick={() => setSearch({ start: '', end: '' })}>Clear dates</Btn>}
              <Btn size="sm" onClick={() => go('requests')}>Ask for it</Btn>
            </>}
          />
        ) : view === 'map' ? (
          <MapView items={results} />
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
            {results.map((listing, index) => <ListingTile key={listing.id} listing={listing} delay={Math.min(index, 6) * 0.04} />)}
          </div>
        )}
      </div>
    </Shell>
  );
}
