import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Crown, Gavel } from 'lucide-react';
import { Alert, Button, Field } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { useAuth } from '@/auth-context';
import { useRouter } from '@/router';
import { getListingAuction, MAX_AUCTION_DAILY_BID, placeListingAuctionBid, type ListingAuction } from '@/lib/listing-auctions';
import { auctionCountdown } from '@/lib/auction-countdown';
import { DateBiddingPanel } from '@/main-site/components/date-bidding-panel';
import { MonthGrid } from '@/main-site/components/date-range-picker';
import { todayIso } from '@/lib/geo';
import { calculateRentalPricing } from '@/lib/rental-pricing';
import { bookingTaxCents } from '@/lib/booking-tax';
import { insuranceAmountCents } from '@/lib/insurance-pricing';
import { usePlatformFee } from '@/lib/settings';
import { BidReviewDialog } from '@/main-site/components/bid-review-dialog';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not load competitive bidding. Please retry.';
const deadlineLabel = (iso: string | null) => iso ? new Date(iso).toLocaleString() : 'Not started';
const money = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const NO_DATES = new Set<string>();

function FixedAuctionCalendar({ start, end }: { start: string; end: string }) {
  const [month, setMonth] = useState(() => new Date(`${start.slice(0, 7)}-01T12:00:00`));
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  return <section aria-label="Bidding rental calendar" className="rental-calendar rounded-card border border-app p-3">
    <h3 className="text-sm font-bold">Rental dates</h3>
    <p className="mt-1 text-xs text-sec">These dates are fixed by the owner. All bids cover pickup {start} to return {end}; the return date is not a charged rental day.</p>
    <div className="my-3 flex items-center justify-between gap-2">
      <Button variant="ghost" aria-label="Previous rental month" disabled={monthKey <= start.slice(0, 7)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}><ChevronLeft size={18} /></Button>
      <p aria-live="polite" className="text-sm font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
      <Button variant="ghost" aria-label="Next rental month" disabled={monthKey >= end.slice(0, 7)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}><ChevronRight size={18} /></Button>
    </div>
    <fieldset disabled aria-label="Fixed rental period">
      <MonthGrid monthDate={month} todayStr={todayIso()} minDate={start} maxDate={end} draftStart={start} draftEnd={end}
        bookedDates={NO_DATES} blockedDates={NO_DATES} onPick={() => {}} showMonthLabel={false} rangeView />
    </fieldset>
  </section>;
}

