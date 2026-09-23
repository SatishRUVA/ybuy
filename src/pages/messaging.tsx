import { useState, useRef, useEffect } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { fetchConversations, fetchMessages, sendMessage, subscribeToMessages, type UiConversation, type UiMessage } from '@/lib/messages';
import { ConversationListSkeleton } from '@/components/skeleton';
import { ArrowLeft, Send, ShieldAlert, ChevronRight } from 'lucide-react';

const FALLBACK_AVATAR = 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function MessagingPage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<UiConversation[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-main font-display mb-4">Messages</h1>
        <div className="grid md:grid-cols-3 gap-4 h-[600px]">
          {/* Conversation list */}
          <div className="md:col-span-1 space-y-2 overflow-y-auto">
            {error && <p className="text-sm text-error p-3">{error}</p>}
            {!error && conversations === null && <ConversationListSkeleton count={5} />}
            {!error && conversations?.length === 0 && <p className="text-sm text-sec p-3">No conversations yet.</p>}
            <div className="space-y-2 animate-cross-fade">
            {conversations?.map((conv) => (
              <button
                key={conv.id}
                onClick={() => { setSelectedId(conv.id); navigate({ name: 'conversation', id: conv.id }); }}
                className={`w-full flex items-center gap-3 p-3 rounded-card-xl border transition-colors text-left ${
                  selectedId === conv.id ? 'bg-accent-soft border-accent' : 'bg-card border-app hover:bg-subtle'
                }`}
              >
                <img src={conv.counterpartAvatar ?? FALLBACK_AVATAR} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-main truncate">{conv.counterpartName}</span>
                    <span className="text-xs text-muted shrink-0">{timeAgo(conv.lastMessageAt)}</span>
                  </div>
                  <p className="text-xs text-sec truncate mt-0.5">{conv.lastMessage || 'Say hello!'}</p>
                </div>
              </button>
            ))}
            </div>
          </div>

          {/* Chat area - desktop */}
          <div className="hidden md:flex md:col-span-2 flex-col bg-card border border-app rounded-card-xl overflow-hidden">
            {selectedId ? <ChatView convId={selectedId} /> : (
              <div className="flex-1 flex items-center justify-center text-sec text-sm">
                Select a conversation to start messaging
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConversationPage({ id }: { id: string }) {
  const { back } = useRouter();

  return (
    <div className="animate-fade-in pb-20 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <button onClick={back} className="flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main transition-colors md:hidden">
          <ArrowLeft size={18} /> Back
        </button>
        <div className="flex flex-col bg-card border border-app rounded-card-xl overflow-hidden h-[600px]">
          <ChatView convId={id} />
        </div>
      </div>
    </div>
  );
}

function ChatView({ convId }: { convId: string }) {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [conv, setConv] = useState<UiConversation | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setConv(null);
    setMessages([]);
    setNotice(null);
    fetchConversations(user.id).then((rows) => { if (!cancelled) setConv(rows.find((c) => c.id === convId) ?? null); });
    fetchMessages(convId).then((rows) => { if (!cancelled) setMessages(rows); });
    const unsubscribe = subscribeToMessages(convId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [convId, user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  if (!user) return null;
  if (!conv) return <div className="flex-1 flex items-center justify-center text-sec text-sm">Loading…</div>;

  const send = async () => {
    const body = input.trim();
    if (!body) return;
    setInput('');
    setNotice(/zelle|venmo|cash app/i.test(body) ? 'Stay protected — keep payment and communication inside the platform.' : null);
    const sent = await sendMessage(convId, user.id, body);
    setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-app">
        <img src={conv.counterpartAvatar ?? FALLBACK_AVATAR} alt="" className="w-10 h-10 rounded-full object-cover" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-main">{conv.counterpartName}</p>
          <p className="text-xs text-sec truncate">{conv.listingTitle}</p>
        </div>
      </div>

      {/* Booking context */}
      {conv.listingId && (
        <button
          onClick={() => navigate({ name: 'listing', id: conv.listingId! })}
          className="flex items-center gap-3 p-2.5 bg-subtle border-b border-app text-left"
        >
          {conv.listingImage && <img src={conv.listingImage} alt="" className="w-10 h-10 rounded-card object-cover shrink-0" />}
          <p className="flex-1 min-w-0 text-xs font-medium text-main truncate">{conv.listingTitle}</p>
          <ChevronRight size={16} className="text-muted" />
        </button>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => {
          const isMe = msg.senderId === user.id;
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] px-3.5 py-2 rounded-card-lg ${isMe ? 'bg-accent text-accent-text' : 'bg-subtle text-main'}`}>
                <p className="text-sm">{msg.body}</p>
                <p className={`text-[10px] mt-0.5 ${isMe ? 'text-accent-text/60' : 'text-muted'}`}>{timeAgo(msg.createdAt)}</p>
              </div>
            </div>
          );
        })}
        {notice && (
          <div className="flex justify-center">
            <div className="flex items-start gap-2 max-w-md p-3 rounded-card-lg bg-warning-soft border border-app">
              <ShieldAlert size={16} className="text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-sec">{notice}</p>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-app">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 rounded-card-lg bg-subtle border border-app text-sm text-main outline-none focus:border-accent"
          />
          <button onClick={send} className="p-2.5 rounded-card-lg bg-accent text-accent-text hover:opacity-90 transition-opacity">
            <Send size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
