import { useState } from 'react';
import { BadgeCheck, Check, Clock, Package, Star } from 'lucide-react';
import { currentUser, listings } from '@/data';
import { useP } from '../ctx';
import { Avatar, Btn, Empty, ListingTile, Shell, Title } from '../ui';

export function FavoritesScreen() {
  const { favs, go } = useP();
  const saved = listings.filter((l) => favs.has(l.id));
  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <Title sub={`${saved.length} ${saved.length === 1 ? 'item' : 'items'} saved`}>Saved items</Title>
      <div className="mt-10">
        {saved.length === 0
          ? <Empty title="Nothing saved yet" body="Tap the heart on anything you like and it will wait here." action={<Btn onClick={() => go('search')}>Browse items</Btn>} />
          : <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">{saved.map((l) => <ListingTile key={l.id} listing={l} />)}</div>}
      </div>
    </Shell>
  );
}

function Toggle({ label, hint, initial }: { label: string; hint: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => setOn(!on)} className="flex w-full items-center justify-between gap-4 py-4 text-left">
      <span><span className="block font-semibold">{label}</span><span className="text-sm text-sec">{hint}</span></span>
      <span aria-hidden="true" className={`relative h-8 w-14 shrink-0 rounded-full transition ${on ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${on ? 'left-7' : 'left-1'}`} /></span>
    </button>
  );
}

export function ProfileScreen() {
  const { toast, openSignIn } = useP();
  const checks = [['Email confirmed', true], ['Phone number', true], ['Government ID', true], ['Payout details', false]] as const;
  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <div className="grid gap-10 lg:grid-cols-[22rem_1fr] lg:gap-16">
        <aside className="h-fit rounded-[1.75rem] bg-card p-8 text-center lg:sticky lg:top-28">
          <div className="mx-auto w-fit"><Avatar src={currentUser.avatar} name={currentUser.name} size={112} /></div>
          <h1 className="mt-4 font-editorial text-5xl leading-none">{currentUser.name}</h1>
          <p className="mt-2 inline-flex items-center gap-1 text-sm text-sec"><BadgeCheck size={16} aria-hidden="true" className="text-accent" />Verified · joined {currentUser.joinedYear}</p>
          <p className="mt-4 text-sec">{currentUser.bio}</p>
          <dl className="mt-6 grid grid-cols-3 gap-2">
            {[[Star, String(currentUser.rating), 'rating'], [Package, String(currentUser.rentals), 'rentals'], [Clock, `${currentUser.responseRate}%`, 'reply rate']].map(([Icon, value, label]) => { const I = Icon as typeof Star; return <div key={String(label)} className="rounded-[1rem] bg-subtle py-3"><I size={16} aria-hidden="true" className="mx-auto text-accent" /><dd className="mt-1 font-display text-lg font-bold">{String(value)}</dd><dt className="text-xs text-sec">{String(label)}</dt></div>; })}
          </dl>
          <Btn tone="outline" full className="mt-6" onClick={openSignIn}>Switch account</Btn>
        </aside>
        <div className="space-y-6">
          <section className="rounded-[1.75rem] bg-card p-6 sm:p-8" aria-labelledby="trust"><h2 id="trust" className="font-editorial text-4xl leading-none">Trust & verification</h2><p className="mt-2 text-sec">Verified profiles get approved faster and rank higher.</p>
            <ul className="mt-5 space-y-3">{checks.map(([label, done]) => <li key={label} className="flex items-center justify-between rounded-[1rem] bg-subtle px-4 py-3"><span className="flex items-center gap-3 font-semibold"><span className={`grid h-6 w-6 place-items-center rounded-full ${done ? 'bg-[var(--accent)] text-white' : 'bg-card text-sec'}`}>{done && <Check size={13} aria-hidden="true" />}</span>{label}</span>{!done && <Btn size="sm" onClick={() => toast('Payout setup opens here. Almost there!')}>Add</Btn>}</li>)}</ul></section>
          <section className="rounded-[1.75rem] bg-card p-6 sm:p-8" aria-labelledby="prefs"><h2 id="prefs" className="font-editorial text-4xl leading-none">Preferences</h2>
            <div className="mt-2 divide-y divide-[var(--border)]"><Toggle label="Rental updates" hint="Approvals, pickups and returns" initial /><Toggle label="Bid alerts" hint="When you’re outbid or a bid is about to close" initial /><Toggle label="New items near me" hint="A weekly roundup" initial={false} /></div></section>
        </div>
      </div>
    </Shell>
  );
}
