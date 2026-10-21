import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Surface } from '@/components/ui';
import { fieldClass, textareaClass } from '@/components/form-classes';
import { createMarketplaceOffer } from '@/lib/marketplace';
import { addDaysIso, todayIso } from '@/lib/geo';
import { ArrowRight } from 'lucide-react';
import type { Listing } from '@/data';

export function MarketplaceOfferForm({ listingId, advertisedPrice, rules,onSent }: {
  listingId: string; advertisedPrice: number;rules?:Listing['offerRules'];onSent: () => void;
}) {
  const idempotencyKey = useRef(crypto.randomUUID());
  const [startDate, setStartDate] = useState(addDaysIso(todayIso(), 1));
  const [endDate, setEndDate] = useState(addDaysIso(todayIso(), 2));
  const [dailyRate, setDailyRate] = useState(String(advertisedPrice));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
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

  return <Surface className="p-4 mt-3">
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <div>
        <h3 className="font-semibold text-main">Make a rental offer</h3>
        <p className="text-xs text-sec mt-1">Advertised price: ${advertisedPrice.toFixed(2)}/day. The final price, fees and deposit are recalculated by YBuy when an offer is accepted.</p>
        <p className="text-xs text-sec mt-1">Minimum offer: ${Math.max(rules?.minimumDaily??0.01,rules?.guardrailPct==null?0.01:Math.round(advertisedPrice*(1-rules.guardrailPct)*100)/100).toFixed(2)}/day.
          {rules?.guardrailPct!=null&&` Maximum: $${(Math.round(advertisedPrice*(1+rules.guardrailPct)*100)/100).toFixed(2)}/day.`}
          {rules?.startDate&&` Permitted dates: ${rules.startDate} to ${rules.endDate}.`} Highest offer does not automatically book the item.</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-sec">Your proposed daily price
          <input required type="number" min={Math.max(rules?.minimumDaily??0.01,rules?.guardrailPct==null?0.01:Math.round(advertisedPrice*(1-rules.guardrailPct)*100)/100)} max={rules?.guardrailPct==null?100000:Math.round(advertisedPrice*(1+rules.guardrailPct)*100)/100} step="0.01" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className={fieldClass('mt-1')} />
        </label>
        <label className="text-xs font-semibold text-sec">Rental start
          <input required type="date" min={addDaysIso(todayIso(), 1)} value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldClass('mt-1')} />
        </label>
        <label className="text-xs font-semibold text-sec">Rental end
          <input required type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} className={fieldClass('mt-1')} />
        </label>
      </div>
      <label className="block text-xs font-semibold text-sec">Message (optional)
        <textarea rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} className={textareaClass('mt-1')} />
      </label>
      {error && <Alert tone="error" title="Offer was not sent">{error}</Alert>}
      <div className="flex justify-end"><Button type="submit" loading={busy} loadingLabel="Sending offer…" icon={<ArrowRight size={15} />}>Send offer</Button></div>
    </form>
  </Surface>;
}
