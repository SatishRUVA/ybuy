import { supabase } from '@/lib/supabase';

export type NotificationCategory = 'bookings' | 'messages' | 'requests' | 'listings' | 'bidding' | 'payments' | 'cases' | 'promotions';
export type NotificationChannel = 'in_app' | 'email';
export type NotificationPreferenceKey = `${NotificationCategory}_${NotificationChannel}`;

export interface AppNotification {
  id: string;
  event_key: string;
  category: NotificationCategory;
  title: string;
  body: string;
  destination: string;
  created_at: string;
  read_at: string | null;
}

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

export const NOTIFICATION_CATEGORIES: { key: NotificationCategory; label: string }[] = [
  { key: 'bookings', label: 'Bookings and rentals' },
  { key: 'messages', label: 'Messages' },
  { key: 'requests', label: 'Item requests and offers' },
  { key: 'listings', label: 'Listings' },
  { key: 'bidding', label: 'Offers and bids' },
  { key: 'payments', label: 'Payments and financial updates' },
  { key: 'cases', label: 'Disputes and support' },
  { key: 'promotions', label: 'Promotions and rewards' },
];

export function mandatoryNotification(category: NotificationCategory, eventKey = ''): boolean {
  return ['bookings', 'payments', 'cases'].includes(category)
    || (category === 'bidding' && !/^(auction-bid|auction-bid-accepted|auction-outbid|auction-extended|auction-closed|auction-not-selected):/.test(eventKey));
}

export const NOTIFICATIONS_CHANGED = 'ybuy:notifications-changed';

export async function listNotifications(params: {
  limit: number;
  offset: number;
  category?: NotificationCategory | 'all';
  read?: 'all' | 'read' | 'unread';
}): Promise<{ rows: AppNotification[]; total: number }> {
  let query = supabase.from('notifications')
    .select('id,event_key,category,title,body,destination,created_at,read_at', { count: 'exact' })
    .neq('category', 'messages')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);
  if (params.category && params.category !== 'all') query = query.eq('category', params.category);
  if (params.read === 'read') query = query.not('read_at', 'is', null);
  if (params.read === 'unread') query = query.is('read_at', null);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const [notifications, marketplace] = await Promise.all([supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('category', 'messages')
    .eq('in_app_enabled', true)
    .is('read_at', null),
  supabase.from('marketplace_notifications').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).is('read_at', null)]);
  if (notifications.error) throw new Error(notifications.error.message);
  if (marketplace.error) throw new Error(marketplace.error.message);
  return (notifications.count ?? 0) + (marketplace.count ?? 0);
}

export async function unreadMessageCount(userId: string): Promise<number> {
  const { count, error } = await supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('category', 'messages')
    .is('read_at', null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function markConversationMessagesRead(conversationId: string): Promise<void> {
  const destination = `/messages/${conversationId}`;
  const { data, error } = await supabase.from('notifications')
    .select('id')
    .eq('category', 'messages')
    .eq('destination', destination)
    .eq('in_app_enabled', true)
    .is('read_at', null);
  if (error) throw new Error(error.message);
  await Promise.all((data ?? []).map(({ id }) => markNotificationRead(id)));
  if (data?.length) window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { data, error } = await supabase.from('notification_preferences')
    .select('bookings_in_app,bookings_email,messages_in_app,messages_email,requests_in_app,requests_email,listings_in_app,listings_email,bidding_in_app,bidding_email,payments_in_app,payments_email,cases_in_app,cases_email,promotions_in_app,promotions_email')
    .single();
  if (error) throw new Error(error.message);
  return data as NotificationPreferences;
}

export async function setNotificationPreference(
  userId: string,
  key: NotificationPreferenceKey,
  enabled: boolean,
): Promise<void> {
  const category = NOTIFICATION_CATEGORIES.find(item => key === `${item.key}_in_app` || key === `${item.key}_email`);
  if (!category) throw new Error('Unknown notification preference.');
  if (!enabled && ['bookings', 'payments', 'cases'].includes(category.key)) throw new Error('Mandatory notifications cannot be muted.');
  const { data, error } = await supabase.from('notification_preferences')
    .update({ [key]: enabled })
    .eq('user_id', userId)
    .select('user_id')
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Notification preference was not saved.');
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_persistent_notification_read', { p_notification_id: id });
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_all_notifications_read');
  if (error) throw new Error(error.message);
}

export function subscribeToNotifications(userId: string, onChange: () => void) {
  return supabase.channel(`notifications:${userId}:${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, onChange)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'marketplace_notifications',
      filter: `user_id=eq.${userId}`,
    }, onChange)
    .subscribe();
}

export async function processPendingNotificationEmails(): Promise<{ processed: number; sent: number; retrying: number; failed: number; unknown: number }> {
  const { data, error } = await supabase.functions.invoke('send-notification-emails', { body: {} });
  if (error) {
    const context = 'context' in error ? error.context : null;
    if (context instanceof Response) {
      const payload: unknown = await context.clone().json().catch(() => null);
      if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string') {
        throw new Error(payload.error);
      }
    }
    throw new Error(error.message);
  }
  if (!data || typeof data.processed !== 'number') {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Email processing returned an invalid response.');
  }
  return data;
}
