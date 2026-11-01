import { useState, useRef, useEffect } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchConversations, fetchMessages, sendMessage, subscribeToMessages, MESSAGE_MAX_LENGTH, type UiConversation, type UiMessage } from '@/lib/messages';
import { InputValidationError } from '@/lib/text-safety';
import { ConversationListSkeleton } from '@/components/skeleton';
import { Alert, EmptyState, IconButton, Button } from '@/components/ui';
import { WorkspaceHeader } from '@/components/account-workspace';
import { ListingPhoto } from '@/components/listing-card';
import { ArrowLeft, Send, Search, ShieldAlert, ChevronRight, MessageSquare, User, Loader2 } from 'lucide-react';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function MessagingPage({ selectedConversationId }: { selectedConversationId?: string } = {}) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<UiConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError(null);
    fetchConversations(user.id)
      .then((rows) => { if (!cancelled) setConversations(rows); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load conversations.'); });
    return () => { cancelled = true; };
  }, [user, attempt]);

  if (!user) return null;
  const desktopConversationId = selectedConversationId ?? conversations?.[0]?.id;
  const visibleConversations = conversations?.filter(conversation =>
    `${conversation.counterpartName} ${conversation.listingTitle ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="p1-work-page p1-messages-page p1-account">
      <div>
        <WorkspaceHeader title="Good rentals start with a hello." description="Make the handoff feel easy. Keep pickup plans, questions and returns attached to their rental."
          action={<Button variant="secondary" onClick={() => navigate({ name: 'dashboard', tab: 'renting' })}>View my rentals</Button>} />
        <div className={`p1-inbox ${selectedConversationId ? 'show-thread' : ''} ${!conversations?.length && !selectedConversationId ? 'account-inbox-empty' : ''}`}>
          <aside aria-label="Conversations" className="p1-thread-list">
            <label className="p1-query"><Search size={17} aria-hidden="true" />
              <input id="conversation-search" aria-label="Search conversations" placeholder="Search conversations" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} />
            </label>
            {error && <Alert tone="warning">{error}<Button variant="secondary" size="sm" className="mt-2" onClick={() => setAttempt(value => value + 1)}>Try again</Button></Alert>}
            {!error && conversations === null && <ConversationListSkeleton count={5} />}
            {!error && conversations?.length === 0 && (
              <EmptyState
                className="p1-empty account-empty"
                icon={<MessageSquare size={20} />}
                title="No conversations yet"
                description="Messaging opens up when you request a rental or contact an owner from a listing."
                actionLabel="Browse rentals"
                onAction={() => navigate({ name: 'search' })}
              />
            )}
              {visibleConversations?.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => navigate({ name: 'conversation', id: conv.id })}
                  type="button"
                  aria-pressed={desktopConversationId === conv.id}
                >
                  <Avatar src={conv.counterpartAvatar} />
                  <span><b>{conv.counterpartName}</b>
                    {conv.listingTitle && <small>{conv.listingTitle}</small>}
                    <span>{conv.lastMessage || 'No messages yet'}</span>
                  </span>
                  <small>{timeAgo(conv.lastMessageAt)}</small>
                </button>
              ))}
            {query && visibleConversations?.length === 0 && <div className="py-6"><p className="text-sm text-sec">No conversations match that search.</p><Button size="sm" variant="secondary" className="mt-3" onClick={() => setQuery('')}>Clear search</Button></div>}
          </aside>

          <section aria-label="Selected conversation" className={`p1-thread ${!desktopConversationId ? 'account-thread-empty' : ''}`}>
            {desktopConversationId ? <ChatView convId={desktopConversationId} /> : (
              <div className="flex-1 grid place-items-center text-center px-8">
                <div>
                  <span className="grid place-items-center w-12 h-12 rounded-full bg-subtle text-sec mx-auto mb-3">
                    <MessageSquare size={20} />
                  </span>
                  <p className="font-semibold text-main">Pick a conversation</p>
                  <p className="text-sm text-sec mt-1">Messages about a rental stay attached to that listing.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function ConversationPage({ id }: { id: string }) {
  return <MessagingPage selectedConversationId={id} />;
}

function Avatar({ src }: { src: string | null }) {
  return src
    ? <img src={src} alt="" className="p1-avatar" />
    : <span className="p1-avatar account-chat-avatar" aria-hidden="true"><User size={19} /></span>;
}

function ChatView({ convId }: { convId: string }) {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [conv, setConv] = useState<UiConversation | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setConv(null);
    setMessages([]);
    setNotice(null);
    setChatError(null);
    fetchConversations(user.id)
      .then((rows) => {
        if (cancelled) return;
        const conversation = rows.find((row) => row.id === convId);
        if (conversation) setConv(conversation);
        else setChatError('Conversation not found.');
      })
      .catch(() => { if (!cancelled) setChatError('Could not load this conversation.'); });
    fetchMessages(convId)
      .then((rows) => { if (!cancelled) setMessages(rows); })
      .catch(() => { if (!cancelled) setChatError('Could not load messages.'); });
    const unsubscribe = subscribeToMessages(convId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [convId, user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [messages]);

  if (!user) return null;
  if (chatError && !conv) return <div className="flex-1 p-4"><Alert tone="error">{chatError}</Alert></div>;
  if (!conv) return <div className="flex-1 flex items-center justify-center text-sec text-sm">Loading…</div>;

  const send = async () => {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setChatError(null);
    try {
      const sent = await sendMessage(convId, user.id, body);
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setInput((current) => current.trim() === body ? '' : current);
      setNotice(/zelle|venmo|cash app/i.test(body) ? 'Stay protected - keep payment and communication inside the platform.' : null);
    } catch (err) {
      setChatError(err instanceof InputValidationError ? err.message : 'Message not sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <header>
        <button type="button" className="p1-icon p1-mobile-only" aria-label="Back to conversations" onClick={() => navigate({ name: 'messaging' })}><ArrowLeft size={20} aria-hidden="true" /></button>
        <Avatar src={conv.counterpartAvatar} />
        <div className="flex-1 min-w-0">
          <h2 className="truncate">{conv.counterpartName}</h2>
          <p className="truncate">{conv.listingTitle}</p>
        </div>
      </header>

      {/* Booking context */}
      {conv.listingId && (
        <button
          onClick={() => navigate({ name: 'listing', id: conv.listingId! })}
          type="button"
          className="p1-thread-item account-thread-item"
        >
          {conv.listingImage && <span className="account-thread-photo"><ListingPhoto src={conv.listingImage} alt="" /></span>}
          <span className="flex-1 min-w-0 truncate">{conv.listingTitle}</span>
          <ChevronRight size={16} className="text-muted" />
        </button>
      )}

      {/* Messages */}
      <div ref={scrollRef} role="log" aria-label="Conversation messages" aria-live="polite" className="p1-message-history">
        {messages.length === 0 && (
          <p className="text-center text-sm text-sec py-8">
            No messages yet. Say hello and agree on a pickup time.
          </p>
        )}
        {messages.map((msg) => {
          const isMe = msg.senderId === user.id;
          return (
            <div key={msg.id} className={`p1-message p1-message-${isMe ? 'me' : 'them'}`}>
                <p className="whitespace-pre-wrap">{msg.body}</p>
                <small><time dateTime={msg.createdAt} title={new Date(msg.createdAt).toLocaleString()}>{timeAgo(msg.createdAt)}</time></small>
            </div>
          );
        })}
        {notice && (
          <div className="flex justify-center pt-2">
            <div className="flex items-start gap-2 max-w-md p-3 rounded-card-lg bg-warning-soft">
              <ShieldAlert size={16} className="text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-sec leading-relaxed">{notice}</p>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div>
        {chatError && <Alert tone="error" className="mb-2">{chatError}</Alert>}
        <form className="p1-message-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
          <label htmlFor="message-input" className="sr-only">Write a message</label>
          <input
            id="message-input"
            value={input}
            maxLength={MESSAGE_MAX_LENGTH}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Write a message"
          />
          <IconButton label="Send message" variant="primary" type="submit" disabled={!input.trim() || sending}>
            {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </IconButton>
        </form>
      </div>
    </>
  );
}
