import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { motion } from 'motion/react';
import { categories, listings } from '@/data';
import { useP } from '../ctx';
import { AvailabilityEditor } from '../availability';
import { addDays, eachDay, rangeLabel, todayIso, type Avail } from '../dates';
import { Btn, Chip, EASE, Photo, PriceTag, Shell, money } from '../ui';

const STEPS = ['What', 'Photos', 'Price & rules', 'Dates', 'Review'];
const POOL = listings.flatMap((l) => l.images).slice(0, 18);
const field = 'mt-1 h-12 w-full rounded-[0.9rem] border border-[var(--border-strong)] bg-card px-4 text-base';

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-4 rounded-[1.25rem] bg-card p-5 text-left">
      <span><span className="block font-display font-bold">{label}</span><span className="text-sm text-sec">{hint}</span></span>
      <span aria-hidden="true" className={`relative h-8 w-14 shrink-0 rounded-full transition ${on ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${on ? 'left-7' : 'left-1'}`} /></span>
    </button>
  );
}

export function CreateScreen({ editId }: { editId?: string }) {
  const { go, celebrate, toast, availFor, setAvail } = useP();
  const existing = editId ? listings.find((l) => l.id === editId) : undefined;
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState(existing?.category ?? 'Cameras');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>(existing ? existing.images.slice(0, 3) : []);
  const [price, setPrice] = useState(existing?.pricePerDay ?? 40);
  const [deposit, setDeposit] = useState(existing?.deposit ?? 100);
  const [instant, setInstant] = useState(existing?.instantBooking ?? true);
  const [bidding, setBidding] = useState(false);
  const [avail, setLocalAvail] = useState<Avail>(() => (existing ? availFor(existing.id) : { start: todayIso(), end: addDays(todayIso(), 29), blocked: [] }));

  const open = avail.start && avail.end ? eachDay(avail.start, avail.end).filter((d) => !avail.blocked.includes(d)).length : 0;
  const valid = [title.trim().length >= 3, photos.length >= 1, price > 0, open > 0, true][step];
  const hint = ['Add a title of at least 3 characters.', 'Add at least one photo.', 'Set a daily price.', 'Choose a window and keep at least one day open.', ''][step];
  const addPhoto = () => { const next = POOL.find((src) => !photos.includes(src)); if (next && photos.length < 6) setPhotos([...photos, next]); };

  const publish = () => {
    if (existing) { setAvail(existing.id, avail); toast('Changes saved.'); go('owner'); return; }
    celebrate('We’re giving it a quick once-over. It goes live in about a day.', 'You’re officially a host!');
    go('owner');
  };

  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <h1 className="font-editorial text-5xl leading-none tracking-[-0.03em] sm:text-7xl">{existing ? 'Edit your listing' : 'List an item'}</h1>
      <ol className="mt-8 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}><button type="button" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined} className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold ${i === step ? 'bg-[var(--ink)] text-white' : i < step ? 'bg-[var(--accent-soft)] text-accent' : 'bg-card text-sec'}`}>{i < step ? <Check size={14} aria-hidden="true" /> : null}{label}</button></li>
        ))}
      </ol>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-16">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: EASE }} className="min-w-0">
          {step === 0 && (
            <div className="space-y-6">
              <h2 className="font-editorial text-4xl leading-none sm:text-5xl">What are you renting out?</h2>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Category">{[...new Set(categories.map((c) => c.name))].map((name) => <Chip key={name} active={category === name} onClick={() => setCategory(name)}>{name}</Chip>)}</div>
              <label className="block text-sm font-semibold">Title<input className={field} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Sony A7 IV with 24–70mm lens" maxLength={80} /></label>
              <label className="block text-sm font-semibold">Description<textarea className={`${field} h-auto py-3`} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Condition, what’s included, anything renters should know." /></label>
            </div>
          )}
          {step === 1 && (
            <div>
              <h2 className="font-editorial text-4xl leading-none sm:text-5xl">Show it off</h2>
              <p className="mt-3 text-sec">The first photo is your cover. Bright, uncluttered shots rent fastest.</p>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((src, i) => (
                  <div key={src} className="relative overflow-hidden rounded-[1.25rem]"><Photo src={src} className="aspect-[4/3] w-full" />{i === 0 && <span className="absolute left-3 top-3 rounded-full bg-[var(--ink)] px-3 py-1 text-xs font-bold text-white">Cover</span>}
                    <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((p) => p !== src))} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90"><X size={16} aria-hidden="true" /></button></div>
                ))}
                {photos.length < 6 && <button type="button" onClick={addPhoto} className="grid aspect-[4/3] place-items-center rounded-[1.25rem] border-2 border-dashed border-[var(--border-strong)] text-sec hover:bg-card"><span className="grid justify-items-center gap-1 font-semibold"><Plus size={22} aria-hidden="true" />Add a photo</span></button>}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="font-editorial text-4xl leading-none sm:text-5xl">Set your price</h2>
              <div className="rounded-[1.5rem] bg-card p-6"><p className="font-editorial text-8xl leading-none tnum">{money(price)}<span className="font-display text-xl text-sec"> / day</span></p>
                <input type="range" min={5} max={200} step={5} value={price} onChange={(event) => setPrice(Number(event.target.value))} aria-label="Daily price" className="mt-4 w-full accent-accent" />
                <p className="mt-2 text-sm text-sec">Similar items nearby rent for $25–$85 a day. Weekly: {money(price * 5)}.</p></div>
              <label className="block text-sm font-semibold">Refundable deposit<input className={field} type="number" min={0} value={deposit} onChange={(event) => setDeposit(Math.max(0, Number(event.target.value)))} /></label>
              <Toggle on={instant} onChange={setInstant} label="Instant booking" hint="Skip approvals for verified renters." />
              <Toggle on={bidding} onChange={setBidding} label="Let renters bid" hint="Highest offer wins when bidding closes." />
            </div>
          )}
          {step === 3 && (
            <div>
              <h2 className="font-editorial text-4xl leading-none sm:text-5xl">When is it available?</h2>
              <p className="mt-3 text-sec">Open it for up to 30 days, then block any days you can’t lend it. You can change this later from Edit listing.</p>
              <div className="mt-6 rounded-[1.5rem] bg-card p-4 sm:p-6"><AvailabilityEditor listingId={existing?.id} value={avail} onChange={setLocalAvail} /></div>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-editorial text-4xl leading-none sm:text-5xl">Ready to list</h2>
              <ul className="space-y-2 rounded-[1.5rem] bg-card p-6 text-[15px]">
                <li><b>{title || 'Untitled'}</b> · {category}</li><li>{photos.length} photos · {money(price)}/day · {money(deposit)} deposit</li><li>{instant ? 'Instant booking on' : 'Approval required'}{bidding ? ' · bidding on' : ''}</li><li>Open {rangeLabel(avail.start, avail.end)} · {open} open days · {avail.blocked.length} blocked</li>
              </ul>
              <p className="text-sm text-sec">Listings are reviewed within a day. You can edit or pause any time.</p>
            </div>
          )}
          <div className="mt-10 flex items-center gap-3">
            {step > 0 && <Btn size="lg" tone="soft" onClick={() => setStep(step - 1)}>Back</Btn>}
            {step < 4 ? <Btn size="lg" disabled={!valid} onClick={() => setStep(step + 1)}>Continue</Btn> : <Btn size="lg" onClick={publish}>{existing ? 'Save changes' : 'Publish listing'}</Btn>}
            {!valid && <span role="status" className="text-sm text-sec">{hint}</span>}
          </div>
        </motion.div>

        <aside className="hidden lg:block" aria-label="Live preview"><div className="sticky top-28">
          <p className="mb-3 text-sm font-semibold text-sec">How renters will see it</p>
          <div className="relative overflow-hidden rounded-[1.5rem] bg-card"><span className="relative block aspect-[4/5] bg-subtle"><Photo src={photos[0]} className="absolute inset-0 h-full w-full" /><PriceTag className="bottom-4"><span className="font-display text-lg font-extrabold">{money(price)}</span><span className="text-xs font-semibold">/ day</span></PriceTag></span>
            <div className="p-4"><p className="font-display font-bold leading-snug">{title || 'Your title appears here'}</p><p className="text-sm text-sec">{category}{instant ? ' · Instant booking' : ''}</p></div></div>
        </div></aside>
      </div>
    </Shell>
  );
}
