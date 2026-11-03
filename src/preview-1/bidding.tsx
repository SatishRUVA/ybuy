import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock, Eye, Gavel, Lock, ShieldCheck } from 'lucide-react';
import { auctions } from '@/data';
import { rangeLabel } from '../preview/dates';
import { href, usePreview } from './state';
import { Action, Avatar, Button, Empty, ErrorNote, Field, PageHead, Tag, money } from './ui';

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const remaining = Math.max(0, Math.floor((until - now) / 1000));
  return <span className="p1-countdown">{remaining ? `${Math.floor(remaining / 3600)}h ${String(Math.floor(remaining / 60) % 60).padStart(2, '0')}m ${String(remaining % 60).padStart(2, '0')}s` : 'Bidding closed'}</span>;
}
export function BiddingLayout({ categories, children }: { categories: ReactNode; children: ReactNode }) {
  return <main className="p1-container p1-page"><PageHead title="Great gear. Your bid." description="Competitive bidding is a second way to rent. See the dates, set your price, and follow the next steps." />
    <div className="p1-bid-intro"><Gavel size={26} aria-hidden="true" /><p><b>Three bids. One good plan.</b> You can bid up to three times per auction. The owner selects from eligible bids after bidding closes. Payment comes next, not before.</p><ShieldCheck size={25} aria-hidden="true" /></div>
    <div className="p1-tabs p1-space-bottom" aria-label="Bidding categories">{categories}</div>
    {children}
  </main>;
}

export function AuctionCard({ id, title, image, countdown, category, status, owner, price, priceLabel = 'Top bid per day' }: {
  id: string; title: string; image: ReactNode; countdown: ReactNode; category: string;
  status: ReactNode; owner: ReactNode; price: number; priceLabel?: string;
}) {
  return <article className="p1-auction-card"><a href={href('auction', id)} className="p1-auction-photo">{image}<span><Clock size={14} aria-hidden="true" />{countdown}</span></a><div>
    <div className="p1-section-head"><span className="p1-muted">{category}</span>{status}</div>
    <h2><a href={href('auction', id)}>{title}</a></h2><div className="p1-auction-owner">{owner}</div>
    <div className="p1-auction-price"><p><small>{priceLabel}</small><strong>{money(price)}</strong></p><Action to="auction" id={id}>See bidding <ArrowRight size={16} aria-hidden="true" /></Action></div>
  </div></article>;
}

export function BidRoomLayout({ navigation, heading, children, tools, error }: {
  navigation?: ReactNode; heading: ReactNode; children: ReactNode; tools?: ReactNode; error?: ReactNode;
}) {
  return <main className="p1-container p1-page"><div className="p1-bid-navigation"><a href={href('bidding')} className="p1-back"><ArrowLeft size={16} aria-hidden="true" /> All bidding</a>{navigation}</div>
    {error}<div className="p1-bid-room-head">{heading}</div>
    <div className="p1-bid-room-layout"><section className="p1-bid-panel">{children}</section>
      <aside className="p1-bid-rules"><h2>Know where you stand.</h2><div className="p1-info"><Gavel size={21} aria-hidden="true" /><div><h3>Up to three bids</h3><p>Each new bid must beat the current daily amount. Once placed, it counts toward your limit.</p></div></div><div className="p1-info"><Lock size={21} aria-hidden="true" /><div><h3>Private bidders. Clear prices.</h3><p>Compare amounts without exposing other renters’ identities.</p></div></div><div className="p1-info"><Check size={21} aria-hidden="true" /><div><h3>Payment confirms the rental</h3><p>A selection alone does not reserve the item. Follow the payment step after the owner’s decision.</p></div></div>{tools}</aside>
    </div>
  </main>;
}

export function Bidding() {
  const { rooms } = usePreview();
  const [category, setCategory] = useState('All');
  const rows = auctions.filter((a) => category === 'All' || a.category === category);
  return <BiddingLayout categories={['All', ...new Set(auctions.map((a) => a.category))].map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}>
    <div className="p1-auction-grid">{rows.map((a) => { const room = rooms[a.id], top = Math.max(a.startingPrice, ...room.bids.map((b) => b.amount));
      return <AuctionCard key={a.id} id={a.id} title={a.title} image={<img src={a.image} alt={a.title} />} countdown={<Countdown until={room.closes} />} category={a.category}
        status={<Tag tone={room.phase === 'live' ? 'lime' : 'blue'}>{room.phase === 'live' ? 'Live bidding' : room.phase}</Tag>} price={top}
        owner={<><Avatar src={a.ownerAvatar} name={a.owner} size={27} /><span>by {a.owner.split(' ')[0]}</span><span><Eye size={14} aria-hidden="true" />{a.watchers} watching</span></>} />; })}</div>
  </BiddingLayout>;
}

