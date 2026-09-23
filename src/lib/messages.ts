import { supabase } from '@/lib/supabase';

interface DbProfileLite {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

interface DbConversationListing {
  id: string;
  title: string;
  listing_images: { url: string; sort_order: number }[];
}

interface DbConversationRow {
  id: string;
  listing_id: string | null;
  booking_id: string | null;
  participant_one: string;
  participant_two: string;
  created_at: string;
  listing: DbConversationListing | null;
  participant_one_profile: DbProfileLite;
  participant_two_profile: DbProfileLite;
}

const CONVERSATION_SELECT = `
  *,
  listing:listings(id, title, listing_images(url, sort_order)),
  participant_one_profile:profiles!participant_one(id, full_name, avatar_url),
  participant_two_profile:profiles!participant_two(id, full_name, avatar_url)
`;

export interface UiConversation {
  id: string;
  listingId: string | null;
  listingTitle: string;
  listingImage: string | null;
  counterpartId: string;
  counterpartName: string;
  counterpartAvatar: string | null;
  lastMessage: string;
  lastMessageAt: string;
}

export interface UiMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

function toUiConversation(row: DbConversationRow, currentUserId: string): UiConversation {
  const isOne = row.participant_one === currentUserId;
  const counterpart = isOne ? row.participant_two_profile : row.participant_one_profile;
  const sortedImages = [...(row.listing?.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listing?.title ?? 'Direct message',
    listingImage: sortedImages[0]?.url ?? null,
    counterpartId: counterpart?.id ?? (isOne ? row.participant_two : row.participant_one),
    counterpartName: counterpart?.full_name ?? 'User',
    counterpartAvatar: counterpart?.avatar_url ?? null,
    lastMessage: '',
    lastMessageAt: row.created_at,
  };
}

function toUiMessage(row: { id: string; conversation_id: string; sender_id: string; body: string; created_at: string }): UiMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

/** Lists a user's conversations with the latest message preview, newest activity first. */
export async function fetchConversations(currentUserId: string): Promise<UiConversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .or(`participant_one.eq.${currentUserId},participant_two.eq.${currentUserId}`);
  if (error) throw error;
  const conversations = (data ?? []).map((row) => toUiConversation(row as unknown as DbConversationRow, currentUserId));
  if (conversations.length === 0) return [];

  const { data: recentMessages, error: msgError } = await supabase
    .from('messages')
    .select('conversation_id, body, created_at')
    .in('conversation_id', conversations.map((c) => c.id))
    .order('created_at', { ascending: false });
  if (msgError) throw msgError;

  const latestByConversation = new Map<string, { body: string; created_at: string }>();
  for (const msg of recentMessages ?? []) {
    if (!latestByConversation.has(msg.conversation_id)) {
      latestByConversation.set(msg.conversation_id, msg);
    }
  }

  return conversations
    .map((c) => {
      const latest = latestByConversation.get(c.id);
      return latest ? { ...c, lastMessage: latest.body, lastMessageAt: latest.created_at } : c;
    })
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
}

export async function fetchMessages(conversationId: string): Promise<UiMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toUiMessage);
}

export async function sendMessage(conversationId: string, senderId: string, body: string): Promise<UiMessage> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body })
    .select('*')
    .single();
  if (error) throw error;
  return toUiMessage(data);
}

/** Finds an existing conversation between the two users for this listing, or creates one. */
export async function getOrCreateConversation(params: {
  currentUserId: string;
  otherUserId: string;
  listingId?: string;
  bookingId?: string;
}): Promise<string> {
  const { currentUserId, otherUserId, listingId, bookingId } = params;
  let query = supabase
    .from('conversations')
    .select('id')
    .or(
      `and(participant_one.eq.${currentUserId},participant_two.eq.${otherUserId}),and(participant_one.eq.${otherUserId},participant_two.eq.${currentUserId})`,
    )
    .limit(1);
  if (listingId) query = query.eq('listing_id', listingId);
  const { data: existing, error: findError } = await query;
  if (findError) throw findError;
  if (existing && existing.length > 0) return existing[0].id;

  const { data: created, error: insertError } = await supabase
    .from('conversations')
    .insert({
      listing_id: listingId ?? null,
      booking_id: bookingId ?? null,
      participant_one: currentUserId,
      participant_two: otherUserId,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;
  return created.id;
}

/** Subscribes to new messages in a conversation; returns an unsubscribe function. */
export function subscribeToMessages(conversationId: string, onInsert: (message: UiMessage) => void): () => void {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(toUiMessage(payload.new as never)),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
