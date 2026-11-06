import { useLayoutEffect, useRef, useState } from 'react';
import { Bell, BellOff, CalendarDays, Check, CheckCheck, CreditCard, Gavel, Gift, Layers, LockKeyhole, MessageSquare, Search, Settings, ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/shadcn/switch';
import { href, usePreview, type Notice } from './state';
import { mandatoryNotice, noticeCategory, previewNotificationCategories, type PreviewNotificationCategory } from './notification-data';
import { Button, Empty, Modal } from './ui';
import './notification-center.css';

const icons = { bookings: CalendarDays, requests: Search, listings: Layers, bidding: Gavel, payments: CreditCard, messages: MessageSquare, safety: ShieldCheck, promotions: Gift };
const inboxCategories = previewNotificationCategories.filter(item => item.key !== 'messages');
const groups = ['Today', 'Yesterday', 'Earlier'] as const;
export interface NotificationCenterRow extends Pick<Notice, 'id' | 'title' | 'body' | 'read' | 'createdAt' | 'category' | 'mandatory'> {
  destination: string;
}
export interface NotificationsBackend {
  rows: NotificationCenterRow[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  busy: string | null;
  error: string | null;
  mutedCategories: PreviewNotificationCategory[];
  preferencesLoading: boolean;
  preferencesError: string | null;
  preferenceBusy: string | null;
  onPreferenceChange: (category: PreviewNotificationCategory, enabled: boolean) => void;
  onRetryPreferences: () => void;
  onRetry: () => void;
  onMark: (ids: string[]) => Promise<boolean>;
  onMarkAll: () => void;
  onLoadMore: () => void;
  onOpen: (notice: NotificationCenterRow) => void;
}
function noticeDay(notice: NotificationCenterRow): typeof groups[number] {
  if (!notice.createdAt) return 'Today';
  const date = new Date(notice.createdAt).toDateString();
  if (date === new Date().toDateString()) return 'Today';
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  return date === yesterday.toDateString() ? 'Yesterday' : 'Earlier';
}

export function PreviewNotificationCenter({ backend }: { backend?: NotificationsBackend } = {}) {
  return backend ? <NotificationCenter {...backend} /> : <DemoNotificationCenter />;
}

function DemoNotificationCenter() {
  const store = usePreview();
  return <NotificationCenter demo rows={store.notices.filter(notice => noticeCategory(notice) !== 'messages').map(notice => ({
    ...notice, category: noticeCategory(notice), mandatory: mandatoryNotice(notice), destination: href(notice.to, notice.itemId),
  }))} loading={false} hasMore={false} loadingMore={false} busy={null} error={null}
    mutedCategories={store.mutedNotificationCategories} preferencesLoading={false} preferencesError={null} preferenceBusy={null}
    onPreferenceChange={(key, enabled) => store.setMutedNotificationCategories(current => enabled ? current.filter(item => item !== key) : [...new Set([...current, key])])}
    onRetryPreferences={() => {}} onRetry={() => {}} onLoadMore={() => {}}
    onMark={async ids => { store.setNotices(current => current.map(row => ids.includes(row.id) ? { ...row, read: true } : row)); return true; }}
    onMarkAll={() => store.setNotices(current => current.map(row => noticeCategory(row) === 'messages' ? row : { ...row, read: true }))}
    onOpen={notice => { store.setNotices(current => current.map(row => row.id === notice.id ? { ...row, read: true } : row)); window.location.hash = notice.destination; }} />;
}

function NotificationCenter({ rows, loading, hasMore, loadingMore, busy, error, mutedCategories, preferencesLoading, preferencesError, preferenceBusy,
  onPreferenceChange, onRetryPreferences, onRetry, onMark, onMarkAll, onLoadMore, onOpen, demo = false }: NotificationsBackend & { demo?: boolean }) {
  const [category, setCategory] = useState<PreviewNotificationCategory | 'all'>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const muteTrigger = useRef<HTMLDivElement>(null);
  const muteMenu = useRef<HTMLElement>(null);
  const [mutePosition, setMutePosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!muteOpen) return;
    const position = () => {
      const trigger = muteTrigger.current?.getBoundingClientRect();
      const menu = muteMenu.current?.getBoundingClientRect();
      if (!trigger || !menu) return;
      setMutePosition({
        top: Math.max(12, Math.min(trigger.bottom + 8, window.innerHeight - menu.height - 12)),
        left: Math.max(12, Math.min(trigger.right - menu.width, window.innerWidth - menu.width - 12)),
      });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [muteOpen]);
  const visible = rows.filter(row => (category === 'all' || row.category === category) && (!unreadOnly || !row.read));
  const unread = rows.filter(row => !row.read).length;
  const selectedVisible = visible.filter(row => selected.includes(row.id));
  const changeCategory = (next: typeof category) => { setCategory(next); setSelected([]); };
  const mark = async (ids: string[]) => {
    if (await onMark(ids)) setSelected([]);
  };
  const setCategoryEnabled = (key: PreviewNotificationCategory, enabled: boolean) => {
    if (previewNotificationCategories.some(item => item.key === key && item.mandatory)) return;
    onPreferenceChange(key, enabled);
  };
  const controls = (prefix: string) => <div className="p1-notification-preferences">{previewNotificationCategories.map(item => {
    const Icon = icons[item.key];
    return <div key={item.key} className="p1-notification-preference">
      <Icon size={17} aria-hidden="true" />
      <label htmlFor={`${prefix}-${item.key}`}><strong>{item.label}</strong><small>{item.mandatory ? 'Mandatory · always on' : item.key === 'bidding' ? 'Winning bids and payment deadlines always on' : item.description}</small></label>
      {item.mandatory && <LockKeyhole size={13} aria-label="Mandatory category" />}
      <Switch id={`${prefix}-${item.key}`} checked={item.mandatory || !mutedCategories.includes(item.key)}
        disabled={item.mandatory || preferencesLoading || Boolean(preferencesError) || preferenceBusy !== null} onCheckedChange={enabled => setCategoryEnabled(item.key, enabled)} />
    </div>;
  })}</div>;
  const renderNotice = (notice: NotificationCenterRow) => {
    const key = notice.category ?? 'promotions', Icon = icons[key], required = notice.mandatory || previewNotificationCategories.some(item => item.key === key && item.mandatory);
    return <article key={notice.id} className={`p1-center-notice ${!notice.read ? 'is-unread' : ''}`}>
      <input type="checkbox" aria-label={`Select ${notice.title}`} checked={selected.includes(notice.id)}
        onChange={event => setSelected(current => event.target.checked ? [...current, notice.id] : current.filter(id => id !== notice.id))} />
      <span className={`p1-notification-icon p1-notification-icon-${key}`}><Icon size={19} aria-hidden="true" /></span>
      <a href={notice.destination} onClick={event => { event.preventDefault(); if (!busy) onOpen(notice); }}><h3>{notice.title}</h3><p>{notice.body}</p>
        <span className="p1-notice-meta">{notice.createdAt && <time dateTime={notice.createdAt}>{new Date(notice.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>}
          {required && <span><LockKeyhole size={11} aria-hidden="true" />Mandatory</span>}</span>
      </a>
      {!notice.read && <button type="button" className="p1-icon" disabled={busy !== null || loadingMore} aria-label={`Mark "${notice.title}" read`} onClick={() => void mark([notice.id])}><Check size={17} aria-hidden="true" /></button>}
    </article>;
  };
  return <main className="p1-work-page p1-notification-center">
    <header className="p1-notification-heading"><span className="p1-notification-heading-icon"><Bell size={27} aria-hidden="true" /></span><div><h1>Notifications</h1><p>Your rentals, requests and important account updates.</p></div></header>
    <nav className="p1-notification-tabs" aria-label="Notification categories">
      <button type="button" aria-pressed={category === 'all'} onClick={() => changeCategory('all')}>All updates <span>{rows.length}</span></button>
      {inboxCategories.map(item => <button key={item.key} type="button" aria-pressed={category === item.key} onClick={() => changeCategory(item.key)}>
        {item.label}{mutedCategories.includes(item.key) && <BellOff size={12} aria-label="Optional alerts muted" />}<span>{rows.filter(row => row.category === item.key).length}</span>
      </button>)}
    </nav>
    <div className="p1-notification-layout"><section aria-label="Notification inbox">
      <div className="p1-notification-toolbar">
        <label className="p1-check"><input type="checkbox" aria-label="Select all visible notifications" checked={visible.length > 0 && selectedVisible.length === visible.length}
          ref={element => { if (element) element.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length; }}
          onChange={event => setSelected(event.target.checked ? visible.map(row => row.id) : [])} />Select all</label>
        <button type="button" className="p1-text-link" aria-pressed={unreadOnly} onClick={() => { setUnreadOnly(value => !value); setSelected([]); }}>Unread ({unread})</button>
        <Button variant="secondary" disabled={busy !== null || loading || loadingMore || (!selectedVisible.length && !unread && !hasMore)} onClick={() => { if (selectedVisible.length) void mark(selectedVisible.map(row => row.id)); else onMarkAll(); }}>
          <CheckCheck size={15} aria-hidden="true" />{selectedVisible.length ? `Mark ${selectedVisible.length} read` : 'Mark all read'}</Button>
        <div className="p1-notification-mute" ref={muteTrigger} onKeyDown={event => {
          if (event.key === 'Escape') { setMuteOpen(false); event.currentTarget.querySelector('button')?.focus(); }
        }}>
          <Button variant="secondary" aria-expanded={muteOpen} aria-controls="preview-mute-categories" onClick={() => setMuteOpen(value => !value)}><BellOff size={15} aria-hidden="true" />Mute by category</Button>
          {muteOpen && <><button type="button" className="p1-notification-dismiss" aria-label="Close category mute menu" onClick={() => setMuteOpen(false)} />
            <section id="preview-mute-categories" ref={muteMenu} style={mutePosition} className="p1-notification-mute-menu" aria-label="Mute by category">
              <h2>Choose optional alerts</h2>{controls('menu')}<p>Mandatory alerts cannot be muted.</p><Button variant="quiet" onClick={() => setMuteOpen(false)}>Done</Button>
            </section></>}
        </div>
      </div>
      <p className="p1-notification-caption">{demo ? 'Sample updates for design approval. Muting stops new optional alerts in this preview; existing updates stay in your inbox.' : 'Category controls manage new optional in-app alerts. Existing updates stay in your inbox. Email preferences are available in Profile & settings.'}{hasMore && ' Counts reflect loaded updates; load older updates to see more.'}</p>
      {error && <div role="alert" className="p1-error">{error}<Button variant="secondary" onClick={onRetry}>Try again</Button></div>}
      {loading ? <p role="status">Loading updates...</p> : visible.length ? groups.map(group => {
        const notices = visible.filter(row => noticeDay(row) === group);
        if (!notices.length) return null;
        return <section className="p1-notification-day" key={group} aria-label={`${group} notifications`}><h2>{group}<span>{notices.length}</span></h2>
          {group === 'Earlier' ? <div className="p1-notification-archive">{inboxCategories.map(item => {
            const matches = notices.filter(row => row.category === item.key), Icon = icons[item.key];
            return matches.length > 0 && <details key={item.key}><summary><Icon size={19} aria-hidden="true" /><span><b>{item.label}</b><small>{item.description}</small></span><span>{matches.length}</span></summary>{matches.map(renderNotice)}</details>;
          })}</div> : <div className="p1-center-notice-list">{notices.map(renderNotice)}</div>}
        </section>;
      }) : error ? null : <Empty title="All caught up. Nice." body="No updates match this view. Try all updates or another category."><Button onClick={() => { changeCategory('all'); setUnreadOnly(false); }}>View all updates</Button></Empty>}
      {!loading && hasMore && <Button variant="secondary" disabled={loadingMore || busy !== null} onClick={onLoadMore}>{loadingMore ? 'Loading older updates...' : 'Load older updates'}</Button>}
    </section>
    <aside className="p1-notification-settings" aria-label="Notification settings">
      <button type="button" className="p1-notification-settings-link" onClick={() => setSettings(true)}><Settings size={19} aria-hidden="true" /><span><b>Notification settings</b><small>Choose the optional updates you receive.</small></span></button>
      <section><h2>Category notifications</h2>{preferencesLoading && <p role="status">Loading preferences...</p>}{preferencesError && <div role="alert" className="p1-error">{preferencesError}<Button variant="secondary" onClick={onRetryPreferences}>Try again</Button></div>}{controls('sidebar')}</section>
      <section className="p1-notification-required"><LockKeyhole size={18} aria-hidden="true" /><h2>Important updates stay on</h2><p>Bookings, payments, safety and support are mandatory. Winning bids and payment deadlines also reach you even when other bid activity is muted.</p></section>
      {mutedCategories.length > 0 && <section><h2><BellOff size={16} aria-hidden="true" />Muted optional categories</h2><p>{previewNotificationCategories.filter(item => mutedCategories.includes(item.key)).map(item => item.label).join(', ')}</p><Button variant="quiet" onClick={() => setSettings(true)}>Manage preferences</Button></section>}
    </aside></div>
    <Modal open={settings} onClose={() => setSettings(false)} title="Notification settings" description={demo ? 'Preview preferences only. Mandatory notifications always stay on.' : 'Choose optional in-app alerts. Mandatory notifications always stay on.'} footer={<Button onClick={() => setSettings(false)}>Done</Button>}>
      {preferencesError && <p role="alert" className="p1-error">{preferencesError}</p>}
      {controls('settings')}<p className="p1-notification-caption">{demo ? 'Changes last for this preview session. No real emails or notifications are sent.' : 'Preferences are saved to your account. Email preferences can be managed in Profile & settings.'}</p>
    </Modal>
  </main>;
}
