import { useState, type ChangeEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, DollarSign, Plus, ShieldCheck, Upload, X } from 'lucide-react';
import { categories, currentUser, listings as fixtures, type Listing } from '@/data';
import { addDays, rangeLabel, todayIso, CITIES, type Avail } from '../preview/dates';
import { Availability } from './dates';
import { availabilityProblem, href, usePreview } from './state';
import { Action, Avatar, Button, Dropdown, Empty, ErrorNote, Field, Modal, PageHead, SectionHead, Tag, money } from './ui';
import type { UiBooking } from '@/lib/bookings';
import type { BankPayoutStatus, DbPayoutRow } from '@/lib/payouts';
import { ListingNegotiationSettings } from '@/components/listing-negotiation-settings';

export interface LiveOwner {
  items: Listing[];
  bookings: UiBooking[];
  loading: boolean;
  error: string | null;
  notice: string | null;
  busy: boolean;
  retry: () => void;
  decide: (id: string, approve: boolean, reason?: string) => Promise<boolean>;
  toggle: (item: Listing) => Promise<void>;
  availability: (id: string) => Promise<{ value: Avail; locked: string[] }>;
  saveAvailability: (id: string, value: Avail) => Promise<boolean>;
  extras: ReactNode;
}
export function Owner({ listingView = false, live }: { listingView?: boolean; live?: LiveOwner }) {
  return live ? <LiveOwnerView listingView={listingView} live={live} /> : <DemoOwner listingView={listingView} />;
}
function DemoOwner({ listingView = false }: { listingView?: boolean }) {
  const store = usePreview();
  const [tab, setTab] = useState('All');
  const [availabilityId, setAvailabilityId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Avail>({ start: '', end: '', blocked: [] });
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const mine = store.items.filter((l) => l.owner.id === 'u1' || l.owner.id === 'me');
  const rows = mine.filter((l) => tab === 'All' || (tab === 'Live' ? l.listingStatus === 'published' : tab === 'Paused' ? l.listingStatus === 'archived' : l.listingStatus === 'pending_approval'));
  const pending = store.ownerRequests.filter((r) => r.status === 'pending');
  const earned = store.ownerRequests.filter((r) => r.status === 'accepted').reduce((s, r) => s + r.total, 0);
  const decide = (id: string, status: 'accepted' | 'declined') => {
    const booking = store.bookings.find((b) => b.id === id);
    if (status === 'accepted' && booking && !store.availableRange(booking.listingId, booking.start, booking.end)) { store.notify('These dates are no longer open. Decline the request or update listing availability first.'); return; }
    store.setOwnerRequests((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    store.setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status: status === 'accepted' ? 'approved' : 'cancelled' } : b));
    store.addNotice(status === 'accepted' ? 'Your request was approved' : 'Your request was declined', status === 'accepted' ? 'Complete the demo payment in your rentals to confirm the booking.' : reason || 'Try another listing or different dates.', 'renter');
    store.notify(status === 'accepted' ? 'Approved. One good plan closer to happening.' : 'Request declined. The renter has an update.', status === 'accepted');
    setDeclining(null); setReason('');
  };
  const listingShelf = <section><SectionHead title={listingView ? 'Your inventory' : 'Gear with a second job'}>{!listingView && <Action to="listings" variant="quiet">Manage all listings <ArrowRight size={16} aria-hidden="true" /></Action>}</SectionHead>
    {listingView && <div className="p1-tabs p1-space-bottom" aria-label="Listing status">{['All', 'Live', 'Paused', 'In review'].map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>}
    <div className="p1-owner-listings">{rows.map((l) => { const a = store.availFor(l.id); return <article key={l.id} className="p1-owner-item"><img src={l.images[0]} alt={l.title} /><div className="p1-owner-item-body"><Tag tone={l.listingStatus === 'published' ? 'good' : l.listingStatus === 'pending_approval' ? 'pending' : 'neutral'}>{l.listingStatus === 'published' ? 'Live' : l.listingStatus === 'pending_approval' ? 'In review' : 'Paused'}</Tag><h3>{l.title}</h3><p>{money(l.pricePerDay)} / day</p><p className="p1-muted"><CalendarDays size={14} aria-hidden="true" />{rangeLabel(a.start, a.end)} · {a.blocked.length} blocked</p><div className="p1-actions p1-wrap"><Action to="create" id={l.id} variant="secondary">Edit listing</Action><Button variant="secondary" onClick={() => { setAvailabilityId(l.id); setDraft(a); }}>Availability</Button>{l.listingStatus !== 'pending_approval' && <Button variant="quiet" onClick={() => { store.setItems((prev) => prev.map((x) => x.id === l.id ? { ...x, listingStatus: l.listingStatus === 'published' ? 'archived' : 'published' } : x)); store.notify(l.listingStatus === 'published' ? 'Listing paused. It won’t appear in search.' : 'Listing is live again.'); }}>{l.listingStatus === 'published' ? 'Pause' : 'Resume'}</Button>}</div></div></article>; })}</div>
    {!rows.length && <Empty title="Give your gear a second job." body="List something you already own. You stay in control of its price and dates."><Action to="create">List an item</Action></Empty>}
  </section>;
  return <main className="p1-work-page"><PageHead title={listingView ? 'Your gear, working for you.' : 'A little more from what you own.'} description={listingView ? 'Price it, pause it, and keep its dates in shape.' : 'Sample owner workspace. Review requests and keep your rentals running smoothly.'} action={<Action to="create"><Plus size={18} aria-hidden="true" /> List an item</Action>} />
    {!listingView && <><div className="p1-owner-metrics"><div><span>Accepted rental value</span><strong>{money(earned)}</strong><small>Demo requests · not settled earnings</small></div><div className="p1-metric-accent"><span>Waiting on you</span><strong>{pending.length}</strong><small>Requests ready to review</small></div><div><span>Your listings</span><strong>{mine.filter((l) => l.listingStatus === 'published').length}</strong><small>Live in the sample marketplace</small></div></div>
      <section className="p1-owner-requests"><SectionHead title="The next handoffs" description="A quick response keeps a good plan moving." /><div className="p1-request-queue">{store.ownerRequests.map((r) => <article key={r.id}><Avatar src={r.renterAvatar || currentUser.avatar} name={r.renterName} size={44} /><div><strong>{r.renterName}</strong><p>{r.listingTitle}</p><small>{rangeLabel(r.startDate, r.endDate)} · {money(r.total)}</small></div>{r.status === 'pending' ? <div className="p1-actions"><Button onClick={() => decide(r.id, 'accepted')}>Approve</Button><Button variant="quiet" onClick={() => setDeclining(r.id)}>Decline</Button></div> : <Tag tone={r.status === 'accepted' ? 'good' : 'neutral'}>{r.status === 'accepted' ? 'Approved · payment next' : 'Declined'}</Tag>}</article>)}</div></section></>}
    {listingShelf}
    <Modal open={Boolean(availabilityId)} onClose={() => setAvailabilityId(null)} title="Keep your dates in shape." description="Choose a window up to 30 days and block individual days. Confirmed rentals stay protected.">
      {availabilityId && <><Availability key={availabilityId} value={draft} onChange={setDraft} locked={store.lockedFor(availabilityId)} /><div className="p1-dialog-footer"><Button variant="secondary" onClick={() => setAvailabilityId(null)}>Cancel</Button><Button onClick={() => { if (store.saveAvailability(availabilityId, draft)) { store.notify('Availability saved. Your days, your call.'); setAvailabilityId(null); } }}>Save availability</Button></div></>}
    </Modal>
    <Modal open={Boolean(declining)} onClose={() => setDeclining(null)} title="Decline this request?" description="Let the renter know why, so they can make another plan."><form onSubmit={(e) => { e.preventDefault(); if (declining) decide(declining, 'declined'); }}><Field label="Reason for declining"><textarea required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="The owner is unavailable for pickup, for example." /></Field><Button type="submit" variant="danger">Decline request</Button></form></Modal>
  </main>;
}

const wizardSteps = ['The item', 'Photos', 'Price & pickup', 'Availability', 'Review'];
export function ListingWizard({ editId }: { editId?: string }) {
  return <DemoListingWizard editId={editId} />;
}
function DemoListingWizard({ editId }: { editId?: string }) {
  const store = usePreview();
  const existing = store.items.find((l) => l.id === editId);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [category, setCategory] = useState(existing?.category ?? 'Cameras');
  const [photos, setPhotos] = useState(existing?.images ?? []);
  const [price, setPrice] = useState(existing?.pricePerDay ?? 40);
  const [deposit, setDeposit] = useState(existing?.deposit ?? 100);
  const [instant, setInstant] = useState(existing?.instantBooking ?? true);
  const [delivery, setDelivery] = useState(existing?.deliveryAvailable ?? false);
  const [pickup, setPickup] = useState(existing?.pickup ?? 'Irving, TX - arrange pickup in messages');
  const [city, setCity] = useState('Irving, TX');
  const [avail, setAvail] = useState<Avail>(() => existing ? store.availFor(existing.id) : { start: todayIso(), end: addDays(todayIso(), 29), blocked: [] });
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const locked = existing ? store.lockedFor(existing.id) : [];
  const validation = () => {
    if (title.trim().length < 3 || description.trim().length < 10) return 'Add a title of at least 3 characters and a description of at least 10 characters.';
    if (!photos.length) return 'Add at least one photo.';
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(deposit) || deposit < 0 || pickup.trim().length < 3) return 'Enter a positive daily price, a non-negative deposit and pickup instructions.';
    return availabilityProblem(avail, locked);
  };
  const next = () => {
    let problem: string | null = null;
    if (step === 0 && (title.trim().length < 3 || description.trim().length < 10)) problem = 'Add a title (3+ characters) and description (10+ characters).';
    if (step === 1 && !photos.length) problem = 'Add at least one photo.';
    if (step === 2 && (!Number.isFinite(price) || price <= 0 || !Number.isFinite(deposit) || deposit < 0 || pickup.trim().length < 3)) problem = 'Check the daily price, deposit and pickup instructions.';
    if (step === 3) problem = availabilityProblem(avail, locked);
    if (problem) { setError(problem); return; }
    setError(''); setStep(step + 1);
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (photos.length + files.length > 6) { setError('Use up to 6 photos. Remove one before adding more.'); return; }
    if (files.some((f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024)) { setError('Use JPEG, PNG or WebP photos under 5 MB each.'); return; }
    setUploading(true); setError('');
    try {
      const images = await Promise.all(files.map((f) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The photo could not be read.'));
        reader.onerror = () => reject(new Error(`Could not read ${f.name}. Try another photo.`));
        reader.readAsDataURL(f);
      })));
      setPhotos((prev) => [...prev, ...images]);
    } catch (error) {
      console.error('Preview photo upload failed', error);
      setError(error instanceof Error ? error.message : 'Photo upload failed. Try another photo.');
    } finally { setUploading(false); event.target.value = ''; }
  };
  const save = (draft = false) => {
    const problem = validation();
    if (problem) { setError(problem); return; }
    const id = existing?.id ?? crypto.randomUUID();
    if (!store.saveAvailability(id, avail)) return;
    const item: Listing = {
      ...(existing ?? fixtures[0]), id, title: title.trim(), description: description.trim(), category, images: photos,
      pricePerDay: price, deposit, instantBooking: instant, deliveryAvailable: delivery, pickup,
      owner: existing?.owner ?? currentUser, listingStatus: draft ? 'draft' : existing && existing.listingStatus !== 'draft' ? existing.listingStatus : 'pending_approval',
      lat: CITIES[city].lat, lng: CITIES[city].lng, ...(existing ? {} : { rating: 0, reviewCount: 0, reviews: [], rentalCount: 0, rentalHistory: 0, verifiedOwner: false, protectionEligible: false, ownershipVerified: false, whatsIncluded: [], components: [], brand: undefined, model: undefined, declaredValue: 0, assetId: id, serialPartial: '', deliveryFee: 15, condition: 'Good', cancellation: 'Sample terms: arrange cancellations with the owner before pickup.' }),
    };
    store.setItems((prev) => existing ? prev.map((l) => l.id === id ? item : l) : [item, ...prev]);
    store.addNotice(existing ? 'Your listing was updated' : draft ? 'Your draft is saved' : 'Your listing is ready for review', title, 'listings');
    store.notify(existing ? 'Changes saved. Your gear is looking good.' : draft ? 'Draft saved. Pick it up when you’re ready.' : 'Submitted. That shelf just got a little more useful.', !draft);
    window.location.hash = href('listings');
  };
  if (editId && !existing) return <main className="p1-container p1-page"><Empty title="This listing isn’t here." body="Choose a listing from your owner workspace to edit."><Action to="listings">My listings</Action></Empty></main>;
  return <main className="p1-container p1-page">
    <a className="p1-back" href={href('listings')}><ArrowLeft size={16} aria-hidden="true" /> Back to my listings</a><PageHead title={existing ? 'Make your listing even better.' : 'Put your good gear to work.'} description="The item, the price, your days. You’re in control." />
    <div className="p1-wizard-layout"><ol className="p1-wizard-steps" aria-label="Listing steps">{wizardSteps.map((s, i) => <li key={s}><button type="button" disabled={i > step} aria-current={step === i ? 'step' : undefined} onClick={() => { setStep(i); setError(''); }}><span>{i < step ? <Check size={14} aria-hidden="true" /> : i + 1}</span><div><b>{s}</b><small>{['Give it a little personality', 'Let your gear speak for itself', 'Make the practical stuff clear', 'Lend it on your terms', 'One last look'][i]}</small></div></button></li>)}</ol>
      <div className="p1-wizard-content">
        {step === 0 && <><h2>Tell us about your item.</h2><Field label="Category"><Dropdown label="Category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c.name, label: c.name }))} /></Field><Field label="Give it a useful title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Sony A7 IV camera with 24–70mm lens" /></Field><Field label="What should renters know?"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={2000} placeholder="Condition, what’s included, and what makes it a good rental." /></Field></>}
        {step === 1 && <><h2>Show its best side.</h2><p className="p1-muted">Add up to 6 photos. The first photo is your cover. Photos stay local to this preview.</p><div className="p1-upload-grid">{photos.map((src, i) => <div key={`${i}-${src.slice(0, 30)}`}><img src={src} alt={`Listing photo ${i + 1}`} />{i === 0 && <Tag tone="lime">Cover</Tag>}<button className="p1-icon" type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((prev) => prev.filter((_, index) => index !== i))}><X size={16} aria-hidden="true" /></button></div>)}</div><label className="p1-upload"><Upload size={24} aria-hidden="true" /><b>{uploading ? 'Reading photos...' : 'Choose photos'}</b><span>JPEG, PNG or WebP · up to 5 MB each</span><input aria-label="Upload listing photos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={upload} /></label><Button variant="secondary" disabled={photos.length >= 6} onClick={() => setPhotos((prev) => [...prev, fixtures.find((l) => l.category === category)?.images[0] ?? fixtures[0].images[0]])}>Add a sample photo</Button></>}
        {step === 2 && <><h2>Good terms make good rentals.</h2><div className="p1-form-two"><Field label="Daily price ($)"><input type="number" min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} /></Field><Field label="Refundable deposit ($)"><input type="number" min={0} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} /></Field></div><Field label="Pickup city"><Dropdown label="Pickup city" value={city} onChange={setCity} options={Object.keys(CITIES).map((c) => ({ value: c, label: c }))} /></Field><Field label="Pickup instructions"><input value={pickup} onChange={(e) => setPickup(e.target.value)} /></Field><label className="p1-check"><input type="checkbox" checked={instant} onChange={(e) => setInstant(e.target.checked)} /><span>Instant booking<small>Let renters book without waiting for approval.</small></span></label><label className="p1-check"><input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} /><span>Offer delivery<small>Sample delivery fee: $15. Pickup stays free.</small></span></label></>}
        {step === 3 && <Availability value={avail} onChange={setAvail} locked={locked} />}
        {step === 4 && <><h2>{existing ? 'Ready for another good rental.' : 'Ready for its second job.'}</h2><div className="p1-listing-review">{photos[0] && <img src={photos[0]} alt={title} />}<h3>{title}</h3><p>{description}</p><dl className="p1-price-breakdown"><div><dt>Category</dt><dd>{category}</dd></div><div><dt>Daily price</dt><dd>{money(price)}</dd></div><div><dt>Refundable deposit</dt><dd>{money(deposit)}</dd></div><div><dt>Availability</dt><dd>{rangeLabel(avail.start, avail.end)}</dd></div><div><dt>Blocked days</dt><dd>{avail.blocked.length}</dd></div><div><dt>Booking</dt><dd>{instant ? 'Instant' : 'Owner approval'}</dd></div></dl></div><p className="p1-info-copy">New listings go into review before appearing in the sample marketplace. You can approve them in the admin preview.</p></>}
        {error && <ErrorNote>{error}</ErrorNote>}<div className="p1-dialog-footer">{step > 0 ? <Button variant="secondary" onClick={() => { setStep(step - 1); setError(''); }}>Back</Button> : <span />}{step < 4 ? <Button disabled={uploading} onClick={next}>Continue <ArrowRight size={17} aria-hidden="true" /></Button> : <div className="p1-actions"><Button variant="secondary" onClick={() => save(true)}>Save draft</Button><Button onClick={() => save()}>{existing ? 'Save changes' : 'Submit for review'}</Button></div>}</div>
      </div><aside className="p1-wizard-preview"><h3>Your listing, at a glance</h3><div className="p1-preview-item">{photos[0] ? <img src={photos[0]} alt={title || 'Your listing cover'} /> : <div className="p1-photo-placeholder"><CameraPlaceholder /></div>}<Tag tone="blue">{category}</Tag><h3>{title || 'Your item title'}</h3><p><b>{money(price)}</b> / day</p><p className="p1-muted">{rangeLabel(avail.start, avail.end)}</p></div><p className="p1-locked-note"><ShieldCheck size={17} aria-hidden="true" />A clear description and real photos help renters choose with confidence.</p></aside>
    </div>
  </main>;
}
function CameraPlaceholder() { return <Upload size={28} aria-hidden="true" />; }

