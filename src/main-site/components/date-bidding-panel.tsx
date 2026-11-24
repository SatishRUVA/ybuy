import { useEffect, useRef, useState } from 'react';
import { Crown, Gavel, Minus, Plus } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { fetchUnavailableDates } from '@/lib/availability';
import { addDaysIso, todayIso } from '@/lib/geo';
import { getListingAuction, MAX_AUCTION_DAILY_BID, placeListingAuctionBid, type ListingAuction } from '@/lib/listing-auctions';
import { auctionCountdown } from '@/lib/auction-countdown';
import { DateRangePicker } from '@/main-site/components/date-range-picker';
import { Alert, Button, Field } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { calculateRentalPricing } from '@/lib/rental-pricing';
import { bookingTaxCents } from '@/lib/booking-tax';
import { insuranceAmountCents } from '@/lib/insurance-pricing';
import { BidReviewDialog } from '@/main-site/components/bid-review-dialog';

const money = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const label = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not confirm bidding. Please retry.';
const MAX_BID_RENTAL_DAYS = 30;

function BidAmount({ rate, total }: { rate: number; total?: number }) {
  const showTotal = total !== undefined && Math.round(total * 100) !== Math.round(rate * 100);
  return <>{showTotal && <><strong>{money(total)} total</strong> · </>}<span className={showTotal ? 'text-sec' : 'font-semibold'}>{money(rate)}/day</span></>;
}

