import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Share2, ShieldCheck, Truck, Zap } from 'lucide-react';
import { listings } from '@/data';
import { useP } from '../ctx';
import { DateRangeField } from '../fields';
import { distanceMi, firstFree, isOpen, rangeLabel, rentalDays, shortDate, todayIso, unavailableSet } from '../dates';
import { Avatar, Btn, Photo, Pill, SaveButton, Shell, Stars, money } from '../ui';

export function ListingScreen({ id }: { id: string }) {
  const { go, toast, search, setSearch, availFor } = useP();
  const listing = listings.find((l) => l.id === id) ?? listings[0];
  const avail = availFor(listing.id);
  const blocked = useMemo(() => unavailableSet(listing.id, avail), [listing.id, avail]);
  const [index, setIndex] = useState(0);
  const initial = isOpen(listing.id, avail, search.start, search.end) && search.start && search.end ? { start: search.start, end: search.end } : firstFree(listing.id, avail) ?? { start: '', end: '' };
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [showAll, setShowAll] = useState(false);
  const pick = (s: string, e: string) => { setStart(s); setEnd(e); if (s && e) setSearch({ start: s, end: e }); };

  const chosen = Boolean(start && end);
  const days = chosen ? rentalDays(start, end) : 0;
  const valid = chosen && isOpen(listing.id, avail, start, end);
  const rental = listing.pricePerDay * days;
  const fee = Math.round(rental * 0.1);
  const total = rental + fee;
  const images = listing.images;
  const miles = distanceMi(listing, search.loc);
  const step = (delta: number) => setIndex((index + delta + images.length) % images.length);

  const booking = (
    <div className="rounded-[1.75rem] bg-card p-6 shadow-hover">
      <div className="flex items-end justify-between">
        <p><span className="font-display text-4xl font-extrabold tnum">{money(listing.pricePerDay)}</span> <span className="text-sec">/ day</span></p>
        <Stars rating={listing.rating} count={listing.reviewCount} />
      </div>
      <div className="mt-5">
        <DateRangeField
          start={start}
          end={end}
          onChange={pick}
          blocked={blocked}
          min={avail.start > todayIso() ? avail.start : todayIso()}
          max={avail.end}
          presets={false}
          align="right"
          anchor="self"
          label="Rental dates"
          placeholder="Choose your dates"
          triggerClass="flex h-14 w-full items-center gap-2 rounded-[1rem] bg-subtle px-4 text-left text-[15px] font-semibold hover:bg-[var(--border)]"
          hint={<>{listing.owner.name.split(' ')[0]} lends this <b>{rangeLabel(avail.start, avail.end)}</b>. Shaded days are already taken.</>}
        />
      </div>
      {!valid && chosen && <p role="alert" className="mt-2 text-sm text-error">Those dates aren’t open. Try different dates.</p>}
      <dl className="mt-5 space-y-2 text-[15px]">
        <div className="flex justify-between"><dt className="text-sec">{chosen ? `${money(listing.pricePerDay)} × ${days} ${days === 1 ? 'day' : 'days'}` : 'Pick dates to see the price'}</dt><dd className="tnum">{chosen ? money(rental) : '–'}</dd></div>
        <div className="flex justify-between"><dt className="text-sec">Service fee</dt><dd className="tnum">{chosen ? money(fee) : '–'}</dd></div>
        <div className="flex justify-between border-t border-app pt-3 text-lg font-bold"><dt>Total</dt><dd className="tnum">{chosen ? money(total) : '–'}</dd></div>
        <div className="flex justify-between text-sm"><dt className="text-sec">Refundable deposit (held, not charged)</dt><dd className="tnum">{money(listing.deposit)}</dd></div>
      </dl>
      <Btn size="lg" full disabled={!valid || !listing.available} onClick={() => go('checkout', listing.id)} className="mt-5">{listing.instantBooking ? 'Book instantly' : 'Request to book'}</Btn>
      <p className="mt-3 text-center text-sm text-sec">{!chosen ? `Open ${shortDate(avail.start)} – ${shortDate(avail.end)}. Choose your days to continue.` : 'You won’t be charged until the owner approves.'}</p>
      <Btn tone="soft" full onClick={() => go('auction', 'a1')} className="mt-3">Make a bid instead</Btn>
    </div>
  );

  return (
    <Shell className="pb-32 pt-4 sm:pt-8 lg:pb-16">
      <button type="button" onClick={() => go('search')} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-sec hover:text-main"><ChevronLeft size={18} aria-hidden="true" />Back to results</button>
      <div className="grid gap-8 lg:grid-cols-[1fr_24rem] lg:gap-14">
        <div className="min-w-0">
          <div className="relative overflow-hidden rounded-[1.75rem] bg-subtle">
            <Photo src={images[index]} alt={`${listing.title}, photo ${index + 1} of ${images.length}`} className="aspect-[4/3] w-full sm:aspect-[16/10]" />
            <div className="absolute right-4 top-4 flex gap-2"><SaveButton id={listing.id} /><button type="button" aria-label="Share" onClick={() => toast('Link copied. Go share the good stuff.')} className="grid h-11 w-11 place-items-center rounded-full bg-white/90"><Share2 size={18} aria-hidden="true" /></button></div>
            <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90"><ChevronLeft size={20} aria-hidden="true" /></button>
            <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90"><ChevronRight size={20} aria-hidden="true" /></button>
            <span className="absolute bottom-4 right-4 rounded-full bg-[var(--ink)]/80 px-3 py-1 text-xs font-bold text-white">{index + 1} / {images.length}</span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:gap-3">
            {images.map((src, i) => (
              <button key={src} type="button" onClick={() => setIndex(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === index} className={`overflow-hidden rounded-[1rem] ${i === index ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]' : 'opacity-70 hover:opacity-100'}`}>
                <Photo src={src} className="aspect-[4/3] w-full" />
              </button>
            ))}
          </div>

          <h1 className="mt-8 font-editorial text-5xl leading-[0.95] tracking-[-0.03em] sm:text-6xl">{listing.title}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sec"><span className="inline-flex items-center gap-1"><MapPin size={15} aria-hidden="true" />{listing.pickup.split(' - ')[0]}</span><span>·</span><span>{miles} mi away</span><span>·</span><span>{listing.condition} condition</span></p>

          <div className="mt-6 flex items-center gap-4 rounded-[1.5rem] bg-card p-4">
            <Avatar src={listing.owner.avatar} name={listing.owner.name} size={56} />
            <div className="min-w-0 flex-1">
              <p className="font-display font-bold">Hosted by {listing.owner.name}</p>
              <p className="text-sm text-sec">{listing.owner.rentals} rentals · {listing.owner.responseRate}% reply rate · joined {listing.owner.joinedYear}</p>
            </div>
            <Btn tone="soft" size="sm" onClick={() => go('messages')}>Message</Btn>
          </div>

          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Highlights">
            {listing.verifiedOwner && <li><Pill tone="accent"><ShieldCheck size={13} aria-hidden="true" className="mr-1" />Verified owner</Pill></li>}
            {listing.instantBooking && <li><Pill tone="yellow"><Zap size={13} aria-hidden="true" className="mr-1" />Instant booking</Pill></li>}
            {listing.protectionEligible && <li><Pill>Rental protection</Pill></li>}
            {listing.deliveryAvailable && <li><Pill><Truck size={13} aria-hidden="true" className="mr-1" />Delivery available</Pill></li>}
          </ul>

          <section className="mt-10" aria-labelledby="about"><h2 id="about" className="font-editorial text-4xl leading-none">About this item</h2><p className="mt-4 max-w-2xl text-lg leading-relaxed">{listing.description}</p></section>
          <section className="mt-10" aria-labelledby="included"><h2 id="included" className="font-editorial text-4xl leading-none">What’s included</h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">{listing.whatsIncluded.map((item) => <li key={item} className="rounded-[1rem] bg-card px-4 py-3 font-semibold">{item}</li>)}</ul>
          </section>
          <section className="mt-10 rounded-[1.5rem] bg-[var(--accent-soft)] p-6" aria-labelledby="trust"><h2 id="trust" className="font-editorial text-4xl leading-none">Rent with confidence</h2>
            <ul className="mt-4 space-y-2 text-[15px]"><li>{listing.cancellation}</li><li>{listing.delivery}</li><li>Declared value {money(listing.declaredValue)} · damage history: {listing.damageHistory}</li></ul>
          </section>
          <section className="mt-10" aria-labelledby="reviews"><h2 id="reviews" className="font-editorial text-4xl leading-none">Reviews</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {listing.reviews.slice(0, showAll ? 6 : 2).map((review) => (
                <article key={review.id} className="rounded-[1.5rem] bg-card p-5">
                  <div className="flex items-center gap-3"><Avatar src={review.avatar} name={review.author} size={40} /><div><p className="font-semibold">{review.author}</p><p className="text-xs text-sec">{review.date}</p></div><span className="ml-auto"><Stars rating={review.rating} /></span></div>
                  <p className="mt-3 leading-relaxed">{review.text}</p>
                </article>
              ))}
            </div>
            {listing.reviews.length > 2 && <Btn tone="outline" onClick={() => setShowAll((v) => !v)} className="mt-4">{showAll ? 'Show fewer' : 'Show all reviews'}</Btn>}
          </section>
        </div>
        <aside className="hidden lg:block"><div className="sticky top-28">{booking}</div></aside>
      </div>

      <div className="fixed inset-x-0 bottom-16 z-30 flex items-center justify-between gap-3 border-t border-app bg-app px-4 py-3 lg:hidden">
        <p><span className="font-display text-2xl font-extrabold tnum">{money(listing.pricePerDay)}</span> <span className="text-sm text-sec">/ day</span></p>
        <Btn disabled={!valid || !listing.available} onClick={() => go('checkout', listing.id)}>{listing.instantBooking ? 'Book instantly' : 'Request to book'}</Btn>
      </div>
      <div className="mt-10 lg:hidden">{booking}</div>
    </Shell>
  );
}
