import { useEffect, useState } from 'react';
import {
  fetchBookingPrecheckin,
  proposeBookingHandoffReplacement,
  respondBookingHandoffReplacement,
  type BookingPrecheckin,
  type HandoffKind,
} from '@/lib/booking-precheckin';
import type { UiBooking } from '@/lib/bookings';
import { HANDOFF_WINDOWS, type HandoffWindow } from '@/lib/listing-item-details';
import { availableHandoffHours, handoffHourLabel } from '@/lib/handoff-hours';
import { Alert, Button, Surface } from '@/main-site/components/ui';

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
  onStateChange,
  onChanged,
  exchangeStarted = false,
}: {
  booking: UiBooking;
  kind?: HandoffKind;
  onReady: (ready: boolean) => void;
  onStateChange?: (state: BookingPrecheckin | null) => void;
  onChanged?: () => void;
  exchangeStarted?: boolean;
}) {
  const [state, setState] = useState<BookingPrecheckin | null>(null);
  const [slotWindow, setSlotWindow] = useState<HandoffWindow>('morning');
  const [hour, setHour] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [changingTime, setChangingTime] = useState(false);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const next = await fetchBookingPrecheckin(booking.id);
        if (!active) return;
        setError(null);
        setState(next);
        onReady(kind === 'pickup' ? next.handoff_ready : next.return_handoff_ready);
        onStateChange?.(next);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Could not load handoff scheduling.');
          onReady(false);
          onStateChange?.(null);
        }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [booking.id, retry, onReady, onStateChange, kind]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await action(); setChangingTime(false); setRetry(value => value + 1); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update the handoff slot.'); }
    finally { setBusy(false); }
  }

  const slot = kind === 'pickup' ? state?.pickup_slot : state?.return_slot;
  const proposal = kind === 'pickup' ? state?.pickup_proposal : state?.return_proposal;
  const workflowVersion = state?.workflow_version;
  const windows = (kind === 'pickup' ? state?.pickup_windows : state?.return_windows) ?? [...HANDOFF_WINDOWS];
  const slotDate = kind === 'pickup' ? booking.startDate : booking.endDate;
  const timeZone = state?.time_zone;
  const options = state && timeZone ? windows.map(window => ({
    window, hours: availableHandoffHours(slotDate, window, timeZone, new Date(state.server_now)),
  })).filter(option => option.hours.length > 0) : [];
  const selectionAvailable = hour !== null && options.some(option => option.window === slotWindow && option.hours.includes(hour));
  const pendingProposal = proposal?.status === 'proposed';
  const canRespond = pendingProposal && proposal.proposed_by_is_owner !== booking.isOwner && !exchangeStarted;
  const canPropose = state && Number.isSafeInteger(state.workflow_version) && !exchangeStarted && !pendingProposal
    && state.time_zone && (kind === 'pickup' ? booking.status === 'confirmed' : booking.status === 'active')
    && (slot?.status !== 'approved' || changingTime);
  const heading = kind === 'pickup'
    ? 'Pickup schedule'
    : 'Return schedule';
  const helper = kind === 'pickup'
    ? `Pickup date: ${dateLabel(slotDate)}. ${exchangeStarted ? 'Pickup is already in progress; the schedule does not reset your inspection.' : 'A new time needs the other participant’s approval.'}`
    : `Return date: ${dateLabel(slotDate)}. ${exchangeStarted ? 'Return is already in progress.' : 'A new time needs the other participant’s approval.'}`;

  return <Surface className="mb-5 space-y-4 p-5" aria-busy={(!state && !error) || busy}>
    <h2 className="text-lg font-semibold text-main">{heading}</h2>
    <p className="text-sm text-sec">{helper}</p>
    {state?.time_zone && <p className="text-sm text-sec">All windows use the pickup location timezone: {state.time_zone}.</p>}
    {state && !state.time_zone && <Alert tone="warning">Pickup location timezone is missing. Ask the owner to confirm the pickup location or contact support.</Alert>}
    {!state && !error && <p role="status" className="text-sm text-sec">Loading handoff scheduling…</p>}
    {error && <Alert tone="error">{error}<Button variant="secondary" size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)}>Retry</Button></Alert>}
    {state && !Number.isSafeInteger(workflowVersion) && <Alert tone="error">Scheduling readiness is unavailable. Refresh this booking or contact support.</Alert>}
    {slot?.status === 'approved' && <p role="status" className="text-sm text-main">
      {dateLabel(slot.selected_date)} · {SLOT_LABELS[slot.slot_window]} · {slot.status}{slot.note ? ` · "${slot.note}"` : ''}
      {' · '}{new Date(slot.starts_at).toLocaleTimeString(undefined, { timeZone: slot.time_zone, hour: 'numeric', minute: '2-digit' })}
      {' - '}{new Date(slot.ends_at).toLocaleTimeString(undefined, { timeZone: slot.time_zone, hour: 'numeric', minute: '2-digit' })} ({slot.time_zone})
    </p>}
    {pendingProposal && !exchangeStarted && <div className="space-y-3 rounded-card bg-subtle p-3">
      <p className="text-sm font-semibold text-main">{slot?.status === 'approved' ? 'Proposed replacement' : 'Proposed time'}</p>
      <p className="text-sm text-main">{dateLabel(proposal.selected_date)} · {new Date(proposal.starts_at).toLocaleTimeString(undefined, {
        timeZone: proposal.time_zone, hour: 'numeric', minute: '2-digit',
      })} - {new Date(proposal.ends_at).toLocaleTimeString(undefined, {
        timeZone: proposal.time_zone, hour: 'numeric', minute: '2-digit',
      })} ({proposal.time_zone})</p>
      {proposal.note && <p className="text-sm text-sec">{proposal.note}</p>}
      {slot?.status === 'approved' && <p className="text-xs text-sec">The existing agreed time stays in effect until this replacement is approved.</p>}
      {canRespond && workflowVersion !== undefined ? <div className="flex flex-wrap gap-3">
        <Button loading={busy} onClick={() => void run(() => respondBookingHandoffReplacement(booking.id, kind, true, workflowVersion))}>Approve time</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void run(() => respondBookingHandoffReplacement(booking.id, kind, false, workflowVersion))}>Decline time</Button>
      </div> : <p className="text-sm text-sec">Waiting for {proposal.proposed_by_is_owner ? 'renter' : 'owner'} approval.</p>}
    </div>}
    {slot?.status === 'approved' && !exchangeStarted && !pendingProposal && !changingTime && <Button variant="secondary"
      onClick={() => setChangingTime(true)}>Propose a different time</Button>}
    {canPropose && <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (selectionAvailable && hour !== null && workflowVersion !== undefined) {
        void run(() => proposeBookingHandoffReplacement({
          bookingId: booking.id, kind, slotWindow, hour, note, version: workflowVersion,
        }));
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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={!selectionAvailable}>Send proposal</Button>
        {changingTime && <Button type="button" variant="ghost" disabled={busy} onClick={() => setChangingTime(false)}>Keep current time</Button>}
      </div>
    </form>}
    {!exchangeStarted && kind === 'pickup' && slot?.status === 'approved' && <p className="text-sm text-sec">{state?.handoff_ready
      ? 'Pickup requirements are ready. When you are together, the owner can begin pickup from 2 hours before the agreed time. Code verification starts the rental immediately; the scheduled return date does not change.'
      : booking.deposit <= 0 ? 'No security hold is required. Pickup opens 2 hours before the approved time, once rental payment is confirmed.'
        : state?.deposit_ready ? 'The security hold is ready. Pickup opens 2 hours before the approved time, once rental payment is confirmed.'
        : state?.can_authorize ? 'Complete the separate deposit step below. Once rental payment and the hold are confirmed, pickup opens 2 hours before the approved time.'
        : 'Deposit authorization opens 24 hours before the approved window. Contact support if the window has passed or needs rescheduling.'}</p>}
    {!exchangeStarted && kind === 'return' && slot?.status === 'approved' && <p className="text-sm text-sec">Return window approved. Begin return during this window.</p>}
    {kind === 'return' && (state?.return_rules.length || state?.return_note) && <div className="rounded-card bg-subtle p-3">
      <p className="text-sm font-semibold text-main">Owner return expectations</p>
      {state.return_rules.length > 0 && <ul className="mt-2 space-y-1">{state.return_rules.map((rule) => <li key={rule} className="text-xs text-sec">• {rule}</li>)}</ul>}
      {state.return_note && <p className="mt-2 text-xs text-sec">{state.return_note}</p>}
    </div>}
  </Surface>;
}
