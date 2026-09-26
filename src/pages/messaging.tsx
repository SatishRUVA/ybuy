import { useState, useRef, useEffect } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchConversations, fetchMessages, sendMessage, subscribeToMessages, type UiConversation, type UiMessage } from '@/lib/messages';
import { ConversationListSkeleton } from '@/components/skeleton';
import { Alert, EmptyState, SectionHeader, IconButton } from '@/components/ui';
import { ArrowLeft, Send, ShieldAlert, ChevronRight, MessageSquare, User, Loader2 } from 'lucide-react';

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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError(null);
    fetchConversations(user.id)
      .then((rows) => { if (!cancelled) setConversations(rows); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load conversations.'); });
    return () => { cancelled = true; };
  }, [user]);

  if (!user) return null;
  const desktopConversationId = selectedConversationId ?? conversations?.[0]?.id;

  return (
    <div className="animate-fade-in pb-20 md:pb-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {selectedConversationId && <button onClick={() => navigate({ name: 'messaging' })} className="md:hidden inline-flex items-center gap-2 min-h-11 text-sm font-medium text-sec hover:text-main mb-2"><ArrowLeft size={18} /> Messages</button>}
        <SectionHeader
          as="h1"
          title="Messages"
          className={`mb-5 ${selectedConversationId ? 'hidden md:flex' : ''}`}
        />
        <div className={`grid ${conversations?.length ? 'md:grid-cols-[320px_minmax(0,1fr)]' : 'md:grid-cols-1'} gap-0 md:gap-4 ${conversations?.length ? 'md:h-[min(38rem,calc(100dvh_-_10rem))] md:min-h-[22rem]' : ''} ${selectedConversationId ? 'h-[calc(100dvh_-_12.5rem_-_env(safe-area-inset-bottom))] min-h-[20rem]' : ''}`}>
          {/* Conversation list */}
          <div className={`${selectedConversationId ? 'hidden md:block' : ''} md:overflow-y-auto no-scrollbar`}>
            {error && <Alert tone="warning">{error}</Alert>}
            {!error && conversations === null && <ConversationListSkeleton count={5} />}
            {!error && conversations?.length === 0 && (
              <EmptyState
                icon={<MessageSquare size={20} />}
                title="No conversations yet"
                description="Messaging opens up when you request a rental or contact an owner from a listing."
                actionLabel="Browse rentals"
                onAction={() => navigate({ name: 'search' })}
              />
            )}
            <div className="divide-y divide-[var(--border)] border-y border-app animate-cross-fade">
              {conversations?.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => navigate({ name: 'conversation', id: conv.id })}
                  className={`w-full flex items-center gap-3 min-h-20 px-2 py-3 text-left transition-colors duration-fast ${
                    (selectedConversationId ?? conversations[0]?.id) === conv.id ? 'bg-subtle' : 'hover:bg-subtle'
                  }`}
                  aria-current={(selectedConversationId ?? conversations[0]?.id) === conv.id ? 'true' : undefined}
                >
                  <Avatar src={conv.counterpartAvatar} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-main truncate">{conv.counterpartName}</span>
                      <span className="text-xs text-muted shrink-0">{timeAgo(conv.lastMessageAt)}</span>
                    </div>
                    {conv.listingTitle && <p className="text-xs text-sec truncate mt-0.5">{conv.listingTitle}</p>}
                    <p className="text-xs text-muted truncate mt-0.5">{conv.lastMessage || 'No messages yet'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Chat area - desktop */}
          <div className={`${selectedConversationId ? 'flex' : conversations?.length ? 'hidden md:flex' : 'hidden'} min-h-0 flex-col bg-card md:border border-app md:rounded-card-lg overflow-hidden`}>
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
          </div>
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
    ? <img src={src} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
    : <span className="grid place-items-center w-11 h-11 rounded-full bg-subtle text-sec shrink-0" aria-hidden="true"><User size={19} /></span>;
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
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
    } catch {
      setChatError('Message not sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-app">
        <Avatar src={conv.counterpartAvatar} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-main truncate">{conv.counterpartName}</p>
          <p className="text-xs text-sec truncate">{conv.listingTitle}</p>
        </div>
      </div>

      {/* Booking context */}
      {conv.listingId && (
        <button
          onClick={() => navigate({ name: 'listing', id: conv.listingId! })}
          className="flex items-center gap-3 px-4 py-2.5 bg-subtle border-b border-app text-left hover:bg-[var(--border)] transition-colors duration-fast"
        >
          {conv.listingImage && <img src={conv.listingImage} alt="" className="w-9 h-9 rounded-card object-cover shrink-0" />}
          <p className="flex-1 min-w-0 text-xs font-semibold text-main truncate">{conv.listingTitle}</p>
          <ChevronRight size={16} className="text-muted" />
        </button>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
        {messages.length === 0 && (
          <p className="text-center text-sm text-sec py-8">
            No messages yet. Say hello and agree on a pickup time.
          </p>
        )}
        {messages.map((msg) => {
          const isMe = msg.senderId === user.id;
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] px-3.5 py-2.5 ${
                isMe
                  ? 'bg-accent text-accent-text rounded-card-lg rounded-br-sm'
                  : 'bg-subtle text-main rounded-card-lg rounded-bl-sm'
              }`}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                <p className={`text-[10px] mt-1 ${isMe ? 'opacity-75' : 'text-muted'}`}>{timeAgo(msg.createdAt)}</p>
              </div>
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
      <div className="shrink-0 p-3 border-t border-app">
        {chatError && <Alert tone="error" className="mb-2">{chatError}</Alert>}
        <div className="flex items-center gap-2">
          <label htmlFor="message-input" className="sr-only">Write a message</label>
          <input
            id="message-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Write a message"
            className="min-w-0 flex-1 h-11 px-3 rounded-card border border-app bg-card text-sm text-main placeholder:text-muted focus:border-accent outline-none transition-colors duration-fast"
          />
          <IconButton label="Send message" variant="primary" onClick={send} disabled={!input.trim() || sending}>
            {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </IconButton>
        </div>
      </div>
    </>
  );
}
