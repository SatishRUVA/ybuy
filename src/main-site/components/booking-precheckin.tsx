import { useEffect, useState } from 'react';
import { fetchBookingPrecheckin, proposeBookingPickupSlot, respondToBookingPickupSlot, type BookingPrecheckin } from '@/lib/booking-precheckin';
import type { UiBooking } from '@/lib/bookings';
import { Alert, Button, Surface } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { DepositAuthorizationStatus } from '@/main-site/components/deposit-authorization-status';

export function BookingPrecheckin({ booking, onReady }: { booking: UiBooking; onReady: (ready: boolean) => void }) {
  const [state, setState] = useState<BookingPrecheckin | null>(null);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const next = await fetchBookingPrecheckin(booking.id);
        if (!active) return;
        setState(next); setError(null); onReady(next.handoff_ready);
      } catch (reason) {
        if (active) { setError(reason instanceof Error ? reason.message : 'Could not load pre-check-in.'); onReady(false); }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [booking.id, retry, onReady]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); setRetry(value => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update the handoff slot.'); }
    finally { setBusy(false); }
  }

  const slot = state?.slot;
  const delivery = booking.deliveryMode === 'delivery';
  const slotLabel = slot ? new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: slot.time_zone,
  }).format(new Date(slot.starts_at)) : '';

  return <Surface className="mb-5 space-y-4 p-5" aria-busy={(!state && !error) || busy}>
    <h2 className="text-lg font-semibold text-main">Pre-check-in for {delivery ? 'delivery' : 'pickup'}</h2>
    <p className="text-sm text-sec">{booking.status !== 'confirmed' ? 'Complete rental payment before scheduling pre-check-in.'
      : `Rental payment is complete. Agree a 30-minute handoff slot with the owner.${booking.deposit > 0
        ? ' Then authorize the separate security hold within 24 hours before that slot.' : ' No security hold is required for this booking.'}`}</p>
    {!state && !error && <p role="status" className="text-sm text-sec">Loading the agreed slot…</p>}
    {error && <Alert tone="error">{error}<Button variant="secondary" size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)}>Retry pre-check-in</Button></Alert>}
    {slot && <p role="status" className="text-sm text-main">{slotLabel} · {slot.time_zone} · 30 minutes · {slot.status}</p>}
    {slot?.status === 'proposed' && (booking.isOwner ? <div className="flex flex-wrap gap-3">
      <Button loading={busy} onClick={() => void run(() => respondToBookingPickupSlot(booking.id, slot.starts_at, true))}>Approve slot</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void run(() => respondToBookingPickupSlot(booking.id, slot.starts_at, false))}>Decline slot</Button>
    </div> : <p className="text-sm text-sec">Waiting for the owner to approve this time.</p>)}
    {state && booking.status === 'confirmed' && slot?.status !== 'approved' && !booking.isOwner && <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        const date = new Date(time);
        if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid handoff time.');
        await proposeBookingPickupSlot(booking.id, date.toISOString(), timeZone);
      });
    }}>
      <label className="block text-sm text-main">Proposed {delivery ? 'delivery' : 'pickup'} time
        <input type="datetime-local" required value={time} min={`${booking.startDate}T00:00`} max={`${booking.startDate}T23:59`}
          onChange={event => setTime(event.target.value)} className={fieldClass('mt-2 w-full')} />
      </label>
      <p className="text-xs text-sec">Times use {timeZone}. Choose a slot on {booking.startDate}. The owner must approve it.</p>
      <Button type="submit" loading={busy}>Propose slot</Button>
    </form>}
    {state && !slot && booking.isOwner && <p className="text-sm text-sec">The renter needs to propose a slot before you can approve it.</p>}
    {slot?.status === 'approved' && <p className="text-sm text-sec">{state?.handoff_ready
      ? delivery ? 'Pre-check-in complete. The owner can deliver during the agreed slot.' : 'Pre-check-in complete. You can meet the owner during the agreed slot.'
      : booking.deposit <= 0 ? 'No security hold is required. Handoff opens at the agreed time.'
        : state?.deposit_ready ? 'The security hold is ready. Handoff opens at the agreed time.'
        : state?.can_authorize ? 'Complete the separate deposit step below. Handoff opens at the agreed time.'
        : 'Deposit authorization opens 24 hours before the agreed slot. Contact support if the slot has passed or needs rescheduling.'}</p>}
    {booking.deposit > 0 && <DepositAuthorizationStatus key={String(state?.can_authorize)} bookingId={booking.id} deposit={booking.deposit}
      collectionModel={booking.depositCollectionModel} isOwner={booking.isOwner} paymentFirst />}
  </Surface>;
}
