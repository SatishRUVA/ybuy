import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Mail, Settings } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/components/ui';
import { Card, CardContent } from '@/components/shadcn/card';
import { Skeleton } from '@/components/skeleton';
import { fieldClass } from '@/components/form-classes';
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_CATEGORIES,
  processPendingNotificationEmails,
  setNotificationPreference,
  subscribeToNotifications,
  unreadNotificationCount,
  type AppNotification,
  type NotificationCategory,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useRouter, type Route } from '@/router';

const PAGE_SIZE = 25;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function notificationRoute(destination: string): Route | null {
  if (destination === '/dashboard') return { name: 'dashboard' };
  if (destination === '/requests') return { name: 'requests' };
  if (destination === '/bidding') return { name: 'bidding' };
  if (destination === '/profile') return { name: 'trust-profile' };
  const booking = new RegExp(`^/confirmation/(${UUID})$`, 'i').exec(destination);
  if (booking) return { name: 'confirmation', id: booking[1] };
  const conversation = new RegExp(`^/messages/(${UUID})$`, 'i').exec(destination);
  if (conversation) return { name: 'conversation', id: conversation[1] };
  const support = new RegExp(`^/support/(${UUID})$`, 'i').exec(destination);
  if (support) return { name: 'support', id: support[1] };
  const claim = new RegExp(`^/claims/(${UUID})$`, 'i').exec(destination);
  if (claim) return { name: 'claim-detail', id: claim[1] };
  return null;
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  return formatter.format(Math.round(seconds / 86400), 'day');
}

