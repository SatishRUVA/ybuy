import { useEffect, useState } from 'react';
import { Alert, Button, Surface } from '@/main-site/components/ui';
import {
  createDepositAuthorizationSession, createDepositSetupSession,
  fetchBookingDepositAuthorization, fetchBookingDepositAuthorizationEvents, fetchBookingDepositClaim,
  type BookingDepositAuthorization, type BookingDepositAuthorizationEvent,
  recordDepositHoldConsent,
} from '@/lib/security-deposit';
import { fetchBookingPrecheckin, type BookingPrecheckin } from '@/lib/booking-precheckin';

const STATUS_LABEL: Record<BookingDepositAuthorization['status'], string> = {
  setup_required: 'Card setup needed', scheduled: 'Authorization due before pickup', authorizing: 'Authorization in progress',
  requires_action: 'Renter action required', authorized: 'Hold authorized', releasing: 'Releasing hold', released: 'Hold released',
  capturing: 'Approved deduction processing', captured: 'Approved deduction captured', expired: 'Authorization expired', failed: 'Authorization failed', superseded: 'Replaced by a newer authorization',
};

export function DepositAuthorizationStatus({ bookingId, deposit, collectionModel, isOwner, paymentFirst = false }: {
  bookingId: string; deposit: number; collectionModel: 'captured' | 'authorization'; isOwner: boolean; paymentFirst?: boolean;
}) {
  const [authorization, setAuthorization] = useState<BookingDepositAuthorization | null>(null);
  const [events, setEvents] = useState<BookingDepositAuthorizationEvent[]>([]);
  const [claim, setClaim] = useState<{ status: string; requested_amount: number; approved_amount: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [precheckin, setPrecheckin] = useState<BookingPrecheckin | null>(null);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (!paymentFirst) return;
    const timer = window.setInterval(() => setAttempt(value => value + 1),15000);
    return () => window.clearInterval(timer);
  }, [bookingId,paymentFirst]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([fetchBookingDepositAuthorization(bookingId),fetchBookingDepositClaim(bookingId),
      paymentFirst ? fetchBookingPrecheckin(bookingId) : Promise.resolve(null)]).then(async ([next,nextClaim,nextPrecheckin]) => {
      const nextEvents = next ? await fetchBookingDepositAuthorizationEvents(next.id) : [];
      if (!active) return;
      setAuthorization(next);
      setClaim(nextClaim);
      setPrecheckin(nextPrecheckin);
      setEvents(nextEvents);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load deposit authorization status.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bookingId, attempt, paymentFirst]);

  if (deposit <= 0) return null;
  if (collectionModel === 'captured') return <Alert tone="warning" title="Legacy charged deposit">
    This booking’s deposit was collected with its original payment. Its refund is tracked separately below.
  </Alert>;

  async function startSetup() {
    setBusy(true); setError(null);
    try {
      if (paymentFirst && !precheckin?.consented) {
        if (!consent) throw new Error('Agree to the separate security hold before continuing.');
        await recordDepositHoldConsent(bookingId);
      }
      const url = await createDepositSetupSession(bookingId);
      if (url) window.location.href = url;
      else setAttempt(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not set up a payment method.'); }
    finally { setBusy(false); }
  }

  async function authorize() {
    setBusy(true); setError(null);
    try {
      if (paymentFirst && !precheckin?.consented) {
        if (!consent) throw new Error('Agree to the separate security hold before continuing.');
        await recordDepositHoldConsent(bookingId);
      }
      const result = await createDepositAuthorizationSession(bookingId);
      if (result.url) window.location.href = result.url;
      else setAttempt(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start deposit authorization.'); }
    finally { setBusy(false); }
  }

  const needsSetup = authorization?.status === 'setup_required';
  const needsAuthorization = authorization && ['scheduled','authorizing','requires_action','failed','expired'].includes(authorization.status);
  return <Surface className="space-y-3 p-4" aria-busy={loading}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold text-main">Security deposit</h3>
        <p className="mt-1 text-sm text-sec">${Number(authorization?.is_claim_authorization ? claim?.approved_amount ?? claim?.requested_amount ?? authorization.authorized_amount : deposit).toFixed(2)} temporary card authorization, not a booking charge.</p>
      </div>
      {authorization && <span className="text-sm font-semibold text-main">{STATUS_LABEL[authorization.status]}</span>}
    </div>
    {loading && <p role="status" className="text-xs text-sec">Checking deposit authorization…</p>}
    {!loading && !authorization && <p className="text-xs text-warning">Authorization record is not available. Contact support before pickup.</p>}
    {authorization?.status === 'authorized' && <p role="status" className="text-sm text-success">{!paymentFirst || precheckin?.deposit_ready
      ? 'The security hold is ready.' : 'The recorded hold does not yet meet check-in requirements. Refresh its status before handoff.'} The hold expires {authorization.capture_before ? new Date(authorization.capture_before).toLocaleString() : 'at the card network deadline'}.</p>}
    {authorization?.status === 'released' && <p role="status" className="text-sm text-success">The uncaptured deposit hold has been released.</p>}
    {authorization?.status === 'captured' && <p role="status" className="text-sm text-sec">Captured amount: ${Number(authorization.captured_amount).toFixed(2)}.</p>}
    {claim && <p className="text-xs text-sec">Damage claim: {claim.status.replace(/_/g,' ')}{claim.approved_amount !== null ? ` · approved $${Number(claim.approved_amount).toFixed(2)}` : ` · requested $${Number(claim.requested_amount).toFixed(2)}`}</p>}
    {authorization?.failure_reason && <Alert tone="warning">{authorization.failure_reason}</Alert>}
    {events.length > 0 && <details className="text-xs text-sec">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold text-main">Deposit transaction history</summary>
      <ol className="space-y-2 border-l border-app pl-3">
        {events.map(event => <li key={event.id}>
          <span className="font-medium text-main">{event.event_type.replace('payment_intent.', '').replace(/_/g, ' ')}</span>
          <span> · {event.status} · ${Number(event.amount).toFixed(2)} · {new Date(event.created_at).toLocaleString()}</span>
        </li>)}
      </ol>
    </details>}
    {paymentFirst && !isOwner && precheckin?.can_authorize && !precheckin.consented && <label className="flex items-start gap-2 text-sm text-sec">
      <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1" />
      I agree to the separate temporary security hold and any separately approved damage claim.
    </label>}
    {paymentFirst && !precheckin?.can_authorize && <p className="text-sm text-sec">Complete rental payment and agree a slot in check-in. Deposit setup opens 24 hours before that time.</p>}
    {!isOwner && needsSetup && (!paymentFirst || precheckin?.can_authorize) && <Button size="sm" disabled={busy || (paymentFirst && !precheckin?.consented && !consent)} loading={busy} onClick={() => void startSetup()}>Set up payment method</Button>}
    {!isOwner && needsAuthorization && !needsSetup && (!paymentFirst || precheckin?.can_authorize) && <Button size="sm" disabled={busy || (paymentFirst && !precheckin?.consented && !consent)} loading={busy} onClick={() => void authorize()}>
      {authorization?.status === 'authorizing' || authorization?.status === 'requires_action' ? 'Continue secure authorization' : 'Authorize deposit'}
    </Button>}
    {isOwner && authorization?.status !== 'authorized' && authorization?.status !== 'released'
      && authorization?.status !== 'captured' && <p className="text-xs text-warning">Do not hand off the item until the deposit authorization is confirmed.</p>}
    {error && <Alert tone="error" title="Deposit authorization unavailable">{error}<Button size="sm" variant="secondary" className="mt-2" onClick={() => setAttempt(value => value + 1)}>Refresh status</Button></Alert>}
  </Surface>;
}
