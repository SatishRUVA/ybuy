import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CalendarCheck, Check, CreditCard, Lock, MapPin, MessageSquare, PackageCheck, ShieldCheck } from 'lucide-react';
import { addDays, rentalDays, rangeLabel } from '../preview/dates';
import { RENTAL_MAX_DAYS } from '@/lib/listing-availability';
import { DateField, DateSummary } from './dates';
import { href, useOptionalPreview, usePreview, type DemoBooking } from './state';
import { useMarketplace } from './marketplace-context';
import { Action, Button, Empty, ErrorNote, Field, Modal, PageHead, Tag, money } from './ui';

export function Checkout({ id }: { id: string }) {
  const store = useMarketplace();
  const preview = useOptionalPreview();
  const item = store.items.find((l) => l.id === id);
  const [step, setStep] = useState(0);
  const seed = store.production || store.availableRange(id, store.search.start, store.search.end) ? store.search : store.firstRange(id);
  const [dates, setDates] = useState({ start: seed.start, end: seed.end });
  const [pickup, setPickup] = useState<'pickup' | 'delivery'>('pickup');
  const [note, setNote] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [failPayment, setFailPayment] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<{ taxAmount: number; sandboxTax: boolean; rentalTotal: number; total: number } | null>(null);
  if (!item) return <main className="p1-container p1-page"><Empty title="Choose a rental first." body="Find the item you need, then pick your dates."><Action to="search">Browse rentals</Action></Empty></main>;
  const a = store.availFor(id), days = dates.start && dates.end ? rentalDays(dates.start, dates.end) : 0;
  const quote = store.rentalQuote(item, days);
  const subtotal = quote.rental, fee = quote.fee, insurance = quote.insurance ?? 0,
    delivery = pickup === 'delivery' ? item.deliveryFee ?? (store.production ? 0 : 15) : 0;
  const tax = createdBooking?.taxAmount ?? quote.tax ?? 0;
  const showTax = createdBooking !== null || quote.tax !== undefined;
  const total = createdBooking?.rentalTotal ?? subtotal + fee + insurance + delivery + tax;
  const valid = store.availableRange(id, dates.start, dates.end) && item.available && item.listingStatus === 'published';
  const finish = async () => {
    if (submitting) return;
    if (!valid) { setError('These dates are no longer open. Choose a different range.'); setStep(0); return; }
    if (!agree) { setError('Accept the rental terms to continue.'); return; }
    if (store.production) {
      if (!store.checkout) { setError('Booking is unavailable. Please refresh and try again.'); return; }
      setSubmitting(true); setError('');
      try {
        if (paymentBookingId) { await store.checkout.pay(paymentBookingId); return; }
        const booking = await store.checkout.create({ listingId: id, startDate: dates.start, endDate: dates.end, deliveryMode: pickup, renterNote: note });
        setCreatedBooking(booking);
        if (booking.paymentRequired) {
          setPaymentBookingId(booking.id);
          await store.checkout.pay(booking.id);
        } else store.navigate('confirmation', booking.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not complete booking. Please try again.');
      } finally { setSubmitting(false); }
      return;
    }
    if (!preview) { setError('Preview session is unavailable.'); return; }
    if (item.instantBooking && failPayment) { setError('Demo payment declined. Choose the successful payment scenario and try again.'); return; }
    const bookingId = crypto.randomUUID();
    const booking: DemoBooking = { id: bookingId, listingId: id, ...dates, total, pickup, note, status: item.instantBooking ? 'upcoming' : 'pending' };
    preview.setBookings((prev) => [booking, ...prev]);
    if (!item.instantBooking) preview.setOwnerRequests((prev) => [{
      id: bookingId, listingTitle: item.title, renterName: preview.profile.name, renterAvatar: '', renterRating: 4.9,
      renterRentals: 31, renterVerified: true, renterClaims: 0, startDate: dates.start, endDate: dates.end, total, status: 'pending',
    }, ...prev]);
    preview.addNotice(item.instantBooking ? 'Your demo rental is booked' : 'Your request is on its way', `${item.title} · ${rangeLabel(dates.start, dates.end)}`, 'renter');
    store.setSearch(dates);
    preview.notify(item.instantBooking ? 'That plan just became a rental. Nice one!' : 'Request sent. Your next good plan is in motion.', true);
    window.location.hash = href('confirmation', bookingId);
  };
  return <main className="p1-container p1-page">
    <a href={href('listing', id)} className="p1-back"><ArrowLeft size={16} aria-hidden="true" /> Back to item</a>
    <div className="p1-checkout-layout"><div>
      <ol className="p1-steps" aria-label="Booking steps">{['Your dates', 'Pickup', item.instantBooking ? 'Review & payment' : 'Review request'].map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined}><span className={i <= step ? 'done' : ''}>{i < step ? <Check size={15} aria-hidden="true" /> : i + 1}</span>{s}</li>)}</ol>
      <PageHead title={step === 0 ? 'Make time for a good plan.' : step === 1 ? 'How will you get your gear?' : item.instantBooking ? 'One last look. Then it’s yours.' : 'Send your plan to the owner.'} description={step === 0 ? 'Choose the days you need, not a day more.' : step === 1 ? 'Keep the handoff simple.' : store.production ? 'The backend checks availability and calculates your final price. Only verified payment confirms a rental.' : 'All prices below are illustrative. No money is moved in this preview.'} />
      {step === 0 && <div className="p1-panel p1-checkout-dates"><DateSummary {...dates} /><DateField {...dates} min={a.start} max={a.end} maxDays={store.production ? RENTAL_MAX_DAYS : undefined} endExclusive={store.production} blocked={store.blockedFor(id)} onChange={(start, end) => { setDates({ start, end }); store.setSearch({ start, end }); }} label="Rental dates" /><p className="p1-muted">Owner’s window: {rangeLabel(a.start, store.production ? addDays(a.end, -1) : a.end)}. Already booked or blocked days cannot be selected.</p><Field label={`A note for ${item.owner.name.split(' ')[0]} (optional)`}><textarea rows={3} maxLength={store.production ? 500 : 300} placeholder="Tell them a little about your plans." value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>}
      {step === 1 && <div className="p1-choice-grid">
        <button type="button" aria-pressed={pickup === 'pickup'} onClick={() => setPickup('pickup')}><MapPin aria-hidden="true" /><strong>Pick it up</strong><span>Free · {item.pickup.split(' - ')[0]}</span>{pickup === 'pickup' && <Check size={17} aria-hidden="true" />}</button>
        {item.deliveryAvailable && <button type="button" aria-pressed={pickup === 'delivery'} onClick={() => setPickup('delivery')}><PackageCheck aria-hidden="true" /><strong>Have it delivered</strong><span>{money(item.deliveryFee ?? 15)} · {item.delivery}</span>{pickup === 'delivery' && <Check size={17} aria-hidden="true" />}</button>}
        <p className="p1-muted">The exact handoff address belongs in the booking details after approval.</p>
      </div>}
      {step === 2 && <div className="p1-panel"><div className="p1-review-block"><DateSummary {...dates} /><p><b>{pickup === 'pickup' ? 'Local pickup' : 'Delivery'}</b> · {rangeLabel(dates.start, dates.end)}</p></div>
        {item.instantBooking ? <><h2>{store.production ? 'Secure payment' : 'Demo payment'}</h2><p className="p1-muted">{store.production ? 'Payment takes place securely on Stripe. Your booking stays pending until payment is verified.' : 'No real card details needed. Choose a scenario to preview the experience.'}</p><div className="p1-demo-payment"><CreditCard size={23} aria-hidden="true" /><div><b>{store.production ? 'Stripe Checkout' : 'Sample card ending 4242'}</b><span>{store.production ? 'No card details are stored here' : 'Illustrative payment method only'}</span></div><Tag tone="blue">{store.production ? 'Secure' : 'Demo'}</Tag></div>{!store.production && <label className="p1-check"><input type="checkbox" checked={failPayment} onChange={(e) => { setFailPayment(e.target.checked); setError(''); }} /><span>Preview a declined payment</span></label>}</> : <div className="p1-info"><ShieldCheck size={24} aria-hidden="true" /><div><h3>Owner approval comes first.</h3><p>This sends a request, not a payment. Complete payment only after approval.</p></div></div>}
        <label className="p1-check"><input type="checkbox" disabled={submitting || Boolean(paymentBookingId)} checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I agree to the item’s rental and cancellation terms.</span></label><details><summary>Read the rental terms</summary><p>{item.cancellation}</p><p>{item.condition} condition. Return all included components. Refundable deposit: {money(item.deposit)}.</p>{!paymentBookingId && !submitting && store.checkout?.options}</details>
      </div>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="p1-actions p1-checkout-actions">{step > 0 && <Button variant="secondary" disabled={submitting || Boolean(paymentBookingId)} onClick={() => { setStep(step - 1); setError(''); }}>Back</Button>}<Button disabled={submitting || (step === 0 && !valid)} onClick={() => { if (step < 2) { setStep(step + 1); setError(''); } else void finish(); }}>{submitting ? 'Working…' : step < 2 ? 'Continue' : paymentBookingId ? 'Retry secure payment' : item.instantBooking ? store.production ? 'Continue to secure payment' : `Confirm demo booking · ${money(total)}` : 'Send rental request'}<ArrowRight size={17} aria-hidden="true" /></Button></div>
    </div><aside className="p1-order-summary"><img src={item.images[0]} alt={item.title} /><h2>{item.title}</h2><p className="p1-muted">From {item.owner.name}</p><DateSummary {...dates} /><dl className="p1-price-breakdown"><div><dt>{money(item.pricePerDay)} × {days} days</dt><dd>{money(subtotal)}</dd></div><div><dt>{insurance > 0 ? 'Service fee & insurance' : 'Service fee'}</dt><dd>{money(fee + insurance)}</dd></div>{delivery > 0 && <div><dt>Delivery</dt><dd>{money(delivery)}</dd></div>}{showTax && <div><dt>{createdBooking?.sandboxTax ? 'Tax (7% test)' : createdBooking && tax === 0 ? 'Tax' : 'Tax (7%)'}</dt><dd>{money(tax)}</dd></div>}<div className="total"><dt>Rental total</dt><dd>{money(total)}</dd></div><div><dt>{store.production ? 'Refundable deposit' : 'Refundable deposit hold'}</dt><dd>{money(createdBooking ? createdBooking.total - createdBooking.rentalTotal : item.deposit)}</dd></div></dl>{showTax && <p className="p1-muted">{createdBooking ? 'Stored tax confirmed by the backend.' : 'Tax is 7% of discounted rental and service fees only. The server confirms the final amount.'}</p>}<p className="p1-locked-note"><Lock size={16} aria-hidden="true" />{store.production ? createdBooking ? `Backend-confirmed payment including deposit: ${money(createdBooking.total)}.` : `Estimated payment including deposit: ${money(total + item.deposit)}. The server confirms the final amount.` : 'Preview only. Nothing charged.'}</p></aside></div>
  </main>;
}

