import { useEffect, useRef, useState } from 'react';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { Alert, Button } from '@/components/ui';
import { fetchUnavailableDates, setDateAvailability } from '@/lib/availability';

export function OwnerBlockedDates({ listingId, start, end, today, onStateChange }: {
  listingId: string; start: string; end: string; today?: string; onStateChange?: (state: { ready: boolean; busy: boolean }) => void;
}) {
  const [dates, setDates] = useState<{ booked: Set<string>; blocked: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    onStateChange?.({ ready: dates !== null && !error, busy });
  }, [dates, error, busy, onStateChange]);
  useEffect(() => {
    let active = true;
    setDates(null); setError(null); setNotice(null);
    void fetchUnavailableDates(listingId).then((result) => {
      if (active) setDates(result);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load blocked days. Retry before continuing.');
    });
    return () => { active = false; };
  }, [listingId, retry]);

  async function toggle(date: string) {
    if (!dates || saving.current) return;
    saving.current = true;
    setBusy(true); setError(null); setNotice(null);
    const available = dates.blocked.has(date);
    try {
      await setDateAvailability(listingId, date, available);
      setDates(await fetchUnavailableDates(listingId));
      setNotice(`${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${available ? 'unblocked' : 'blocked'}. Saved to your listing.`);
    } catch (reason) {
      setDates(null);
      setError(reason instanceof Error ? reason.message : 'Could not update this date. Retry to check its saved state.');
    } finally { saving.current = false; setBusy(false); }
  }

  return (
    <section aria-label="Block unavailable days" aria-busy={busy || (!dates && !error)} className="owner-wizard-blocked-dates space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-main">Block unavailable days</h3>
        <p className="mt-1 text-sm text-sec">These changes save immediately, including on drafts. Booked days are protected. You can update blocked days later from My listings.</p>
      </div>
      {error && <Alert tone="error">{error}<Button variant="secondary" className="mt-2" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Reload dates</Button></Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {dates ? <AvailabilityCalendar key={`${start}:${end}`} bookedDates={dates.booked} blockedDates={dates.blocked}
        minDate={start} maxDate={end} today={today} monthsAhead={7} editable={!busy} onToggleDate={(date) => void toggle(date)} />
        : !error && <p role="status" className="text-sm text-sec">Loading blocked and booked days...</p>}
      {busy && <p role="status" className="text-sm text-sec">Saving date availability...</p>}
    </section>
  );
}
