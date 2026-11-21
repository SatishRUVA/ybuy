import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bell, Calendar, CheckCheck, CheckCircle2, ChevronRight, Clock, CreditCard, Gavel, Gift, LifeBuoy,
  Package, Settings, Tag, TrendingUp, Trophy, Users, XCircle,
} from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/main-site/components/ui';
import { Skeleton } from '@/main-site/components/skeleton';
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_CATEGORIES,
  NOTIFICATIONS_CHANGED,
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
import { notificationRoute, RouteLink, useRouter } from '@/router';
import {
  fetchMarketplaceNotifications, markAllMarketplaceNotificationsRead, markMarketplaceNotificationRead,
  type MarketplaceNotification,
} from '@/lib/marketplace';
import { fetchMainItemRequest } from '@/main-site/request-flow';

const PAGE_SIZE = 25;
const MANDATORY: NotificationCategory[] = ['bookings', 'payments', 'cases'];

const CATEGORY_CHIPS: { key: NotificationCategory; label: string; icon: typeof Bell }[] = [
  { key: 'bookings', label: 'Rentals', icon: Calendar },
  { key: 'bidding', label: 'Bids', icon: Gavel },
  { key: 'requests', label: 'Requests', icon: Users },
  { key: 'listings', label: 'Listings', icon: Package },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'cases', label: 'Support', icon: LifeBuoy },
  { key: 'promotions', label: 'Rewards', icon: Gift },
];

const EVENT_ICONS: Record<string, { icon: typeof Bell; tone: string }> = {
  'auction-bid': { icon: Gavel, tone: 'text-accent bg-accent-soft' },
  'auction-bid-accepted': { icon: CheckCircle2, tone: 'text-accent bg-accent-soft' },
  'auction-outbid': { icon: TrendingUp, tone: 'text-error bg-error-soft' },
  'auction-extended': { icon: Clock, tone: 'text-accent bg-accent-soft' },
  'auction-closed': { icon: Gavel, tone: 'text-warning bg-warning-soft' },
  'auction-winner': { icon: Trophy, tone: 'text-accent bg-accent-soft' },
  'auction-not-selected': { icon: XCircle, tone: 'text-muted bg-app' },
  'auction-payment-reminder': { icon: CreditCard, tone: 'text-warning bg-warning-soft' },
};

function iconFor(notification: AppNotification) {
  const event = EVENT_ICONS[notification.event_key?.split(':')[0] ?? ''];
  if (event) return event;
  const chip = CATEGORY_CHIPS.find((item) => item.key === notification.category);
  return { icon: chip?.icon ?? Bell, tone: 'text-accent bg-accent-soft' };
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
  if (Math.abs(seconds) < 60) return 'Just now';
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  return formatter.format(Math.round(seconds / 86400), 'day');
}

function dayGroup(value: string): string {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000;
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  return 'Earlier';
}

function groupByDay<T extends { created_at: string }>(rows: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = dayGroup(row.created_at);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups];
}

function RowBody({ icon: Icon, tone, title, body, createdAt, unread }: {
  icon: typeof Bell; tone: string; title: string; body: string; createdAt: string; unread: boolean;
}) {
  return <>
    <span className={`notif-icon ${tone}`}><Icon size={18} aria-hidden="true" /></span>
    <span className="notif-text">
      <span className="notif-title">{title}{unread && <span className="sr-only"> (unread)</span>}</span>
      <span className="notif-body">{body}</span>
    </span>
    <span className="notif-meta">
      <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>{relativeTime(createdAt)}</time>
      {unread && <span className="notif-dot" aria-hidden="true" />}
    </span>
    <ChevronRight size={16} aria-hidden="true" className="notif-chevron" />
  </>;
}

function Feed<T extends { id: string; created_at: string }>({ rows, render }: { rows: T[]; render: (row: T) => ReactNode }) {
  return <div className="notif-feed">
    {groupByDay(rows).map(([label, items]) => <section key={label} aria-label={label}>
      <h2 className="notif-group-label">{label}</h2>
      <ul className="notif-list">{items.map((row) => <li key={row.id}>{render(row)}</li>)}</ul>
    </section>)}
  </div>;
}

