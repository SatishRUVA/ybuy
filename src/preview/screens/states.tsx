import { useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { listings } from '@/data';
import { useP } from '../ctx';
import { Btn, Empty, ListingTile, Shell, Skeleton, Title } from '../ui';

export function StatesScreen() {
  const { go, toast, celebrate } = useP();
  const [retrying, setRetrying] = useState(false);
  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <Title sub="What people see while things load, when there’s nothing yet, and when something goes wrong.">Every state</Title>

      <section className="mt-12" aria-labelledby="s-load"><h2 id="s-load" className="font-editorial text-4xl leading-none">Loading</h2>
        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i}><Skeleton className="aspect-[4/5]" /><Skeleton className="mt-3 h-5 w-3/4" /><Skeleton className="mt-2 h-4 w-1/2" /></div>)}</div></section>

      <section className="mt-14" aria-labelledby="s-empty"><h2 id="s-empty" className="font-editorial text-4xl leading-none">Empty</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Empty title="No saved items" body="Tap the heart on anything you like and it will wait here." action={<Btn onClick={() => go('search')}>Browse items</Btn>} />
          <Empty title="No messages yet" body="When you book or list something, conversations show up here." action={<Btn tone="soft" onClick={() => go('home')}>Go home</Btn>} />
        </div></section>

      <section className="mt-14" aria-labelledby="s-error"><h2 id="s-error" className="font-editorial text-4xl leading-none">Errors</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div role="alert" className="rounded-[1.75rem] bg-error-soft p-8"><AlertTriangle size={28} aria-hidden="true" className="text-error" /><p className="mt-4 font-editorial text-4xl leading-none text-error">We couldn’t load this</p><p className="mt-2 text-sec">Something went wrong on our side. Your data is safe.</p>
            <Btn className="mt-5" onClick={() => { setRetrying(true); window.setTimeout(() => { setRetrying(false); toast('And we’re back. Thanks for hanging in there.'); }, 900); }} disabled={retrying}>{retrying ? 'Trying…' : 'Try again'}</Btn></div>
          <div className="rounded-[1.75rem] bg-warning-soft p-8"><WifiOff size={28} aria-hidden="true" className="text-warning" /><p className="mt-4 font-editorial text-4xl leading-none text-warning">You’re offline</p><p className="mt-2 text-sec">Saved items and your bookings are still here. We’ll sync when you reconnect.</p></div>
        </div></section>

      <section className="mt-14" aria-labelledby="s-ok"><h2 id="s-ok" className="font-editorial text-4xl leading-none">Success</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">{listings.slice(0, 3).map((l) => <ListingTile key={l.id} listing={l} />)}</div>
        <div className="mt-6 flex gap-2"><Btn onClick={() => celebrate('This is what a win feels like.', 'Booked!')}>Celebrate</Btn><Btn tone="soft" onClick={() => toast('Saved. Good taste.')}>Quiet toast</Btn><Btn tone="soft" onClick={() => go('confirmation', 'l1')}>Open confirmation screen</Btn></div></section>
    </Shell>
  );
}
