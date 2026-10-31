import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Send } from 'lucide-react';
import { conversations, type Conversation, type Message } from '@/data';
import { Avatar, Btn, Chip, Photo, Shell, Title } from '../ui';

export function MessagesScreen() {
  const [threads, setThreads] = useState<Conversation[]>(conversations.map((c) => ({ ...c, messages: [...c.messages] })));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const active = threads.find((t) => t.id === activeId) ?? null;

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [active?.messages.length, activeId]);

  const open = (id: string) => { setActiveId(id); setThreads((list) => list.map((t) => (t.id === id ? { ...t, unread: 0 } : t))); };
  const send = (text: string) => {
    const clean = text.trim();
    if (!clean || !active) return;
    const message: Message = { id: `s${Date.now()}`, sender: 'me', text: clean, time: 'now' };
    setThreads((list) => list.map((t) => (t.id === active.id ? { ...t, messages: [...t.messages, message], lastMessage: clean, lastTime: 'now' } : t)));
    setDraft('');
  };

  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <Title>Messages</Title>
      <div className="mt-8 grid min-h-[34rem] gap-4 lg:grid-cols-[22rem_1fr]">
        <ul className={`space-y-2 ${active ? 'hidden lg:block' : ''}`} aria-label="Conversations">
          {threads.map((t) => (
            <li key={t.id}><button type="button" onClick={() => open(t.id)} aria-current={t.id === activeId} className={`flex w-full items-center gap-3 rounded-[1.5rem] p-4 text-left ${t.id === activeId ? 'bg-[var(--ink)] text-white' : 'bg-card hover:bg-subtle'}`}>
              <Avatar src={t.avatar} name={t.name} size={48} />
              <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className="font-display font-bold">{t.name}</span><span className={`text-xs ${t.id === activeId ? 'text-white/70' : 'text-sec'}`}>{t.lastTime}</span></span><span className={`block truncate text-sm ${t.id === activeId ? 'text-white/80' : 'text-sec'}`}>{t.lastMessage}</span></span>
              {t.unread > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-xs font-bold text-white">{t.unread}</span>}
            </button></li>
          ))}
        </ul>
        <section className={`flex flex-col overflow-hidden rounded-[1.75rem] bg-card ${active ? '' : 'hidden lg:flex'}`} aria-label="Conversation">
          {!active ? (
            <div className="grid flex-1 place-items-center p-10 text-center"><div><p className="font-editorial text-4xl leading-none">Pick a conversation</p><p className="mt-2 text-sec">Messages stay inside YBuy so you’re protected.</p></div></div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-app p-4">
                <button type="button" onClick={() => setActiveId(null)} aria-label="Back to conversations" className="grid h-11 w-11 place-items-center rounded-full hover:bg-subtle lg:hidden"><ChevronLeft size={20} aria-hidden="true" /></button>
                <Avatar src={active.avatar} name={active.name} size={44} /><div className="min-w-0 flex-1"><p className="font-display font-bold">{active.name}</p><p className="truncate text-sm text-sec">{active.listingTitle}</p></div>
                <Photo src={active.listingImage} className="h-12 w-12 rounded-[0.8rem]" />
              </header>
              <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6" style={{ maxHeight: '28rem' }}>
                {active.messages.map((m) => m.sender === 'system'
                  ? <p key={m.id} className="mx-auto max-w-sm rounded-[1rem] bg-subtle px-4 py-2 text-center text-xs text-sec">{m.text}</p>
                  : <div key={m.id} className={`flex ${m.sender === 'me' ? 'justify-end' : ''}`}><p className={`max-w-[80%] rounded-[1.25rem] px-4 py-2.5 ${m.sender === 'me' ? 'bg-[var(--accent)] text-white' : 'bg-subtle'}`}>{m.text}<span className={`mt-0.5 block text-[11px] ${m.sender === 'me' ? 'text-white/70' : 'text-sec'}`}>{m.time}</span></p></div>)}
                <div ref={endRef} />
              </div>
              <div className="border-t border-app p-3">
                <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar">{['Is it still available?', 'Can I pick up earlier?', 'Thank you!'].map((q) => <Chip key={q} onClick={() => send(q)} className="!h-9 !bg-subtle">{q}</Chip>)}</div>
                <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
                  <label className="min-w-0 flex-1"><span className="sr-only">Message</span><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" className="h-12 w-full rounded-full bg-subtle px-5 outline-none focus:ring-2 focus:ring-[var(--accent)]" /></label>
                  <Btn type="submit" aria-label="Send message" disabled={!draft.trim()} className="!px-0 w-12"><Send size={18} aria-hidden="true" /></Btn>
                </form>
              </div>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}

const NOTES = [
  { id: 'n1', group: 'Today', title: 'Alex approved your request', body: 'Sony A7 IV · Aug 28–29. Pick up at 2 PM.', unread: true },
  { id: 'n2', group: 'Today', title: 'You were outbid', body: 'Pioneer DDJ-1000 is now $68/day. Bid again?', unread: true },
  { id: 'n3', group: 'Today', title: 'New offer on your request', body: 'Priya can lend a projector for $35/day.', unread: true },
  { id: 'n4', group: 'Earlier', title: 'Payment received', body: '$170 for Sep 1–3 is on its way to your bank.', unread: false },
  { id: 'n5', group: 'Earlier', title: 'Leave a review', body: 'How was the DeWalt drill kit?', unread: false },
];

export function NotificationsScreen() {
  const [items, setItems] = useState(NOTES);
  const unread = items.filter((n) => n.unread).length;
  return (
    <Shell className="pb-20 pt-6 sm:pt-10">
      <Title action={<Btn tone="soft" disabled={!unread} onClick={() => setItems((l) => l.map((n) => ({ ...n, unread: false })))}>Mark all read</Btn>}>Notifications</Title>
      <div className="mt-8 max-w-3xl space-y-8">
        {['Today', 'Earlier'].map((group) => (
          <section key={group} aria-label={group}><h2 className="text-sm font-bold text-sec">{group}</h2>
            <ul className="mt-3 space-y-2">{items.filter((n) => n.group === group).map((n) => (
              <li key={n.id}><button type="button" onClick={() => setItems((l) => l.map((x) => (x.id === n.id ? { ...x, unread: false } : x)))} className="flex w-full items-start gap-4 rounded-[1.5rem] bg-card p-5 text-left hover:bg-subtle"><span aria-hidden="true" className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${n.unread ? 'bg-[var(--accent)]' : 'bg-transparent'}`} /><span><span className="block font-display font-bold">{n.title}{n.unread && <span className="sr-only"> (unread)</span>}</span><span className="text-sec">{n.body}</span></span></button></li>
            ))}</ul></section>
        ))}
      </div>
    </Shell>
  );
}
