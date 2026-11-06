import { useEffect, useState } from 'react';
import {
  fetchBookingPrecheckin,
  proposeBookingHandoffSlot,
  respondToBookingHandoffSlot,
  type BookingPrecheckin,
  type HandoffKind,
} from '@/lib/booking-precheckin';
import type { UiBooking } from '@/lib/bookings';
import { HANDOFF_WINDOWS, type HandoffWindow } from '@/lib/listing-item-details';
import { availableHandoffHours, handoffHourLabel } from '@/lib/handoff-hours';
import { Alert, Button, Surface } from '@/main-site/components/ui';
import { DepositAuthorizationStatus } from '@/main-site/components/deposit-authorization-status';

const SLOT_LABELS: Record<HandoffWindow, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const NOTE_SUGGESTIONS = [
  'I can arrive at the start of this window.',
  'Please have all listed accessories ready.',
  'I may be 10 minutes early.',
] as const;

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function BookingPrecheckin({
  booking,
  kind = 'pickup',
  onReady,
}: {
  booking: UiBooking;
  kind?: HandoffKind;
  onReady: (ready: boolean) => void;
}) {
  const [state, setState] = useState<BookingPrecheckin | null>(null);
  const [slotWindow, setSlotWindow] = useState<HandoffWindow>('morning');
  const [hour, setHour] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const next = await fetchBookingPrecheckin(booking.id);
        if (!active) return;
        setState(next);
        onReady(kind === 'pickup' ? next.handoff_ready : next.return_handoff_ready);
      } catch (reason) {
        if (active) { setError(reason instanceof Error ? reason.message : 'Could not load handoff scheduling.'); onReady(false); }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [booking.id, retry, onReady, kind]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await action(); setRetry(value => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update the handoff slot.'); }
    finally { setBusy(false); }
  }

  const slot = kind === 'pickup' ? state?.pickup_slot : state?.return_slot;
  const windows = (kind === 'pickup' ? state?.pickup_windows : state?.return_windows) ?? [...HANDOFF_WINDOWS];
  const slotDate = kind === 'pickup' ? booking.startDate : booking.endDate;
  const timeZone = state?.time_zone;
  const options = state && timeZone ? windows.map(window => ({
    window, hours: availableHandoffHours(slotDate, window, timeZone, new Date(state.server_now)),
  })).filter(option => option.hours.length > 0) : [];
  const selectionAvailable = hour !== null && options.some(option => option.window === slotWindow && option.hours.includes(hour));
  const waitingOwner = slot?.status === 'proposed' && !booking.isOwner;
  const canPropose = state && slot?.status !== 'approved' && !booking.isOwner
    && state.time_zone && (kind === 'pickup' ? booking.status === 'confirmed' : booking.status === 'active');
  const heading = kind === 'pickup'
    ? `Check-in for ${booking.deliveryMode === 'delivery' ? 'delivery' : 'pickup'}`
    : 'Return scheduling';
  const helper = kind === 'pickup'
    ? `Booking date is fixed to ${dateLabel(slotDate)}. Pick a time and add an optional note for the owner.`
    : `Return date is fixed to ${dateLabel(slotDate)}. Pick a time and add an optional note for the owner.`;

  return <Surface className="mb-5 space-y-4 p-5" aria-busy={(!state && !error) || busy}>
    <h2 className="text-lg font-semibold text-main">{heading}</h2>
    <p className="text-sm text-sec">{helper}</p>
    {state?.time_zone && <p className="text-sm text-sec">All windows use the pickup location timezone: {state.time_zone}.</p>}
    {state && !state.time_zone && <Alert tone="warning">Pickup location timezone is missing. Ask the owner to confirm the pickup location or contact support.</Alert>}
    {!state && !error && <p role="status" className="text-sm text-sec">Loading handoff scheduling…</p>}
    {error && <Alert tone="error">{error}<Button variant="secondary" size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)}>Retry</Button></Alert>}
    {slot && <p role="status" className="text-sm text-main">
      {dateLabel(slot.selected_date)} · {SLOT_LABELS[slot.slot_window]} · {slot.status}{slot.note ? ` · "${slot.note}"` : ''}
      {' · '}{new Date(slot.starts_at).toLocaleTimeString(undefined, { timeZone: slot.time_zone, hour: 'numeric', minute: '2-digit' })}
      {' - '}{new Date(slot.ends_at).toLocaleTimeString(undefined, { timeZone: slot.time_zone, hour: 'numeric', minute: '2-digit' })} ({slot.time_zone})
    </p>}
    {slot?.status === 'proposed' && booking.isOwner && <div className="flex flex-wrap gap-3">
      <Button loading={busy} onClick={() => void run(() => respondToBookingHandoffSlot(booking.id, kind, true, slot.updated_at))}>Approve slot</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void run(() => respondToBookingHandoffSlot(booking.id, kind, false, slot.updated_at))}>Decline slot</Button>
    </div>}
    {waitingOwner && <p className="text-sm text-sec">Waiting for the owner to approve this window.</p>}
    {canPropose && <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (selectionAvailable && hour !== null) {
        void run(() => proposeBookingHandoffSlot(booking.id, kind, slotWindow, hour, note));
      }
    }}>
      <p className="text-sm font-semibold text-main">Choose a {kind} time</p>
      <p className="text-xs text-sec">Only the owner’s available hours are shown. Each time reserves a one-hour handoff window; past times are hidden.</p>
      {options.map(option => <fieldset key={option.window} className="space-y-2" disabled={busy}>
        <legend className="text-sm font-semibold text-main">{SLOT_LABELS[option.window]}</legend>
        <div className="flex flex-wrap gap-2">{option.hours.map(value => <button key={value} type="button"
          className={`min-h-11 rounded-full border px-4 text-sm ${slotWindow === option.window && hour === value && selectionAvailable
            ? 'bg-accent text-accent-text border-accent' : 'bg-card text-sec border-strong'}`}
          aria-pressed={slotWindow === option.window && hour === value && selectionAvailable}
          onClick={() => { setSlotWindow(option.window); setHour(value); }}>{handoffHourLabel(value)}</button>)}</div>
      </fieldset>)}
      {options.length === 0 && <Alert tone="warning">No future owner-available times remain on this booking date. Contact the owner or support to reschedule pickup. A changed return date requires a rental extension.</Alert>}
      <div className="flex flex-wrap gap-2">{NOTE_SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button"
        className="min-h-11 rounded-full border border-strong bg-card px-3 text-xs text-sec"
        onClick={() => setNote(suggestion)}>{suggestion}</button>)}
      </div>
      <label className="block text-sm text-main">Optional note
        <textarea value={note} maxLength={240} rows={2}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Example: I’ll arrive about 10 minutes early."
          className="mt-2 w-full rounded-card border border-app bg-card px-3 py-2 text-sm text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
      </label>
      <Button type="submit" loading={busy} disabled={!selectionAvailable}>Send proposal</Button>
    </form>}
    {kind === 'pickup' && slot?.status === 'approved' && <p className="text-sm text-sec">{state?.handoff_ready
      ? booking.deliveryMode === 'delivery' ? 'Check-in setup complete. The owner can deliver during the agreed window.' : 'Check-in setup complete. You can meet the owner during the agreed window.'
      : booking.deposit <= 0 ? 'No security hold is required. Handoff opens during the approved window.'
        : state?.deposit_ready ? 'The security hold is ready. Handoff opens during the approved window.'
        : state?.can_authorize ? 'Complete the separate deposit step below. Handoff opens during the approved window.'
        : 'Deposit authorization opens 24 hours before the approved window. Contact support if the window has passed or needs rescheduling.'}</p>}
    {kind === 'return' && slot?.status === 'approved' && <p className="text-sm text-sec">Return window approved. Start return during this window.</p>}
    {kind === 'return' && (state?.return_rules.length || state?.return_note) && <div className="rounded-card bg-subtle p-3">
      <p className="text-sm font-semibold text-main">Owner return expectations</p>
      {state.return_rules.length > 0 && <ul className="mt-2 space-y-1">{state.return_rules.map((rule) => <li key={rule} className="text-xs text-sec">• {rule}</li>)}</ul>}
      {state.return_note && <p className="mt-2 text-xs text-sec">{state.return_note}</p>}
    </div>}
    {kind === 'pickup' && booking.deposit > 0 && <DepositAuthorizationStatus key={String(state?.can_authorize)} bookingId={booking.id} deposit={booking.deposit}
      collectionModel={booking.depositCollectionModel} isOwner={booking.isOwner} paymentFirst />}
  </Surface>;
}
