import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Bell, Check, CheckCheck, ChevronLeft, Plus, Search, Send, ShieldCheck } from 'lucide-react';
import { currentUser } from '@/data';
import { rangeLabel } from '../preview/dates';
import { DateField } from './dates';
import { href, usePreview } from './state';
import { Action, Avatar, Button, Dropdown, Empty, Field, Modal, PageHead, Tag, money } from './ui';
import { NOTIFICATION_CATEGORIES, type NotificationPreferenceKey, type NotificationPreferences } from '@/lib/notifications';

function DemoRequests() {
  const store = usePreview();
  const [open, setOpen] = useState(false);
  const [matching, setMatching] = useState<string | null>(null);
  const [match, setMatch] = useState('');
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [budget, setBudget] = useState(50);
  const [dates, setDates] = useState({ start: '', end: '' });
  const [location, setLocation] = useState('Irving, TX');
  const rows = store.requests.filter((r) => `${r.title} ${r.location}`.toLowerCase().includes(q.toLowerCase()));
  const linked = matching ? store.requestMatches[matching] ?? [] : [];
  return <main className="p1-container p1-page"><PageHead title="Good plans need good gear." description="Can’t find the thing you need? Ask the community. Owners can link an available rental, without private offers or counteroffers." action={<Button onClick={() => setOpen(true)}><Plus size={17} aria-hidden="true" /> Post a request</Button>} />
    <div className="p1-request-header"><div><h2>Someone nearby might have it.</h2><p>Clear dates and a daily budget help the right gear find you.</p></div><label className="p1-query"><Search size={17} aria-hidden="true" /><input aria-label="Search community requests" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requests or city" /></label></div>
    <div className="p1-community-grid">{rows.map((r) => <article key={r.id}><div className="p1-section-head"><Avatar src={r.avatar} name={r.renter} /><span className="p1-muted">{r.postedAgo}</span></div><h2>{r.title}</h2><p className="p1-muted">{r.when} · {r.location}</p><div className="p1-section-head"><span><b>{money(r.budget)}</b> / day budget</span><Tag tone="blue">{store.requestMatches[r.id]?.length ?? 0} linked rentals</Tag></div><div className="p1-request-person"><span>Requested by {r.renter}</span><Button variant="secondary" onClick={() => { setMatching(r.id); setMatch(''); }}>Have something that fits?</Button></div></article>)}</div>
    {!rows.length && <Empty title="No matching requests." body="Try a different search, or post what you need."><Button onClick={() => setQ('')}>Clear search</Button></Empty>}
    <Modal open={open} onClose={() => setOpen(false)} title="What’s the plan?" description="Tell the community what you need. This request stays in the clickable preview."><form onSubmit={(e) => { e.preventDefault(); store.setRequests((prev) => [{ id: crypto.randomUUID(), title: title.trim(), when: rangeLabel(dates.start, dates.end), location, budget, renter: store.profile.name, avatar: currentUser.avatar, postedAgo: 'Just now', offers: 0 }, ...prev]); store.notify('Request posted. Let’s find your next good thing.', true); setOpen(false); setTitle(''); }}><Field label="What do you need?"><input required minLength={5} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="A projector for an outdoor movie night" /></Field><DateField {...dates} onChange={(start, end) => setDates({ start, end })} label="Requested dates" /><div className="p1-form-two"><Field label="Daily budget ($)"><input required type="number" min={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></Field><Field label="Location"><Dropdown label="Location" value={location} onChange={setLocation} options={['Irving, TX', 'Dallas, TX', 'Plano, TX'].map((city) => ({ value: city, label: city }))} /></Field></div><Button type="submit" disabled={!dates.end}>Post request</Button></form></Modal>
    <Modal open={Boolean(matching)} onClose={() => setMatching(null)} title="Link a rental that fits." description="Share a published rental at its listed price. The renter still chooses dates and follows the regular booking flow."><form onSubmit={(e) => { e.preventDefault(); if (!matching || !match) return; store.setRequestMatches((prev) => ({ ...prev, [matching]: [...new Set([...(prev[matching] ?? []), match])] })); store.notify('Rental linked. That request has a lead.', true); setMatch(''); }}><Field label="Choose an available sample listing"><Dropdown required label="Choose an available sample listing" value={match} onChange={setMatch} placeholder="Choose a listing" options={store.items.filter((l) => l.listingStatus === 'published' && l.available && !linked.includes(l.id)).map((l) => ({ value: l.id, label: `${l.title} · ${money(l.pricePerDay)} / day` }))} /></Field><Button type="submit" disabled={!match}>Link rental</Button></form>{linked.length > 0 && <div className="p1-linked-rentals"><h3>Linked rentals</h3>{linked.map((id) => { const l = store.items.find((x) => x.id === id); return l && <a href={href('listing', id)} key={id} onClick={() => setMatching(null)}><img src={l.images[0]} alt="" /><span>{l.title}<small>{money(l.pricePerDay)} / day</small></span><ArrowRight size={17} aria-hidden="true" /></a>; })}</div>}</Modal>
  </main>;
}

function DemoMessages({ id }: { id?: string }) {
  const store = usePreview();
  const { setThreads } = store;
  const [selected, setSelected] = useState<string | null>(id ?? store.threads[0]?.id ?? null);
  const [mobileThread, setMobileThread] = useState(Boolean(id));
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const thread = store.threads.find((t) => t.id === selected);
  useEffect(() => { if (id) { setSelected(id); setMobileThread(true); } }, [id]);
  useEffect(() => { if (selected) setThreads((prev) => prev.map((t) => t.id === selected && t.unread ? { ...t, unread: 0 } : t)); }, [selected, setThreads]);
  const append = (sender: 'me' | 'them', body: string) => {
    if (!thread) return;
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    store.setThreads((prev) => prev.map((t) => t.id === thread.id ? { ...t, lastMessage: body, lastTime: time, messages: [...t.messages, { id: crypto.randomUUID(), sender, text: body, time }] } : t));
    setText('');
  };
  return <main className="p1-work-page p1-messages-page"><PageHead title="Good rentals start with a hello." description="Make the handoff feel easy. Messages here are local, not sent to anyone." />
    <div className={`p1-inbox ${mobileThread ? 'show-thread' : ''}`}><aside className="p1-thread-list"><label className="p1-query"><Search size={17} aria-hidden="true" /><input aria-label="Search messages" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" /></label>{store.threads.filter((t) => `${t.name} ${t.listingTitle}`.toLowerCase().includes(q.toLowerCase())).map((t) => <button key={t.id} type="button" aria-pressed={selected === t.id} onClick={() => { setSelected(t.id); setMobileThread(true); }}><Avatar src={t.avatar} name={t.name} /><span><b>{t.name}</b><small>{t.listingTitle}</small><span>{t.lastMessage}</span></span><small>{t.unread > 0 ? <Tag tone="blue">{t.unread}</Tag> : t.lastTime}</small></button>)}</aside>
      <section className="p1-thread">{thread ? <><header><button type="button" className="p1-icon p1-mobile-only" aria-label="Back to conversations" onClick={() => setMobileThread(false)}><ChevronLeft size={20} aria-hidden="true" /></button><Avatar src={thread.avatar} name={thread.name} /><div><h2>{thread.name}</h2><p>{thread.listingTitle}</p></div><Tag tone="neutral">Demo chat</Tag></header><div className="p1-thread-item"><img src={thread.listingImage} alt="" /><span>{thread.listingTitle}</span></div><div className="p1-message-history" role="log" aria-label="Conversation messages">{thread.messages.map((m) => <div key={m.id} className={`p1-message p1-message-${m.sender}`}><p>{m.text}</p><small>{m.time}{m.sender === 'me' && <CheckCheck size={12} aria-label="Saved in preview" />}</small></div>)}</div><form className="p1-message-compose" onSubmit={(e) => { e.preventDefault(); if (text.trim()) append('me', text.trim()); }}><input required aria-label="Message" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about pickup, what’s included..." /><Button type="submit" aria-label="Send demo message" disabled={!text.trim()}><Send size={18} aria-hidden="true" /></Button></form><details className="p1-chat-scenario"><summary>Preview a reply</summary><p>Generate a sample reply to inspect both sides of the conversation.</p><Button variant="quiet" onClick={() => append('them', 'That works for me. We can confirm the pickup details here once your booking is confirmed.')}>Add sample reply</Button></details></> : <Empty title="Say hello to a good rental." body="Open an item and message its owner to begin a conversation."><Action to="search">Find an item</Action></Empty>}</section>
    </div>
  </main>;
}

function DemoNotifications() {
  const store = usePreview();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const rows = store.notices.filter((n) => !unreadOnly || !n.read);
  return <main className="p1-work-page"><PageHead title="The useful updates." description="Your rentals, requests and messages. The things worth knowing." action={<Button variant="secondary" onClick={() => store.setNotices((prev) => prev.map((n) => ({ ...n, read: true })))}><CheckCheck size={17} aria-hidden="true" /> Mark all read</Button>} /><div className="p1-tabs p1-space-bottom"><button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All updates</button><button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread ({store.notices.filter((n) => !n.read).length})</button></div>{rows.length ? <div className="p1-notice-list">{rows.map((n) => <article key={n.id} className={!n.read ? 'is-unread' : ''}><Bell size={21} aria-hidden="true" /><a href={href(n.to, n.itemId)} onClick={() => store.setNotices((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x))}><h2>{n.title}</h2><p>{n.body}</p></a>{!n.read && <button type="button" className="p1-icon" aria-label={`Mark "${n.title}" read`} onClick={() => store.setNotices((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x))}><Check size={17} aria-hidden="true" /></button>}</article>)}</div> : <Empty title="All caught up. Nice." body="New sample updates appear when you book, bid or receive a request."><Action to="search" variant="secondary">Find your next plan</Action></Empty>}</main>;
}

function DemoProfile() {
  const store = usePreview();
  const [draft, setDraft] = useState(store.profile);
  const [tab, setTab] = useState('Profile');
  const [saved, setSaved] = useState(false);
  return <main className="p1-work-page"><PageHead title="A little more about you." description="Help the people you rent from and lend to get to know you." /><div className="p1-profile-layout"><aside><Avatar src={currentUser.avatar} name={store.profile.name} size={92} /><h2>{store.profile.name}</h2><p className="p1-muted">Sample member profile</p><Tag tone="blue"><ShieldCheck size={14} aria-hidden="true" />Demo verification badge</Tag><div className="p1-profile-counts"><span><b>{store.bookings.length}</b> sample rentals</span><span><b>{store.saved.length}</b> saved items</span></div></aside><div><div className="p1-tabs p1-space-bottom">{['Profile', 'Notifications', 'Security'].map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>{tab === 'Profile' && <form onSubmit={(e) => { e.preventDefault(); store.setProfile(draft); setSaved(true); store.notify('Profile saved. A little more you.', true); }}><div className="p1-form-two"><Field label="Full name"><input required minLength={2} value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setSaved(false); }} /></Field><Field label="Email"><input required type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field></div><Field label="Phone"><input type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field><Field label="About you"><textarea value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} rows={4} maxLength={500} /></Field><Button type="submit">Save profile</Button>{saved && <p role="status" className="p1-info-copy">Changes saved for this preview session.</p>}</form>}{tab === 'Notifications' && <section><h2>Keep the useful updates.</h2><label className="p1-check"><input type="checkbox" checked={store.profile.updates} onChange={(e) => store.setProfile((p) => ({ ...p, updates: e.target.checked }))} /><span>Rental and community email updates<small>Preference only. No emails are sent in this preview.</small></span></label><Action to="notifications" variant="secondary">View notification center</Action></section>}{tab === 'Security' && <section><h2>Safety isn’t a preview shortcut.</h2><p>Authentication, identity checks and account recovery stay with YBuy’s real security flows. This isolated preview doesn’t collect passwords or verify identities.</p><Button variant="secondary" onClick={() => { store.setSignedIn(false); store.notify('Demo session signed out. Use the header to explore sign-in.'); }}>Sign out of demo</Button></section>}</div></div></main>;
}

  export interface PreviewRequestRow {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    location: string;
    dailyBudget: number | null;
    createdAt: string;
    responseCount: number;
    description: string;
    category: string;
    quantity: number;
    intendedUse: string | null;
    specifications: string | null;
    notes: string | null;
    categoryId: string;
    matchedListings: { id: string; title: string; dailyPrice: number }[];
  }
  export interface PreviewOwnerListing {
    id: string;
    title: string;
    dailyPrice: number;
    categoryId: string;
    quantity: number;
  }
  export interface RequestsBackend {
    rows: PreviewRequestRow[];
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    onManage: () => void;
    postForm: ReactNode;
    ownerListings: PreviewOwnerListing[];
    onLink: (requestId: string, listingId: string) => Promise<void>;
  }

  function BackendRequests({ rows, loading, error, onRetry, onManage, postForm, ownerListings, onLink }: RequestsBackend) {
    const [query, setQuery] = useState('');
    const [posting, setPosting] = useState(false);
    const [offerFor, setOfferFor] = useState<PreviewRequestRow | null>(null);
    const visible = rows.filter((row) => `${row.title} ${row.location}`.toLowerCase().includes(query.trim().toLowerCase()));
    return <main className="p1-container p1-page">
      <PageHead title="Good plans need good gear." description="Can’t find the thing you need? Ask the community. Owners can link an available rental, without private offers or counteroffers."
        action={<div className="p1-actions"><Button variant="secondary" onClick={onManage}>My requests</Button><Button onClick={() => setPosting(true)}><Plus size={17} aria-hidden="true" /> Post a request</Button></div>} />
      <div className="p1-request-header"><div><h2>Someone nearby might have it.</h2><p>Clear dates and a daily budget help the right gear find you.</p></div>
        <label className="p1-query"><Search size={17} aria-hidden="true" /><input aria-label="Search community requests" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requests or city" /></label>
      </div>
      {error && <div role="alert" className="p1-error">{error}<Button variant="secondary" onClick={onRetry}>Try again</Button></div>}
      {loading ? <div className="p1-community-grid" aria-busy="true"><article>Loading community requests…</article></div>
        : visible.length ? <div className="p1-community-grid">{visible.map((row) => <article key={row.id}>
          <div className="p1-section-head"><Avatar src="" name="YBuy member" /><span className="p1-muted">{new Date(row.createdAt).toLocaleDateString()}</span></div>
          <h2>{row.title}</h2><p className="p1-muted">{rangeLabel(row.startDate, row.endDate)} · {row.location}</p>
          <div className="p1-section-head"><span><b>{row.dailyBudget === null ? 'No limit' : money(row.dailyBudget)}</b> / day budget</span><Tag tone="blue">{row.matchedListings.length} matching rentals</Tag></div>
          {row.matchedListings.length > 0 && <div className="p1-linked-rentals">{row.matchedListings.map((listing) =>
            <a href={href('listing', listing.id)} key={listing.id}><span>{listing.title}<small>{money(listing.dailyPrice)} / day</small></span><ArrowRight size={17} aria-hidden="true" /></a>)}</div>}
          <details className="p1-chat-scenario"><summary>Request details</summary><dl className="p1-form-two">
            <div><dt>Category</dt><dd>{row.category}</dd></div><div><dt>Quantity</dt><dd>{row.quantity} requested</dd></div>
            {row.intendedUse && <div><dt>Intended use</dt><dd>{row.intendedUse}</dd></div>}
            {row.specifications && <div><dt>Specifications</dt><dd>{row.specifications}</dd></div>}
            {row.notes && <div><dt>Additional notes</dt><dd>{row.notes}</dd></div>}
          </dl></details>
          <div className="p1-request-person"><span>{row.responseCount} owner responses</span><div className="p1-actions">
            {row.categoryId && ownerListings.some((listing) => listing.categoryId === row.categoryId && listing.quantity >= row.quantity)
              ? <Button variant="secondary" onClick={() => setOfferFor(row)}>Have something that fits?</Button>
              : <Action to="create" variant="secondary">List an item</Action>}
            <Button variant="secondary" onClick={onManage}>My requests</Button>
          </div></div>
        </article>)}</div>
          : <Empty title="No matching requests." body={query ? 'Try a different search, or post what you need.' : 'No community requests are available right now.'}>
            {query && <Button onClick={() => setQuery('')}>Clear search</Button>}
            <Button onClick={() => setPosting(true)}>Post a request</Button>
          </Empty>}
      <Modal open={posting} onClose={() => setPosting(false)} title="What’s the plan?" description="Tell nearby owners what you need, with the dates and details they need to help.">{postForm}</Modal>
      <Modal open={Boolean(offerFor)} onClose={() => setOfferFor(null)} title="Link a rental that fits." description="Share a published rental at its listed price. The renter still chooses dates and follows the regular booking flow.">
        {offerFor && <RequestListingForm key={offerFor.id} request={offerFor} listings={ownerListings} onLink={(listingId) => onLink(offerFor.id, listingId).then(() => setOfferFor(null))} />}
      </Modal>
    </main>;
  }

  function RequestListingForm({ request, listings, onLink }: {
    request: PreviewRequestRow;
    listings: PreviewOwnerListing[];
    onLink: (listingId: string) => Promise<void>;
  }) {
    const eligible = listings.filter((listing) => listing.categoryId === request.categoryId && listing.quantity >= request.quantity
      && (request.dailyBudget === null || listing.dailyPrice <= request.dailyBudget));
    const [listingId, setListingId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        if (!eligible.some((listing) => listing.id === listingId)) throw new Error('Choose a matching published rental.');
        await onLink(listingId);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not link this rental.');
      } finally {
        setBusy(false);
      }
    }
    return <form onSubmit={(event) => void submit(event)}>
      {!eligible.length ? <Empty title="No published listing fits yet." body="You need a published listing in the requested category with enough available quantity." /> : <>
        <Field label="Your matching published rental"><Dropdown required label="Your matching published rental" value={listingId} onChange={setListingId}
          placeholder="Choose a listing" options={eligible.map((listing) => ({ value: listing.id, label: `${listing.title} · ${money(listing.dailyPrice)} / day` }))} /></Field>
        <p className="p1-muted">YBuy checks the requested dates, area, quantity and listed price. Linking does not reserve or book the rental.</p>
      </>}
      {error && <p role="alert" className="p1-error">{error}</p>}
      <div className="p1-actions"><Button variant="quiet" type="button" disabled={busy} onClick={() => setError(null)}>Keep editing</Button>
        {eligible.length > 0 && <Button type="submit" disabled={busy || !listingId}>{busy ? 'Linking rental…' : 'Link rental'}</Button>}
      </div>
    </form>;
  }

  export interface PreviewConversation {
    id: string;
    name: string;
    avatar: string | null;
    listingTitle: string;
    listingImage: string | null;
    lastMessage: string;
    lastTime: string;
  }
  export interface PreviewConversationMessage {
    id: string;
    senderId: string;
    text: string;
    time: string;
  }
  export interface MessagesBackend {
    rows: PreviewConversation[];
    selectedId: string | null;
    messages: PreviewConversationMessage[];
    currentUserId: string;
    loading: boolean;
    loadingMessages: boolean;
    error: string | null;
    sending: boolean;
    onRetry: () => void;
    onSelect: (id: string) => void;
    onBack: () => void;
    onSend: (text: string) => Promise<boolean>;
  }

  function BackendMessages({ rows, selectedId, messages, currentUserId, loading, loadingMessages, error, sending, onRetry, onSelect, onBack, onSend }: MessagesBackend) {
    const [query, setQuery] = useState('');
    const [text, setText] = useState('');
    const [mobileThread, setMobileThread] = useState(Boolean(selectedId));
    const selected = rows.find((row) => row.id === selectedId) ?? null;
    const visible = rows.filter((row) => `${row.name} ${row.listingTitle}`.toLowerCase().includes(query.trim().toLowerCase()));
    useEffect(() => { setMobileThread(Boolean(selectedId)); }, [selectedId]);
    return <main className="p1-work-page p1-messages-page"><PageHead title="Good rentals start with a hello." description="Make the handoff feel easy. Keep pickup plans, questions and returns attached to their rental." />
      {error && <div role="alert" className="p1-error">{error}<Button variant="secondary" onClick={onRetry}>Try again</Button></div>}
      <div className={`p1-inbox ${mobileThread ? 'show-thread' : ''}`}><aside className="p1-thread-list" aria-label="Conversations">
        <label className="p1-query"><Search size={17} aria-hidden="true" /><input aria-label="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" /></label>
        {loading ? <p className="p1-muted" role="status">Loading conversations…</p> : visible.map((row) => <button key={row.id} type="button" aria-pressed={selectedId === row.id} onClick={() => { onSelect(row.id); setMobileThread(true); }}>
          <Avatar src={row.avatar ?? ''} name={row.name} /><span><b>{row.name}</b><small>{row.listingTitle}</small><span>{row.lastMessage || 'No messages yet'}</span></span><small>{new Date(row.lastTime).toLocaleDateString()}</small>
        </button>)}
        {!loading && rows.length === 0 && <p className="p1-muted">No conversations yet.</p>}
        {!loading && rows.length > 0 && visible.length === 0 && <p className="p1-muted">No conversations match that search.</p>}
      </aside>
        <section className="p1-thread" aria-label="Selected conversation">{selected ? <>
          <header><button type="button" className="p1-icon p1-mobile-only" aria-label="Back to conversations" onClick={() => { setMobileThread(false); onBack(); }}><ChevronLeft size={20} aria-hidden="true" /></button>
            <Avatar src={selected.avatar ?? ''} name={selected.name} /><div><h2>{selected.name}</h2><p>{selected.listingTitle}</p></div><Tag tone="neutral">YBuy conversation</Tag>
          </header>
          {selected.listingImage && <div className="p1-thread-item"><img src={selected.listingImage} alt="" /><span>{selected.listingTitle}</span></div>}
          <div className="p1-message-history" role="log" aria-label="Conversation messages" aria-busy={loadingMessages}>
            {loadingMessages ? <p role="status" className="p1-muted">Loading messages…</p> : messages.map((message) => {
              const mine = message.senderId === currentUserId;
              return <div key={message.id} className={`p1-message p1-message-${mine ? 'me' : 'them'}`}><p>{message.text}</p><small>{message.time}</small></div>;
            })}
          </div>
          <form className="p1-message-compose" onSubmit={async (event) => { event.preventDefault(); const body = text.trim(); if (body && await onSend(body)) setText(''); }}>
            <input required aria-label="Message" maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask about pickup, what’s included..." />
            <Button type="submit" aria-label="Send message" disabled={!text.trim() || sending}>{sending ? 'Sending…' : <Send size={18} aria-hidden="true" />}</Button>
          </form>
        </> : <Empty title="Say hello to a good rental." body="Open an item and message its owner to begin a conversation."><Action to="search">Find an item</Action></Empty>}</section>
      </div>
    </main>;
  }

  export interface PreviewNotice {
    id: string;
    title: string;
    body: string;
    read: boolean;
    destination: string;
  }
  export interface NotificationsBackend {
    rows: PreviewNotice[];
    loading: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    busy: string | null;
    error: string | null;
    onRetry: () => void;
    onMark: (id: string) => void;
    onMarkAll: () => void;
    onLoadMore: () => void;
    onOpen: (notice: PreviewNotice) => void;
  }
  function BackendNotifications({ rows, loading, hasMore, loadingMore, busy, error, onRetry, onMark, onMarkAll, onLoadMore, onOpen }: NotificationsBackend) {
    const [unreadOnly, setUnreadOnly] = useState(false);
    const visible = rows.filter((row) => !unreadOnly || !row.read);
    return <main className="p1-work-page"><PageHead title="The useful updates." description="Your rentals, requests and messages. The things worth knowing."
      action={<Button variant="secondary" disabled={busy !== null} onClick={onMarkAll}><CheckCheck size={17} aria-hidden="true" /> Mark all read</Button>} />
      <div className="p1-tabs p1-space-bottom"><button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All updates</button>
        <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread ({rows.filter((row) => !row.read).length})</button></div>
      {error && <div role="alert" className="p1-error">{error}<Button variant="secondary" onClick={onRetry}>Try again</Button></div>}
      {loading ? <p role="status" className="p1-muted">Loading updates…</p> : visible.length ? <div className="p1-notice-list">{visible.map((notice) => <article key={notice.id} className={!notice.read ? 'is-unread' : ''}>
        <Bell size={21} aria-hidden="true" /><a href={href('notifications')} onClick={(event) => { event.preventDefault(); onOpen(notice); }}><h2>{notice.title}</h2><p>{notice.body}</p></a>
        {!notice.read && <button type="button" className="p1-icon" aria-label={`Mark "${notice.title}" read`} disabled={busy !== null} onClick={() => onMark(notice.id)}><Check size={17} aria-hidden="true" /></button>}
      </article>)}</div> : <Empty title="All caught up. Nice." body="New updates will appear here when activity happens on your account."><Action to="search" variant="secondary">Find your next plan</Action></Empty>}
      {!loading && hasMore && <div className="p1-actions"><Button variant="secondary" disabled={loadingMore || busy !== null} onClick={onLoadMore}>{loadingMore ? 'Loading older updates…' : 'Load older updates'}</Button></div>}
    </main>;
  }

  export interface PreviewProfileData {
    id: string;
    name: string;
    email: string;
    phone: string;
    bio: string;
    avatar: string | null;
    joinedYear: number;
    provider: string;
    emailVerified: boolean;
    completedRentals: number | null;
    listingsOwned: number | null;
    savedItems: number | null;
  }
  export interface ProfileBackend {
    profile: PreviewProfileData;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    savingProfile: boolean;
    onSaveProfile: (fullName: string, phone: string, bio: string) => Promise<void>;
    signingOut: boolean;
    onSignOut: () => void;
    preferences: NotificationPreferences | null;
    preferencesError: string | null;
    preferencesLoading: boolean;
    preferenceBusy: string | null;
    onRetryPreferences: () => void;
    onPreferenceChange: (key: NotificationPreferenceKey, enabled: boolean) => void;
  }
  function BackendProfile({ profile, loading, error, onRetry, savingProfile, onSaveProfile, signingOut, onSignOut, preferences, preferencesError, preferencesLoading, preferenceBusy, onRetryPreferences, onPreferenceChange }: ProfileBackend) {
    const [tab, setTab] = useState('Profile');
    const [savedProfile, setSavedProfile] = useState({ name: profile.name, phone: profile.phone, bio: profile.bio });
    const [fullName, setFullName] = useState(profile.name);
    const [phone, setPhone] = useState(profile.phone);
    const [bio, setBio] = useState(profile.bio);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const displayName = savedProfile.name;
    const displayPhone = savedProfile.phone;
    async function saveProfile(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setSaveError(null);
      setSaved(false);
      try {
        await onSaveProfile(fullName, phone, bio);
        setSavedProfile({ name: fullName.trim(), phone: phone.trim(), bio: bio.trim() });
        setFullName(fullName.trim());
        setPhone(phone.trim());
        setBio(bio.trim());
        setSaved(true);
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : 'Could not save your profile.');
      }
    }
    return <main className="p1-work-page"><PageHead title="A little more about you." description="Help the people you rent from and lend to get to know you." />
      {error && <div role="alert" className="p1-error">{error}<Button variant="secondary" onClick={onRetry}>Try again</Button></div>}
      <div className="p1-profile-layout"><aside aria-label="Account identity"><Avatar src={profile.avatar ?? ''} name={displayName} size={92} /><h2>{displayName}</h2>
        <p className="p1-muted">Member since {profile.joinedYear}</p>
        {profile.emailVerified && <Tag tone="good"><ShieldCheck size={14} aria-hidden="true" />Verified email</Tag>}
        <div className="p1-profile-counts" aria-busy={loading}><span><b>{loading ? '—' : profile.completedRentals ?? '—'}</b> completed rentals</span><span><b>{loading ? '—' : profile.savedItems ?? '—'}</b> saved items</span></div>
      </aside><div><div className="p1-tabs p1-space-bottom" aria-label="Account sections">{['Profile', 'Notifications', 'Security'].map((section) =>
        <button key={section} type="button" aria-pressed={tab === section} onClick={() => setTab(section)}>{section}</button>)}</div>
        {tab === 'Profile' && <section><form onSubmit={(event) => void saveProfile(event)}>
          <div className="p1-form-two"><Field label="Full name"><input required minLength={2} maxLength={100} value={fullName} onChange={(event) => { setFullName(event.target.value); setSaved(false); }} /></Field><Field label="Email"><input readOnly type="email" value={profile.email} /></Field></div>
          <Field label="Phone"><input type="tel" maxLength={32} value={phone} onChange={(event) => { setPhone(event.target.value); setSaved(false); }} /></Field>
          <Field label="About you"><textarea value={bio} onChange={(event) => { setBio(event.target.value); setSaved(false); }} rows={4} maxLength={500} /></Field>
          <p className="p1-info-copy">Email changes and verification are managed through your Supabase sign-in provider.</p>
          {saveError && <p role="alert" className="p1-error">{saveError}</p>}
          <Button type="submit" disabled={savingProfile || (fullName.trim() === displayName && phone.trim() === displayPhone && bio.trim() === savedProfile.bio)}>{savingProfile ? 'Saving…' : 'Save profile'}</Button>
          {saved && <p role="status" className="p1-info-copy">Your profile was saved.</p>}
        </form>
          <div className="p1-profile-counts" aria-busy={loading}><span><b>{loading ? '—' : profile.completedRentals ?? '—'}</b> completed rentals</span><span><b>{loading ? '—' : profile.listingsOwned ?? '—'}</b> listings owned</span></div>
        </section>}
        {tab === 'Notifications' && <section><h2>Keep the useful updates.</h2><p>Choose which account updates can reach you.</p>
          <Action to="notifications" variant="secondary">View notification center</Action>
          <details className="p1-chat-scenario"><summary>Notification preferences</summary>
            {preferencesError && <p role="alert" className="p1-error">{preferencesError}<Button variant="secondary" onClick={onRetryPreferences}>Try again</Button></p>}
            {preferencesLoading ? <p role="status" className="p1-muted">Loading preferences…</p> : preferences && <div className="p1-preference-list">
              {NOTIFICATION_CATEGORIES.map((category) => <fieldset key={category.key} className="p1-preference-row"><legend>{category.label}</legend>
                {(['in_app', 'email'] as const).map((channel) => { const key = `${category.key}_${channel}` as NotificationPreferenceKey; return <label className="p1-check" key={key}>
                  <input type="checkbox" checked={preferences[key]} disabled={preferenceBusy === key} onChange={(event) => onPreferenceChange(key, event.target.checked)} />
                  <span>{channel === 'in_app' ? 'In-app updates' : 'Email updates'}</span></label>; })}
              </fieldset>)}
            </div>}
          </details>
        </section>}
        {tab === 'Security' && <section><h2>Safety isn’t a preview shortcut.</h2><p>Authentication and account recovery stay with YBuy’s real security flows.</p>
          <p className="p1-info-copy">Signed in with {profile.provider}. Email {profile.emailVerified ? 'is verified.' : 'is not verified.'}</p>
          <Button variant="secondary" disabled={signingOut} onClick={onSignOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
        </section>}
      </div></div>
    </main>;
  }

  export function Requests({ backend }: { backend?: RequestsBackend } = {}) {
    return backend ? <BackendRequests {...backend} /> : <DemoRequests />;
  }
  export function Messages({ id, backend }: { id?: string; backend?: MessagesBackend } = {}) {
    return backend ? <BackendMessages {...backend} /> : <DemoMessages id={id} />;
  }
  export function Notifications({ backend }: { backend?: NotificationsBackend } = {}) {
    return backend ? <BackendNotifications {...backend} /> : <DemoNotifications />;
  }
  export function Profile({ backend }: { backend?: ProfileBackend } = {}) {
    return backend ? <BackendProfile {...backend} /> : <DemoProfile />;
  }