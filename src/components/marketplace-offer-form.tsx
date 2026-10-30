import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button } from '@/components/ui';
import { fieldClass, textareaClass } from '@/components/form-classes';
import { createMarketplaceOffer } from '@/lib/marketplace';
import { addDaysIso, todayIso } from '@/lib/geo';
import { ArrowRight, CheckCircle2, Handshake, MessageSquare, ShieldCheck, XCircle } from 'lucide-react';
import type { Listing } from '@/data';
import { DateRangePicker } from '@/components/date-range-picker';

export function MarketplaceOfferForm({ listingId, advertisedPrice, rules, bookedDates, blockedDates, onSent }: {
  listingId: string; advertisedPrice: number; rules?: Listing['offerRules']; bookedDates?: Set<string>; blockedDates?: Set<string>; onSent: () => void;
}) {
  const idempotencyKey = useRef(crypto.randomUUID());
  const earliestStart = rules?.startDate && rules.startDate > todayIso() ? rules.startDate : todayIso();
  const [startDate, setStartDate] = useState(earliestStart);
  const [endDate, setEndDate] = useState(addDaysIso(earliestStart, 1));
  const [dailyRate, setDailyRate] = useState(String(advertisedPrice));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const legacyGuardrail = rules?.maximumDaily == null ? rules?.guardrailPct : null;
  const minimum = Math.max(rules?.minimumDaily ?? 0.01, legacyGuardrail == null ? 0.01 : Math.round(advertisedPrice * (1 - legacyGuardrail) * 100) / 100);
  const maximum = rules?.maximumDaily ?? (legacyGuardrail == null ? 100000 : Math.round(advertisedPrice * (1 + legacyGuardrail) * 100) / 100);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (startDate < earliestStart || endDate <= startDate || (rules?.endDate && endDate > rules.endDate)) {
        throw new Error('Choose rental dates within the permitted offer window.');
      }
      if (!Number.isFinite(Number(dailyRate)) || Number(dailyRate) < minimum || Number(dailyRate) > maximum) {
        throw new Error(`Choose a daily offer between $${minimum.toFixed(2)} and $${maximum.toFixed(2)}.`);
      }
      await createMarketplaceOffer({
        requestId: null,
        listingId,
        startDate,
        endDate,
        dailyRate: Number(dailyRate),
        message,
        idempotencyKey: idempotencyKey.current,
      });
      onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send your offer.');
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="private-offer-title" className="mt-3 rounded-card-lg border border-app overflow-hidden">
    <header className="flex items-start gap-3 bg-accent-soft px-5 py-4">
      <Handshake size={21} aria-hidden="true" className="text-accent mt-0.5" />
      <div><h3 id="private-offer-title" className="font-bold text-main">Private rental offer</h3><p className="text-xs text-sec mt-1">Propose a price for your dates. The owner accepts, counters or declines.</p></div>
    </header>
    <div className="grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 p-5">
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div><h4 className="text-sm font-bold text-main mb-2">1. Select rental dates</h4>
          <DateRangePicker mode="range" startDate={startDate} endDate={endDate} minimumDate={earliestStart} maximumDate={rules?.endDate}
            bookedDates={bookedDates} blockedDates={blockedDates} onChange={(start, end) => { setStartDate(start); setEndDate(end); }} />
          <p className="mt-2 text-xs text-sec">Pickup {startDate} &middot; return {endDate}. Return date is not charged as another rental day.</p>
        </div>
        <div><h4 className="text-sm font-bold text-main mb-2">2. Make an offer</h4>
          <label className="text-xs font-semibold text-sec">Your proposed daily price
            <input required type="number" min={minimum} max={maximum} step="0.01" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className={fieldClass('mt-1')} />
          </label>
          <p className="text-xs text-sec mt-2">Owner accepts ${minimum.toFixed(2)}–${maximum.toFixed(2)} per day. Listed price: ${advertisedPrice.toFixed(2)}/day.</p>
        </div>
        <label className="block text-xs font-semibold text-sec">Message (optional)
          <textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} className={textareaClass('mt-1')} />
          <span className="block text-right mt-1 font-normal">{message.length}/1000</span>
        </label>
        {error && <Alert tone="error" title="Offer was not sent">{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy} loadingLabel="Sending offer…" trailingIcon={<ArrowRight size={15} aria-hidden="true" />}>Send offer</Button>
        <p className="text-xs text-sec text-center">No payment is taken when you submit an offer.</p>
      </form>
      <aside aria-label="What happens after a private offer" className="rounded-card bg-subtle p-4 text-xs text-sec">
        <h4 className="font-bold text-main mb-4">What happens next?</h4>
        <div className="flex gap-3 mb-5"><ShieldCheck size={18} aria-hidden="true" className="shrink-0 text-accent" /><div><strong className="text-main">Owner reviews</strong><p className="mt-1">Only you and the owner see this offer. You'll be notified when they respond.</p></div></div>
        <h5 className="font-semibold text-main mb-3">Possible responses</h5>
        <ul className="space-y-4">
          <li className="flex gap-3"><CheckCircle2 size={17} aria-hidden="true" className="shrink-0 text-accent" /><div><strong className="text-main">Accept</strong><p className="mt-1">Continue to payment after current availability is checked.</p></div></li>
          <li className="flex gap-3"><MessageSquare size={17} aria-hidden="true" className="shrink-0 text-accent" /><div><strong className="text-main">Counter</strong><p className="mt-1">Review a new proposed price or dates, then accept or decline.</p></div></li>
          <li className="flex gap-3"><XCircle size={17} aria-hidden="true" className="shrink-0 text-error" /><div><strong className="text-main">Decline</strong><p className="mt-1">Make a new offer or request the item at the listed price.</p></div></li>
        </ul>
        <p className="mt-5 border-t border-app pt-3">Fees and the deposit are recalculated on acceptance. This is not a competitive bid and the highest private offer never wins automatically.</p>
      </aside>
    </div>
  </section>;
}