export function Confirmation({ id }: { id?: string }) {
  const { items, bookings } = usePreview();
  const booking = id ? bookings.find((b) => b.id === id) : bookings[0];
  const item = items.find((l) => l.id === booking?.listingId);
  if (!booking || !item) return <main className="p1-container p1-page"><Empty title="Your next plan starts here." body="Book a sample rental to explore the confirmation experience."><Action to="search">Find your thing</Action></Empty></main>;
  const pending = booking.status === 'pending';
  return <ConfirmationTemplate title={pending ? 'Good plans are on their way.' : 'Go make something of it.'}
    description={pending ? 'Your request is with the owner. We’ll keep the next steps together in your rentals.' : 'Your demo rental is confirmed. All that’s left is the adventure.'}
    status={pending ? 'Awaiting approval' : 'Demo booking confirmed'} pending={pending}
    item={{ title: item.title, image: item.images[0] }} start={booking.start} end={booking.end} total={booking.total}
    actions={<><Action to="renter">View my rentals</Action><Action to="messages" variant="secondary"><MessageSquare size={17} aria-hidden="true" /> Message owner</Action></>}
    note="No payment was made. This is a clickable design preview." />;
}

export function ConfirmationTemplate({ title, description, status, pending, item, start, end, total, actions, note, feedback }: {
  title: string; description: string; status: string; pending: boolean;
  item: { title: string; image: string }; start: string; end: string; total: number;
  actions: ReactNode; note: ReactNode; feedback?: ReactNode;
}) {
  return <main className="p1-container p1-page p1-confirmation"><div className="p1-confirm-check"><Check size={34} aria-hidden="true" /></div><h1>{title}</h1><p>{description}</p>{feedback}<div className="p1-confirm-ticket"><img src={item.image} alt={item.title} /><div><Tag tone={pending ? 'pending' : 'good'}>{status}</Tag><h2>{item.title}</h2><DateSummary start={start} end={end} /><div className="p1-ticket-total"><span>Rental total</span><strong>{money(total)}</strong></div></div></div><div className="p1-actions">{actions}</div><p className="p1-muted">{note}</p></main>;
}

