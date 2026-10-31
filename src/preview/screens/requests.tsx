import { useState } from 'react';
import { MapPin, Send } from 'lucide-react';
import { needRequests, currentUser, type NeedRequest } from '@/data';
import { useP } from '../ctx';
import { Avatar, Btn, Chip, Empty, Pill, Shell, Title, money } from '../ui';

const field = 'mt-1 h-12 w-full rounded-[0.9rem] border border-[var(--border-strong)] bg-card px-4 text-base';

export function RequestsScreen() {
  const { toast, celebrate } = useP();
  const [tab, setTab] = useState<'browse' | 'mine'>('browse');
  const [items, setItems] = useState<NeedRequest[]>(needRequests);
  const [mine, setMine] = useState<NeedRequest[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [offer, setOffer] = useState(30);
  const [what, setWhat] = useState('');
  const [when, setWhen] = useState('This weekend');
  const [budget, setBudget] = useState(40);

  const send = (id: string) => {
    setItems((list) => list.map((r) => (r.id === id ? { ...r, offers: r.offers + 1 } : r)));
    setOpen(null);
    toast(`Offer of ${money(offer)} sent. Fingers crossed!`);
  };
  const post = () => {
    if (what.trim().length < 3) return;
    setMine((list) => [{ id: `m${list.length}`, title: `I need ${what.trim()}`, when, location: 'Irving, TX', budget, renter: currentUser.name, avatar: currentUser.avatar, postedAgo: 'just now', offers: 0 }, ...list]);
    setWhat('');
    setTab('mine');
    celebrate('Neighbours nearby just got a ping. Offers usually roll in within the hour.', 'Request posted!');
  };

  const list = tab === 'browse' ? items : mine;
  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <Title sub="Can’t find it? Ask neighbours. Got something people need? Make an offer.">Requests & offers</Title>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-14">
        <div>
          <div className="flex gap-2" role="tablist" aria-label="Requests"><Chip active={tab === 'browse'} onClick={() => setTab('browse')}>Browse requests</Chip><Chip active={tab === 'mine'} onClick={() => setTab('mine')}>My requests {mine.length ? `(${mine.length})` : ''}</Chip></div>
          <div className="mt-5 space-y-3">
            {list.length === 0 && <Empty title="Nothing yet" body="Post what you’re looking for and owners nearby will send offers." />}
            {list.map((r) => (
              <article key={r.id} className="rounded-[1.5rem] bg-card p-5">
                <div className="flex gap-4"><Avatar src={r.avatar} name={r.renter} size={48} />
                  <div className="min-w-0 flex-1"><p className="font-display text-lg font-bold">{r.title}</p><p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-sec"><span>{r.when}</span><span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden="true" />{r.location}</span><span>{r.postedAgo}</span></p>
                    <div className="mt-2 flex items-center gap-2"><Pill tone="yellow">Budget {money(r.budget)}/day</Pill>{r.offers > 0 && <Pill tone="accent">{r.offers} {r.offers === 1 ? 'offer' : 'offers'}</Pill>}</div></div>
                  {tab === 'browse' && <Btn size="sm" tone={open === r.id ? 'soft' : 'solid'} onClick={() => { setOpen(open === r.id ? null : r.id); setOffer(r.budget); }}>{open === r.id ? 'Close' : 'Make an offer'}</Btn>}
                </div>
                {open === r.id && (
                  <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-app pt-4" onSubmit={(event) => { event.preventDefault(); send(r.id); }}>
                    <label className="text-sm font-semibold">Your price per day<input type="number" min={1} value={offer} onChange={(event) => setOffer(Number(event.target.value))} className={`${field} w-40`} /></label>
                    <Btn type="submit" icon={<Send size={15} aria-hidden="true" />}>Send offer</Btn>
                  </form>
                )}
              </article>
            ))}
          </div>
        </div>
        <aside className="h-fit rounded-[1.75rem] bg-[var(--ink)] p-6 text-white lg:sticky lg:top-28" aria-label="Post a request">
          <h2 className="font-editorial text-4xl leading-none">Ask for it</h2>
          <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); post(); }}>
            <label className="block text-sm font-semibold">What do you need?<input value={what} onChange={(event) => setWhat(event.target.value)} placeholder="a pressure washer" className="mt-1 h-12 w-full rounded-[0.9rem] bg-white/10 px-4 text-base text-white outline-none placeholder:text-white/50 focus:ring-2 focus:ring-[var(--highlight)]" /></label>
            <label className="block text-sm font-semibold">When<select value={when} onChange={(event) => setWhen(event.target.value)} className="mt-1 h-12 w-full rounded-[0.9rem] bg-white/10 px-4 text-base text-white outline-none"><option className="text-black">This weekend</option><option className="text-black">Next week</option><option className="text-black">Flexible</option></select></label>
            <label className="block text-sm font-semibold">Budget per day: {money(budget)}<input type="range" min={5} max={150} step={5} value={budget} onChange={(event) => setBudget(Number(event.target.value))} className="mt-2 w-full accent-[var(--highlight)]" /></label>
            <Btn type="submit" tone="yellow" size="lg" full disabled={what.trim().length < 3}>Post request</Btn>
          </form>
        </aside>
      </div>
    </Shell>
  );
}
