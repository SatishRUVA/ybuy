import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Mail, Settings, CheckCircle2, Clock, CreditCard, Gavel, Trophy, TrendingUp, XCircle } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/components/ui';
import { Card, CardContent } from '@/components/shadcn/card';
import { Skeleton } from '@/components/skeleton';
import { Dropdown } from '@/components/shadcn/select';
import { WorkspaceHeader } from '@/components/account-workspace';
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
import { notificationRoute, useRouter } from '@/router';
import {
  fetchMarketplaceNotifications, markAllMarketplaceNotificationsRead, markMarketplaceNotificationRead,
  type MarketplaceNotification,
} from '@/lib/marketplace';

const PAGE_SIZE = 25;
function NotificationIcon({ notification }: { notification: AppNotification }) {
  const event = notification.event_key?.split(':')[0];
  const styles: Record<string, { icon: typeof Bell; tone: string }> = {
    'auction-bid': { icon: Gavel, tone: 'text-accent bg-accent-soft' },
    'auction-bid-accepted': { icon: CheckCircle2, tone: 'text-accent bg-accent-soft' },
    'auction-outbid': { icon: TrendingUp, tone: 'text-error bg-error-soft' },
    'auction-extended': { icon: Clock, tone: 'text-accent bg-accent-soft' },
    'auction-closed': { icon: Gavel, tone: 'text-warning bg-warning-soft' },
    'auction-winner': { icon: Trophy, tone: 'text-accent bg-accent-soft' },
    'auction-not-selected': { icon: XCircle, tone: 'text-muted bg-app' },
    'auction-payment-reminder': { icon: CreditCard, tone: 'text-warning bg-warning-soft' },
  };
  const style = styles[event ?? '']
    ?? { icon: notification.title === 'Booking confirmed' ? CheckCircle2 : Bell, tone: 'text-accent bg-accent-soft' };
  const Icon = style.icon;
  return <span className={`flex h-10 w-10 shrink-0 items-center justify-center ${style.tone.split(' ')[0]}`}>
    <Icon size={20} aria-hidden="true" />
  </span>;
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

function MarketplaceUpdates({ enabled }: { enabled: boolean }) {
  const { navigate } = useRouter();
  const [rows, setRows] = useState<MarketplaceNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMarketplaceNotifications(pageSize, 0);
      setRows(result);
      setHasMore(result.length === pageSize);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load request updates.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) void load();
    else { setRows([]); setLoading(false); }
  }, [enabled, load]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const next = await fetchMarketplaceNotifications(pageSize, rows.length);
      setRows((current) => [...current, ...next.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setHasMore(next.length === pageSize);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load more request updates.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function openUpdate(notification: MarketplaceNotification) {
    setBusy(notification.id);
    setError(null);
    try {
      if (!notification.read_at) {
        await markMarketplaceNotificationRead(notification.id);
        setRows((current) => current.map((item) => item.id === notification.id
          ? { ...item, read_at: new Date().toISOString() } : item));
      }
      navigate({ name: 'requests', tab: 'mine' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this request update.');
    } finally {
      setBusy(null);
    }
  }

  async function markAllRead() {
    setBusy('all');
    setError(null);
    try {
      await markAllMarketplaceNotificationsRead();
      const timestamp = new Date().toISOString();
      setRows((current) => current.map((item) => item.read_at ? item : { ...item, read_at: timestamp }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not mark request updates as read.');
    } finally {
      setBusy(null);
    }
  }

  if (!enabled) return null;
  const unread = rows.filter((row) => !row.read_at).length;
  return <section aria-labelledby="marketplace-updates-title" className="space-y-3">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 id="marketplace-updates-title" className="text-lg font-semibold text-main">Community request updates</h2>
        <p className="text-xs text-sec">{unread} unread update{unread === 1 ? '' : 's'}</p></div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
        <Button size="sm" variant="secondary" disabled={unread === 0 || busy !== null} loading={busy === 'all'} onClick={() => void markAllRead()}>Mark updates read</Button>
      </div>
    </header>
    {error && <Alert tone="error" title="Request updates unavailable">{error}</Alert>}
    {loading ? <div className="space-y-3" aria-busy="true">{[0, 1].map((index) => <Skeleton key={index} className="h-24 w-full" />)}</div>
      : rows.length === 0 ? <Card><CardContent className="p-5 text-sm text-sec">No community request updates yet.</CardContent></Card>
        : <div className="space-y-3">{rows.map((notification) => <Card key={notification.id}>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2">
              {!notification.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
              <h3 className="font-semibold text-main">{notification.title}</h3>
              {!notification.read_at && <span className="text-xs font-medium text-accent">Unread</span>}
            </div><p className="mt-1 text-sm text-sec">{notification.body}</p>
              <time className="mt-2 block text-xs text-muted" dateTime={notification.created_at}>{relativeTime(notification.created_at)}</time>
            </div>
            <Button size="sm" variant="secondary" className="shrink-0" loading={busy === notification.id} onClick={() => void openUpdate(notification)}>View update</Button>
          </CardContent>
        </Card>)}
          {hasMore && <div className="flex justify-center"><Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>Load more updates</Button></div>}
        </div>}
  </section>;
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
  const [section, setSection] = useState<'updates' | 'preferences'>('updates');

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
    <div className="p1-work-page p1-account"><div>
      <WorkspaceHeader title="The useful updates." description="Your rentals, requests and messages. The things worth knowing." action={
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
      } />
      <p className="text-sm text-sec mb-5" role="status" aria-live="polite" aria-atomic="true">{unreadCount} unread notification{unreadCount === 1 ? '' : 's'}</p>
      <div className="p1-tabs p1-space-bottom" aria-label="Notification sections">
        <button type="button" aria-pressed={section === 'updates' && readFilter === 'all'} onClick={() => { setSection('updates'); setReadFilter('all'); }}>All updates</button>
        <button type="button" aria-pressed={section === 'updates' && readFilter === 'unread'} onClick={() => { setSection('updates'); setReadFilter('unread'); }}>Unread ({unreadCount})</button>
        <button type="button" aria-pressed={section === 'preferences'} onClick={() => setSection('preferences')}>Preferences & email</button>
      </div>

      {error && <Alert tone="error" title="Notifications unavailable">
        <p>{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>Try again</Button>
      </Alert>}

      <div hidden={section !== 'updates'} className="space-y-6">
      <details>
        <summary>Filter updates</summary>
        <div className="p1-form-two">
          <label className="p1-field">
            Category
            <Dropdown aria-label="Category" value={category} onChange={setCategory} options={[
              { value: 'all', label: 'All categories' },
              ...NOTIFICATION_CATEGORIES.map((item) => ({ value: item.key, label: item.label })),
            ]} />
          </label>
          <label className="p1-field">
            Read status
            <Dropdown aria-label="Read status" value={readFilter} onChange={setReadFilter} options={[
              { value: 'all', label: 'All notifications' }, { value: 'unread', label: 'Unread' }, { value: 'read', label: 'Read' },
            ]} />
          </label>
        </div>
      </details>

      <section aria-label="Notification history" className="space-y-3">
        {loading ? <div className="space-y-3" aria-busy="true" aria-label="Loading notifications">
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28 w-full" />)}
        </div> : rows.length === 0 ? <div className="p1-empty">
          <Bell size={24} className="text-muted" aria-hidden="true" />
          <h2>{readFilter === 'unread' ? 'All caught up. Nice.' : 'No notifications yet'}</h2>
          <p>Auction, booking, message, request, and case updates will appear here.</p>
          <Button variant="secondary" onClick={() => navigate({ name: 'search' })}>Find your next plan</Button>
        </div> : <div className="p1-notice-list">
          {rows.map((notification) => <article key={notification.id} className={notification.read_at ? '' : 'is-unread'}>
                <NotificationIcon notification={notification} />
                <div className="account-notice-body">
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
          </article>)}
          {rows.length < total && <div className="flex justify-center">
            <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>Load more</Button>
          </div>}
        </div>}
      </section>

      <MarketplaceUpdates enabled={preferences?.requests_in_app === true} />
      </div>

      <div hidden={section !== 'preferences'} className="space-y-6">
      <section aria-labelledby="notification-preferences-title" className="p1-panel account-panel space-y-3">
        <div>
          <h2 id="notification-preferences-title" className="flex items-center gap-2 text-lg font-semibold text-main">
            <Settings size={18} aria-hidden="true" /> Notification preferences
          </h2>
          <p className="mt-1 text-sm text-sec">Choose in-app and email updates independently. Promotional updates are off by default.</p>
        </div>
        {preferencesError && <Alert tone="error" title="Could not load or save preferences">{preferencesError}</Alert>}
        {!preferences ? <Skeleton className="h-40 w-full" /> : <Card>
          <CardContent className="divide-y divide-app p-0">
            <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2 px-4 py-3 text-xs font-semibold text-sec">
              <span>Updates</span><span className="text-center">In app</span><span className="text-center">Email</span>
            </div>
            {NOTIFICATION_CATEGORIES.map((item) => <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-2 px-4 py-3">
              <span className="text-sm font-medium text-main">{item.label}</span>
              {(['in_app', 'email'] as const).map((channel) => {
                const key = `${item.key}_${channel}` as NotificationPreferenceKey;
                const channelLabel = channel === 'in_app' ? 'In-app' : 'Email';
                const mandatory = ['bookings', 'payments', 'cases'].includes(item.key);
                return <label key={key} className="flex min-h-11 items-center justify-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-accent"
                    checked={mandatory || preferences[key]}
                    disabled={mandatory || preferenceBusy !== null}
                    aria-label={`${item.label}: ${channelLabel}${mandatory ? ' (mandatory)' : ''}`}
                    onChange={(event) => void changePreference(key, event.target.checked)}
                  />
                  {preferenceBusy === key && <span className="sr-only">Saving</span>}
                </label>;
              })}
            </div>)}
          </CardContent>
        </Card>}
      </section>

      <section aria-labelledby="email-delivery-title" className="p1-panel account-panel space-y-2">
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
    </div></div>
  );
}
