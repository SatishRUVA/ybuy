import { useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarCheck, Check, CreditCard, Lock, MapPin, MessageSquare, PackageCheck, ShieldCheck } from 'lucide-react';
import { rentalDays, rangeLabel } from '../preview/dates';
import { DateField, DateSummary } from './dates';
import { href, usePreview, type DemoBooking } from './state';
import { Action, Button, Empty, ErrorNote, Field, Modal, PageHead, Tag, money } from './ui';

export function Checkout({ id }: { id: string }) {
  const store = usePreview();
  const item = store.items.find((l) => l.id === id);
  const [step, setStep] = useState(0);
  const seed = store.availableRange(id, store.search.start, store.search.end) ? store.search : store.firstRange(id);
  const [dates, setDates] = useState({ start: seed.start, end: seed.end });
  const [pickup, setPickup] = useState<'pickup' | 'delivery'>('pickup');
  const [note, setNote] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [failPayment, setFailPayment] = useState(false);
  if (!item) return <main className="p1-container p1-page"><Empty title="Choose a rental first." body="Find the item you need, then pick your dates."><Action to="search">Browse rentals</Action></Empty></main>;
  const a = store.availFor(id), days = dates.start && dates.end ? rentalDays(dates.start, dates.end) : 0;
  const subtotal = item.pricePerDay * days, fee = Math.round(subtotal * 0.1), delivery = pickup === 'delivery' ? item.deliveryFee ?? 15 : 0;
  const total = subtotal + fee + delivery;
  const valid = store.availableRange(id, dates.start, dates.end) && item.available && item.listingStatus === 'published';
  const finish = () => {
    if (!valid) { setError('These dates are no longer open. Choose a different range.'); setStep(0); return; }
    if (!agree) { setError('Accept the rental terms to continue.'); return; }
    if (item.instantBooking && failPayment) { setError('Demo payment declined. Choose the successful payment scenario and try again.'); return; }
    const bookingId = crypto.randomUUID();
    const booking: DemoBooking = { id: bookingId, listingId: id, ...dates, total, pickup, note, status: item.instantBooking ? 'upcoming' : 'pending' };
    store.setBookings((prev) => [booking, ...prev]);
    if (!item.instantBooking) store.setOwnerRequests((prev) => [{
      id: bookingId, listingTitle: item.title, renterName: store.profile.name, renterAvatar: '', renterRating: 4.9,
      renterRentals: 31, renterVerified: true, renterClaims: 0, startDate: dates.start, endDate: dates.end, total, status: 'pending',
    }, ...prev]);
    store.addNotice(item.instantBooking ? 'Your demo rental is booked' : 'Your request is on its way', `${item.title} · ${rangeLabel(dates.start, dates.end)}`, 'renter');
    store.setSearch(dates);
    store.notify(item.instantBooking ? 'That plan just became a rental. Nice one!' : 'Request sent. Your next good plan is in motion.', true);
    window.location.hash = href('confirmation', bookingId);
  };
  return <main className="p1-container p1-page">
    <a href={href('listing', id)} className="p1-back"><ArrowLeft size={16} aria-hidden="true" /> Back to item</a>
    <div className="p1-checkout-layout"><div>
      <ol className="p1-steps" aria-label="Booking steps">{['Your dates', 'Pickup', item.instantBooking ? 'Review & payment' : 'Review request'].map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined}><span className={i <= step ? 'done' : ''}>{i < step ? <Check size={15} aria-hidden="true" /> : i + 1}</span>{s}</li>)}</ol>
      <PageHead title={step === 0 ? 'Make time for a good plan.' : step === 1 ? 'How will you get your gear?' : item.instantBooking ? 'One last look. Then it’s yours.' : 'Send your plan to the owner.'} description={step === 0 ? 'Choose the days you need, not a day more.' : step === 1 ? 'Keep the handoff simple.' : 'All prices below are illustrative. No money is moved in this preview.'} />
      {step === 0 && <div className="p1-panel p1-checkout-dates"><DateSummary {...dates} /><DateField {...dates} min={a.start} max={a.end} blocked={store.blockedFor(id)} onChange={(start, end) => { setDates({ start, end }); store.setSearch({ start, end }); }} label="Rental dates" /><p className="p1-muted">Owner’s window: {rangeLabel(a.start, a.end)}. Already booked or blocked days cannot be selected.</p><Field label={`A note for ${item.owner.name.split(' ')[0]} (optional)`}><textarea rows={3} maxLength={300} placeholder="Tell them a little about your plans." value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>}
      {step === 1 && <div className="p1-choice-grid">
        <button type="button" aria-pressed={pickup === 'pickup'} onClick={() => setPickup('pickup')}><MapPin aria-hidden="true" /><strong>Pick it up</strong><span>Free · {item.pickup.split(' - ')[0]}</span>{pickup === 'pickup' && <Check size={17} aria-hidden="true" />}</button>
        {item.deliveryAvailable && <button type="button" aria-pressed={pickup === 'delivery'} onClick={() => setPickup('delivery')}><PackageCheck aria-hidden="true" /><strong>Have it delivered</strong><span>{money(item.deliveryFee ?? 15)} · {item.delivery}</span>{pickup === 'delivery' && <Check size={17} aria-hidden="true" />}</button>}
        <p className="p1-muted">The exact handoff address belongs in the booking details after approval.</p>
      </div>}
      {step === 2 && <div className="p1-panel"><div className="p1-review-block"><DateSummary {...dates} /><p><b>{pickup === 'pickup' ? 'Local pickup' : 'Delivery'}</b> · {rangeLabel(dates.start, dates.end)}</p></div>
        {item.instantBooking ? <><h2>Demo payment</h2><p className="p1-muted">No real card details needed. Choose a scenario to preview the experience.</p><div className="p1-demo-payment"><CreditCard size={23} aria-hidden="true" /><div><b>Sample card ending 4242</b><span>Illustrative payment method only</span></div><Tag tone="blue">Demo</Tag></div><label className="p1-check"><input type="checkbox" checked={failPayment} onChange={(e) => { setFailPayment(e.target.checked); setError(''); }} /><span>Preview a declined payment</span></label></> : <div className="p1-info"><ShieldCheck size={24} aria-hidden="true" /><div><h3>Owner approval comes first.</h3><p>This sends a request, not a payment. Complete payment only after approval.</p></div></div>}
        <label className="p1-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I agree to the item’s rental and cancellation terms.</span></label><details><summary>Read the rental terms</summary><p>{item.cancellation}</p><p>{item.condition} condition. Return all included components. Refundable deposit: {money(item.deposit)}.</p></details>
      </div>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="p1-actions p1-checkout-actions">{step > 0 && <Button variant="secondary" onClick={() => { setStep(step - 1); setError(''); }}>Back</Button>}<Button disabled={step === 0 && !valid} onClick={() => { if (step < 2) { setStep(step + 1); setError(''); } else finish(); }}>{step < 2 ? 'Continue' : item.instantBooking ? `Confirm demo booking · ${money(total)}` : 'Send rental request'}<ArrowRight size={17} aria-hidden="true" /></Button></div>
    </div><aside className="p1-order-summary"><img src={item.images[0]} alt={item.title} /><h2>{item.title}</h2><p className="p1-muted">From {item.owner.name}</p><DateSummary {...dates} /><dl className="p1-price-breakdown"><div><dt>{money(item.pricePerDay)} × {days} days</dt><dd>{money(subtotal)}</dd></div><div><dt>Service fee</dt><dd>{money(fee)}</dd></div>{delivery > 0 && <div><dt>Delivery</dt><dd>{money(delivery)}</dd></div>}<div className="total"><dt>Rental total</dt><dd>{money(total)}</dd></div><div><dt>Refundable deposit hold</dt><dd>{money(item.deposit)}</dd></div></dl><p className="p1-locked-note"><Lock size={16} aria-hidden="true" />Preview only. Nothing charged.</p></aside></div>
  </main>;
}

