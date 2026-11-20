import { useState, useRef, useEffect } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchConversations, fetchMessages, sendMessage, subscribeToMessages, MESSAGE_MAX_LENGTH, type UiConversation, type UiMessage } from '@/lib/messages';
import { InputValidationError } from '@/lib/text-safety';
import { ConversationListSkeleton } from '@/main-site/components/skeleton';
import { Alert, EmptyState, SectionHeader, IconButton } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
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
    <div className="messages-page animate-fade-in">
      <div className="messages-page-container">
        {selectedConversationId && <button type="button" onClick={() => navigate({ name: 'messaging' })} className="messages-back md:hidden"><ArrowLeft size={18} aria-hidden="true" /> Messages</button>}
        <SectionHeader
          as="h1"
          title="Messages"
          subtitle="Keep rental conversations and pickup details together."
          className={`messages-page-heading ${selectedConversationId ? 'hidden md:flex' : ''}`}
        />
        <div className={`messages-workspace ${conversations?.length ? 'messages-workspace-ready' : ''} ${selectedConversationId ? 'messages-workspace-selected' : ''} ${conversations?.length ? 'md:grid-cols-[320px_minmax(0,1fr)]' : 'md:grid-cols-1'}`}>
          {/* Conversation list */}
          <section aria-label="Conversation inbox" className={`messages-inbox ${selectedConversationId ? 'hidden md:flex' : 'flex'}`}>
            <header className="messages-inbox-header"><h2>Inbox</h2></header>
            <div className="messages-inbox-scroll">
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
            <ul className="messages-conversation-list animate-cross-fade">
              {conversations?.map((conv) => (
                <li key={conv.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'conversation', id: conv.id })}
                    className="messages-conversation"
                    aria-current={(selectedConversationId ?? conversations[0]?.id) === conv.id ? 'true' : undefined}
                  >
                    <Avatar src={conv.counterpartAvatar} />
                    <span className="messages-conversation-copy">
                      <span className="messages-conversation-topline">
                        <span className="messages-conversation-name">{conv.counterpartName}</span>
                        <time className="messages-conversation-time" dateTime={conv.lastMessageAt}>{timeAgo(conv.lastMessageAt)}</time>
                      </span>
                      {conv.listingTitle && <span className="messages-conversation-listing">{conv.listingTitle}</span>}
                      <span className="messages-conversation-preview">{conv.lastMessage || 'No messages yet'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            </div>
          </section>

          {/* Chat area - desktop */}
          <section aria-label="Conversation" className={`messages-thread ${selectedConversationId ? 'flex' : conversations?.length ? 'hidden md:flex' : 'hidden'}`}>
            {desktopConversationId ? <ChatView convId={desktopConversationId} /> : (
              <div className="messages-thread-empty">
                <div className="messages-thread-empty-content">
                  <span className="grid place-items-center w-12 h-12 rounded-full bg-subtle text-sec mx-auto mb-3">
                    <MessageSquare size={20} aria-hidden="true" />
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
  const scrollRef = useRef<HTMLOListElement>(null);

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' });
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
      {/* Header */}
      <header className="messages-thread-header">
        <Avatar src={conv.counterpartAvatar} />
        <div className="messages-thread-identity">
          <h2>{conv.counterpartName}</h2>
          <p>{conv.listingTitle}</p>
        </div>
      </header>

      {/* Booking context */}
      {conv.listingId && (
        <button type="button"
          onClick={() => navigate({ name: 'listing', id: conv.listingId! })}
          className="messages-listing-context"
        >
          {conv.listingImage && <img src={conv.listingImage} alt="" width="40" height="40" />}
          <span>{conv.listingTitle}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}

      {/* Messages */}
      <ol ref={scrollRef} aria-label="Conversation messages" className="messages-thread-body">
        {messages.length === 0 && (
          <li className="messages-thread-empty-note">
            No messages yet. Say hello and agree on a pickup time.
          </li>
        )}
        {messages.map((msg) => {
          const isMe = msg.senderId === user.id;
          return (
            <li key={msg.id} className={`messages-thread-message ${isMe ? 'is-mine' : ''}`}>
              <div className={`min-w-0 max-w-[85%] sm:max-w-[78%] px-3.5 py-2.5 ${
                isMe
                  ? 'bg-accent text-accent-text rounded-card-lg rounded-br-sm'
                  : 'bg-subtle text-main rounded-card-lg rounded-bl-sm'
              }`}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.body}</p>
                <time dateTime={msg.createdAt} className={`text-[10px] mt-1 ${isMe ? 'opacity-75' : 'text-muted'}`}>{timeAgo(msg.createdAt)}</time>
              </div>
            </li>
          );
        })}
        {notice && (
          <li className="messages-thread-notice">
            <div className="flex items-start gap-2 max-w-md p-3 rounded-card-lg bg-warning-soft">
              <ShieldAlert size={16} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-sec leading-relaxed">{notice}</p>
            </div>
          </li>
        )}
      </ol>

      {/* Composer */}
      <form className="messages-composer" onSubmit={(event) => { event.preventDefault(); void send(); }} aria-label="Send a message" aria-busy={sending}>
        {chatError && <Alert tone="error" className="mb-2">{chatError}</Alert>}
        <div className="messages-composer-row">
          <label htmlFor="message-input" className="sr-only">Write a message</label>
          <input
            id="message-input"
            value={input}
            maxLength={MESSAGE_MAX_LENGTH}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Write a message"
            className={fieldClass('flex-1')}
          />
          <IconButton type="submit" label="Send message" variant="primary" disabled={!input.trim() || sending}>
            {sending ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
          </IconButton>
        </div>
      </form>
    </>
  );
}