export interface LivePayouts {
  bookings: UiBooking[] | null;
  transfers: Map<string, DbPayoutRow> | null;
  bank: { connected: boolean; payouts: BankPayoutStatus[] } | null;
  error: string | null;
  loading: boolean;
  busy: boolean;
  retry: () => void;
  connect: () => Promise<void>;
}
export function Payouts({ live }: { live?: LivePayouts } = {}) {
  return live ? <LivePayoutsView live={live} /> : <DemoPayouts />;
}
function DemoPayouts() {
  const store = usePreview();
  const [range, setRange] = useState('This month');
  const [exported, setExported] = useState(false);
  const rows = store.ownerRequests.filter((r) => r.status === 'accepted');
  const value = rows.reduce((s, r) => s + r.total, 0);
  const download = () => {
    const content = ['Item,Dates,Accepted value,Status', ...rows.map((r) => `"${r.listingTitle.replace(/"/g, '""')}","${rangeLabel(r.startDate, r.endDate)}",${r.total},Awaiting demo payment`)].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ybuy-preview-rental-activity.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true); store.notify('Sample activity exported.');
  };
  return <main className="p1-work-page"><PageHead title="Your gear. Your returns." description="Understand what’s booked, what’s pending, and what’s been paid." action={<Button variant="secondary" onClick={download}>Export sample activity</Button>} /><div className="p1-owner-metrics"><div><span>Accepted rental value</span><strong>{money(value)}</strong><small>Before payment and settlement</small></div><div><span>Paid out</span><strong>$0</strong><small>No money moves in this preview</small></div><div className="p1-metric-accent"><span>Awaiting payment</span><strong>{rows.length}</strong><small>Accepted sample requests</small></div></div><div className="p1-section-head"><h2>Rental activity</h2><label className="p1-inline-select">Period <Dropdown label="Activity period" value={range} onChange={setRange} options={['This month', 'All time'].map((period) => ({ value: period, label: period }))} /></label></div><p className="p1-muted">{range === 'This month' ? 'Sample requests for the current preview window.' : 'All activity from this preview session.'}</p>{rows.length ? <div className="p1-data-list">{rows.map((r) => <article key={r.id}><div><h3>{r.listingTitle}</h3><p>{rangeLabel(r.startDate, r.endDate)}</p></div><Tag tone="pending">Awaiting demo payment</Tag><strong>{money(r.total)}</strong></article>)}</div> : <Empty title="Your first earnings start with a rental." body="Approve a sample request in the owner overview to explore the activity table."><Action to="owner">Review requests</Action></Empty>}{exported && <p role="status" className="p1-info-copy">CSV exported. It contains sample data, not a financial statement.</p>}<div className="p1-info p1-payout-note"><DollarSign size={26} aria-hidden="true" /><div><h3>Keep the numbers honest.</h3><p>Accepted requests are not settled earnings. Real payout status will come from verified payments when the approved UI is connected.</p></div></div></main>;
}