export function ListingAuctionPanel({ listingId, deposit = 0, listedPrice = 0, replacementValue = 0 }: {
  listingId: string; deposit?: number; listedPrice?: number; replacementValue?: number;
}) {
  const { user, openSignIn } = useAuth();
  const { navigate } = useRouter();
  const fee = usePlatformFee();
  const [auction, setAuction] = useState<ListingAuction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const submitting = useRef(false);
  const [rate, setRate] = useState('');
  const amount = Number(rate);
  const [depositConsent, setDepositConsent] = useState(false);
  const [now, setNow] = useState(Date.now());
  const serverOffset = useRef(0);
  const pendingBid = useRef<{ rate: number; key: string } | null>(null);
  const mounted = useRef(true);
  const dateFlexible = useRef(false);
  const apply = useCallback((value: ListingAuction | null) => {
    if (!mounted.current) return;
    if (value) serverOffset.current = Date.parse(value.server_now) - Date.now();
    dateFlexible.current = value?.date_flexible === true;
    setAuction(value); setError(null); setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    try { apply(await getListingAuction(listingId)); }
    catch (reason) { if (mounted.current) { setError(errorMessage(reason)); setLoading(false); } }
  }, [apply, listingId]);
  useEffect(() => {
    mounted.current = true;
    setLoading(true); setAuction(null); setError(null);
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden && !dateFlexible.current) void refresh(); }, 10000);
    const tick = window.setInterval(() => setNow(Date.now() + serverOffset.current), 1000);
    return () => { mounted.current = false; window.clearInterval(timer); window.clearInterval(tick); };
  }, [refresh, user?.id]);

  async function submit() {
    if (!auction || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      if (fee.error || fee.loading || fee.pct === null) throw new Error(fee.error ?? 'Wait for the current service fee to load before bidding.');
      if (!rate.trim() || !Number.isFinite(amount) || amount < auction.minimum_next_bid || amount > MAX_AUCTION_DAILY_BID) {
        throw new Error(`Bid between $${auction.minimum_next_bid.toFixed(2)} and $${MAX_AUCTION_DAILY_BID.toLocaleString('en-US')} per day.`);
      }
      if (deposit > 0 && !depositConsent) throw new Error('Agree to the temporary deposit authorization before placing a bid.');
      if (!pendingBid.current || pendingBid.current.rate !== amount) pendingBid.current = { rate: amount, key: crypto.randomUUID() };
      apply(await placeListingAuctionBid(listingId, amount, pendingBid.current.key, depositConsent));
      pendingBid.current = null; setReviewOpen(false); setRate('');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  const deadline = auction?.status === 'scheduled' ? auction.starts_at ?? null : auction?.status === 'owner_selection' ? auction.selection_deadline : auction?.status === 'awaiting_payment' ? auction.payment_deadline : auction?.ends_at ?? null;
  const open = auction?.status === 'open' && !!deadline && Date.parse(deadline) > now;
  const rentalDays = auction ? Math.max(1, (Date.parse(auction.end_date) - Date.parse(auction.start_date)) / 86400000) : 0;
  const estimate = auction && Number.isFinite(amount) && amount > 0 && Number.isInteger(rentalDays) && fee.pct !== null
    ? calculateRentalPricing(amount, rentalDays) : null;
  const serviceFee = estimate ? Math.round(estimate.subtotal * (fee.pct ?? 0) * 100) / 100 : 0;
  const tax = estimate ? bookingTaxCents(estimate.subtotal, serviceFee) / 100 : 0;
  const insurance = estimate ? insuranceAmountCents(replacementValue, rentalDays) / 100 : 0;
  const totalWithoutInsurance = estimate ? estimate.subtotal + serviceFee + tax : 0;
  if (auction?.date_flexible) return <DateBiddingPanel listingId={listingId} deposit={deposit} listedPrice={listedPrice}
    replacementValue={replacementValue} serviceFeePct={fee.pct} serviceFeeLoading={fee.loading} serviceFeeError={fee.error}
    initialAuction={auction} />;
  return <section id="competitive-auction" aria-labelledby="competitive-auction-title" className="scroll-mt-24 rounded-card-lg border border-app overflow-hidden">
    <header className="flex items-start gap-3 bg-accent-soft px-5 py-4">
      <Gavel size={21} aria-hidden="true" className="text-accent mt-0.5" /><div>
        <h2 id="competitive-auction-title" className="text-lg font-bold text-main">Place your bid</h2>
        <p className="text-xs text-sec mt-1">Renter identities stay private from other bidders. No payment is taken when bidding.</p>
      </div>
    </header>
    <div className="p-5">
      {loading && <p role="status" className="text-sm text-sec">Loading current bids...</p>}
      {error && <Alert tone="error" title="Competitive bidding could not be confirmed">{error}<Button variant="secondary" size="sm" className="mt-2" disabled={busy} onClick={() => void refresh()}>Refresh bids</Button></Alert>}
      {!loading && !error && !auction && <p role="status" className="text-sm text-sec">There is no active bidding for this listing.</p>}
      {auction && <div className="grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <div className="space-y-4">
          <div className="flex gap-3 rounded-card bg-subtle p-3">
            <Clock3 size={22} className="shrink-0 text-accent" aria-hidden="true" />
            <div className="text-xs"><p className="font-semibold">{auction.status === 'scheduled' ? 'Bidding opens in' : auction.status === 'owner_selection' ? 'Owner selection ends in' : auction.status === 'awaiting_payment' ? 'Payment deadline in' : open ? 'Bidding ends in' : auction.status === 'completed' ? 'Rental booked' : 'Bidding is closed'}</p>
              {['scheduled', 'open', 'owner_selection', 'awaiting_payment'].includes(auction.status) && <p className="mt-1 text-lg text-accent font-bold tnum" aria-label="Time remaining">{deadline ? auctionCountdown(deadline, now) : 'Not started'}</p>}
              <p className="text-sec mt-1">{deadlineLabel(deadline)}</p>
            </div>
          </div>
          <p className="text-xs text-sec">Rental pickup {auction.start_date} &middot; return {auction.end_date} &middot; 1 unit</p>
          <FixedAuctionCalendar key={`${auction.start_date}:${auction.end_date}`} start={auction.start_date} end={auction.end_date} />
          <div><h3 className="text-sm font-bold mb-2">Top 3 bids <span className="text-xs font-normal text-sec">(anonymous)</span></h3>
            {auction.top_bids.length === 0 ? <p className="text-xs text-sec py-3">No bids yet. The opening bid starts at ${auction.minimum_next_bid.toFixed(2)}/day.</p> :
              <ol className="space-y-2" aria-label="Anonymous top bids">{auction.top_bids.map(bid => <li key={bid.id} className="flex flex-wrap items-center gap-2 rounded-card bg-subtle p-3 text-xs">
                <span className="font-semibold">#{bid.rank}</span><Crown size={15} aria-hidden="true" className={bid.rank === 1 ? 'text-warning' : 'text-sec'} />
                <span className="font-bold text-main">${bid.daily_rate.toFixed(2)}<span className="font-normal text-sec"> / day</span></span>
                <span className="ml-auto text-sec">{bid.bid_count} {bid.bid_count === 1 ? 'bid' : 'bids'}</span>
              </li>)}</ol>}
          </div>
          {!auction.is_owner && user && <div>
            <h3 className="text-sm font-bold mb-2">Your bid history</h3>
            <p className="text-xs text-sec mb-2">{auction.my_rank ? `Your current rank is #${auction.my_rank}.` : 'You are not currently ranked among eligible bids.'}</p>
            {auction.my_bids.length ? <ol className="space-y-2">
              {auction.my_bids.map(bid => <li key={bid.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-subtle p-3 text-xs">
                <time dateTime={bid.submitted_at}>{new Date(bid.submitted_at).toLocaleString()}</time>
                <strong>${bid.daily_rate.toFixed(2)}/day</strong>
                <span>{bid.selected ? 'Selected' : bid.passed ? 'Payment window expired' : bid.is_current ? 'Current bid' : 'Earlier bid'}</span>
                {bid.rank !== null && <span>#{bid.rank}</span>}
              </li>)}
            </ol> : <p className="text-xs text-sec">You have not placed a bid on this listing.</p>}
          </div>}
          {auction.is_owner ? <p className="text-xs text-sec">Owners choose the winner from the separate Bidding section. Selecting a winner closes bidding and starts a one-hour payment window.</p> :
            auction.my_booking_id && auction.status === 'awaiting_payment' ? <div role="status" className="space-y-3">
              <Alert tone="success" title="Your bid was selected">Complete payment before the deadline. Availability and payment verification still apply.</Alert>
              <Button onClick={() => navigate({ name: 'confirmation', id: auction.my_booking_id! })}>Continue to payment</Button>
            </div> : auction.status === 'completed' && auction.my_booking_id ? <Button onClick={() => navigate({ name: 'confirmation', id: auction.my_booking_id! })}>View booking</Button> :
              user && open && auction.my_bid_count >= 3 ? <p role="status" className="rounded-card bg-subtle p-4 text-sm text-main">You have used all 3 bids for this listing. You’ll be notified if your bid is selected.</p> :
              user && open ? <form onSubmit={event => {
                event.preventDefault();
                setError(null);
                if (deposit > 0 && !depositConsent) { setError('Agree to the temporary deposit authorization before placing a bid.'); return; }
                setReviewOpen(true);
              }} className="space-y-3">
                <div className="flex justify-between items-center"><p className="text-xs font-semibold">Your bids ({auction.my_bid_count}/3 used)</p><div className="flex gap-1" aria-hidden="true">{[1, 2, 3].map(at => <span key={at} className={`h-3 w-3 rounded-full border ${at <= auction.my_bid_count ? 'bg-accent border-accent' : 'border-strong'}`} />)}</div></div>
                {auction.my_daily_rate !== null && <p role="status" className="text-xs text-sec">Your highest bid: ${auction.my_daily_rate.toFixed(2)}/day.</p>}
                <Field label="Your competitive bid per day (USD)" htmlFor="auction-bid-rate">
                  <input id="auction-bid-rate" required type="number" step="0.01" min={auction.minimum_next_bid} max={MAX_AUCTION_DAILY_BID} inputMode="decimal" value={rate}
                    disabled={busy || auction.my_bid_count >= 3} onChange={event => setRate(event.target.value)} className={fieldClass()} />
                    <p className="mt-2 text-xs text-sec">Bid range: ${auction.minimum_next_bid.toFixed(2)}–${MAX_AUCTION_DAILY_BID.toLocaleString('en-US')}/day. Minimum increase: ${auction.minimum_increment.toFixed(2)}/day.</p>
                </Field>
                {fee.error && <Alert tone="error" title="Could not estimate the service fee">{fee.error}</Alert>}
                {estimate && <div className="rounded-card bg-accent-soft p-3" aria-label="Estimated bid price breakdown">
                  <p className="text-sm font-semibold text-main">Estimated rental cost</p>
                  <dl className="mt-2 space-y-1.5 text-xs">
                    <div className="flex justify-between gap-3"><dt className="text-sec">Rental bid subtotal ({money(amount)}/day × {rentalDays} days)</dt><dd className="font-semibold text-main">{money(estimate.subtotal)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-sec">Service fee</dt><dd className="text-main">{money(serviceFee)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-sec">Estimated tax (7%)</dt><dd className="text-main">{money(tax)}</dd></div>
                    <div className="flex justify-between gap-3 border-t border-app pt-2 font-semibold"><dt className="text-main">Total without optional insurance</dt><dd className="text-main">{money(totalWithoutInsurance)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-sec">Optional insurance estimate</dt><dd className="text-main">{money(insurance)}</dd></div>
                    <div className="flex justify-between gap-3 font-bold"><dt className="text-main">Total with optional insurance</dt><dd className="text-main">{money(totalWithoutInsurance + insurance)}</dd></div>
                  </dl>
                  <p className="mt-2 text-xs text-sec">Estimate only; insurance is selected at checkout. Placing a bid does not charge you. Checkout recalculates the final rental payment.</p>
                </div>}
                {!fee.error && (fee.loading || fee.pct === null) && <p role="status" className="text-xs text-sec">Loading the current service fee to estimate your total…</p>}
                {deposit > 0 && <label className="flex items-start gap-2 text-xs text-sec">
                  <input type="checkbox" checked={depositConsent} disabled={busy} onChange={event => setDepositConsent(event.target.checked)} className="mt-0.5" />
                  <span>I agree to a temporary {money(deposit)} security hold if my bid is selected. This is separate from the rental payment.</span>
                </label>}
                <Button type="submit" className="w-full" disabled={busy || fee.loading || !!fee.error || auction.my_bid_count >= 3}>Continue to review bid</Button>
              </form> : !user && open ? <Button className="w-full" onClick={openSignIn}>Sign in to bid</Button> :
                <p role="status" className="text-xs text-sec">{auction.my_bid_count > 0 ? 'Your bid is recorded. You will be notified if selected.' : 'New bids are not being accepted.'}</p>}
          <BidReviewDialog open={reviewOpen} onClose={() => setReviewOpen(false)} onConfirm={() => void submit()} busy={busy} error={error}
            start={auction.start_date} end={auction.end_date} rate={amount} subtotal={estimate?.subtotal ?? 0} deposit={deposit} />
        </div>
        <aside aria-label="How competitive bidding works" className="rounded-card bg-subtle p-4 text-xs text-sec">
          <h3 className="font-bold text-main mb-4">What happens next?</h3>
          <p>The owner chooses a bid. If yours is selected, you’ll be notified to complete payment within {auction.winner_payment_hours ?? 1} {auction.winner_payment_hours === 1 || auction.winner_payment_hours == null ? 'hour' : 'hours'}. Your rental is confirmed after payment.</p>
          <p className="mt-3">Bids placed near closing may extend the bidding time.</p>
        </aside>
      </div>}
    </div>
  </section>;
}
