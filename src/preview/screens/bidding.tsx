import { useEffect, useState } from 'react';
import { ChevronLeft, Eye, ShieldCheck } from 'lucide-react';
import { auctions, currentUser, type AuctionListing, type Bid } from '@/data';
import { useP } from '../ctx';
import { Avatar, Btn, Photo, Pill, PriceTag, Reveal, Shell, Stars, Title, money } from '../ui';

function useCountdown(hours: number) {
  const [left, setLeft] = useState(Math.round(hours * 3600) - 14 * 60);
  useEffect(() => {
    const timer = window.setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  return left === 0 ? 'Closed' : `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function Countdown({ hours }: { hours: number }) { return <span className="tnum">{useCountdown(hours)}</span>; }

export function BiddingScreen() {
  const { go } = useP();
  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <Title sub="Name your price for the days you need. The highest offer when the clock ends wins.">Live bidding</Title>
      <div className="mt-10 grid gap-x-4 gap-y-10 sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-3">
        {auctions.map((a, index) => (
          <Reveal key={a.id} delay={index * 0.05}>
            <button type="button" onClick={() => go('auction', a.id)} className="group block w-full text-left" aria-label={`Bid on ${a.title}`}>
              <span className="relative block aspect-[4/3] overflow-hidden rounded-[1.5rem] bg-subtle">
                <Photo src={a.image} className="absolute inset-0 h-full w-full transition duration-[400ms] group-hover:scale-[1.03]" />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-bold text-white"><span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-[var(--highlight)]" /><Countdown hours={a.endsInHours} /></span>
                <PriceTag className="bottom-4"><span className="font-display text-xl font-extrabold tnum">{money(a.currentBid)}</span><span className="text-xs font-semibold">/ day · top bid</span></PriceTag>
              </span>
              <span className="mt-3 block px-1"><span className="block font-display text-lg font-bold leading-snug">{a.title}</span><span className="text-sm text-sec">{a.bids.length} bids · {a.watchers} watching · {a.distance} mi</span></span>
            </button>
          </Reveal>
        ))}
      </div>
    </Shell>
  );
}

export function AuctionScreen({ id }: { id: string }) {
  const { go, celebrate } = useP();
  const base: AuctionListing = auctions.find((a) => a.id === id) ?? auctions[0];
  const [bids, setBids] = useState<Bid[]>(base.bids);
  const top = bids.reduce((max, b) => Math.max(max, b.amount), base.startingPrice);
  const [amount, setAmount] = useState(top + 2);
  const [error, setError] = useState('');
  const leading = bids.find((b) => b.isLeading);
  const mine = leading?.bidder === currentUser.name;

  const place = () => {
    if (amount < top + 1) { setError(`Bid at least ${money(top + 1)} to lead.`); return; }
    setError('');
    setBids((previous) => [...previous.map((b) => ({ ...b, isLeading: false })), { id: `mine-${previous.length}`, bidder: currentUser.name, avatar: currentUser.avatar, amount, time: 'just now', isLeading: true }]);
    setAmount(amount + 2);
    celebrate(`You’re leading at ${money(amount)}/day. Now we wait.`, 'You’re in the lead!');
  };

  return (
    <Shell className="pb-20 pt-4 sm:pt-8">
      <button type="button" onClick={() => go('bidding')} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-sec hover:text-main"><ChevronLeft size={18} aria-hidden="true" />All bidding</button>
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
        <div><Photo src={base.image} className="aspect-[4/3] w-full rounded-[1.75rem]" />
          <h1 className="mt-6 font-editorial text-5xl leading-[0.95] tracking-[-0.03em] sm:text-6xl">{base.title}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 text-sec"><span className="inline-flex items-center gap-2"><Avatar src={base.ownerAvatar} name={base.owner} size={28} />{base.owner}</span><Stars rating={base.rating} /><span className="inline-flex items-center gap-1"><Eye size={14} aria-hidden="true" />{base.watchers} watching</span></p>
          <div className="mt-4 flex flex-wrap gap-2">{base.verified && <Pill tone="accent"><ShieldCheck size={13} aria-hidden="true" className="mr-1" />Verified owner</Pill>}{base.protectionEligible && <Pill>Rental protection</Pill>}<Pill>{base.rentalDays} days</Pill></div>
        </div>
        <div className="space-y-4">
          <div className="ink-surface rounded-[1.75rem] p-6 sm:p-8">
            <p className="text-sm font-semibold text-white/70">Top bid · closes in <Countdown hours={base.endsInHours} /></p>
            <p className="mt-1 font-editorial text-8xl leading-none tnum">{money(top)}<span className="font-display text-xl text-white/70"> / day</span></p>
            <p className="mt-2 text-sm text-white/80">{mine ? 'You’re leading. Nice.' : `Starting price ${money(base.startingPrice)}`}</p>
            <div className="mt-6 flex gap-2" role="group" aria-label="Quick increments">{[2, 5, 10].map((n) => <button key={n} type="button" onClick={() => setAmount(top + n)} className="h-11 flex-1 rounded-full bg-white/10 text-sm font-bold hover:bg-white/20">+{n}</button>)}</div>
            <label className="mt-3 block text-sm font-semibold">Your bid per day
              <input type="number" min={top + 1} value={amount} onChange={(event) => setAmount(Number(event.target.value))} aria-invalid={Boolean(error)} className="mt-1 h-14 w-full rounded-[1rem] bg-white/10 px-5 text-2xl font-bold text-white outline-none focus:ring-2 focus:ring-[var(--highlight)]" />
            </label>
            {error && <p role="alert" className="mt-2 text-sm text-[var(--highlight)]">{error}</p>}
            <Btn tone="yellow" size="lg" full onClick={place} className="mt-4">Place bid · {money(amount * base.rentalDays)} total</Btn>
            <p className="mt-3 text-center text-xs text-white/70">You’re only charged if you win and the owner confirms.</p>
          </div>
          <section aria-labelledby="hist" className="rounded-[1.75rem] bg-card p-6"><h2 id="hist" className="font-editorial text-3xl leading-none">Bid history</h2>
            <ul className="mt-4 space-y-3">{[...bids].reverse().map((b) => (
              <li key={b.id} className="flex items-center gap-3"><Avatar src={b.avatar} name={b.bidder} size={36} /><div className="min-w-0 flex-1"><p className="font-semibold">{b.bidder}{b.isLeading && <span className="ml-2"><Pill tone="yellow">Leading</Pill></span>}</p><p className="text-xs text-sec">{b.time}</p></div><p className="font-bold tnum">{money(b.amount)}</p></li>
            ))}</ul>
          </section>
        </div>
      </div>
    </Shell>
  );
}