function MarketplaceUpdates({ enabled, refreshKey }: { enabled: boolean; refreshKey: number }) {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [rows, setRows] = useState<MarketplaceNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMarketplaceNotifications(PAGE_SIZE, 0);
      setRows(result);
      setHasMore(result.length === PAGE_SIZE);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load request updates.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) void load();
    else { setRows([]); setLoading(false); }
  }, [enabled, load, refreshKey]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const next = await fetchMarketplaceNotifications(PAGE_SIZE, rows.length);
      setRows((current) => [...current, ...next.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setHasMore(next.length === PAGE_SIZE);
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
        window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      }
      // Requesters manage their request under "mine"; lenders follow their offers under "offers".
      let tab: 'mine' | 'offers' = 'mine';
      if (notification.item_request_id) {
        const request = await fetchMainItemRequest(notification.item_request_id).catch(() => null);
        if (request && request.renter_id !== user?.id) tab = 'offers';
      }
      navigate({ name: 'requests', tab });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this request update.');
      setBusy(null);
    }
  }

  if (!enabled || (!loading && !error && rows.length === 0)) return null;
  return <section aria-labelledby="marketplace-updates-title" className="notif-section">
    <h2 id="marketplace-updates-title" className="notif-section-title">Requests and offers</h2>
    {error && <Alert tone="error" title="Request updates unavailable">
      <p>{error}</p>
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>Try again</Button>
    </Alert>}
    {loading ? <Skeleton className="h-20 w-full" /> : <>
      <Feed rows={rows} render={(notification) => <button
        type="button"
        className="notif-row"
        data-unread={!notification.read_at || undefined}
        aria-busy={busy === notification.id || undefined}
        disabled={busy !== null}
        onClick={() => void openUpdate(notification)}
      >
        <RowBody
          icon={notification.event_type.startsWith('offer') ? Tag : notification.event_type.endsWith('expired') ? Clock : Users}
          tone="text-accent bg-accent-soft"
          title={notification.title}
          body={notification.body}
          createdAt={notification.created_at}
          unread={!notification.read_at}
        />
      </button>} />
      {hasMore && <div className="flex justify-center"><Button variant="ghost" loading={loadingMore} onClick={() => void loadMore()}>Show older</Button></div>}
    </>}
  </section>;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
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
  const [marketplaceKey, setMarketplaceKey] = useState(0);
  const requestsInApp = preferences?.requests_in_app === true;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listNotifications({ limit: PAGE_SIZE, offset: 0, category, read: unreadOnly ? 'unread' : 'all' });
      setRows(result.rows);
      setTotal(result.total);
      setUnreadCount(user?.id ? await unreadNotificationCount(user.id) : 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your notifications.');
    } finally {
      setLoading(false);
    }
  }, [category, unreadOnly, user?.id]);

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
        : `Sent ${result.sent} of ${result.processed} pending emails${result.retrying + result.failed + result.unknown > 0 ? `; ${result.retrying} retrying, ${result.failed} failed, ${result.unknown} unconfirmed` : ''}.`);
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
      const result = await listNotifications({ limit: PAGE_SIZE, offset: rows.length, category, read: unreadOnly ? 'unread' : 'all' });
      setRows((current) => [...current, ...result.rows.filter((row) => !current.some((item) => item.id === row.id))]);
      setTotal(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load more notifications.');
    } finally {
      setLoadingMore(false);
    }
  }

  function markOpened(notification: AppNotification) {
    if (notification.read_at) return;
    // The page unmounts on navigation; a failed read mark only leaves the item unread.
    void markNotificationRead(notification.id)
      .then(() => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)))
      .catch(() => undefined);
  }

  async function markAllRead() {
    setBusy('all');
    setError(null);
    try {
      await Promise.all([
        markAllNotificationsRead(),
        requestsInApp ? markAllMarketplaceNotificationsRead() : Promise.resolve(),
      ]);
      const timestamp = new Date().toISOString();
      setRows((current) => unreadOnly ? [] : current.map((row) => row.read_at ? row : { ...row, read_at: timestamp }));
      setUnreadCount(0);
      setMarketplaceKey((key) => key + 1);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
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

  function openSettings() {
    const details = settingsRef.current;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    details.querySelector('summary')?.focus({ preventScroll: true });
  }

  const filtered = category !== 'all' || unreadOnly;

  return (
    <div className="notif-page">
      <header className="notif-header">
        <div>
          <h1>Notifications</h1>
          <p role="status" aria-live="polite" aria-atomic="true">
            {unreadCount === 0 ? 'You’re all caught up' : `${unreadCount} unread`}
          </p>
        </div>
        <div className="notif-header-actions">
          <Button
            size="sm"
            variant="ghost"
            icon={<CheckCheck size={16} aria-hidden="true" />}
            disabled={unreadCount === 0 || busy === 'all'}
            loading={busy === 'all'}
            onClick={() => void markAllRead()}
          >
            Mark all read
          </Button>
          <button type="button" className="notif-icon-button" aria-label="Notification settings" onClick={openSettings}>
            <Settings size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="notif-toolbar">
        <div className="notif-segmented" role="group" aria-label="Show">
          <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All</button>
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread</button>
        </div>
        <div className="notif-chips" role="group" aria-label="Filter by type">
          <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>Everything</button>
          {CATEGORY_CHIPS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(category === key ? 'all' : key)}>
              <Icon size={14} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="error" title="Notifications unavailable">
        <p>{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>Try again</Button>
      </Alert>}

      {loading ? <div className="notif-list" aria-busy="true" aria-label="Loading notifications">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[72px] w-full" />)}
      </div> : rows.length === 0 && !error ? <div className="notif-empty">
        <span className="notif-empty-icon"><Bell size={22} aria-hidden="true" /></span>
        <p className="notif-empty-title">{unreadOnly ? 'You’re all caught up' : 'Nothing here yet'}</p>
        <p>{filtered ? 'Try a different filter.' : 'Rental, bid, and request updates will show up here.'}</p>
        {filtered && <Button size="sm" variant="secondary" onClick={() => { setCategory('all'); setUnreadOnly(false); }}>Show everything</Button>}
      </div> : <>
        <Feed rows={rows} render={(notification) => {
          const route = notificationRoute(notification.destination);
          const body = <RowBody {...iconFor(notification)} title={notification.title} body={notification.body}
            createdAt={notification.created_at} unread={!notification.read_at} />;
          return route
            ? <RouteLink route={route} className="notif-row" data-unread={!notification.read_at || undefined} onClick={() => markOpened(notification)}>{body}</RouteLink>
            : <div className="notif-row" data-unavailable="">{body}</div>;
        }} />
        {rows.length < total && <div className="flex justify-center">
          <Button variant="ghost" loading={loadingMore} onClick={() => void loadMore()}>Show older</Button>
        </div>}
      </>}

      {!filtered && <MarketplaceUpdates enabled={requestsInApp} refreshKey={marketplaceKey} />}

      <details ref={settingsRef} id="notification-settings" className="notif-settings">
        <summary><Settings size={18} aria-hidden="true" /> Notification settings <ChevronRight size={16} aria-hidden="true" className="notif-settings-chevron" /></summary>
        <div className="notif-settings-body">
          {preferencesError && <Alert tone="error" title="Could not load or save settings">{preferencesError}</Alert>}
          {!preferences ? <Skeleton className="h-40 w-full" /> : <table className="notif-prefs">
            <thead><tr><th scope="col">Update</th><th scope="col">In app</th><th scope="col">Email</th></tr></thead>
            <tbody>{NOTIFICATION_CATEGORIES.map((item) => {
              const required = MANDATORY.includes(item.key);
              return <tr key={item.key}>
                <th scope="row">{item.label}{required && <span className="notif-required">Always on</span>}</th>
                {(['in_app', 'email'] as const).map((channel) => {
                  const key = `${item.key}_${channel}` as NotificationPreferenceKey;
                  return <td key={key}>
                    <input
                      type="checkbox"
                      role="switch"
                      className="notif-switch"
                      checked={preferences[key]}
                      disabled={preferenceBusy !== null || (required && preferences[key])}
                      aria-label={`${item.label}: ${channel === 'in_app' ? 'In app' : 'Email'}`}
                      onChange={(event) => void changePreference(key, event.target.checked)}
                    />
                    {preferenceBusy === key && <span className="sr-only">Saving</span>}
                  </td>;
                })}
              </tr>;
            })}</tbody>
          </table>}
          <div className="notif-email">
            <p>{emailError ? 'Some emails could not be sent.' : emailStatus ?? 'Checking pending emails…'}</p>
            <Button size="sm" variant="ghost" loading={processingEmails} onClick={() => void processEmails()}>
              {emailError ? 'Retry' : 'Send pending'}
            </Button>
          </div>
          {emailError && <Alert tone="error" title="Email processing failed">{emailError}</Alert>}
        </div>
      </details>
    </div>
  );
}