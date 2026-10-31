import { useState } from 'react';
import { Check, MessageSquare, X } from 'lucide-react';
import { listings, myBookings, ownerBookings, rentalRequests, type Booking } from '@/data';
import { useP } from '../ctx';
import { AvailabilityEditor } from '../availability';
import { rangeLabel, type Avail } from '../dates';
import { Avatar, Btn, Chip, Empty, Modal, Photo, Pill, Shell, Stars, Title, money } from '../ui';

type Status = Booking['status'];
const STATUS_PILL: Record<Status, { tone: 'accent' | 'yellow' | 'soft' | 'warn' | 'good'; label: string }> = {
  upcoming: { tone: 'accent', label: 'Upcoming' }, active: { tone: 'yellow', label: 'With you now' }, past: { tone: 'soft', label: 'Returned' },
  pending: { tone: 'warn', label: 'Waiting for owner' }, cancelled: { tone: 'soft', label: 'Cancelled' },
};

export function RenterScreen() {
  const { go, toast, celebrate } = useP();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const items = myBookings.map((b) => ({ ...b, status: statuses[b.id] ?? b.status }));
  const shown = items.filter((b) => (tab === 'past' ? b.status === 'past' || b.status === 'cancelled' : b.status === 'upcoming' || b.status === 'active'));
  const next = items.find((b) => b.status === 'upcoming');

  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <Title sub="Everything you’re renting, in one calm place.">Your rentals</Title>
      {next && (
        <div className="ink-surface mt-8 grid gap-6 overflow-hidden rounded-[1.75rem] sm:grid-cols-[18rem_1fr]">
          <Photo src={next.listing.images[0]} className="h-48 w-full sm:h-full" />
          <div className="flex flex-col justify-center p-6 sm:p-8">
            <Pill tone="yellow">Next up · {next.startDate}</Pill>
            <p className="mt-3 font-editorial text-5xl leading-none">{next.listing.title}</p>
            <p className="mt-3 text-white/80">Pick up at {next.pickupTime} from {next.listing.owner.name}. Directions are in your messages.</p>
            <div className="mt-5 flex flex-wrap gap-2"><Btn tone="yellow" onClick={() => go('messages')}>Message owner</Btn><Btn tone="outline" className="!border-white/30 !bg-transparent !text-white hover:!bg-white/10" onClick={() => toast('Check-in unlocks on pickup day. See you then!')}>Start check-in</Btn></div>
          </div>
        </div>
      )}
      <div className="mt-10 flex gap-2" role="tablist" aria-label="Rental status">
        {(['upcoming', 'past'] as const).map((value) => <Chip key={value} active={tab === value} onClick={() => setTab(value)}>{value === 'upcoming' ? 'Upcoming' : 'Past'}</Chip>)}
      </div>
      <div className="mt-6 space-y-3">
        {shown.length === 0 && <Empty title="No rentals here" body="When you book something, it shows up here." action={<Btn onClick={() => go('search')}>Browse items</Btn>} />}
        {shown.map((booking) => (
          <article key={booking.id} className="flex flex-col gap-4 rounded-[1.5rem] bg-card p-4 sm:flex-row sm:items-center">
            <button type="button" onClick={() => go('listing', booking.listing.id)} aria-label={`View ${booking.listing.title}`}><Photo src={booking.listing.images[0]} className="h-32 w-full rounded-[1rem] sm:h-24 sm:w-32" /></button>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-bold">{booking.listing.title}</p>
              <p className="text-sm text-sec">{booking.startDate} – {booking.endDate} · {booking.listing.owner.name}</p>
              <div className="mt-2 flex items-center gap-3"><Pill tone={STATUS_PILL[booking.status].tone}>{STATUS_PILL[booking.status].label}</Pill><span className="text-sm font-semibold tnum">{money(booking.total)}</span></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {booking.status === 'upcoming' && <><Btn size="sm" tone="soft" onClick={() => go('messages')} icon={<MessageSquare size={15} aria-hidden="true" />}>Message</Btn><Btn size="sm" tone="outline" onClick={() => { setStatuses((s) => ({ ...s, [booking.id]: 'cancelled' })); toast('Cancelled. No charge, no hard feelings.'); }}>Cancel</Btn></>}
              {booking.status === 'past' && <><Btn size="sm" tone="soft" onClick={() => celebrate('Your review helps the next renter choose with confidence.', 'Thanks for sharing!')}>Leave a review</Btn><Btn size="sm" onClick={() => go('listing', booking.listing.id)}>Rent again</Btn></>}
            </div>
          </article>
        ))}
      </div>
    </Shell>
  );
}

