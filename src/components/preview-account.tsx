import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth-context';
import { Alert, EmptyState } from '@/components/ui';
import { fetchFavoriteListingIds } from '@/lib/favorites';
import { fetchBookingsAsRenter } from '@/lib/bookings';
import {
  fetchConversations,
  fetchMessages,
  sendMessage,
  subscribeToMessages,
  MESSAGE_MAX_LENGTH,
  type UiConversation,
  type UiMessage,
} from '@/lib/messages';
import {
  fetchOpenItemRequests,
  fetchRequestListingMatches,
  fetchMyOwnerListings,
  listRequestCategories,
  createItemRequest,
  linkItemRequestListing,
  fetchMarketplaceNotifications,
  markMarketplaceNotificationRead,
  markAllMarketplaceNotificationsRead,
  type MarketplaceNotification,
} from '@/lib/marketplace';
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markConversationMessagesRead,
  setNotificationPreference,
  subscribeToNotifications,
  mandatoryNotification,
  NOTIFICATIONS_CHANGED,
  type AppNotification,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '@/lib/notifications';
import { previewNotificationCategories, type PreviewNotificationCategory } from '@/preview-1/notification-data';
import { authProviderLabel } from '@/lib/auth-providers';
import { updateOwnAccountProfile } from '@/lib/account-profile';
import { findCities, locationLabel, addDaysIso, todayIso, type MarketplaceLocation } from '@/lib/geo';
import { searchListings, toUiListing } from '@/lib/listings';
import type { Listing } from '@/data';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { supabase } from '@/lib/supabase';
import { notificationRoute, useRouter } from '@/router';
import { RequestsPage } from '@/pages/requests';
import {
  Messages as MessagesTemplate,
  Notifications as NotificationsTemplate,
  Profile as ProfileTemplate,
  Requests as RequestsTemplate,
  type PreviewConversation,
  type PreviewConversationMessage,
  type PreviewNotice,
  type PreviewProfileData,
  type PreviewRequestRow,
  type PreviewOwnerListing,
} from '@/preview-1/account';
import { DateField } from '@/preview-1/dates';
import { Button, Dropdown, Field, Modal, PageHead } from '@/preview-1/ui';

const PAGE_SIZE = 25;