export function NotificationsPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');
  const [readFilter, setReadFilter] = useState<'all' | 'read' | 'unread'>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [preferenceBusy, setPreferenceBusy] = useState<NotificationPreferenceKey | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [processingEmails, setProcessingEmails] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listNotifications({
        limit: PAGE_SIZE,
        offset: 0,
        category,
        read: readFilter,
      });
      setRows(result.rows);
      setTotal(result.total);
      setUnreadCount(user?.id ? await unreadNotificationCount(user.id) : 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your notifications.');
    } finally {
      setLoading(false);
    }
  }, [category, readFilter, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void load();
    let active = true;
    setPreferences(null);
    setPreferencesError(null);
    getNotificationPreferences()
      .then((result) => { if (active) setPreferences(result); })
      .catch((reason: unknown) => {
        if (active) setPreferencesError(reason instanceof Error ? reason.message : 'Could not load notification preferences.');
      });
    const channel = subscribeToNotifications(user.id, () => { void load(); });
    const fallback = window.setInterval(() => { void load(); }, 45_000);
    return () => {
      active = false;
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, load]);

  const processEmails = useCallback(async () => {
    setProcessingEmails(true);
    setEmailError(null);
    setEmailStatus(null);
    try {
      const result = await processPendingNotificationEmails();
      setEmailStatus(result.processed === 0
        ? 'No pending emails.'
        : `Processed ${result.processed}; accepted by Resend: ${result.sent}; retrying: ${result.retrying}; failed: ${result.failed}; outcome unknown: ${result.unknown}.`);
    } catch (reason) {
      setEmailError(reason instanceof Error ? reason.message : 'Could not process pending email notifications.');
    } finally {
      setProcessingEmails(false);
    }
  }, []);

  useEffect(() => {
    if (user?.id) void processEmails();
  }, [user?.id, processEmails]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const result = await listNotifications({
        limit: PAGE_SIZE,
        offset: rows.length,
        category,
        read: readFilter,
      });
      setRows((current) => [...current, ...result.rows.filter((row) => !current.some((item) => item.id === row.id))]);
      setTotal(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load more notifications.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function openNotification(notification: AppNotification) {
    const route = notificationRoute(notification.destination);
    if (!route) {
      setError('This notification destination is unavailable.');
      return;
    }
    setBusy(notification.id);
    setError(null);
    try {
      if (!notification.read_at) {
        await markNotificationRead(notification.id);
        setRows((current) => current.map((row) => row.id === notification.id
          ? { ...row, read_at: new Date().toISOString() }
          : row));
        setUnreadCount((count) => Math.max(0, count - 1));
      }
      navigate(route);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this notification.');
    } finally {
      setBusy(null);
    }
  }

  async function markAllRead() {
    setBusy('all');
    setError(null);
    try {
      await markAllNotificationsRead();
      const timestamp = new Date().toISOString();
      setRows((current) => current.map((row) => row.read_at ? row : { ...row, read_at: timestamp }));
      setUnreadCount(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not mark notifications as read.');
    } finally {
      setBusy(null);
    }
  }

  async function changePreference(key: NotificationPreferenceKey, enabled: boolean) {
    if (!user?.id) return;
    setPreferenceBusy(key);
    setPreferencesError(null);
    try {
      await setNotificationPreference(user.id, key, enabled);
      setPreferences((current) => current ? { ...current, [key]: enabled } : current);
    } catch (reason) {
      setPreferencesError(reason instanceof Error ? reason.message : 'Could not save notification preferences.');
    } finally {
      setPreferenceBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-main">
            <Bell size={22} aria-hidden="true" /> Notifications
          </h1>
          <p className="mt-1 text-sm text-sec" role="status" aria-live="polite" aria-atomic="true">
            {unreadCount} unread notification{unreadCount === 1 ? '' : 's'}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<CheckCheck size={16} aria-hidden="true" />}
          disabled={unreadCount === 0 || busy === 'all'}
          loading={busy === 'all'}
          onClick={() => void markAllRead()}
        >
          Mark all read
        </Button>
      </header>

      {error && <Alert tone="error" title="Notifications unavailable">
        <p>{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>Try again</Button>
      </Alert>}

      <section aria-label="Notification history" className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-main">
            Category
            <select className={fieldClass()} value={category} onChange={(event) => setCategory(event.target.value as NotificationCategory | 'all')}>
              <option value="all">All categories</option>
              {NOTIFICATION_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-main">
            Read status
            <select className={fieldClass()} value={readFilter} onChange={(event) => setReadFilter(event.target.value as typeof readFilter)}>
              <option value="all">All notifications</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
            </select>
          </label>
        </div>

        {loading ? <div className="space-y-3" aria-busy="true" aria-label="Loading notifications">
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28 w-full" />)}
        </div> : rows.length === 0 ? <Card><CardContent className="flex flex-col items-center gap-2 p-8 text-center">
          <Bell size={24} className="text-muted" aria-hidden="true" />
          <p className="font-semibold text-main">No notifications yet</p>
          <p className="text-sm text-sec">Booking, message, request, and case updates will appear here.</p>
        </CardContent></Card> : <div className="space-y-3">
          {rows.map((notification) => <Card key={notification.id}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {!notification.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                  <h2 className="font-semibold text-main">{notification.title}</h2>
                  {!notification.read_at && <span className="text-xs font-medium text-accent">Unread</span>}
                </div>
                <p className="mt-1 text-sm text-sec">{notification.body}</p>
                <time className="mt-2 block text-xs text-muted" dateTime={notification.created_at} title={new Date(notification.created_at).toLocaleString()}>
                  {relativeTime(notification.created_at)}
                </time>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                loading={busy === notification.id}
                onClick={() => void openNotification(notification)}
              >
                View update
              </Button>
            </CardContent>
          </Card>)}
          {rows.length < total && <div className="flex justify-center">
            <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>Load more</Button>
          </div>}
        </div>}
      </section>

      <section aria-labelledby="notification-preferences-title" className="space-y-3">
        <div>
          <h2 id="notification-preferences-title" className="flex items-center gap-2 text-lg font-semibold text-main">
            <Settings size={18} aria-hidden="true" /> Notification preferences
          </h2>
          <p className="mt-1 text-sm text-sec">Choose in-app and email updates independently. Promotional updates are off by default.</p>
        </div>
        {preferencesError && <Alert tone="error" title="Could not load or save preferences">{preferencesError}</Alert>}
        {!preferences ? <Skeleton className="h-40 w-full" /> : <Card>
          <CardContent className="divide-y divide-app p-0">
            <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-sec">
              <span>Updates</span><span className="text-center">In app</span><span className="text-center">Email</span>
            </div>
            {NOTIFICATION_CATEGORIES.map((item) => <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-2 px-4 py-3">
              <span className="text-sm font-medium text-main">{item.label}</span>
              {(['in_app', 'email'] as const).map((channel) => {
                const key = `${item.key}_${channel}` as NotificationPreferenceKey;
                const channelLabel = channel === 'in_app' ? 'In-app' : 'Email';
                return <label key={key} className="flex min-h-11 items-center justify-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-accent"
                    checked={preferences[key]}
                    disabled={preferenceBusy !== null}
                    aria-label={`${item.label}: ${channelLabel}`}
                    onChange={(event) => void changePreference(key, event.target.checked)}
                  />
                  {preferenceBusy === key && <span className="sr-only">Saving</span>}
                </label>;
              })}
            </div>)}
          </CardContent>
        </Card>}
      </section>

      <section aria-labelledby="email-delivery-title" className="space-y-2">
        <h2 id="email-delivery-title" className="flex items-center gap-2 text-lg font-semibold text-main">
          <Mail size={18} aria-hidden="true" /> Email delivery
        </h2>
        <p className="text-sm text-sec">Pending email jobs are retried safely. Resend acceptance is not proof of delivery.</p>
        {emailStatus && <p className="text-sm text-sec" role="status">{emailStatus}</p>}
        {emailError && <Alert tone="error" title="Email processing failed">
          <p>{emailError}</p>
          <Button size="sm" variant="secondary" className="mt-2" loading={processingEmails} onClick={() => void processEmails()}>
            Retry processing
          </Button>
        </Alert>}
        {!emailError && <Button size="sm" variant="secondary" loading={processingEmails} onClick={() => void processEmails()}>
          Process pending email
        </Button>}
      </section>
    </div>
  );
}