export function OwnerScreen() {
  const { go, celebrate, toast, availFor, setAvail } = useP();
  const [requests, setRequests] = useState(rentalRequests.map((r) => ({ ...r })));
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Avail>({ start: '', end: '', blocked: [] });
  const [paused, setPaused] = useState<Set<string>>(new Set());
  const mine = listings.filter((l) => l.owner.id === 'u1');
  const earned = ownerBookings.reduce((sum, b) => sum + b.total, 0) + requests.filter((r) => r.status === 'accepted').reduce((s, r) => s + r.total, 0);
  const pending = requests.filter((r) => r.status === 'pending').length;

  const decide = (id: string, status: 'accepted' | 'declined') => {
    setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    if (status === 'accepted') { celebrate('They’ve been told. Pickup details are on their way.', 'Approved. You’re in business!'); } else { toast('Declined politely. On to the next one.'); }
  };

  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <Title sub="Approve requests, manage dates and keep earning." action={<Btn onClick={() => go('create')}>List another item</Btn>}>Your workspace</Title>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[['This month', money(earned), 'earned from rentals'], ['Waiting on you', String(pending), pending === 1 ? 'request to review' : 'requests to review'], ['Response rate', '98%', 'owners above 95% rank higher']].map(([label, value, sub], index) => (
          <div key={label} className={`rounded-[1.5rem] p-6 ${index === 1 ? 'bg-[var(--accent)] text-white' : 'bg-card'}`}><p className={`text-sm font-semibold ${index === 1 ? 'text-white/80' : 'text-sec'}`}>{label}</p><p className="mt-1 font-editorial text-6xl leading-none">{value}</p><p className={`mt-2 text-sm ${index === 1 ? 'text-white/80' : 'text-sec'}`}>{sub}</p></div>
        ))}
      </div>

      <section className="mt-12" aria-labelledby="req"><h2 id="req" className="font-editorial text-4xl leading-none">Requests</h2>
        <div className="mt-5 space-y-3">
          {requests.map((r) => (
            <article key={r.id} className="flex flex-col gap-4 rounded-[1.5rem] bg-card p-5 sm:flex-row sm:items-center">
              <Avatar src={r.renterAvatar} name={r.renterName} size={52} />
              <div className="min-w-0 flex-1"><p className="font-display font-bold">{r.renterName} <span className="font-normal text-sec">wants</span> {r.listingTitle}</p><p className="text-sm text-sec">{r.startDate} – {r.endDate} · {money(r.total)} · <Stars rating={r.renterRating} /> · {r.renterRentals} rentals{r.renterVerified ? ' · verified' : ''}</p></div>
              {r.status === 'pending' ? <div className="flex gap-2"><Btn size="sm" icon={<Check size={15} aria-hidden="true" />} onClick={() => decide(r.id, 'accepted')}>Approve</Btn><Btn size="sm" tone="outline" icon={<X size={15} aria-hidden="true" />} onClick={() => decide(r.id, 'declined')}>Decline</Btn></div> : <Pill tone={r.status === 'accepted' ? 'good' : 'soft'}>{r.status === 'accepted' ? 'Approved' : 'Declined'}</Pill>}
            </article>
          ))}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="mine"><h2 id="mine" className="font-editorial text-4xl leading-none">Your listings</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((l) => { const off = paused.has(l.id); const a = availFor(l.id); return (
            <article key={l.id} className="rounded-[1.5rem] bg-card p-4"><Photo src={l.images[0]} className={`aspect-[16/10] w-full rounded-[1rem] ${off ? 'opacity-40' : ''}`} />
              <p className="mt-3 font-display font-bold">{l.title}</p><p className="text-sm text-sec">{money(l.pricePerDay)}/day · {l.rentalCount} rentals</p>
              <p className="mt-1 text-sm text-sec">Open {rangeLabel(a.start, a.end)} · {a.blocked.length} blocked</p>
              <div className="mt-3 flex flex-wrap gap-2"><Btn size="sm" tone="soft" onClick={() => go('create', l.id)}>Edit</Btn><Btn size="sm" tone="soft" onClick={() => { setEditing(l.id); setDraft(a); }}>Availability</Btn><Btn size="sm" tone="outline" aria-pressed={off} onClick={() => setPaused((s) => { const n = new Set(s); if (n.has(l.id)) { n.delete(l.id); } else { n.add(l.id); } return n; })}>{off ? 'Resume' : 'Pause'}</Btn></div>
            </article>
          ); })}
        </div>
      </section>
      {editing && (
        <Modal title="Availability" onClose={() => setEditing(null)}>
          <AvailabilityEditor listingId={editing} value={draft} onChange={setDraft} />
          <div className="mt-6 flex justify-end gap-2"><Btn tone="soft" onClick={() => setEditing(null)}>Cancel</Btn><Btn onClick={() => { setAvail(editing, draft); setEditing(null); toast('Availability updated.'); }}>Save</Btn></div>
        </Modal>
      )}
    </Shell>
  );
}
