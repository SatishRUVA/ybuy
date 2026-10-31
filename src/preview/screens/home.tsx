import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Search } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { categories, listings } from '@/data';
import { useP } from '../ctx';
import { DateRangeField, LocationField, RadiusField } from '../fields';
import { distanceMi } from '../dates';
import { Btn, EASE, ListingTile, Photo, PriceTag, Reveal, Shell, catTint } from '../ui';

const columns = [[0, 3, 6, 9], [1, 4, 7], [2, 5, 8]].map((ids) => ids.map((id) => categories[id]).filter(Boolean));

function Wall({ items, reverse, offset }: { items: typeof categories; reverse: boolean; offset: number }) {
  const reduce = useReducedMotion();
  const loop = reduce ? items : [...items, ...items];
  const aspects = ['aspect-[3/4]', 'aspect-square', 'aspect-[4/5]', 'aspect-[3/4]'];
  return (
    <div className="overflow-hidden">
      <motion.div className="flex flex-col" animate={reduce ? undefined : { y: reverse ? ['-50%', '0%'] : ['0%', '-50%'] }} transition={{ duration: 34 + offset * 6, ease: 'linear', repeat: Infinity }}>
        {loop.map((category, index) => (
          <div key={`${category.id}-${index}`} className="pb-2 sm:pb-3">
            <div className={`relative overflow-hidden rounded-[1rem] bg-subtle ${aspects[(index + offset) % aspects.length]}`}>
              <Photo src={category.image} className="absolute inset-0 h-full w-full" />
              <PriceTag className="bottom-3 !py-1.5 text-xs font-bold sm:text-sm">{category.name}</PriceTag>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

export function HomeScreen() {
  const { go, search, setSearch } = useP();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState(search.q);
  const available = listings.filter((listing) => listing.available);
  const featured = available.slice(0, 4);
  const near = [...available].sort((a, b) => distanceMi(a, search.loc) - distanceMi(b, search.loc)).slice(0, 8);

  return (
    <div className="overflow-x-clip">
      <Shell className="pt-6 sm:pt-10">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <div className="flex min-w-0 flex-col justify-center">
            <h1 className="font-editorial text-[clamp(4rem,10.5vw,10rem)] leading-[0.86] tracking-[-0.035em]">
              {['Don’t buy it.', 'Rent it.'].map((line, index) => (
                <span key={line} className={`block overflow-hidden pb-[0.14em] -mb-[0.14em] ${index ? 'text-accent' : ''}`}>
                  <motion.span className="block" initial={reduce ? false : { y: '108%' }} animate={{ y: 0 }} transition={{ duration: 0.95, delay: 0.1 + index * 0.14, ease: EASE }}>{line}</motion.span>
                </span>
              ))}
            </h1>
            <p className="mt-6 max-w-md text-lg leading-snug sm:text-xl">Cameras, camping gear, tools and party supplies from people close by, for exactly the days you need them.</p>
            <form
              className="relative mt-8 max-w-xl rounded-[1.75rem] bg-card p-2 shadow-hover"
              onSubmit={(event) => { event.preventDefault(); setSearch({ q: query.trim(), cat: 'All' }); go('search'); }}
            >
              <div className="flex items-center gap-2 pl-4">
                <Search size={18} aria-hidden="true" className="shrink-0 text-sec" />
                <label className="min-w-0 flex-1">
                  <span className="sr-only">What do you need?</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Camera, tent, drill, projector…" className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted" />
                </label>
                <Btn type="submit">Search</Btn>
              </div>
              <div className="flex flex-wrap gap-2 px-2 pb-2 pt-2" role="group" aria-label="Where and when">
                <LocationField value={search.loc} onChange={(loc) => setSearch({ loc })} />
                <RadiusField value={search.radius} onChange={(radius) => setSearch({ radius })} />
                <DateRangeField start={search.start} end={search.end} onChange={(start, end) => setSearch({ start, end })} placeholder="Add dates (optional)" />
              </div>
            </form>
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Popular searches">
              {['Camera', 'Tent', 'Drill', 'Projector'].map((term) => (
                <button key={term} type="button" onClick={() => { setSearch({ q: term, cat: 'All' }); go('search'); }} className="rounded-full bg-subtle px-4 py-2 text-sm font-semibold hover:bg-[var(--border)]">{term}</button>
              ))}
            </div>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-sec">
              {['Secure checkout', 'Owner approval before payment', 'Verified owners'].map((point) => (
                <li key={point} className="inline-flex items-center gap-1.5"><Check size={15} aria-hidden="true" className="text-accent" />{point}</li>
              ))}
            </ul>
          </div>
          <div aria-hidden="true" className="grid h-[22rem] grid-cols-3 gap-2 overflow-hidden rounded-[1.75rem] sm:h-[30rem] sm:gap-3 lg:h-[36rem]">
            {columns.map((items, index) => <Wall key={index} items={items} reverse={index === 1} offset={index} />)}
          </div>
        </div>
      </Shell>

      <Shell className="pt-24 sm:pt-32">
        <Reveal className="mb-8 flex flex-col gap-4 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-editorial text-5xl leading-[0.92] tracking-[-0.03em] sm:text-7xl">Browse by category</h2>
            <p className="mt-3 text-base text-sec sm:text-lg">Start with what you need.</p>
          </div>
          <button type="button" onClick={() => { setSearch({ cat: 'All', q: '' }); go('search'); }} className="group inline-flex min-h-11 items-center gap-2 text-sm font-bold underline decoration-2 underline-offset-[6px]">Explore all <ArrowRight size={18} aria-hidden="true" className="transition group-hover:translate-x-1" /></button>
        </Reveal>
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-6 sm:gap-5 sm:px-6">
          {categories.map((category, index) => (
            <motion.button key={category.id} type="button" onClick={() => { setSearch({ cat: category.name, q: '' }); go('search'); }} whileHover={reduce ? undefined : { y: -8 }} transition={{ type: 'spring', stiffness: 380, damping: 26 }} style={{ background: catTint(category.name) }} className={`group w-[46vw] shrink-0 snap-start rounded-[1.75rem] p-2.5 text-left sm:w-[16.5rem] ${index % 2 ? 'sm:mt-8' : ''}`}>
              <span className="relative block aspect-[4/5] overflow-hidden rounded-[1.25rem] bg-subtle">
                <Photo src={category.image} className="absolute inset-0 h-full w-full transition duration-[400ms] group-hover:scale-[1.04]" />
              </span>
              <span className="mt-3 flex items-center justify-between px-2 font-display text-lg font-bold">{category.name}<ArrowUpRight size={18} aria-hidden="true" /></span>
              <span className="px-2 pb-1 text-sm text-sec">{category.count.toLocaleString()} nearby</span>
            </motion.button>
          ))}
        </div>
      </Shell>

      <section className="ink-surface mt-24 sm:mt-36">
        <Shell className="py-16 sm:py-28">
          <Reveal className="mb-12 flex flex-col gap-4 sm:mb-16 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-editorial text-5xl leading-[0.9] tracking-[-0.03em] sm:text-8xl">Featured rentals</h2>
              <p className="mt-4 max-w-lg text-base text-white/75 sm:text-lg">Well-reviewed things from owners with a track record.</p>
            </div>
            <button type="button" onClick={() => go('search')} className="group inline-flex min-h-11 items-center gap-2 text-sm font-bold underline decoration-2 underline-offset-[6px]">See all <ArrowRight size={18} aria-hidden="true" /></button>
          </Reveal>
          <div className="grid gap-10 lg:grid-cols-[7fr_5fr] lg:gap-14">
            <ListingTile listing={featured[0]} aspect="aspect-[4/5]" large />
            <div className="grid grid-cols-2 content-start gap-x-4 gap-y-8 sm:gap-x-6">
              <ListingTile listing={featured[1]} aspect="aspect-[3/4]" delay={0.08} />
              <div className="mt-10 sm:mt-20"><ListingTile listing={featured[2]} aspect="aspect-[3/4]" delay={0.16} /></div>
              <div className="col-span-2"><ListingTile listing={featured[3]} aspect="aspect-[16/10]" delay={0.1} /></div>
            </div>
          </div>
        </Shell>
      </section>

      <Shell className="pt-24 sm:pt-36">
        <Reveal className="mb-8 sm:mb-12">
          <h2 className="font-editorial text-5xl leading-[0.92] tracking-[-0.03em] sm:text-7xl">Close to you</h2>
          <p className="mt-3 text-base text-sec sm:text-lg">The nearest things first, so pickup is easy.</p>
        </Reveal>
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-6 sm:gap-6 sm:px-6">
          {near.map((listing, index) => (
            <div key={listing.id} className={`w-[68vw] shrink-0 snap-start sm:w-[19rem] ${index % 2 ? 'sm:mt-10' : ''}`}><ListingTile listing={listing} /></div>
          ))}
        </div>
      </Shell>

      <Shell className="pt-24 sm:pt-36">
        <Reveal><h2 className="font-editorial text-5xl leading-[0.92] tracking-[-0.03em] sm:text-7xl">How YBuy works</h2></Reveal>
        <ol className="mt-10 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {[['Discover', 'Search by item, place and the dates you need it.'], ['Request', 'Pick your dates and send a request to the owner.'], ['Rent', 'Pay securely once the owner approves, then pick it up.'], ['Return', 'Hand it back, mark it returned, leave a review.']].map(([title, body], index) => (
            <motion.li key={title} initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: index * 0.09, ease: EASE }} whileHover={reduce ? undefined : { y: -6 }} className={`flex min-h-[15rem] flex-col justify-between rounded-[1.5rem] px-7 py-8 sm:px-9 ${index % 2 ? 'bg-[var(--accent)] text-white' : 'bg-card'}`}>
              <h3 className="font-editorial text-5xl leading-none">{title}</h3>
              <p className={`mt-8 leading-snug ${index % 2 ? 'text-white/85' : 'text-sec'}`}>{body}</p>
            </motion.li>
          ))}
        </ol>
      </Shell>

      <section className="ink-surface mt-24 sm:mt-36">
        <Shell className="grid items-center gap-12 py-16 sm:py-28 lg:grid-cols-2">
          <div>
            <h2 className="font-editorial text-6xl leading-[0.88] tracking-[-0.035em] sm:text-8xl">Rent out what you already own</h2>
            <ul className="mt-8 space-y-3 text-base text-white/80 sm:text-lg">
              {['Add photos of what you already own.', 'Set the dates it is available.', 'Choose which requests to approve.'].map((step) => <li key={step} className="flex gap-3"><ArrowRight size={20} aria-hidden="true" className="mt-1 shrink-0" />{step}</li>)}
            </ul>
            <Btn tone="yellow" size="lg" onClick={() => go('create')} className="mt-9" icon={<ArrowRight size={18} aria-hidden="true" />}>List an item</Btn>
          </div>
          <div aria-hidden="true" className="relative mx-auto h-[24rem] w-full max-w-[32rem] sm:h-[34rem]">
            {[[4, -7, '0%', '4%'], [1, 5, '38%', '0%'], [3, -2, '16%', '38%']].map(([index, rotate, left, top], i) => (
              <motion.div key={String(index)} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0, rotate: Number(rotate) }} viewport={{ once: true }} transition={{ duration: 0.8, delay: i * 0.12, ease: EASE }} whileHover={{ rotate: 0, scale: 1.03, zIndex: 5 }} style={{ left: String(left), top: String(top) }} className="absolute w-[58%] rounded-[1.25rem] bg-white p-2 pb-8 sm:p-3 sm:pb-10">
                <Photo src={categories[Number(index)]?.image} className="aspect-[4/5] w-full rounded-[0.75rem]" />
              </motion.div>
            ))}
          </div>
        </Shell>
      </section>

      <footer className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <p className="text-sm text-sec">© 2026 YBuy · Design preview</p>
      </footer>
    </div>
  );
}
