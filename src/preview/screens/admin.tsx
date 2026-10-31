import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { claims, listings } from '@/data';
import { useP } from '../ctx';
import { Avatar, Btn, Empty, Photo, Pill, Shell, money } from '../ui';

type Tab = 'overview' | 'moderation' | 'users' | 'disputes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'moderation', label: 'Listing review' }, { id: 'users', label: 'People' }, { id: 'disputes', label: 'Disputes' },
];

export function AdminScreen() {
  const { toast, celebrate } = useP();
  const [tab, setTab] = useState<Tab>('overview');
  const [queue, setQueue] = useState(listings.slice(4, 9).map((l) => ({ ...l, decision: null as null | 'approved' | 'rejected' })));
  const [suspended, setSuspended] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const people = [...new Map(listings.map((l) => [l.owner.id, l.owner])).values()];
  const pending = queue.filter((q) => !q.decision).length;

  const decide = (id: string, decision: 'approved' | 'rejected') => { setQueue((q) => q.map((x) => (x.id === id ? { ...x, decision } : x))); toast(decision === 'approved' ? 'Approved. It’s live!' : 'Rejected. The owner gets a friendly note.'); };

  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <div className="grid gap-6 lg:grid-cols-[14rem_1fr] lg:gap-10">
        <nav aria-label="Admin sections" className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
          <p className="hidden px-4 pb-2 font-editorial text-3xl leading-none lg:block">Admin</p>
          {TABS.map((t) => <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)} className={`h-11 shrink-0 rounded-full px-5 text-left text-sm font-semibold ${tab === t.id ? 'bg-[var(--ink)] text-white' : 'hover:bg-subtle'}`}>{t.label}{t.id === 'moderation' && pending > 0 && <span className="ml-2 rounded-full bg-[var(--highlight)] px-2 py-0.5 text-xs text-[var(--ink)]">{pending}</span>}</button>)}
        </nav>
        <div className="min-w-0">
          {tab === 'overview' && (
            <div>
              <h1 className="font-editorial text-5xl leading-none">Today</h1>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[['Listings to review', String(pending)], ['Open disputes', String(claims.length - resolved.size)], ['Bookings today', '27'], ['New members', '14']].map(([label, value]) => <div key={label} className="rounded-[1.5rem] bg-card p-5"><p className="text-sm font-semibold text-sec">{label}</p><p className="mt-1 font-editorial text-6xl leading-none">{value}</p></div>)}
              </div>
              <div className="mt-6 flex flex-wrap gap-2"><Btn onClick={() => setTab('moderation')}>Review listings</Btn><Btn tone="soft" onClick={() => setTab('disputes')}>Open disputes</Btn></div>
            </div>
          )}
          {tab === 'moderation' && (
            <div><h1 className="font-editorial text-5xl leading-none">Listing review</h1>
              <div className="mt-6 space-y-2">{pending === 0 && <Empty title="Queue is clear" body="New listings will land here for review." />}
                {queue.map((q) => (
                  <article key={q.id} className="flex flex-col gap-3 rounded-[1.25rem] bg-card p-3 sm:flex-row sm:items-center">
                    <Photo src={q.images[0]} className="h-24 w-full rounded-[0.9rem] sm:h-16 sm:w-24" />
                    <div className="min-w-0 flex-1"><p className="font-display font-bold">{q.title}</p><p className="text-sm text-sec">{q.owner.name} · {money(q.pricePerDay)}/day · {q.category}</p></div>
                    {q.decision ? <Pill tone={q.decision === 'approved' ? 'good' : 'soft'}>{q.decision === 'approved' ? 'Approved' : 'Rejected'}</Pill> : <div className="flex gap-2"><Btn size="sm" icon={<Check size={15} aria-hidden="true" />} onClick={() => decide(q.id, 'approved')}>Approve</Btn><Btn size="sm" tone="outline" icon={<X size={15} aria-hidden="true" />} onClick={() => decide(q.id, 'rejected')}>Reject</Btn></div>}
                  </article>))}</div></div>
          )}
          {tab === 'users' && (
            <div><h1 className="font-editorial text-5xl leading-none">People</h1>
              <ul className="mt-6 divide-y divide-[var(--border)] rounded-[1.5rem] bg-card">{people.map((p) => { const off = suspended.has(p.id); return (
                <li key={p.id} className="flex items-center gap-4 p-4"><Avatar src={p.avatar} name={p.name} size={44} /><div className="min-w-0 flex-1"><p className="font-semibold">{p.name} {off && <Pill tone="warn">Suspended</Pill>}</p><p className="text-sm text-sec">{p.rentals} rentals · {p.rating} rating · {p.unresolvedClaims} open claims</p></div>
                  <Btn size="sm" tone="outline" onClick={() => { setSuspended((s) => { const n = new Set(s); if (n.has(p.id)) { n.delete(p.id); } else { n.add(p.id); } return n; }); toast(off ? 'Welcome back. Account restored.' : 'Account paused. Owner notified.'); }}>{off ? 'Restore' : 'Suspend'}</Btn></li>); })}</ul></div>
          )}
          {tab === 'disputes' && (
            <div><h1 className="font-editorial text-5xl leading-none">Disputes</h1>
              <div className="mt-6 space-y-3">{claims.map((c) => { const done = resolved.has(c.id) || c.status === 'resolved'; return (
                <article key={c.id} className="rounded-[1.5rem] bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-display font-bold">{c.listingTitle}</p><p className="text-sm text-sec">{c.issue} · {money(c.amount)} · {c.date}</p></div>{done ? <Pill tone="good">Resolved</Pill> : <Btn size="sm" onClick={() => { setResolved((s) => new Set(s).add(c.id)); celebrate('Both sides have been notified and the case is closed.', 'Dispute settled!'); }}>Resolve</Btn>}</div>
                  <ol className="mt-4 flex flex-wrap gap-2">{c.timeline.map((t) => <li key={t.step}><Pill tone={t.done || done ? 'accent' : 'soft'}>{t.step}</Pill></li>)}</ol></article>); })}</div></div>
          )}
        </div>
      </div>
    </Shell>
  );
}