export interface RentalSummary {
  id: string; bookingReference?: string | null; listingId: string; start: string; end: string; total: number;
  status: DemoBooking['status'] | 'return_pending'; label?: string;
  title: string; image: string; ownerName: string; pickup: string; cancellation: string;
  disputed?: boolean; resolved?: boolean;
}
export interface RentalActions {
  bookings: RentalSummary[]; loading: boolean; error: string | null; retry: () => void;
  pickup: (id: string) => Promise<void>; startReturn: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>; pay: (id: string) => Promise<void>;
  contact: (id: string) => Promise<void>; report: (id: string, issue: string) => Promise<void>;
  details: (id: string) => ReactNode;
}
export function Rentals({ live }: { live?: RentalActions } = {}) {
  const store = useOptionalPreview();
  const [tab, setTab] = useState('All');
  const [detail, setDetail] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  if (!live && !store) throw new Error('Rental provider is missing.');
  const rentals: RentalSummary[] = live?.bookings ?? (store?.bookings ?? []).flatMap((booking) => {
    const item = store?.items.find((listing) => listing.id === booking.listingId);
    return item ? [{ ...booking, title: item.title, image: item.images[0], ownerName: item.owner.name, pickup: item.pickup, cancellation: item.cancellation }] : [];
  });
  const rows = rentals.filter((b) => tab === 'All' || b.status === tab.toLowerCase() || tab === 'Active' && b.status === 'return_pending');
  const booking = rentals.find((b) => b.id === detail);
  const run = async (command: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setActionError('');
    try { await command(); setCancel(false); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Could not update this rental. Please try again.'); }
    finally { setBusy(false); }
  };
  const update = (status: DemoBooking['status']) => {
    if (!booking || !store) return;
    store.setBookings((prev) => prev.map((b) => b.id === booking.id ? { ...b, status } : b));
    if (status === 'cancelled') store.setOwnerRequests((prev) => prev.map((r) => r.id === booking.id ? { ...r, status: 'declined' } : r));
    store.addNotice('Rental updated', `${booking.title} is now ${status}.`, 'renter');
    store.notify(status === 'past' ? 'Returned. Good gear, good memories.' : status === 'active' ? 'Picked up. Go do your thing!' : status === 'upcoming' ? 'Demo payment complete. Your rental is confirmed.' : 'Demo rental cancelled.', status !== 'cancelled');
    setCancel(false);
  };
  return <main className="p1-work-page">
    <PageHead title="Your next good plans." description="Upcoming adventures, projects in progress, and things well done." action={<Action to="search" variant="secondary">Find a new rental</Action>} />
    <div className="p1-tabs p1-space-bottom" aria-label="Rental status">{['All', 'Upcoming', 'Active', 'Pending', 'Approved', 'Past', 'Cancelled'].map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
    {live?.loading && <p role="status">Loading rentals…</p>}
    {live?.error && <ErrorNote>{live.error}<Button variant="secondary" onClick={live.retry}>Try again</Button></ErrorNote>}
    {rows.length ? <div className="p1-rental-list">{rows.map((b) =>
      <article className="p1-rental-row" key={b.id}><img src={b.image} alt={b.title} /><div><Tag tone={b.status === 'pending' ? 'pending' : b.status === 'active' ? 'blue' : b.status === 'upcoming' ? 'good' : 'neutral'}>{b.label ?? b.status}</Tag><h2>{b.title}</h2><p><CalendarCheck size={15} aria-hidden="true" />{rangeLabel(b.start, b.end)}</p><p className="p1-muted">From {b.ownerName} · {money(b.total)} rental total</p><p className="p1-muted">Booking reference: {b.bookingReference ?? 'Not assigned'}</p></div><Button variant="secondary" onClick={() => { setDetail(b.id); setIssue(''); setActionError(''); }}>Rental details</Button></article>)}</div> : !live?.loading && !live?.error && <Empty title={`No ${tab === 'All' ? '' : tab.toLowerCase()} rentals yet.`} body="Your next good plan will live here."><Action to="search">Browse rentals</Action></Empty>}
    <Modal open={Boolean(detail)} onClose={() => { if (!busy) { setDetail(null); setCancel(false); } }} title="Your rental" description={live ? 'Track pickup, return, verified payment and any issues.' : 'Track pickup, return and any issues in this demo.'}>
      {booking && <><h2>{booking.title}</h2><DateSummary start={booking.start} end={booking.end} /><Tag tone={booking.status === 'pending' ? 'pending' : 'blue'}>{booking.label ?? booking.status}</Tag><p>{booking.pickup}</p><div className="p1-actions p1-wrap">
        {booking.status === 'upcoming' && <Button disabled={busy} onClick={() => live ? void run(() => live.pickup(booking.id)) : update('active')}>{live ? 'Start check-in' : 'Mark picked up'}</Button>}
        {booking.status === 'active' && <Button disabled={busy} onClick={() => live ? void run(() => live.startReturn(booking.id)) : update('past')}>{live ? 'Start return' : 'Finish return'}</Button>}
        {booking.status === 'approved' && <Button disabled={busy} onClick={() => { if (live) { void run(() => live.pay(booking.id)); return; } if (!store?.availableRange(booking.listingId, booking.start, booking.end)) { store?.notify('These dates are no longer available. Cancel this request and choose other dates.'); return; } update('upcoming'); }}>{live ? 'Continue to secure payment' : 'Complete demo payment'}</Button>}
        {['pending', 'approved', 'upcoming'].includes(booking.status) && <Button disabled={busy} variant="quiet" onClick={() => setCancel(true)}>Cancel rental</Button>}
        {live ? <Button disabled={busy} variant="secondary" onClick={() => { void run(() => live.contact(booking.id)); }}>Message owner</Button> : <Action to="messages" variant="secondary">Message owner</Action>}
      </div>{cancel && <div className="p1-warning"><h3>{live ? 'Cancel this rental?' : 'Cancel this demo rental?'}</h3><p>{booking.cancellation}</p><div className="p1-actions"><Button disabled={busy} variant="danger" onClick={() => live ? void run(() => live.cancel(booking.id)) : update('cancelled')}>Confirm cancellation</Button><Button disabled={busy} variant="secondary" onClick={() => setCancel(false)}>Keep rental</Button></div></div>}
      {actionError && <ErrorNote>{actionError}</ErrorNote>}
      {booking.status === 'pending' && <p className="p1-info-copy">{live ? 'This rental is waiting for owner approval. Payment comes after approval.' : 'This rental is waiting for owner approval. Explore the owner workspace to review the sample request.'}</p>}
      {booking.status === 'return_pending' && <p className="p1-info-copy">Return started. The owner must confirm receipt before settlement.</p>}
      {['active', 'return_pending', 'past'].includes(booking.status) && (booking.disputed ? <Tag tone="pending">Issue submitted for review</Tag> : booking.resolved ? <Tag tone="good">Issue resolved in demo</Tag> : <form className="p1-issue-form" onSubmit={(e) => { e.preventDefault(); if (live) { void run(() => live.report(booking.id, issue.trim())); return; } store?.setBookings((prev) => prev.map((b) => b.id === booking.id ? { ...b, disputed: true, issue: issue.trim() } : b)); store?.addNotice('Rental issue submitted', issue, 'renter'); store?.notify('Issue submitted. Check the admin disputes view for its next steps.'); }}><Field label="Report an issue"><textarea required disabled={busy} minLength={10} maxLength={live ? 5000 : undefined} value={issue} onChange={(e) => setIssue(e.target.value)} rows={3} placeholder="Describe what happened (at least 10 characters)." /></Field><Button disabled={busy} type="submit" variant="secondary">Submit issue</Button></form>)}
      {live?.details(booking.id)}</>}
    </Modal>
  </main>;
}
