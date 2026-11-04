import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Crown, Gavel, Minus, Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { fetchUnavailableDates } from '@/lib/availability';
import { addDaysIso, todayIso } from '@/lib/geo';
import { getListingAuction, placeListingAuctionBid, type ListingAuction } from '@/lib/listing-auctions';
import { auctionCountdown } from '@/lib/auction-countdown';
import { MonthGrid } from '@/main-site/components/date-range-picker';
import { Alert, Button, Field } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';

const money = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const label = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not confirm bidding. Please retry.';

export function DateBiddingPanel({ listingId, listedPrice, deposit, initialAuction }: {
  listingId: string; listedPrice: number; deposit: number; initialAuction: ListingAuction;
}) {
  const { user, openSignIn } = useAuth();
  const { navigate } = useRouter();
  const [auction, setAuction] = useState(initialAuction);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [returnPicking, setReturnPicking] = useState(false);
  const [month, setMonth] = useState(() => new Date(`${initialAuction.start_date.slice(0, 7)}-01T12:00:00`));
  const [rate, setRate] = useState('');
  const [consent, setConsent] = useState(false);
  const [unavailable, setUnavailable] = useState<{ blocked: Set<string>; booked: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pending = useRef<{ rate: number; start: string; end: string; key: string } | null>(null);
  const [message, setMessage] = useState('');
  const [quote, setQuote] = useState<{ start: string; end: string; minimum: number } | null>(null);
  const validRange = !!start && !!end && end > start && start >= initialAuction.start_date && end <= initialAuction.end_date;
  useEffect(() => {
    let active = true;
    setQuote(null);
    const refresh = async () => {
      try {
        const [current, dates] = await Promise.all([getListingAuction(listingId, validRange ? { start, end } : undefined), fetchUnavailableDates(listingId)]);
        if (!active) return;
        if (!current) throw new Error('This auction is no longer available.');
        setAuction(current); setUnavailable(dates); setRefreshError(null);
        if (validRange) setQuote({ start, end, minimum: current.minimum_next_bid });
      } catch (reason) { if (active) setRefreshError(errorMessage(reason)); }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [listingId, user?.id, start, end, validRange]);
  useEffect(() => {
    const offset = Date.parse(auction.server_now) - Date.now();
    const tick = window.setInterval(() => setNow(Date.now() + offset), 1000);
    setNow(Date.now() + offset);
    return () => window.clearInterval(tick);
  }, [auction.server_now]);
  const days = start && end ? (Date.parse(end) - Date.parse(start)) / 86400000 : 0;
  const amount = Number(rate);
  const total = days > 0 && Number.isFinite(amount) ? Math.round(amount * 100) * days / 100 : 0;
  const quoted = quote?.start === start && quote.end === end;
  const minimum = quoted ? quote.minimum : auction.minimum_next_bid;
  const open = auction.status === 'open' && !!auction.ends_at && Date.parse(auction.ends_at) > now;
  const minDate = auction.start_date > todayIso() ? auction.start_date : todayIso();
  function pick(date: string) {
    setMessage('');
    if (!returnPicking || !start || date <= start) {
      setStart(date); setEnd(''); setReturnPicking(true);
    } else { setEnd(date); setReturnPicking(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage('');
    try {
      if (!unavailable) throw new Error('Wait for availability to load, then retry.');
      if (!start || !end || days < 1 || start < minDate || end > auction.end_date) throw new Error('Choose rental dates inside the bidding window.');
      for (let day = start; day < end; day = addDaysIso(day, 1)) {
        if (unavailable.booked.has(day) || unavailable.blocked.has(day)) throw new Error('Some selected dates are unavailable. Choose another range.');
      }
      const currentQuote = await getListingAuction(listingId, { start, end });
      if (!currentQuote) throw new Error('This auction is no longer available.');
      setAuction(currentQuote); setQuote({ start, end, minimum: currentQuote.minimum_next_bid });
      if (!rate.trim() || !Number.isFinite(amount) || amount < currentQuote.minimum_next_bid) throw new Error(`Bid at least ${money(currentQuote.minimum_next_bid)} per day for these dates.`);
      if (deposit > 0 && !consent) throw new Error('Agree to the temporary deposit authorization before bidding.');
      if (!pending.current || pending.current.rate !== amount || pending.current.start !== start || pending.current.end !== end) {
        pending.current = { rate: amount, start, end, key: crypto.randomUUID() };
      }
      const current = await placeListingAuctionBid(listingId, amount, pending.current.key, consent, { start, end });
      setAuction(current); pending.current = null;
      setQuote(null);
      setMessage(`Bid saved for ${label(start)} to ${label(end)}: ${money(total)} for ${days} rental days.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="date-bidding-title" className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(16rem,1fr)]">
    <div className="min-w-0 rounded-card-lg border border-app bg-card p-4 sm:p-5">
      <h2 id="date-bidding-title" className="flex items-center gap-2 text-xl font-bold text-main"><Gavel size={23} aria-hidden="true" />Competitive bidding</h2>
      <p className="mt-2 text-sm text-sec">Choose your rental dates. Overlapping bids compete by total rental value; non-overlapping rentals can both win.</p>
      {(error || refreshError) && <div className="mt-4"><Alert tone="error" title={error ? 'Could not save bidding' : 'Could not refresh bidding'}><p>{error ?? refreshError}</p></Alert></div>}
      {message && <p role="status" className="mt-4 rounded-card bg-accent-soft p-3 text-sm font-semibold text-main">{message}</p>}
      <form onSubmit={event => void submit(event)} className="mt-5 space-y-5">
        <fieldset disabled={busy || !open || !unavailable} className="space-y-3">
          <legend className="mb-3 text-base font-semibold text-main">1. Select your rental dates</legend>
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Previous month" disabled={month.toISOString().slice(0, 7) <= minDate.slice(0, 7)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))} className="grid h-11 w-11 place-items-center rounded-full hover:bg-subtle"><ChevronLeft size={18} /></button>
            <p aria-live="polite" className="text-sm font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
            <button type="button" aria-label="Next month" disabled={month.toISOString().slice(0, 7) >= auction.end_date.slice(0, 7)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))} className="grid h-11 w-11 place-items-center rounded-full hover:bg-subtle"><ChevronRight size={18} /></button>
          </div>
          <MonthGrid monthDate={month} todayStr={todayIso()} minDate={minDate} maxDate={auction.end_date} draftStart={start || null} draftEnd={end || null} bookedDates={unavailable?.booked ?? new Set()} blockedDates={unavailable?.blocked ?? new Set()} onPick={pick} showMonthLabel={false} rangeView />
          <p role="status" className="text-xs text-sec">{returnPicking ? 'Choose your return date.' : 'Choose your pickup date.'} The return date is not a charged rental day.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rental pickup" htmlFor="bid-start"><input id="bid-start" type="date" required min={minDate} max={addDaysIso(auction.end_date, -1)} value={start} onChange={e => { setStart(e.target.value); setEnd(''); }} className={fieldClass()} /></Field>
            <Field label="Rental return" htmlFor="bid-end"><input id="bid-end" type="date" required min={start ? addDaysIso(start, 1) : minDate} max={auction.end_date} value={end} onChange={e => setEnd(e.target.value)} className={fieldClass()} /></Field>
          </div>
        </fieldset>
        <fieldset disabled={busy || !open} className="space-y-3 border-t border-app pt-4">
          <legend className="text-base font-semibold text-main">2. Place your bid</legend>
          <Field label="Your competitive bid per day (USD)" htmlFor="date-bid-rate">
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" aria-label="Decrease daily bid" disabled={!rate || amount <= minimum} onClick={() => setRate(Math.max(minimum, amount - auction.minimum_increment).toFixed(2))}><Minus size={16} /></Button>
              <input id="date-bid-rate" type="number" required min={minimum} max={100000} step="0.01" value={rate} onChange={e => setRate(e.target.value)} className={fieldClass('min-w-0')} />
              <Button type="button" variant="secondary" aria-label="Increase daily bid" onClick={() => setRate((Math.max(minimum, amount || minimum) + auction.minimum_increment).toFixed(2))}><Plus size={16} /></Button>
            </div>
          </Field>
          <p className="text-xs text-sec">{quoted ? `Minimum ${money(minimum)}/day for these dates.` : 'Choose dates and wait for the current minimum bid.'} Up to 3 bids per renter. Your chosen dates are saved with each bid.</p>
          <div className="rounded-card bg-accent-soft p-4">
            <p className="text-sm text-sec">Your total rental bid</p><p className="text-3xl font-bold text-main">{money(total)}</p>
            <p className="mt-1 text-xs text-sec">{days > 0 ? `${days} rental days. Listed rental total: ${money(listedPrice * days)}.` : 'Choose dates to calculate your total.'} Fees and deposit are confirmed at checkout.</p>
            {days > 0 && total > 0 && total < listedPrice * days && <p className="mt-2 text-xs font-semibold text-accent">Rental-price savings: {money(listedPrice * days - total)}</p>}
          </div>
          {deposit > 0 && <label className="flex gap-3 text-xs leading-relaxed text-sec"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>I agree to a temporary {money(deposit)} security-deposit authorization if I win. No payment is taken with this bid.</span></label>}
        </fieldset>
        {user && !auction.is_owner ? <Button type="submit" className="w-full" disabled={busy || !open || !unavailable || !quoted || auction.my_bid_count >= 3} loading={busy} loadingLabel="Submitting bid...">Submit Bid</Button> : !user ? <Button type="button" className="w-full" onClick={openSignIn}>Sign in to bid</Button> : <p className="text-sm text-sec">Owners cannot bid on their own listing.</p>}
        {!open && <p role="status" className="text-sm text-sec">{auction.status === 'scheduled' ? 'Bidding has not opened yet.' : 'New bids are not being accepted.'}</p>}
        {auction.my_booking_id && <Button type="button" className="w-full" onClick={() => navigate({ name: 'confirmation', id: auction.my_booking_id! })}>View winner booking and payment</Button>}
        {auction.my_payment_deadline && <p className="text-xs text-sec">Your payment: {auction.my_payment_status}. Deadline: {new Date(auction.my_payment_deadline).toLocaleString()}.</p>}
      </form>
      {auction.my_bids.length > 0 && <div className="mt-5 border-t border-app pt-4"><h3 className="text-sm font-semibold">Your bids ({auction.my_bid_count}/3)</h3><ul className="mt-2 space-y-2">{auction.my_bids.map(bid => <li key={bid.id} className="rounded-card bg-subtle p-3 text-xs">
        <strong>{money(bid.total_value ?? 0)}</strong> · {money(bid.daily_rate)}/day
        {bid.start_date && bid.end_date && <p className="mt-1">{label(bid.start_date)} – {label(bid.end_date)}</p>}
        <p className="mt-1">{bid.selected ? 'Selected' : bid.passed ? 'Passed or payment expired' : bid.is_current ? 'Current bid' : 'Earlier bid'}</p>
        {bid.payment_status && <p className="mt-1">Payment: {bid.payment_status}{bid.payment_deadline && ` · Deadline: ${new Date(bid.payment_deadline).toLocaleString()}`}</p>}
        {bid.booking_id && <Button type="button" variant="secondary" className="mt-2" onClick={() => navigate({ name: 'confirmation', id: bid.booking_id! })}>View booking for {bid.start_date && bid.end_date ? `${label(bid.start_date)} – ${label(bid.end_date)}` : 'this bid'}</Button>}
      </li>)}</ul></div>}
    </div>
    <aside className="min-w-0 space-y-4">
      <div className="rounded-card-lg border border-app bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-card bg-accent-soft p-3"><span className="text-xs font-bold uppercase">{open ? 'Live bidding' : auction.status.replace(/_/g, ' ')}</span><span aria-label="Time remaining" className="text-xs font-semibold tnum">{auction.ends_at && auctionCountdown(auction.ends_at, now)}</span></div>
        <h3 className="text-lg font-bold">Flexible rental dates</h3><p className="text-sm text-sec">{label(auction.start_date)} – {label(auction.end_date)}</p>
        {auction.participant_count !== undefined && auction.total_bid_count !== undefined && <div className="grid grid-cols-2 gap-3"><div className="rounded-card bg-subtle p-3"><strong className="text-xl">{auction.participant_count}</strong><p className="text-xs text-sec">Participants</p></div><div className="rounded-card bg-subtle p-3"><strong className="text-xl">{auction.total_bid_count}</strong><p className="text-xs text-sec">Total bids</p></div></div>}
        <div><h4 className="flex items-center gap-2 text-sm font-semibold"><Crown size={18} aria-hidden="true" />Top bids by rental value</h4><p className="mt-1 text-xs text-sec">{validRange ? 'Anonymous bids overlapping your dates.' : 'Anonymous bids may cover different dates.'}</p><ol aria-label="Anonymous top bids" className="mt-3 space-y-2">{auction.top_bids.map(bid => <li key={bid.id} className="rounded-card border border-app p-3 text-sm"><strong>#{bid.rank} · {money(bid.total_value ?? 0)}</strong><span className="block text-xs text-sec">{money(bid.daily_rate)}/day</span>{bid.start_date && bid.end_date && <p className="mt-1 text-xs text-sec">{label(bid.start_date)} – {label(bid.end_date)}</p>}</li>)}</ol>{!auction.top_bids.length && <p className="mt-3 text-sm text-sec">Be the first to bid.</p>}</div>
      </div>
      <div className="rounded-card-lg bg-subtle p-4 text-xs leading-relaxed text-sec"><h3 className="mb-3 text-sm font-semibold text-main">How date-based bidding works</h3><ul className="space-y-3"><li className="flex gap-2"><CalendarDays size={17} className="shrink-0" />Choose your own pickup and return dates.</li><li className="flex gap-2"><Gavel size={17} className="shrink-0" />Overlapping bids rank by daily bid × rental days. Available, non-overlapping periods can both win if the owner selects them.</li><li className="flex gap-2"><Clock3 size={17} className="shrink-0" />The owner must choose before bidding closes. Undecided bidding expires; the system never selects bidders automatically.</li><li className="flex gap-2"><ShieldCheck size={17} className="shrink-0" />Pay only if selected, within the server-confirmed deadline. Availability is checked again.</li></ul></div>
    </aside>
  </section>;
}