export function Confirmation({ id }: { id?: string }) {
  const { items, bookings } = usePreview();
  const booking = id ? bookings.find((b) => b.id === id) : bookings[0];
  const item = items.find((l) => l.id === booking?.listingId);
  if (!booking || !item) return <main className="p1-container p1-page"><Empty title="Your next plan starts here." body="Book a sample rental to explore the confirmation experience."><Action to="search">Find your thing</Action></Empty></main>;
  const pending = booking.status === 'pending';
  return <main className="p1-container p1-page p1-confirmation"><div className="p1-confirm-check"><Check size={34} aria-hidden="true" /></div><h1>{pending ? 'Good plans are on their way.' : 'Go make something of it.'}</h1><p>{pending ? 'Your request is with the owner. We’ll keep the next steps together in your rentals.' : 'Your demo rental is confirmed. All that’s left is the adventure.'}</p><div className="p1-confirm-ticket"><img src={item.images[0]} alt={item.title} /><div><Tag tone={pending ? 'pending' : 'good'}>{pending ? 'Awaiting approval' : 'Demo booking confirmed'}</Tag><h2>{item.title}</h2><DateSummary start={booking.start} end={booking.end} /><div className="p1-ticket-total"><span>Rental total</span><strong>{money(booking.total)}</strong></div></div></div><div className="p1-actions"><Action to="renter">View my rentals</Action><Action to="messages" variant="secondary"><MessageSquare size={17} aria-hidden="true" /> Message owner</Action></div><p className="p1-muted">No payment was made. This is a clickable design preview.</p></main>;
}