export function BidRoom({ id }: { id: string }) {
  const store = usePreview();
  const base = auctions.find((a) => a.id === id);
  const room = store.rooms[id];
  const [role, setRole] = useState<'renter' | 'owner'>('renter');
  const [amount, setAmount] = useState(base ? base.currentBid + 2 : 0);
  const [error, setError] = useState('');
  if (!base || !room) return <main className="p1-container p1-page"><Empty title="This auction isn’t here." body="Choose a live sample auction to explore bidding."><Action to="bidding">See live bidding</Action></Empty></main>;
  const top = Math.max(base.startingPrice, ...room.bids.map((b) => b.amount));
  const mine = room.bids.filter((b) => b.mine);
  const leading = mine.some((b) => b.amount === top);
  const item = store.items.find((l) => l.title === base.title);
  const dates = item ? store.firstRange(item.id, base.rentalDays) : { start: '', end: '' };
  const closed = room.closes <= Date.now() || room.phase !== 'live';
  const submit = () => {
    if (closed) { setError('Bidding is closed for this auction.'); return; }
    if (room.count >= 3) { setError('You have used your three bids. Follow the auction for next steps.'); return; }
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < top + 1) { setError(`Enter a whole-dollar bid of at least ${money(top + 1)} per day.`); return; }
    store.setRooms((prev) => ({ ...prev, [id]: { ...room, count: room.count + 1, bids: [...room.bids, { id: crypto.randomUUID(), amount, mine: true }] } }));
    store.addNotice('Your bid is leading', `${base.title} · ${money(amount)} per day`, 'auction', id);
    store.notify('You’re in the running. Now that’s a good bid.', true);
    setAmount(amount + 2); setError('');
  };
  const select = (bidId: string) => {
    store.setRooms((prev) => ({ ...prev, [id]: { ...room, selected: bidId, phase: 'payment' } }));
    store.notify('Demo bidder selected. Payment is the next step.');
  };
  const confirm = () => {
    const selected = room.bids.find((b) => b.id === room.selected);
    if (!item || !selected || !dates.end) { setError('No available rental window. Choose another sample auction.'); return; }
    const bookingId = crypto.randomUUID(), subtotal = selected.amount * base.rentalDays, total = subtotal + Math.round(subtotal * 0.1);
    store.setBookings((prev) => [{ id: bookingId, listingId: item.id, ...dates, total, status: 'upcoming', pickup: 'pickup', note: 'Demo auction booking' }, ...prev]);
    store.setRooms((prev) => ({ ...prev, [id]: { ...room, phase: 'confirmed' } }));
    store.addNotice('Auction demo booking confirmed', `${base.title} · ${rangeLabel(dates.start, dates.end)}`, 'renter');
    store.notify('Winning bid, good plans. Demo rental confirmed.', true);
    window.location.hash = href('confirmation', bookingId);
  };
  return <BidRoomLayout navigation={<div className="p1-tabs" aria-label="Bidding preview role">{(['renter', 'owner'] as const).map((r) => <button type="button" key={r} aria-pressed={role === r} onClick={() => setRole(r)}>{r === 'renter' ? 'Renter view' : 'Owner demo'}</button>)}</div>}
    heading={<><img src={base.image} alt={base.title} /><div><h1>{base.title}</h1><p><Avatar src={base.ownerAvatar} name={base.owner} size={27} /> From {base.owner} · {base.rentalDays} sample rental days</p><Tag tone="blue">{room.phase === 'decision' ? 'Owner decision' : room.phase === 'payment' ? 'Winner payment' : room.phase === 'confirmed' ? 'Demo booking confirmed' : 'Live auction'}</Tag></div><div><small>Bidding closes in</small><Countdown until={room.closes} /><span>Demo countdown</span></div></>}
    tools={<details className="p1-demo-controls"><summary>Explore demo lifecycle</summary><p>Jump forward to inspect later screens. These controls do not model real auction timing or permissions.</p><Button variant="secondary" onClick={() => { store.setRooms((prev) => ({ ...prev, [id]: { ...room, closes: Date.now(), phase: 'decision' } })); setRole('owner'); }}>Close demo bidding</Button></details>}>
      <div className="p1-bid-price"><span>Top daily bid</span><strong>{money(top)}</strong><small>{room.bids.length} bids placed</small></div>
      {role === 'renter' && room.phase === 'live' && <><Tag tone={leading ? 'lime' : 'neutral'}>{leading ? 'You’re currently leading' : 'Your next bid could be the one'}</Tag><form onSubmit={(e) => { e.preventDefault(); submit(); }}><Field label="Your bid per day"><input type="number" step={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-invalid={Boolean(error)} /></Field><div className="p1-actions">{[2, 5, 10].map((n) => <Button key={n} variant="secondary" onClick={() => setAmount(top + n)}>+{money(n)}</Button>)}</div><Button type="submit" className="p1-full" disabled={room.count >= 3 || closed}>Place bid · {money(amount * base.rentalDays)} rental subtotal</Button></form><p className="p1-muted">{room.count} of 3 bids used. Service fee and deposit are reviewed after selection.</p></>}
      {role === 'owner' && room.phase === 'live' && <div className="p1-info-copy"><h2>Let the bidding run.</h2><p>Selection is available only after bidding closes. Bidder identities stay private here.</p></div>}
      {room.phase === 'decision' && <><h2>Choose an eligible bid</h2><p className="p1-muted">Illustrative owner decision. These anonymous bids are sample data.</p>{[...room.bids].sort((a, b) => b.amount - a.amount).slice(0, 3).map((b, i) => <div className="p1-bid-row" key={b.id}><span>Eligible bid {i + 1}{b.mine && ' · Yours'}</span><b>{money(b.amount)} / day</b>{role === 'owner' ? <Button variant="secondary" onClick={() => select(b.id)}>Select bidder</Button> : <Tag tone="pending">Awaiting owner</Tag>}</div>)}</>}
      {room.phase === 'payment' && <><h2>Selection isn’t a booking. Yet.</h2><p>Complete the demo payment to see how a winning bid becomes a rental. No money moves.</p><Button onClick={confirm}>Simulate successful winner payment</Button><Button variant="quiet" onClick={() => setError('Demo payment declined. Dates remain unreserved until payment succeeds.')}>Preview failed payment</Button></>}
      {room.phase === 'confirmed' && <><h2>That bid became a plan.</h2><p>Your demo rental is confirmed and its dates are reserved.</p><Action to="renter">View rentals</Action></>}
      {error && <ErrorNote>{error}</ErrorNote>}
  </BidRoomLayout>;
}
