import { useState } from 'react';
import { Gavel } from 'lucide-react';
import { listingInputClass as fieldClass } from '@/main-site/components/listing-ui-classes';
import { addDaysIso } from '@/lib/geo';
import { pickupToday } from '@/lib/pickup-timezone';
import { defaultBiddingOpeningTime, enableBiddingPreferences, twoHoursBeforePickup, type ListingAuctionPreferences as Preferences } from '@/lib/listing-auctions';

const parseDate = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
const dateLabel = (value: string) => value ? parseDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Choose date';

export function ListingAuctionPreferences({ value, start, end, timeZone, disabled, error, hideEnableSwitch = false, onChange, onCalculatingChange }: {
  value: Preferences; start: string; end: string; timeZone: string; disabled?: boolean; error?: string;
  hideEnableSwitch?: boolean;
  onChange: (value: Preferences) => void;
  onCalculatingChange: (calculating: boolean) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const today = pickupToday(timeZone);
  const immediateEligible = Boolean(start && start <= addDaysIso(today, 1));
  const pickup = value.start_date ?? '';
  const returnDate = value.end_date ?? '';
  const minStart = start > today ? start : today;
  const validStart = Boolean(start && end && minStart < end);
  async function updateDates(nextPickup: string, nextReturn: string) {
    setUpdating(true); onCalculatingChange(true); setScheduleError(null);
    try {
      const valid = Boolean(nextPickup && nextReturn && nextReturn > nextPickup);
      onChange({ ...value, start_date: nextPickup || null, end_date: nextReturn || null,
        starts_immediately: immediateEligible,
        bidding_starts_at: immediateEligible ? null : value.bidding_starts_at ?? await defaultBiddingOpeningTime(start, timeZone),
        bidding_ends_at: valid ? await twoHoursBeforePickup(nextPickup, timeZone) : value.bidding_ends_at });
    } catch (reason) {
      onChange({ ...value, start_date: nextPickup || null, end_date: nextReturn || null, bidding_ends_at: null });
      setScheduleError(reason instanceof Error ? `Could not calculate the bidding schedule: ${reason.message}` : 'Could not calculate the bidding schedule. Please try another date.');
    } finally { setUpdating(false); onCalculatingChange(false); }
  }
  const formatTime = (instant: string) => new Date(instant).toLocaleString(undefined, {
    timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  return <section id="listing-auction" tabIndex={-1} aria-labelledby="listing-bidding" className="owner-auction-card space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <Gavel size={20} aria-hidden="true" className="mt-1 shrink-0 text-accent" />
        <div className="min-w-0"><h3 id="listing-bidding" className="text-lg font-semibold text-main">Competitive bidding</h3>
          <p id="auction-preferences-help" className="mt-1 max-w-prose text-sm leading-relaxed text-sec">Let renters make offers for selected dates. Regular rentals stay available on other dates.</p></div>
      </div>
      {!hideEnableSwitch && <label className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-strong bg-card px-3 text-sm font-semibold text-main">
        <input type="checkbox" role="switch" aria-describedby="auction-preferences-help" checked={value.enabled}
          disabled={disabled || updating} onChange={event => {
            if (!event.target.checked) { onChange({ ...value, enabled: false, starts_immediately: false }); return; }
            setUpdating(true); onCalculatingChange(true); setScheduleError(null);
            void enableBiddingPreferences(value, start, timeZone).then(onChange)
              .catch((reason: unknown) => setScheduleError(reason instanceof Error ? `Could not calculate the bidding schedule: ${reason.message}` : 'Could not calculate the bidding schedule.'))
              .finally(() => { setUpdating(false); onCalculatingChange(false); });
          }} />
        <span>Offer bidding</span>
      </label>}
    </header>
    {value.enabled && <fieldset disabled={disabled || updating} className="space-y-4 border-t border-app pt-4">
      <p className="text-sm text-sec">Choose a date range. The closing deadline is based on the start of the pickup date, not the pickup appointment.</p>
      {validStart ? <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-main">First pickup date
          <input type="date" className={fieldClass()} required min={minStart} max={end} value={pickup}
            onChange={event => {
              const nextPickup = event.target.value;
              void updateDates(nextPickup, nextPickup ? returnDate && returnDate > nextPickup ? returnDate : addDaysIso(nextPickup, 1) : '');
            }} />
        </label>
        <label className="space-y-2 text-sm font-medium text-main">Last return date
          <input type="date" className={fieldClass()} required min={pickup ? addDaysIso(pickup, 1) : minStart} max={end} value={returnDate}
            onChange={event => void updateDates(pickup, event.target.value)} />
        </label>
      </div> : <p className="text-sm text-sec">Set listing availability before enabling bidding.</p>}
      {pickup && returnDate && returnDate > pickup && <div role="status" className="rounded-lg bg-subtle px-3 py-2.5 text-sm text-main space-y-1">
        <p>Rental dates: <strong>{dateLabel(pickup)} – {dateLabel(returnDate)}</strong> (return day is not charged).</p>
        <p>Bidding opens: <strong>{value.starts_immediately && !value.bidding_starts_at ? 'When you save' : value.bidding_starts_at ? formatTime(value.bidding_starts_at) : 'Not set'}</strong></p>
        <p>Bidding closes: <strong>{value.bidding_ends_at ? formatTime(value.bidding_ends_at) : 'Not set'}</strong></p>
        <p className="text-xs text-sec">Times shown in the pickup time zone ({timeZone}). Select eligible bidders before closing; the server confirms the final schedule.</p>
      </div>}
    </fieldset>}
    {updating && <p role="status" className="text-xs text-sec">Calculating bidding times...</p>}
    {scheduleError && <p role="alert" className="text-sm text-error">{scheduleError}</p>}
    {error && <p id="listing-auction-error" role="alert" className="text-xs text-error">{error}</p>}
  </section>;
}