export function Rentals() {
  const store = usePreview();
  const [tab, setTab] = useState('All');
  const [detail, setDetail] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const [issue, setIssue] = useState('');
  const rows = store.bookings.filter((b) => tab === 'All' || b.status === tab.toLowerCase());
  const booking = store.bookings.find((b) => b.id === detail);
  const item = store.items.find((l) => l.id === booking?.listingId);
  const update = (status: DemoBooking['status']) => {
    if (!booking) return;
    store.setBookings((prev) => prev.map((b) => b.id === booking.id ? { ...b, status } : b));
    if (status === 'cancelled') store.setOwnerRequests((prev) => prev.map((r) => r.id === booking.id ? { ...r, status: 'declined' } : r));
    store.addNotice('Rental updated', `${item?.title} is now ${status}.`, 'renter');
    store.notify(status === 'past' ? 'Returned. Good gear, good memories.' : status === 'active' ? 'Picked up. Go do your thing!' : status === 'upcoming' ? 'Demo payment complete. Your rental is confirmed.' : 'Demo rental cancelled.', status !== 'cancelled');
    setCancel(false);
  };
  return <main className="p1-work-page">
    <PageHead title="Your next good plans." description="Upcoming adventures, projects in progress, and things well done." action={<Action to="search" variant="secondary">Find a new rental</Action>} />
    <div className="p1-tabs p1-space-bottom" aria-label="Rental status">{['All', 'Upcoming', 'Active', 'Pending', 'Approved', 'Past', 'Cancelled'].map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
    {rows.length ? <div className="p1-rental-list">{rows.map((b) => { const l = store.items.find((x) => x.id === b.listingId); if (!l) return null;
      return <article className="p1-rental-row" key={b.id}><img src={l.images[0]} alt={l.title} /><div><Tag tone={b.status === 'pending' ? 'pending' : b.status === 'active' ? 'blue' : b.status === 'upcoming' ? 'good' : 'neutral'}>{b.status}</Tag><h2>{l.title}</h2><p><CalendarCheck size={15} aria-hidden="true" />{rangeLabel(b.start, b.end)}</p><p className="p1-muted">From {l.owner.name} · {money(b.total)} rental total</p></div><Button variant="secondary" onClick={() => { setDetail(b.id); setIssue(''); }}>Rental details</Button></article>; })}</div> : <Empty title={`No ${tab === 'All' ? '' : tab.toLowerCase()} rentals yet.`} body="Your next good plan will live here."><Action to="search">Browse rentals</Action></Empty>}
    <Modal open={Boolean(detail)} onClose={() => { setDetail(null); setCancel(false); }} title="Your rental" description="Track pickup, return and any issues in this demo.">
      {booking && item && <><h2>{item.title}</h2><DateSummary start={booking.start} end={booking.end} /><Tag tone={booking.status === 'pending' ? 'pending' : 'blue'}>{booking.status}</Tag><p>{item.pickup}</p><div className="p1-actions p1-wrap">
        {booking.status === 'upcoming' && <Button onClick={() => update('active')}>Mark picked up</Button>}
        {booking.status === 'active' && <Button onClick={() => update('past')}>Finish return</Button>}
        {booking.status === 'approved' && <Button onClick={() => { if (!store.availableRange(booking.listingId, booking.start, booking.end)) { store.notify('These dates are no longer available. Cancel this request and choose other dates.'); return; } update('upcoming'); }}>Complete demo payment</Button>}
        {['pending', 'approved', 'upcoming'].includes(booking.status) && <Button variant="quiet" onClick={() => setCancel(true)}>Cancel rental</Button>}
        <Action to="messages" variant="secondary">Message owner</Action>
      </div>{cancel && <div className="p1-warning"><h3>Cancel this demo rental?</h3><p>{item.cancellation}</p><div className="p1-actions"><Button variant="danger" onClick={() => update('cancelled')}>Confirm cancellation</Button><Button variant="secondary" onClick={() => setCancel(false)}>Keep rental</Button></div></div>}
      {booking.status === 'pending' && <p className="p1-info-copy">This rental is waiting for owner approval. Explore the owner workspace to review the sample request.</p>}
      {['active', 'past'].includes(booking.status) && (booking.disputed ? <Tag tone="pending">Issue submitted for review</Tag> : booking.resolved ? <Tag tone="good">Issue resolved in demo</Tag> : <form className="p1-issue-form" onSubmit={(e) => { e.preventDefault(); store.setBookings((prev) => prev.map((b) => b.id === booking.id ? { ...b, disputed: true, issue: issue.trim() } : b)); store.addNotice('Rental issue submitted', issue, 'renter'); store.notify('Issue submitted. Check the admin disputes view for its next steps.'); }}><Field label="Report an issue"><textarea required minLength={10} value={issue} onChange={(e) => setIssue(e.target.value)} rows={3} placeholder="Describe what happened (at least 10 characters)." /></Field><Button type="submit" variant="secondary">Submit issue</Button></form>)}</>}
    </Modal>
  </main>;
}