export function DateBiddingPanel({ listingId, listedPrice, deposit, replacementValue = 0, serviceFeePct, serviceFeeLoading, serviceFeeError, initialAuction }: {
  listingId: string; listedPrice: number; deposit: number; replacementValue?: number;
  serviceFeePct: number | null; serviceFeeLoading: boolean; serviceFeeError: string | null; initialAuction: ListingAuction;
}) {
  const { user, openSignIn } = useAuth();
  const { navigate } = useRouter();
  const [auction, setAuction] = useState(initialAuction);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rate, setRate] = useState('');
  const [consent, setConsent] = useState(false);
  const [unavailable, setUnavailable] = useState<{ blocked: Set<string>; booked: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const submitting = useRef(false);
  const [now, setNow] = useState(Date.now());
  const pending = useRef<{ rate: number; start: string; end: string; key: string } | null>(null);
  const [message, setMessage] = useState('');
  const [quote, setQuote] = useState<{ start: string; end: string; minimum: number; bidCount: number } | null>(null);
  const validRange = !!start && !!end && end > start && (Date.parse(end) - Date.parse(start)) / 86400000 <= MAX_BID_RENTAL_DAYS
    && start >= initialAuction.start_date && end <= initialAuction.end_date;
  useEffect(() => {
    let active = true;
    setQuote(null);
    const refresh = async () => {
      try {
        const [current, dates] = await Promise.all([getListingAuction(listingId, validRange ? { start, end } : undefined), fetchUnavailableDates(listingId)]);
        if (!active) return;
        if (!current) throw new Error('Bidding is no longer available for this listing.');
        setAuction(current); setUnavailable(dates); setRefreshError(null);
        if (validRange) {
          if (current.my_overlapping_bid_count === undefined) throw new Error('Could not verify the bid limit for these dates. Please retry.');
          setQuote({ start, end, minimum: current.minimum_next_bid, bidCount: current.my_overlapping_bid_count });
        }
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
  const estimate = validRange && Number.isInteger(days) && days > 0 && Number.isFinite(amount) && amount > 0 && serviceFeePct !== null
    ? calculateRentalPricing(amount, days) : null;
  const serviceFee = estimate ? Math.round(estimate.subtotal * (serviceFeePct ?? 0) * 100) / 100 : 0;
  const tax = estimate ? bookingTaxCents(estimate.subtotal, serviceFee) / 100 : 0;
  const insurance = estimate ? insuranceAmountCents(replacementValue, days) / 100 : 0;
  const totalWithoutInsurance = estimate ? estimate.subtotal + serviceFee + tax : 0;
  const quoted = quote?.start === start && quote.end === end;
  const minimum = quoted ? quote.minimum : auction.minimum_next_bid;
  const open = auction.status === 'open' && !!auction.ends_at && Date.parse(auction.ends_at) > now;
  const bidLimitReached = !!user && !auction.is_owner && quoted && quote.bidCount >= 3;
  const minDate = auction.start_date > todayIso() ? auction.start_date : todayIso();
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null); setMessage('');
    try {
      if (serviceFeeError || serviceFeeLoading || serviceFeePct === null) {
        throw new Error(serviceFeeError ?? 'Wait for the current service fee to load before bidding.');
      }
      if (!unavailable) throw new Error('Wait for availability to load, then retry.');
      if (!start || !end || days < 1 || start < minDate || end > auction.end_date) throw new Error('Choose rental dates inside the bidding window.');
      for (let day = start; day < end; day = addDaysIso(day, 1)) {
        if (unavailable.booked.has(day) || unavailable.blocked.has(day)) throw new Error('Some selected dates are unavailable. Choose another range.');
      }
      const currentQuote = await getListingAuction(listingId, { start, end });
      if (!currentQuote) throw new Error('Bidding is no longer available for this listing.');
      if (currentQuote.my_overlapping_bid_count === undefined) throw new Error('Could not verify the bid limit for these dates. Please retry.');
      setAuction(currentQuote); setQuote({ start, end, minimum: currentQuote.minimum_next_bid, bidCount: currentQuote.my_overlapping_bid_count });
      if (currentQuote.my_overlapping_bid_count >= 3
        && !(pending.current && pending.current.rate === amount && pending.current.start === start && pending.current.end === end)) {
        throw new Error('You have used all 3 bids for these dates. Choose different dates to bid again.');
      }
      if (!rate.trim() || !Number.isFinite(amount) || amount < currentQuote.minimum_next_bid || amount > MAX_AUCTION_DAILY_BID) {
        throw new Error(`Bid between ${money(currentQuote.minimum_next_bid)} and ${money(MAX_AUCTION_DAILY_BID)} per day for these dates.`);
      }
      if (deposit > 0 && !consent) throw new Error('Agree to the temporary deposit authorization before bidding.');
      if (!pending.current || pending.current.rate !== amount || pending.current.start !== start || pending.current.end !== end) {
        pending.current = { rate: amount, start, end, key: crypto.randomUUID() };
      }
      const current = await placeListingAuctionBid(listingId, amount, pending.current.key, consent, { start, end });
      setAuction(current); pending.current = null;
      setQuote(null);
      setReviewOpen(false);
      setMessage(`Bid saved for ${label(start)} to ${label(end)}: ${money(total)} for ${days} rental days.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section aria-labelledby="date-bidding-title" className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(16rem,1fr)]">
    <div className="min-w-0 rounded-card-lg border border-app bg-card p-4 sm:p-5">
      <h2 id="date-bidding-title" className="flex items-center gap-2 text-xl font-bold text-main"><Gavel size={23} aria-hidden="true" />Place your bid</h2>
      <p className="mt-2 text-sm text-sec">Choose your dates and enter your daily bid. The owner chooses which bids to accept.</p>
      {(error || refreshError) && <div className="mt-4"><Alert tone="error" title={error ? 'Could not save bidding' : 'Could not refresh bidding'}><p>{error ?? refreshError}</p></Alert></div>}
      {message && <p role="status" className="mt-4 rounded-card bg-accent-soft p-3 text-sm font-semibold text-main">{message}</p>}
      <form onSubmit={event => {
        event.preventDefault();
        setError(null);
        if (deposit > 0 && !consent) { setError('Agree to the temporary deposit authorization before bidding.'); return; }
        setReviewOpen(true);
      }} className="mt-5 space-y-5">
        <fieldset disabled={busy || !open || !unavailable} className="space-y-3">
          <legend className="mb-3 text-base font-semibold text-main">1. Select your rental dates</legend>
          <DateRangePicker
            mode="range"
            presentation="listing"
            startDate={start}
            endDate={end}
            minimumDate={minDate}
            maximumDate={auction.end_date}
            maximumDurationDays={MAX_BID_RENTAL_DAYS}
            bookedDates={unavailable?.booked}
            blockedDates={unavailable?.blocked}
            disabled={busy || !open || !unavailable}
            onChange={(pickup, returnDate) => {
              setStart(pickup);
              setEnd(returnDate);
              setMessage('');
            }}
          />
          <p role="status" className="text-xs text-sec">Choose pickup, then return. The return date is not charged; rentals are limited to 30 days.</p>
        </fieldset>
        {!bidLimitReached && <>
        <fieldset disabled={busy || !open || serviceFeeLoading || !!serviceFeeError} className="space-y-3 border-t border-app pt-4">
          <legend className="text-base font-semibold text-main">2. Place your bid</legend>
          <Field label="Your competitive bid per day (USD)" htmlFor="date-bid-rate">
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" aria-label="Decrease daily bid" disabled={!rate || amount <= minimum} onClick={() => setRate(Math.max(minimum, amount - auction.minimum_increment).toFixed(2))}><Minus size={16} /></Button>
              <input id="date-bid-rate" type="number" inputMode="decimal" required min={minimum} max={MAX_AUCTION_DAILY_BID} step="0.01" value={rate} onChange={e => setRate(e.target.value)} className={fieldClass('min-w-0')} />
              <Button type="button" variant="secondary" aria-label="Increase daily bid" onClick={() => setRate((Math.max(minimum, amount || minimum) + auction.minimum_increment).toFixed(2))}><Plus size={16} /></Button>
            </div>
          </Field>
          <p className="text-xs text-sec">{quoted ? `Minimum bid: ${money(minimum)}/day.` : 'Choose dates to see the minimum bid.'} You can place up to 3 bids on overlapping dates.</p>
          {serviceFeeError && <Alert tone="error" title="Could not estimate the service fee">{serviceFeeError}</Alert>}
          {serviceFeeLoading && <p role="status" className="text-xs text-sec">Loading the current service fee to estimate your total…</p>}
          {estimate ? <div className="rounded-card bg-accent-soft p-4" aria-label="Estimated bid price breakdown">
            <p className="text-sm font-semibold text-main">Estimated rental cost</p>
            <dl className="mt-2 space-y-1.5 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-sec">Rental bid subtotal ({money(amount)}/day × {days} days)</dt><dd className="font-semibold text-main">{money(estimate.subtotal)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-sec">Service fee</dt><dd className="text-main">{money(serviceFee)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-sec">Estimated tax (7%)</dt><dd className="text-main">{money(tax)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-app pt-2 font-semibold"><dt className="text-main">Total without optional insurance</dt><dd className="text-main">{money(totalWithoutInsurance)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-sec">Optional insurance estimate</dt><dd className="text-main">{money(insurance)}</dd></div>
              <div className="flex justify-between gap-3 font-bold"><dt className="text-main">Total with optional insurance</dt><dd className="text-main">{money(totalWithoutInsurance + insurance)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-sec">Estimate only. Choose insurance and see your final total at checkout if selected.</p>
            <p className="mt-1 text-xs text-sec">{days} rental days. Listed rental total: {money(listedPrice * days)}.</p>
            {days > 0 && total > 0 && total < listedPrice * days && <p className="mt-2 text-xs font-semibold text-accent">Rental-price savings: {money(listedPrice * days - total)}</p>}
          </div> : <p className="text-xs text-sec">{days > 0 ? 'Enter a bid to see the estimated total.' : 'Choose dates to calculate your estimated total.'}</p>}
          {deposit > 0 && <label className="flex gap-3 text-xs leading-relaxed text-sec"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>I agree to a temporary {money(deposit)} security hold if my bid is selected. This is separate from the rental payment.</span></label>}
        </fieldset>
        {user && !auction.is_owner ? <Button type="submit" className="w-full" disabled={busy || !open || !unavailable || !quoted || serviceFeeLoading || !!serviceFeeError}>Continue to review bid</Button> : !user ? <Button type="button" className="w-full" onClick={openSignIn}>Sign in to bid</Button> : <p className="text-sm text-sec">Owners cannot bid on their own listing.</p>}
        </>}
        {bidLimitReached && <p role="status" className="rounded-card bg-subtle p-4 text-sm text-main">You have used all 3 bids for these dates. Choose different dates to bid again.</p>}
        {!open && <p role="status" className="text-sm text-sec">{auction.status === 'scheduled' ? 'Bidding has not opened yet.' : 'New bids are not being accepted.'}</p>}
        {auction.my_booking_id && <Button type="button" className="w-full" onClick={() => navigate({ name: 'confirmation', id: auction.my_booking_id! })}>View winner booking and payment</Button>}
        {auction.my_payment_deadline && <p className="text-xs text-sec">Your payment: {auction.my_payment_status}. Deadline: {new Date(auction.my_payment_deadline).toLocaleString()}.</p>}
      </form>
      {auction.my_bids.length > 0 && <div className="mt-5 border-t border-app pt-4"><h3 className="text-sm font-semibold">Your bids ({auction.my_bid_count})</h3><ul className="mt-2 space-y-2">{auction.my_bids.map(bid => <li key={bid.id} className="rounded-card bg-subtle p-3 text-xs">
        <BidAmount rate={bid.daily_rate} total={bid.total_value} />
        {bid.start_date && bid.end_date && <p className="mt-1">{label(bid.start_date)} – {label(bid.end_date)}</p>}
        <p className="mt-1">{bid.selected ? 'Selected' : bid.passed ? 'Passed or payment expired' : bid.is_current ? 'Current bid' : 'Earlier bid'}</p>
        {bid.payment_status && <p className="mt-1">Payment: {bid.payment_status}{bid.payment_deadline && ` · Deadline: ${new Date(bid.payment_deadline).toLocaleString()}`}</p>}
        {bid.booking_id && <Button type="button" variant="secondary" className="mt-2" onClick={() => navigate({ name: 'confirmation', id: bid.booking_id! })}>View booking for {bid.start_date && bid.end_date ? `${label(bid.start_date)} – ${label(bid.end_date)}` : 'this bid'}</Button>}
      </li>)}</ul></div>}
      <BidReviewDialog open={reviewOpen} onClose={() => setReviewOpen(false)} onConfirm={() => void submit()} busy={busy} error={error}
        start={start} end={end} rate={amount} subtotal={total} deposit={deposit} />
    </div>
    <aside className="min-w-0 space-y-4">
      <div className="rounded-card-lg border border-app bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-card bg-accent-soft p-3"><span className="text-xs font-bold uppercase">{open ? 'Live bidding' : auction.status === 'scheduled' ? 'Bidding opens soon' : auction.status === 'completed' ? 'Rental booked' : 'Bidding closed'}</span>{open && auction.ends_at && <span aria-label="Time remaining" className="text-xs font-semibold tnum">{auctionCountdown(auction.ends_at, now)}</span>}</div>
        <h3 className="text-lg font-bold">Flexible rental dates</h3><p className="text-sm text-sec">{label(auction.start_date)} – {label(auction.end_date)}</p>
        <div><h4 className="flex items-center gap-2 text-sm font-semibold"><Crown size={18} aria-hidden="true" />Top bids</h4><p className="mt-1 text-xs text-sec">{validRange ? 'Bids for overlapping dates.' : 'Bids may cover different dates.'}</p><ol aria-label="Anonymous top bids" className="mt-3 space-y-2">{auction.top_bids.map(bid => <li key={bid.id} className="rounded-card border border-app p-3 text-sm"><span className="font-semibold">#{bid.rank} · </span><BidAmount rate={bid.daily_rate} total={bid.total_value} />{bid.start_date && bid.end_date && <p className="mt-1 text-xs text-sec">{label(bid.start_date)} – {label(bid.end_date)}</p>}</li>)}</ol>{!auction.top_bids.length && <p className="mt-3 text-sm text-sec">{open ? 'Be the first to bid.' : 'No eligible bids to show.'}</p>}</div>
      </div>
      {!bidLimitReached && <div className="rounded-card-lg border border-app bg-card p-4">
        <h3 className="text-base font-bold text-main">Rental summary</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-sec">Rental period</dt><dd className="text-right">{validRange ? `${label(start)} – ${label(end)} (${days} ${days === 1 ? 'day' : 'days'})` : 'Choose dates'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-sec">Your bid per day</dt><dd>{rate && Number.isFinite(amount) ? money(amount) : 'Enter a bid'}</dd></div>
          <div className="flex justify-between gap-3 rounded-card bg-accent-soft p-3 font-semibold"><dt>Rental subtotal</dt><dd>{validRange && rate && Number.isFinite(amount) ? money(total) : '—'}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-sec">Before taxes, fees and optional insurance.</p>
      </div>}
      <p className="px-1 text-xs leading-relaxed text-sec">Bidding is free. If the owner selects your bid, you’ll be notified to complete payment before the deadline.</p>
    </aside>
  </section>;
}
