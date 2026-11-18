import { useEffect,useState } from 'react';
import { Alert,Button } from '@/components/ui';
import { createCheckoutSession,fetchCheckoutException,fetchCheckoutReservation } from '@/lib/payments';

export function CheckoutReservation({ bookingId,canPay }: { bookingId: string; canPay: boolean }) {
  const [remaining,setRemaining] = useState<number | null>(null);
  const [status,setStatus] = useState('');
  const [error,setError] = useState<string | null>(null);
  const [exception,setException] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    let active=true;
    let deadline=0;
    let receivedAt=0;
    let serverNow=0;
    const update = () => { if (active && deadline) setRemaining(Math.max(0,Math.ceil((deadline-serverNow-(performance.now()-receivedAt))/1000))); };
    async function refresh() {
      try {
        const [reservation,paymentException] = await Promise.all([fetchCheckoutReservation(bookingId),fetchCheckoutException(bookingId)]);
        if (!active) return;
        deadline=reservation.expires_at ? Date.parse(reservation.expires_at) : 0;
        serverNow=Date.parse(reservation.server_now); receivedAt=performance.now();
        setStatus(reservation.status);setException(paymentException?.status==='needs_review' ? paymentException.reason : null);
        setError(null);update();
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Could not verify checkout time.'); }
    }
    void refresh();
    const clock=window.setInterval(update,1000);
    const sync=window.setInterval(() => void refresh(),15000);
    return () => { active=false;window.clearInterval(clock);window.clearInterval(sync); };
  }, [bookingId,retry]);
  if (exception) return <Alert tone="error" title="Payment received — support review required" className="mb-4">{exception} Do not pay again. Contact support with your booking reference; the rental is not confirmed.</Alert>;
  if (error) return <Alert tone="error" title="Could not verify checkout" className="mb-4">{error}<Button className="mt-2" size="sm" variant="secondary" onClick={() => setRetry((value) => value+1)}>Retry checkout status</Button></Alert>;
  if (status==='confirmed') return <Alert tone="success" title="Backend payment confirmation received" className="mb-4">Your rental is confirmed.<Button className="mt-2" size="sm" onClick={() => window.location.reload()}>Refresh booking details</Button></Alert>;
  if (status!=='pending_payment') return status==='cancelled' && remaining===0
    ? <Alert tone="warning" title="Checkout reservation expired" className="mb-4">Availability has been released. Submit a new booking request if you still want this item. If you already paid, wait for payment reconciliation and contact support before paying again.</Alert> : null;
  return <Alert tone={remaining===0 ? 'warning' : 'info'} title="15-minute payment reservation" className="mb-4">
    <p>{remaining===null ? 'Checking server reservation…' : remaining===0 ? 'The payment window has ended. Checking the server for final status.' : `Time remaining: ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`}</p>
    <p className="text-xs mt-1">Starts with an instant booking, owner approval or an accepted offer. Only verified backend payment confirmation secures the rental.</p>
    {canPay && <Button className="mt-3" disabled={remaining===null || remaining<=0} loading={busy} onClick={async () => {
      setBusy(true);
      try { window.location.href=await createCheckoutSession(bookingId); }
      catch (error) { setError(error instanceof Error ? error.message : 'Could not start payment.');setBusy(false); }
    }}>Continue to secure payment</Button>}
  </Alert>;
}