export function PreviewRequests({ initialTab = 'browse' }: { initialTab?: 'browse' | 'mine' | 'offers' } = {}) {
  const { user, openSignIn } = useAuth();
  const userId = user?.id;
  const { enabled, loading: flagLoading, error: flagError, reload: reloadFlag } = useFeatureFlag('item_requests');
  const [rows, setRows] = useState<PreviewRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [manage, setManage] = useState(initialTab !== 'browse');
  const [managementTab, setManagementTab] = useState<'browse' | 'mine'>('mine');
  const [ownerListings, setOwnerListings] = useState<PreviewOwnerListing[]>([]);

  useEffect(() => { setManage(initialTab !== 'browse'); }, [initialTab]);

  useEffect(() => {
    let active = true;
    if (!userId || !enabled) {
      setRows([]);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    Promise.all([
      fetchOpenItemRequests({ page: 0, pageSize: PAGE_SIZE, sort: 'newest' }),
      fetchMyOwnerListings(userId),
    ])
      .then(async ([result, myListings]) => {
        const ids = result.rows.map((request) => request.id);
         const matches = await fetchRequestListingMatches(ids);
        if (!active) return;
        setOwnerListings(myListings.map((listing) => ({
          id: listing.id, title: listing.title, dailyPrice: listing.price_per_day,
          categoryId: listing.category_id, quantity: listing.available_quantity,
        })));
        setRows(result.rows.map((request) => ({
          id: request.id,
          title: request.title,
          startDate: request.preferred_start_date,
          endDate: request.preferred_end_date,
          location: request.location_label,
          dailyBudget: request.max_daily_budget,
          createdAt: request.created_at,
          description: request.description,
          category: request.categories?.name ?? 'Item',
          quantity: request.requested_quantity,
          intendedUse: request.intended_use,
          specifications: request.specifications,
          notes: request.additional_notes,
          categoryId: request.category_id,
           matchedListings: (matches[request.id] ?? []).map((listing) => ({
            id: listing.id,
            title: listing.title,
            dailyPrice: listing.price_per_day,
          })),
        })));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load community requests.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, enabled, attempt]);

  const retry = () => {
    setAttempt((value) => value + 1);
    reloadFlag();
  };
  if (!user) return <div className="p1-work-page"><EmptyState title="Sign in to find or request an item" description="Community requests are available to signed-in YBuy members." actionLabel="Sign in" onAction={openSignIn} /></div>;
  if (flagError) return <div className="p1-work-page"><EmptyState title="Could not load request settings" description={flagError} actionLabel="Try again" onAction={retry} /></div>;
  if (flagLoading) return <div className="p1-work-page" aria-busy="true"><p role="status">Loading request settings…</p></div>;
  if (!enabled) return <div className="p1-work-page"><EmptyState title="Item requests are not enabled yet" description="An authorized administrator can enable the item_requests feature flag after the backend migration is installed." /></div>;

  return <>
    <RequestsTemplate backend={{
      rows, loading, error, onRetry: retry,
      onManage: () => { setManagementTab('mine'); setManage(true); },
      ownerListings,
      onLink: async (requestId, listingId) => {
        await linkItemRequestListing(requestId, listingId);
        setAttempt((value) => value + 1);
      },
      postForm: <RequestComposer onComplete={() => {
        setAttempt((value) => value + 1);
        setManagementTab('mine');
        setManage(true);
      }} />,
    }} />
    <Modal open={manage} onClose={() => setManage(false)} title="Your requests" wide>
      <RequestsPage initialTab={managementTab} />
    </Modal>
  </>;
}

export function PreviewNeedSomething() {
  const { user, openSignIn } = useAuth();
  const { enabled, loading, error, reload } = useFeatureFlag('item_requests');
  const { navigate } = useRouter();
  if (!user) return <div className="p1-work-page"><EmptyState title="Sign in to ask the community" description="Community requests are available to signed-in YBuy members." actionLabel="Sign in" onAction={openSignIn} /></div>;
  if (loading) return <main className="p1-work-page" aria-busy="true"><p role="status">Loading request settings…</p></main>;
  if (error) return <main className="p1-work-page"><EmptyState title="Could not load request settings" description={error} actionLabel="Try again" onAction={reload} /></main>;
  if (!enabled) return <main className="p1-work-page"><EmptyState title="Item requests are not enabled yet" description="An authorized administrator can enable the item_requests feature flag after the backend migration is installed." /></main>;
  return <main className="p1-work-page"><PageHead title="Good plans need good gear." description="Tell nearby owners what you need, with the dates and details they need to help." />
    <RequestComposer onComplete={() => navigate({ name: 'requests', tab: 'mine' })} /></main>;
}

function RequestComposer({ onComplete }: {
  onComplete: () => void;
}) {
  const { user } = useAuth();
  const requestId = useRef(crypto.randomUUID());
  const idempotencyKey = useRef(crypto.randomUUID());
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryAttempt, setCategoryAttempt] = useState(0);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [intendedUse, setIntendedUse] = useState('');
  const [startDate, setStartDate] = useState(addDaysIso(todayIso(), 1));
  const [endDate, setEndDate] = useState(addDaysIso(todayIso(), 3));
  const [location, setLocation] = useState('');
  const [areas, setAreas] = useState<MarketplaceLocation[]>([]);
  const [area, setArea] = useState<MarketplaceLocation | null>(null);
  const [radius, setRadius] = useState<number | null>(5);
  const [budget, setBudget] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [specifications, setSpecifications] = useState('');
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [findingArea, setFindingArea] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Listing[] | null>(null);
  const [reviewedMatches, setReviewedMatches] = useState(false);

  useEffect(() => {
    let active = true;
    setCategoriesLoading(true);
    setCategoriesError(null);
    listRequestCategories().then((items) => { if (active) setCategories(items); })
      .catch((reason: unknown) => { if (active) setCategoriesError(reason instanceof Error ? reason.message : 'Could not load request categories.'); })
      .finally(() => { if (active) setCategoriesLoading(false); });
    return () => { active = false; };
  }, [categoryAttempt]);

  async function findArea() {
    setFindingArea(true);
    setError(null);
    try {
      const results = await findCities(location);
      setAreas(results);
      if (!results.length) throw new Error('No matching city or postal code was found. Try another area.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not look up this area.');
    } finally {
      setFindingArea(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || area?.latitude === undefined || area.longitude === undefined) {
      setError('Find and select a city or postal code before posting.');
      return;
    }
    if (!acknowledged) {
      setError('Confirm that your request will be visible to signed-in owners.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await searchListings({
        keyword: title, categoryId, latitude: area.latitude, longitude: area.longitude,
        radiusMiles: radius, startDate, endDate, maxPrice: budget ? Number(budget) : undefined, pageSize: 5,
      });
      const matchingListings = found.rows.map(toUiListing);
      setMatches(matchingListings);
      if (matchingListings.length && !reviewedMatches) return;
      await createItemRequest({
        id: requestId.current, idempotencyKey: idempotencyKey.current, categoryId, title, description,
        intendedUse, startDate, endDate, location, country: area.country,
        latitude: area.latitude, longitude: area.longitude, radiusMiles: radius,
        maxDailyBudget: budget ? Number(budget) : null, quantity: Number(quantity),
        specifications, notes, images,
      }, user.id);
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not post your request.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="p1-request-composer" onSubmit={(event) => void submit(event)}>
    {categoriesError && <p role="alert" className="p1-error">{categoriesError}<Button variant="secondary" type="button" onClick={() => setCategoryAttempt((value) => value + 1)}>Try again</Button></p>}
    {categoriesLoading && <p role="status" className="p1-muted">Loading request categories…</p>}
    <div className="p1-form-two">
      <Field label="What do you need?"><input required minLength={3} maxLength={120} value={title} onChange={(event) => { setTitle(event.target.value); setMatches(null); setReviewedMatches(false); }} placeholder="A projector for an outdoor movie night" /></Field>
      <Field label="Category"><Dropdown label="Category" required value={categoryId} onChange={(value) => { setCategoryId(value); setMatches(null); setReviewedMatches(false); }} placeholder="Choose a category" options={categories.map((category) => ({ value: category.id, label: category.name }))} /></Field>
    </div>
    <Field label="Description"><textarea required minLength={10} maxLength={1200} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Share the important details and condition you need." /></Field>
    <Field label="Intended use (optional)"><input maxLength={500} value={intendedUse} onChange={(event) => setIntendedUse(event.target.value)} placeholder="What will you use it for?" /></Field>
    <DateField start={startDate} end={endDate} min={addDaysIso(todayIso(), 1)} onChange={(start, end) => { setStartDate(start); setEndDate(end); setMatches(null); setReviewedMatches(false); }} label="Requested dates" />
    <div className="p1-form-two">
      <Field label="Preferred area"><input required maxLength={200} value={location} onChange={(event) => { setLocation(event.target.value); setArea(null); setAreas([]); setMatches(null); setReviewedMatches(false); }} placeholder="City or postal code" />
        <Button type="button" variant="secondary" disabled={findingArea || location.trim().length < 2} onClick={() => void findArea()}>{findingArea ? 'Finding area…' : 'Find area'}</Button>
      </Field>
      <Field label="Search radius"><Dropdown label="Request search radius" value={radius === null ? 'unlimited' : String(radius)} onChange={(value) => { setRadius(value === 'unlimited' ? null : Number(value)); setMatches(null); setReviewedMatches(false); }}
        options={[5, 10, 25, 50].map((miles) => ({ value: String(miles), label: `${miles} miles` })).concat([{ value: 'unlimited', label: 'Unlimited distance' }])} /></Field>
    </div>
    {areas.length > 0 && <div className="p1-actions" role="group" aria-label="Choose request area">{areas.map((candidate, index) =>
      <Button key={`${candidate.city}:${index}`} type="button" variant={area === candidate ? 'primary' : 'secondary'} onClick={() => {
        setArea(candidate); setLocation(locationLabel(candidate)); setAreas([]); setMatches(null); setReviewedMatches(false);
      }}>{locationLabel(candidate)}</Button>)}</div>}
    {area && <p role="status" className="p1-info-copy">Verified search area selected: {locationLabel(area)}.</p>}
    <div className="p1-form-two">
      <Field label="Maximum daily budget ($, optional)"><input type="number" min="0.01" max="100000" step="0.01" value={budget} onChange={(event) => { setBudget(event.target.value); setMatches(null); setReviewedMatches(false); }} /></Field>
      <Field label="Quantity"><input required type="number" min="1" max="100" step="1" value={quantity} onChange={(event) => { setQuantity(event.target.value); setMatches(null); setReviewedMatches(false); }} /></Field>
    </div>
    <Field label="Specifications or accessories (optional)"><input maxLength={500} value={specifications} onChange={(event) => setSpecifications(event.target.value)} /></Field>
    <Field label="Additional notes (optional)"><textarea maxLength={1200} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
    <Field label="Reference images (optional, up to 4; JPEG, PNG or WebP, 5 MB each)"><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => {
      const selected = Array.from(event.target.files ?? []);
      if (selected.length > 4) setError('Choose no more than four reference images.');
      setImages(selected.slice(0, 4));
    }} /><small>{images.map((image) => image.name).join(', ')}</small></Field>
    {matches && <section className="p1-chat-scenario" aria-label="Existing matching listings">
      <h2>{matches.length ? 'Existing listings may meet your request.' : 'No existing listings match those details.'}</h2>
      {matches.map((listing) => <a key={listing.id} href={`/listing/${listing.id}`} target="_blank" rel="noopener noreferrer">{listing.title} · {listing.pricePerDay}/day</a>)}
      {matches.length > 0 && <label className="p1-check"><input type="checkbox" checked={reviewedMatches} onChange={(event) => setReviewedMatches(event.target.checked)} />
        <span>I reviewed these listings and still want to post my request.</span></label>}
    </section>}
    <label className="p1-check"><input required type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
      <span>I understand this request is visible to signed-in owners while open.</span></label>
    {error && <Alert tone="error" title="Request was not posted">{error}</Alert>}
    <div className="p1-dialog-footer"><Button type="submit" disabled={busy || categoriesLoading || Boolean(categoriesError) || !categories.length} aria-busy={busy}>{busy ? 'Posting your request…' : 'Post request'}</Button></div>
  </form>;
}

function mapConversation(row: UiConversation): PreviewConversation {
  return {
    id: row.id,
    name: row.counterpartName,
    avatar: row.counterpartAvatar,
    listingTitle: row.listingTitle,
    listingImage: row.listingImage,
    lastMessage: row.lastMessage,
    lastTime: row.lastMessageAt,
  };
}
function mapMessage(row: UiMessage): PreviewConversationMessage {
  return {
    id: row.id,
    senderId: row.senderId,
    text: row.body,
    time: new Date(row.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

export function PreviewMessages({ id }: { id?: string } = {}) {
  const { user, openSignIn } = useAuth();
  const userId = user?.id;
  const [rows, setRows] = useState<UiConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(id ?? null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSelectedId(id ?? null);
  }, [id]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setRows([]);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    fetchConversations(userId)
      .then((conversations) => {
        if (!active) return;
        setRows(conversations);
        setSelectedId((current) => id ?? (current && conversations.some((row) => row.id === current) ? current : conversations[0]?.id ?? null));
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load conversations.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, attempt, id]);

  useEffect(() => {
    if (!selectedId || !userId) {
      setMessages([]);
      return;
    }
    let active = true;
    void markConversationMessagesRead(selectedId).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not mark messages as read.');
    });
    setMessages([]);
    setError(null);
    setLoadingMessages(true);
    fetchMessages(selectedId)
      .then((loaded) => { if (active) setMessages(loaded); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load messages.'); })
      .finally(() => { if (active) setLoadingMessages(false); });
    const unsubscribe = subscribeToMessages(selectedId, (message) => {
      setMessages((current) => current.some((existing) => existing.id === message.id) ? current : [...current, message]);
      setRows((current) => current.map((row) => row.id === selectedId
        ? { ...row, lastMessage: message.body, lastMessageAt: message.createdAt }
        : row).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
    });
    return () => { active = false; unsubscribe(); };
  }, [selectedId, attempt, userId]);

  const onSend = async (body: string) => {
    if (!userId || !selectedId || sending || body.length > MESSAGE_MAX_LENGTH) return false;
    setSending(true);
    setError(null);
    try {
      const sent = await sendMessage(selectedId, userId, body);
      setMessages((current) => current.some((row) => row.id === sent.id) ? current : [...current, sent]);
      setRows((current) => current.map((row) => row.id === selectedId
        ? { ...row, lastMessage: sent.body, lastMessageAt: sent.createdAt }
        : row).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send this message.');
      return false;
    } finally {
      setSending(false);
    }
  };

  if (!user) return <div className="p1-work-page"><EmptyState title="Sign in to view messages" description="Your conversations are available after signing in." actionLabel="Sign in" onAction={openSignIn} /></div>;
  return <MessagesTemplate backend={{
    rows: rows.map(mapConversation), selectedId, messages: messages.map(mapMessage), currentUserId: user.id,
    loading, loadingMessages, error, sending, onRetry: () => setAttempt((value) => value + 1),
    onSelect: setSelectedId, onBack: () => setSelectedId(null), onSend,
  }} />;
}

type UnifiedNotification = PreviewNotice & { marketplace: boolean; createdAt: string };
function mapAppNotification(row: AppNotification): UnifiedNotification {
  return { id: row.id, title: row.title, body: row.body, read: Boolean(row.read_at), destination: row.destination, marketplace: false, createdAt: row.created_at,
    category: row.category === 'cases' ? 'safety' : row.category, mandatory: mandatoryNotification(row.category, row.event_key) };
}
function mapMarketplaceNotification(row: MarketplaceNotification): UnifiedNotification {
  return {
    id: `marketplace:${row.id}`,
    title: row.title,
    body: row.body,
    read: Boolean(row.read_at),
    destination: '/requests?tab=mine',
    marketplace: true,
    createdAt: row.created_at,
    category: 'requests',
  };
}

export function PreviewNotifications() {
  const { user, openSignIn } = useAuth();
  const userId = user?.id;
  const { navigate } = useRouter();
  const [rows, setRows] = useState<UnifiedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadedPages = useRef(1);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [preferenceBusy, setPreferenceBusy] = useState<string | null>(null);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const loadPreferences = useCallback(async () => {
    if (!userId) return;
    setPreferencesLoading(true);
    setPreferencesError(null);
    try {
      const result = await getNotificationPreferences();
      if (currentUser.current === userId) setPreferences(result);
    } catch (reason) {
      if (currentUser.current === userId) setPreferencesError(reason instanceof Error ? reason.message : 'Could not load notification preferences.');
    } finally {
      if (currentUser.current === userId) setPreferencesLoading(false);
    }
  }, [userId]);
  useEffect(() => { setPreferences(null); void loadPreferences(); }, [loadPreferences]);

  async function updatePreference(category: PreviewNotificationCategory, enabled: boolean) {
    if (!userId || preferenceBusy) return;
    const key: NotificationPreferenceKey = `${category === 'safety' ? 'cases' : category}_in_app`;
    setPreferenceBusy(key);
    setPreferencesError(null);
    try {
      await setNotificationPreference(userId, key, enabled);
      await loadPreferences();
    } catch (reason) {
      if (currentUser.current === userId) setPreferencesError(reason instanceof Error ? reason.message : 'Could not save this preference.');
    } finally {
      if (currentUser.current === userId) setPreferenceBusy(null);
    }
  }

  const load = useCallback(async (pageCount = 1, append = false): Promise<boolean> => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return true;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const offsets = Array.from({ length: pageCount }, (_, index) => index * PAGE_SIZE);
      const [notificationPages, marketplacePages] = await Promise.all([
        Promise.all(offsets.map((offset) => listNotifications({ limit: PAGE_SIZE, offset }))),
        Promise.all(offsets.map((offset) => fetchMarketplaceNotifications(PAGE_SIZE, offset))),
      ]);
      const notifications = notificationPages.flatMap((page) => page.rows);
      const marketplace = marketplacePages.flat();
      if (currentUser.current !== userId) return false;
      setRows([...notifications.map(mapAppNotification), ...marketplace.map(mapMarketplaceNotification)]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      const systemTotal = notificationPages[0]?.total ?? 0;
      const lastMarketplacePage = marketplacePages[marketplacePages.length - 1] ?? [];
      setHasMore(systemTotal > pageCount * PAGE_SIZE || lastMarketplacePage.length === PAGE_SIZE);
      return true;
    } catch (reason) {
      if (currentUser.current === userId) setError(reason instanceof Error ? reason.message : 'Could not load updates.');
      return false;
    } finally {
      if (currentUser.current === userId) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    loadedPages.current = 1;
    setRows([]);
    setHasMore(false);
    void load(1);
  }, [load, attempt]);
  useEffect(() => {
    if (!userId) return;
    const channel = subscribeToNotifications(userId, () => { void load(loadedPages.current); });
    return () => { void supabase.removeChannel(channel); };
  }, [userId, load]);

  async function loadMore() {
    const pageCount = loadedPages.current + 1;
    if (await load(pageCount, true)) loadedPages.current = pageCount;
  }

  async function mark(ids: string[]): Promise<boolean> {
    const selected = rows.filter(item => ids.includes(item.id) && !item.read);
    if (busy || loadingMore) return false;
    if (!selected.length) return true;
    setBusy('selected');
    setError(null);
    try {
      await Promise.all(selected.map(row => row.marketplace ? markMarketplaceNotificationRead(row.id.slice('marketplace:'.length)) : markNotificationRead(row.id)));
      return await load(loadedPages.current, true);
    } catch (reason) {
      await load(loadedPages.current, true);
      setError(reason instanceof Error ? reason.message : 'Could not mark this update as read.');
      return false;
    } finally {
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      setBusy(null);
    }
  }
  async function markAll() {
    if (busy) return;
    setBusy('all');
    setError(null);
    const pageCount = loadedPages.current;
    try {
      await Promise.all([markAllNotificationsRead(), markAllMarketplaceNotificationsRead()]);
      await load(pageCount, true);
    } catch (reason) {
      await load(pageCount, true);
      setError(reason instanceof Error ? reason.message : 'Could not mark all updates as read.');
    } finally {
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      setBusy(null);
    }
  }
  async function open(notice: PreviewNotice) {
    const row = rows.find((item) => item.id === notice.id);
    if (!row) return;
    const route = notificationRoute(row.destination === '/requests' ? '/requests?tab=mine' : row.destination);
    if (!route) {
      setError('This notification destination is unavailable.');
      return;
    }
    if (!row.read && !await mark([row.id])) return;
    navigate(route);
  }

  if (!user) return <div className="p1-work-page"><EmptyState title="Sign in to view updates" description="Your account notifications are available after signing in." actionLabel="Sign in" onAction={openSignIn} /></div>;
  return <NotificationsTemplate backend={{
    rows, loading, hasMore, loadingMore, busy, error,
    mutedCategories: previewNotificationCategories.filter(item => !item.mandatory && preferences && !preferences[`${item.key}_in_app`]).map(item => item.key),
    preferencesLoading, preferencesError, preferenceBusy,
    onPreferenceChange: (category, enabled) => { void updatePreference(category, enabled); },
    onRetryPreferences: () => { void loadPreferences(); },
    onRetry: () => setAttempt((value) => value + 1),
    onLoadMore: () => { void loadMore(); },
    onMark: mark,
    onMarkAll: () => { void markAll(); },
    onOpen: (notice) => { void open(notice); },
  }} />;
}

interface ProfileActivity {
  completedRentals: number;
  listingsOwned: number;
  savedItems: number;
}

export function PreviewProfile() {
  const { user, profile, authBusy, signOut, openSignIn, loading: authLoading, error: authError } = useAuth();
  const profileId = profile?.id;
  const [activity, setActivity] = useState<ProfileActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [preferenceBusy, setPreferenceBusy] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    let active = true;
    if (!profileId) {
      setActivity(null);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    Promise.all([
      fetchBookingsAsRenter(profileId),
      fetchFavoriteListingIds(profileId),
      supabase.from('listings').select('id', { count: 'exact', head: true }).eq('owner_id', profileId),
    ]).then(([bookings, favorites, listings]) => {
      if (!active) return;
      if (listings.error) throw listings.error;
      setActivity({
        completedRentals: bookings.filter((booking) => booking.status === 'completed').length,
        savedItems: favorites.size,
        listingsOwned: listings.count ?? 0,
      });
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load account activity.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profileId, attempt]);

  const loadPreferences = useCallback(async () => {
    if (!profileId) {
      setPreferences(null);
      setPreferencesLoading(false);
      return;
    }
    setPreferencesLoading(true);
    setPreferencesError(null);
    try {
      setPreferences(await getNotificationPreferences());
    } catch (reason) {
      setPreferencesError(reason instanceof Error ? reason.message : 'Could not load notification preferences.');
    } finally {
      setPreferencesLoading(false);
    }
  }, [profileId]);
  useEffect(() => { void loadPreferences(); }, [loadPreferences]);

  async function updatePreference(key: NotificationPreferenceKey, enabled: boolean) {
    if (!profileId || preferenceBusy) return;
    setPreferenceBusy(key);
    setPreferencesError(null);
    try {
      await setNotificationPreference(profileId, key, enabled);
      await loadPreferences();
    } catch (reason) {
      await loadPreferences();
      setPreferencesError(reason instanceof Error ? reason.message : 'Could not save this preference.');
    } finally {
      setPreferenceBusy(null);
    }
  }

  async function saveProfile(fullName: string, phone: string, bio: string) {
    if (!profileId || savingProfile) return;
    setSavingProfile(true);
    try {
      await updateOwnAccountProfile(profileId, { fullName, phone, bio });
    } finally {
      setSavingProfile(false);
    }
  }

  if (!user) return <div className="p1-work-page"><EmptyState title="Sign in to view your profile" description="Your account information is available after signing in." actionLabel="Sign in" onAction={openSignIn} /></div>;
  if (!profile) return <div className="p1-work-page"><p role="status">{authError ? 'Your profile is unavailable. Please refresh to retry.' : authLoading ? 'Loading your profile…' : 'Your profile is unavailable.'}</p>
    {error && <p role="alert" className="p1-error">{error}</p>}
    <button className="p1-button p1-button-secondary" type="button" disabled={authBusy === 'sign-out'} onClick={() => { void signOut().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not sign out.')); }}>
      {authBusy === 'sign-out' ? 'Signing out…' : 'Sign out'}
    </button></div>;
  const profileData: PreviewProfileData = {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    phone: profile.phone ?? '',
    bio: profile.bio ?? '',
    avatar: profile.avatar_url,
    joinedYear: new Date(profile.created_at).getFullYear(),
    provider: authProviderLabel(user.app_metadata.provider),
    emailVerified: Boolean(user.email_confirmed_at),
    completedRentals: activity?.completedRentals ?? null,
    listingsOwned: activity?.listingsOwned ?? null,
    savedItems: activity?.savedItems ?? null,
  };
  return <ProfileTemplate key={profileData.id} backend={{
    profile: profileData, loading, error, onRetry: () => setAttempt((value) => value + 1),
    savingProfile, onSaveProfile: saveProfile,
    signingOut: authBusy === 'sign-out',
    onSignOut: () => { void signOut().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not sign out.')); },
    preferences, preferencesError, preferencesLoading, preferenceBusy,
    onRetryPreferences: () => { void loadPreferences(); },
    onPreferenceChange: (key, enabled) => { void updatePreference(key, enabled); },
  }} />;
}