function LiveOwnerView({ live, listingView }: { live: LiveOwner; listingView: boolean }) {
  const [biddingId, setBiddingId] = useState<string | null>(null);
  const [tab, setTab] = useState('All');
  const [availabilityId, setAvailabilityId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Avail>({ start: '', end: '', blocked: [] });
  const [locked, setLocked] = useState<string[]>([]);
  const [datesReady, setDatesReady] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [extras, setExtras] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const rows = live.items.filter(l => tab === 'All' || (tab === 'Live' ? l.available : tab === 'Paused' ? l.listingStatus === 'archived' : l.listingStatus === 'pending_approval'));
  const pending = live.bookings.filter(r => r.status === 'requested');
  const earned = live.bookings.filter(r => ['confirmed', 'active', 'return_pending', 'completed'].includes(r.status)).reduce((sum, r) => sum + r.subtotal, 0);
  async function openDates(id: string) {
    setAvailabilityId(id); setDatesReady(false); setDateError(null);
    try { const result = await live.availability(id); setDraft(result.value); setLocked(result.locked); setDatesReady(true); }
    catch (error) { setDateError(error instanceof Error ? error.message : 'Could not load availability.'); }
  }
  return <main className="p1-work-page" aria-busy={live.loading}>
    <PageHead title={listingView ? 'Your gear, working for you.' : 'A little more from what you own.'} description={listingView ? 'Price it, pause it, and keep its dates in shape.' : 'Review requests and keep your rentals running smoothly.'} action={<Action to="create"><Plus size={18} aria-hidden="true" /> List an item</Action>} />
    {live.error && <ErrorNote>{live.error}<Button variant="secondary" disabled={live.busy} onClick={live.retry}>Retry</Button></ErrorNote>}
    {live.notice && <p role="status" className="p1-info-copy">{live.notice}</p>}
    {live.loading && <p role="status">Loading your owner workspace…</p>}
    {!listingView && <><div className="p1-owner-metrics"><div><span>Rental earnings</span><strong>{live.loading || live.error ? '—' : money(earned)}</strong><small>Owner rental share · not bank payouts</small></div><div className="p1-metric-accent"><span>Waiting on you</span><strong>{pending.length}</strong><small>Requests ready to review</small></div><div><span>Your listings</span><strong>{live.items.filter(l => l.available).length}</strong><small>Live in the marketplace</small></div></div>
      <section className="p1-owner-requests"><SectionHead title="The next handoffs" description="A quick response keeps a good plan moving." /><div className="p1-request-queue">{live.bookings.map(r => <article key={r.id}><Avatar src={r.counterpartAvatar ?? ''} name={r.counterpartName} size={44} /><div><strong>{r.counterpartName}</strong><p>{r.listingTitle}</p><small>{rangeLabel(r.startDate, r.endDate)} · {money(r.subtotal)} owner share</small></div>{r.status === 'requested' ? <div className="p1-actions"><Button disabled={live.busy} onClick={() => void live.decide(r.id, true)}>Approve</Button><Button disabled={live.busy} variant="quiet" onClick={() => setDeclining(r.id)}>Decline</Button></div> : <Tag tone={r.status === 'rejected' || r.status === 'cancelled' ? 'neutral' : 'good'}>{r.status === 'pending_payment' ? 'Approved · payment next' : r.status.split('_').join(' ')}</Tag>}</article>)}</div></section></>}
    <section><SectionHead title={listingView ? 'Your inventory' : 'Gear with a second job'}>{!listingView && <Action to="listings" variant="quiet">Manage all listings <ArrowRight size={16} aria-hidden="true" /></Action>}</SectionHead>
      {listingView && <div className="p1-tabs p1-space-bottom" aria-label="Listing status">{['All', 'Live', 'Paused', 'In review'].map(t => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>}
      <div className="p1-owner-listings">{rows.map(l => <article key={l.id} className="p1-owner-item">{l.images[0] ? <img src={l.images[0]} alt={l.title} /> : <div className="p1-photo-placeholder"><Upload aria-hidden="true" /></div>}<div className="p1-owner-item-body"><Tag tone={l.available ? 'good' : l.listingStatus === 'pending_approval' ? 'pending' : 'neutral'}>{l.listingStatus === 'published' && l.availabilityExpired ? 'Expired' : l.listingStatus === 'published' ? 'Live' : l.listingStatus === 'pending_approval' ? 'In review' : l.listingStatus === 'archived' ? 'Paused' : l.listingStatus}</Tag><h3>{l.title || 'Untitled draft'}</h3><p>{money(l.pricePerDay)} / day</p><p className="p1-muted"><CalendarDays size={14} aria-hidden="true" />{rangeLabel(l.availabilityStart ?? '', l.availabilityEnd ?? '')}</p>{l.listingStatus === 'published' && l.availabilityExpired && <p className="p1-muted">Hidden from search. Update availability to make this listing available again.</p>}<div className="p1-actions p1-wrap"><Action to="create" id={l.id} variant="secondary">Edit listing</Action><Button disabled={live.busy} variant="secondary" onClick={() => void openDates(l.id)}>Availability</Button>{l.available && <Button disabled={live.busy} variant="secondary" onClick={() => setBiddingId(l.id)}>Bidding settings</Button>}{['published', 'archived'].includes(l.listingStatus ?? '') && <Button disabled={live.busy} variant="quiet" onClick={() => void live.toggle(l)}>{l.listingStatus === 'published' ? 'Pause' : 'Resume'}</Button>}</div></div></article>)}</div>
      {!live.loading && !live.error && !rows.length && <Empty title="Give your gear a second job." body="List something you already own. You stay in control of its price and dates."><Action to="create">List an item</Action></Empty>}
    </section>
    <Button variant="secondary" onClick={() => setExtras(true)}>Rental management & additional controls</Button>
    <Modal open={Boolean(biddingId)} onClose={() => setBiddingId(null)} title="Bidding settings" description="Schedule competitive bidding and review its saved dates.">
      {biddingId && <ListingNegotiationSettings listingId={biddingId} />}
    </Modal>
    <Modal open={extras} onClose={() => { setExtras(false); live.retry(); }} title="Manage your rentals and listings" description="Messages, pickup, returns, reviews, settlement, removal, discounts and promotions.">{extras && live.extras}</Modal>
    <Modal open={Boolean(availabilityId)} onClose={() => { if (!live.busy) setAvailabilityId(null); }} title="Keep your dates in shape." description="Choose a window up to 30 days and block individual days. Confirmed rentals stay protected.">
      {dateError && <ErrorNote>{dateError}<Button onClick={() => availabilityId && void openDates(availabilityId)}>Retry dates</Button></ErrorNote>}
      {live.error && <ErrorNote>{live.error}<Button variant="secondary" disabled={live.busy} onClick={() => availabilityId && void openDates(availabilityId)}>Reload saved dates</Button></ErrorNote>}
      {!datesReady && !dateError && <p role="status">Loading protected dates…</p>}
      {datesReady && availabilityId && <><Availability value={draft} onChange={setDraft} locked={locked} /><div className="p1-dialog-footer"><Button variant="secondary" disabled={live.busy} onClick={() => setAvailabilityId(null)}>Cancel</Button><Button disabled={live.busy} onClick={async () => { if (await live.saveAvailability(availabilityId, draft)) setAvailabilityId(null); }}>Save availability</Button></div></>}
    </Modal>
    <Modal open={Boolean(declining)} onClose={() => { if (!live.busy) setDeclining(null); }} title="Decline this request?" description="The request status will only change after the server confirms it."><form onSubmit={async e => { e.preventDefault(); if (declining && await live.decide(declining, false, reason)) { setDeclining(null); setReason(''); } }}><Field label="Reason for declining"><textarea required minLength={5} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} rows={3} /></Field>{live.error && <ErrorNote>{live.error}</ErrorNote>}<Button disabled={live.busy} type="submit" variant="danger">Decline request</Button></form></Modal>
  </main>;
}

function LivePayoutsView({ live }: { live: LivePayouts }) {
  const [range, setRange] = useState('This month');
  const [exported, setExported] = useState(false);
  const now = new Date();
  const inPeriod = (date: string) => range === 'All time' || date.slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rows = (live.bookings ?? []).filter(r => ['confirmed', 'active', 'return_pending', 'completed'].includes(r.status) && inPeriod(r.startDate));
  const earned = rows.reduce((sum, r) => sum + r.subtotal, 0);
  const transfers = live.transfers ? [...live.transfers.values()].filter(p => p.status === 'paid' && (range === 'All time' || Boolean(p.paid_at && inPeriod(p.paid_at)))) : null;
  function download() {
    const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
    const csv = ['Item,Dates,Owner rental share,Stripe transfer status', ...rows.map(r => [cell(r.listingTitle), cell(rangeLabel(r.startDate, r.endDate)), r.subtotal, cell(live.transfers ? live.transfers.get(r.id)?.status === 'paid' ? 'Transferred to Stripe' : 'No confirmed transfer' : 'Unverified')].join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ybuy-owner-rental-activity.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setExported(true);
  }
  return <main className="p1-work-page" aria-busy={live.loading}><PageHead title="Your gear. Your returns." description="Understand what’s booked, what’s pending, and what’s been paid." action={<Button variant="secondary" disabled={live.loading || !live.bookings || Boolean(live.error)} onClick={download}>Export rental activity</Button>} />
    {live.error && <ErrorNote>{live.error}</ErrorNote>}<Button variant="secondary" disabled={live.loading || live.busy} onClick={live.retry}>Refresh activity</Button>
    <div className="p1-owner-metrics"><div><span>Rental earnings</span><strong>{live.bookings && !live.error ? money(earned) : '—'}</strong><small>Owner rental share, selected period</small></div><div><span>Transferred to Stripe</span><strong>{transfers ? money(transfers.reduce((sum, p) => sum + p.amount, 0)) : '—'}</strong><small>Verified transfers · not bank payouts</small></div><div className="p1-metric-accent"><span>Awaiting payment</span><strong>{live.bookings ? live.bookings.filter(r => r.status === 'pending_payment' && inPeriod(r.startDate)).length : '—'}</strong><small>Approved requests, selected period</small></div></div>
    <div className="p1-section-head"><h2>Rental activity</h2><label className="p1-inline-select">Period <Dropdown label="Activity period" value={range} onChange={v => { setRange(v); setExported(false); }} options={['This month', 'All time'].map(period => ({ value: period, label: period }))} /></label></div><p className="p1-muted">{range === 'This month' ? 'Rentals starting in the current calendar month.' : 'All your paid rental activity.'}</p>{live.loading ? <p role="status">Verifying rental activity and payouts…</p> : rows.length ? <div className="p1-data-list">{rows.map(r => <article key={r.id}><div><h3>{r.listingTitle}</h3><p>{rangeLabel(r.startDate, r.endDate)}</p></div><Tag tone={live.transfers?.get(r.id)?.status === 'paid' ? 'good' : 'pending'}>{!live.transfers ? 'Transfer unavailable' : live.transfers.get(r.id)?.status === 'paid' ? 'Transferred to Stripe' : live.transfers.has(r.id) ? 'Transfer pending' : 'No transfer recorded'}</Tag><strong>{money(r.subtotal)}</strong></article>)}</div> : !live.error && <Empty title="Your first earnings start with a rental." body="Paid rental activity and verified transfers appear here after a rental."><Action to="owner">Review requests</Action></Empty>}
    {exported && <p role="status" className="p1-info-copy">CSV exported with owner rental shares and verified transfer statuses. It is not a bank statement.</p>}
    <div className="p1-info p1-payout-note"><DollarSign size={26} aria-hidden="true" /><div><h3>Keep the numbers honest.</h3><p>Rental earnings, Stripe transfers and bank payouts are different. Only Stripe-reported bank payouts below confirm their bank payout status.</p></div></div>
    <section><SectionHead title="Bank payout status" /><Button variant="secondary" disabled={live.busy || live.loading} onClick={() => void live.connect()}>Set up or manage Stripe payouts</Button>{live.bank ? live.bank.connected ? <div className="p1-data-list">{live.bank.payouts.length ? live.bank.payouts.map(p => <article key={p.id}><div><h3>{p.status}</h3><p>{p.arrival_date ? `Expected arrival ${new Date(p.arrival_date * 1000).toLocaleDateString()}` : 'No arrival date reported'}{p.failure_code ? ` · ${p.failure_code}` : ''}</p></div><strong>{new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency }).format(p.amount / 100)}</strong></article>) : <p>No bank payouts reported by Stripe.</p>}</div> : <p>Connect Stripe to receive bank payouts.</p> : <p>Bank payout status unavailable. Refresh to retry.</p>}</section>
  </main>;
}
