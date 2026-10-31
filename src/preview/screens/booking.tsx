import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { listings } from '@/data';
import { useP } from '../ctx';
import { Calendar } from '../calendar';
import { DateStub } from '../fields';
import { firstFree, isOpen, rangeLabel, rentalDays, todayIso, unavailableSet } from '../dates';
import { Btn, EASE, Photo, Pill, Shell, money } from '../ui';

const STEPS = ['Your dates', 'Pickup', 'Payment'];
const field = 'mt-1 h-12 w-full rounded-[0.9rem] border border-[var(--border-strong)] bg-card px-4 text-base';

export function CheckoutScreen({ id }: { id: string }) {
  const { go, toast, search, setSearch, availFor } = useP();
  const listing = listings.find((l) => l.id === id) ?? listings[0];
  const avail = availFor(listing.id);
  const blocked = useMemo(() => unavailableSet(listing.id, avail), [listing.id, avail]);
  const seed = isOpen(listing.id, avail, search.start, search.end) && search.start && search.end ? { start: search.start, end: search.end } : firstFree(listing.id, avail) ?? { start: '', end: '' };
  const [start, setStart] = useState(seed.start);
  const [end, setEnd] = useState(seed.end);
  const [step, setStep] = useState(0);
  const [pickup, setPickup] = useState<'pickup' | 'delivery'>('pickup');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = Boolean(start && end);
  const days = chosen ? rentalDays(start, end) : 0;
  const rental = listing.pricePerDay * days;
  const fee = Math.round(rental * 0.1);
  const delivery = pickup === 'delivery' ? 15 : 0;
  const total = rental + fee + delivery;
  const setDates = (s: string, e: string) => { setStart(s); setEnd(e); if (s && e) setSearch({ start: s, end: e }); };

  const next = () => {
    if (step === 0 && !chosen) return;
    if (step < 2) { setStep(step + 1); return; }
    setBusy(true);
    window.setTimeout(() => { setBusy(false); go('confirmation', listing.id); }, 900);
  };

  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <button type="button" onClick={() => (step ? setStep(step - 1) : go('listing', listing.id))} className="mb-6 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-sec hover:text-main"><ChevronLeft size={18} aria-hidden="true" />{step ? 'Back' : 'Back to listing'}</button>
      <ol className="mb-10 flex items-center gap-3" aria-label="Booking steps">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined} className="flex flex-1 items-center gap-3">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${i < step ? 'bg-[var(--accent)] text-white' : i === step ? 'bg-[var(--ink)] text-white' : 'bg-subtle text-sec'}`}>{i < step ? <Check size={16} aria-hidden="true" /> : i + 1}</span>
            <span className={`hidden text-sm font-semibold sm:block ${i === step ? '' : 'text-sec'}`}>{label}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className="h-0.5 flex-1 rounded-full bg-[var(--border)]"><motion.span className="block h-full rounded-full bg-[var(--accent)]" initial={false} animate={{ width: i < step ? '100%' : '0%' }} transition={{ duration: 0.4, ease: EASE }} /></span>}
          </li>
        ))}
      </ol>

      <div className="grid gap-10 lg:grid-cols-[1fr_24rem] lg:gap-16">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: EASE }}>
          {step === 0 && (
            <div>
              <h1 className="font-editorial text-5xl leading-none tracking-[-0.03em] sm:text-6xl">Which days do you need it?</h1>
              <p className="mt-3 text-sec">{listing.owner.name.split(' ')[0]} lends this {rangeLabel(avail.start, avail.end)}. Shaded days are already taken.</p>
              <div className="mt-6 flex flex-col gap-6 rounded-[1.5rem] bg-card p-4 sm:p-6 md:flex-row md:items-start md:justify-between">
                <Calendar start={start} end={end} onRange={setDates} min={avail.start > todayIso() ? avail.start : todayIso()} max={avail.end} blocked={blocked} twoUp fluid />
                <div className="grid shrink-0 grid-cols-2 gap-2 md:w-56 md:grid-cols-1" aria-live="polite">
                  <DateStub label="Pick up" day={start} active={!start || Boolean(end)} />
                  <DateStub label="Return" day={end} active={Boolean(start) && !end} />
                  <p className={`col-span-2 mt-1 inline-flex h-10 items-center justify-self-start rounded-full px-4 text-sm font-bold md:col-span-1 ${chosen ? 'bg-[var(--highlight)] text-[var(--ink)]' : 'bg-subtle text-sec'}`}>{chosen ? `${days} ${days === 1 ? 'day' : 'days'} · ${money(rental)}` : start ? 'Pick return' : 'Pick up day'}</p>
                </div>
              </div>
              <label className="mt-8 block text-sm font-semibold">Say hello to {listing.owner.name.split(' ')[0]} <span className="font-normal text-sec">(optional)</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={300} placeholder="What will you use it for?" className={`${field} h-auto py-3`} />
              </label>
            </div>
          )}
          {step === 1 && (
            <div>
              <h1 className="font-editorial text-5xl leading-none tracking-[-0.03em] sm:text-6xl">How will you get it?</h1>
              <div className="mt-8 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Pickup method">
                {([['pickup', 'Pick up', `Free · ${listing.pickup.split(' - ')[0]}`], ['delivery', 'Delivery', '$15 · within 10 miles']] as const).map(([value, title, sub]) => (
                  <button key={value} type="button" role="radio" aria-checked={pickup === value} onClick={() => setPickup(value)} className={`rounded-[1.5rem] p-6 text-left transition ${pickup === value ? 'bg-[var(--ink)] text-white' : 'bg-card hover:bg-subtle'}`}>
                    <span className="block font-display text-xl font-bold">{title}</span><span className={`mt-1 block text-sm ${pickup === value ? 'text-white/80' : 'text-sec'}`}>{sub}</span>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-sm text-sec">Exact address is shared after the owner approves your request.</p>
            </div>
          )}
          {step === 2 && (
            <div>
              <h1 className="font-editorial text-5xl leading-none tracking-[-0.03em] sm:text-6xl">Review and pay</h1>
              <div className="mt-8 space-y-3 rounded-[1.5rem] bg-card p-6">
                <label className="block text-sm font-semibold">Card number<input className={field} inputMode="numeric" placeholder="4242 4242 4242 4242" autoComplete="cc-number" /></label>
                <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold">Expiry<input className={field} placeholder="MM / YY" autoComplete="cc-exp" /></label><label className="block text-sm font-semibold">CVC<input className={field} placeholder="123" autoComplete="cc-csc" /></label></div>
              </div>
              <p className="mt-4 flex items-start gap-2 text-sm text-sec"><Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0" />Your card is only charged after {listing.owner.name.split(' ')[0]} approves. Free cancellation up to 48 hours before pickup.</p>
            </div>
          )}
          <div className="mt-10 flex gap-3">
            <Btn size="lg" onClick={next} disabled={busy || (step === 0 && !chosen)} className="min-w-48">{busy ? 'Sending…' : step < 2 ? 'Continue' : `Send request · ${money(total)}`}</Btn>
            <Btn size="lg" tone="ghost" onClick={() => toast('Saved for later. Your dates will be waiting.')}>Save for later</Btn>
          </div>
        </motion.div>

        <aside className="h-fit rounded-[1.75rem] bg-card p-6 lg:sticky lg:top-28" aria-label="Order summary">
          <div className="flex gap-4"><Photo src={listing.images[0]} className="h-24 w-24 shrink-0 rounded-[1rem]" /><div className="min-w-0"><p className="font-display font-bold leading-snug">{listing.title}</p><p className="mt-1 text-sm text-sec">{days} {days === 1 ? 'day' : 'days'} · {listing.owner.name}</p></div></div>
          <dl className="mt-6 space-y-2 text-[15px]">
            <div className="flex justify-between"><dt className="text-sec">{money(listing.pricePerDay)} × {days}</dt><dd className="tnum">{money(rental)}</dd></div>
            <div className="flex justify-between"><dt className="text-sec">Service fee</dt><dd className="tnum">{money(fee)}</dd></div>
            {delivery > 0 && <div className="flex justify-between"><dt className="text-sec">Delivery</dt><dd className="tnum">{money(delivery)}</dd></div>}
            <div className="flex justify-between border-t border-app pt-3 text-xl font-bold"><dt>Total</dt><dd className="tnum">{money(total)}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-sec">Plus a {money(listing.deposit)} refundable deposit hold.</p>
        </aside>
      </div>
    </Shell>
  );
}

export function ConfirmationScreen({ id }: { id: string }) {
  const { go, celebrate } = useP();
  const listing = listings.find((l) => l.id === id) ?? listings[0];
  const owner = listing.owner.name.split(' ')[0];
  useEffect(() => {
    celebrate(`${owner} usually replies within the hour. You won’t be charged until they say yes.`, 'Request sent. Fingers crossed!');
  }, [celebrate, owner]);
  return (
    <Shell className="pb-20 pt-10 sm:pt-16">
      <div className="mx-auto max-w-2xl text-center">
        <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[var(--accent)] text-white">
          <motion.svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.25 }} /></motion.svg>
        </motion.div>
        <h1 className="mt-8 font-editorial text-6xl leading-none tracking-[-0.03em] sm:text-7xl">Request sent</h1>
        <p className="mt-4 text-lg text-sec">{owner} usually replies within an hour. You won’t be charged until they approve.</p>
      </div>
      <div className="mx-auto mt-10 max-w-2xl rounded-[1.75rem] bg-card p-6">
        <div className="flex gap-4"><Photo src={listing.images[0]} className="h-24 w-24 rounded-[1rem]" /><div><p className="font-display text-lg font-bold">{listing.title}</p><Pill tone="warn">Waiting for approval</Pill></div></div>
        <ol className="mt-6 space-y-4">
          {[['Request sent', 'Just now', true], ['Owner approves', 'Usually within an hour', false], ['Payment is taken', 'Only after approval', false], ['Pick up & enjoy', 'Address shared once approved', false]].map(([title, sub, done]) => (
            <li key={String(title)} className="flex items-start gap-3"><span className={`mt-0.5 grid h-6 w-6 place-items-center rounded-full ${done ? 'bg-[var(--accent)] text-white' : 'bg-subtle'}`}>{done ? <Check size={13} aria-hidden="true" /> : null}</span><div><p className="font-semibold">{title}</p><p className="text-sm text-sec">{sub}</p></div></li>
          ))}
        </ol>
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3"><Btn onClick={() => go('renter')}>View your rentals</Btn><Btn tone="soft" onClick={() => go('messages')}>Message {owner}</Btn><Btn tone="ghost" onClick={() => go('search')}>Keep browsing</Btn></div>
    </Shell>
  );
}
