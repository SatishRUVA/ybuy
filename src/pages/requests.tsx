import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@/router';
import { useAuth } from '@/auth-context';
import { Alert, Badge, Button, EmptyState, SectionHeader, Surface } from '@/components/ui';
import { fieldClass, textareaClass } from '@/components/form-classes';
import { Skeleton } from '@/components/skeleton';
import { DatePicker } from '@/components/date-picker';
import { addDaysIso, todayIso,findCities,locationLabel,type MarketplaceLocation } from '@/lib/geo';
import { searchListings,toUiListing } from '@/lib/listings';
import type { Listing } from '@/data';
import {
  closeItemRequest, createItemRequest, createMarketplaceOffer, expireMarketplaceActivity,
  fetchItemRequestResponseCounts, fetchMyItemRequests, fetchMyNegotiations, fetchMyOwnerListings,
  fetchOpenItemRequests, listRequestCategories, linkRequestOfferListing, requestImageUrl,
  fetchRequestListingMatches, fetchMarketplaceRequestEvents,
  respondToMarketplaceOffer, updateItemRequest, type ItemRequest, type ItemRequestStatus, type MarketplaceNegotiation,
  type NegotiationProposal, type OwnerListing, type MarketplaceRequestEvent,
} from '@/lib/marketplace';
import { getOrCreateConversation } from '@/lib/messages';
import { useFeatureFlags, useFeatureFlag } from '@/lib/use-feature-flags';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, DollarSign,
  HeartHandshake, MapPin, MessageSquare, PackagePlus, Plus, Search,
} from 'lucide-react';

type Category = { id: string; name: string };
type RequestTab = 'browse' | 'mine' | 'offers';

const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'success' | 'warning' | 'error'> = {
  open: 'accent', responses_received: 'warning', negotiating: 'warning', matched: 'success',
  pending: 'warning', countered: 'accent', accepted: 'success', declined: 'error',
  withdrawn: 'neutral', expired: 'neutral', cancelled: 'neutral', closed: 'neutral',
};

const REQUEST_STATUS_LABEL: Record<ItemRequestStatus, string> = {
  open: 'Open', responses_received: 'Responses received', negotiating: 'Negotiating',
  matched: 'Fulfilled', cancelled: 'Cancelled', expired: 'Expired', closed: 'Closed',
};

const requestEventLabel = (eventType: string) => eventType.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());

const dateLabel = (start: string, end: string) => {
  const format = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${format(start)} – ${format(end)}`;
};
const money = (value: number | null | undefined) => value == null ? 'No limit set' : `$${Number(value).toFixed(2)}/day`;

export function RequestsPage({ initialTab = 'browse' }: { initialTab?: RequestTab }) {
  const { user, openSignIn } = useAuth();
  const { navigate } = useRouter();
  const { data: flags, loading: flagsLoading, error: featureError, reload: reloadFlags } = useFeatureFlags();
  const flagsReady = !flagsLoading && !featureError;
  const enabled = flagsReady && flags?.some((flag) => flag.key === 'item_requests' && flag.enabled) === true;
  const privateOffersEnabled = flagsReady && flags?.some((flag) => flag.key === 'private_offers' && flag.enabled) === true;
  const [tab, setTab] = useState<RequestTab>(initialTab);
  const [categories, setCategories] = useState<Category[]>([]);
  const [ownerListings, setOwnerListings] = useState<OwnerListing[]>([]);
  const [listingMatches,setListingMatches]=useState<Record<string,OwnerListing[]>>({});
  const [requests, setRequests] = useState<ItemRequest[] | null>(null);
  const [myRequests, setMyRequests] = useState<ItemRequest[] | null>(null);
  const [negotiations, setNegotiations] = useState<MarketplaceNegotiation[] | null>(null);
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});
  const [categoryId, setCategoryId] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [sort, setSort] = useState<'newest' | 'earliest' | 'budget'>('newest');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [activeRequest, setActiveRequest] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled && privateOffersEnabled) setTab('offers');
  }, [enabled, privateOffersEnabled]);

  useEffect(() => {
    let cancelled = false;
    listRequestCategories().then((rows) => { if (!cancelled) setCategories(rows); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load categories.'); });
    return () => { cancelled = true; };
  }, []);

  const reload = useCallback(async () => {
    if (!user || (!enabled && !privateOffersEnabled)) return;
    setError(null);
    try {
      await expireMarketplaceActivity();
      const [mine, offers, listings] = await Promise.all([
        fetchMyItemRequests(user.id),
        fetchMyNegotiations(user.id),
        fetchMyOwnerListings(user.id),
      ]);
      setMyRequests(mine);
      setNegotiations(offers);
      setOwnerListings(listings);
      if (enabled && tab === 'mine') {
        setResponseCounts(await fetchItemRequestResponseCounts(mine.map((request) => request.id)));
        setListingMatches(await fetchRequestListingMatches(mine.map(request=>request.id)));
      }
      if (enabled && tab === 'browse') {
        const result = await fetchOpenItemRequests({
          categoryId: categoryId || undefined,
          location: locationFilter,
          search,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          maxDailyBudget: maxBudget === '' ? undefined : Number(maxBudget),
          sort,
          page,
        });
        setRequests(result.rows);
        setTotal(result.total);
        setResponseCounts(await fetchItemRequestResponseCounts(result.rows.map((request) => request.id)));
        setListingMatches(await fetchRequestListingMatches(result.rows.map((request)=>request.id)));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load item requests.');
      if (enabled && tab === 'browse') setRequests([]);
    }
  }, [user, enabled, privateOffersEnabled, tab, categoryId, locationFilter, search, startDate, endDate, maxBudget, sort, page]);

  useEffect(() => {
    if ((enabled || privateOffersEnabled) && user) void reload();
  }, [enabled, privateOffersEnabled, user, reload]);

  const filteredNegotiations = useMemo(() => negotiations ?? [], [negotiations]);
  const visibleMine = useMemo(() => myRequests ?? [], [myRequests]);
  const pages = Math.max(1, Math.ceil(total / 12));

  function selectTab(next: RequestTab) {
    setTab(next);
    setPage(0);
    setError(null);
  }

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <EmptyState icon={<HeartHandshake size={22} />} title="Sign in to find or request an item"
          description="Requests and offers are available to signed-in YBuy members."
          actionLabel="Sign in" onAction={openSignIn} />
      </div>
    );
  }
  if (flagsLoading && !featureError) {
    return <div className="max-w-4xl mx-auto px-4 py-8 space-y-3" aria-busy="true">
      <Skeleton className="h-9 w-56" /><Skeleton className="h-32 w-full" rounded="rounded-card-lg" />
    </div>;
  }
  if (featureError) {
    return <div className="max-w-2xl mx-auto px-4 py-10"><Alert tone="error" title="Could not load request settings">
      {featureError}<Button size="sm" variant="secondary" className="mt-3" onClick={reloadFlags}>Try again</Button>
    </Alert></div>;
  }
  if (initialTab === 'offers' && !enabled && !privateOffersEnabled) {
    return <div className="max-w-2xl mx-auto px-4 py-12"><EmptyState icon={<HeartHandshake size={22} />}
      title="Offers are not enabled yet"
      description="An authorized administrator can enable private offers after the backend migration is installed." /></div>;
  }
  if (!enabled && !privateOffersEnabled) {
    return <div className="max-w-2xl mx-auto px-4 py-12"><EmptyState icon={<HeartHandshake size={22} />}
      title="Item requests are not enabled yet"
      description="The request workflow is installed but remains off until an authorized administrator enables the item_requests feature flag." /></div>;
  }
  const tabs: { id: RequestTab; label: string }[] = [
    ...(enabled ? [{ id: 'browse' as const, label: 'Find requests' }, { id: 'mine' as const, label: 'My requests' }] : []),
    ...((enabled || privateOffersEnabled) ? [{ id: 'offers' as const, label: 'Offers & negotiations' }] : []),
  ];

  return (
    <div className="pb-20 md:pb-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-9 space-y-5">
        <SectionHeader as="h1" title="Item requests" subtitle="Ask for something you can't find, or offer a rental that fits." action={
          enabled && <Button icon={<Plus size={16} />} onClick={() => navigate({ name: 'need-something' })}>Request an item</Button>
        } />
        <div className="flex gap-1 p-1 rounded-card-lg bg-subtle" role="tablist" aria-label="Item request activity">
          {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
            onClick={() => selectTab(item.id)}
            className={`min-w-0 flex-1 min-h-11 rounded-card px-2 py-2 text-xs sm:text-sm font-semibold transition-colors duration-fast ${tab === item.id ? 'bg-card text-main shadow-xs' : 'text-sec hover:text-main'}`}>
            {item.label}
          </button>)}
        </div>

        {error && <Alert tone="error" title="Could not refresh marketplace data">
          {error}<Button size="sm" variant="secondary" className="mt-2" onClick={() => void reload()}>Try again</Button>
        </Alert>}

        {tab === 'browse' && enabled && <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-semibold text-sec">Search item
              <span className="relative block mt-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input value={search} maxLength={100} onChange={(e) => { setPage(0); setSearch(e.target.value); }} placeholder="Projector, drill…" className={fieldClass('pl-9 !h-10')} />
              </span>
            </label>
            <label className="text-xs font-semibold text-sec">Category
              <select value={categoryId} onChange={(e) => { setPage(0); setCategoryId(e.target.value); }} className={fieldClass('mt-1 !h-10')}>
                <option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-sec">Location
              <input value={locationFilter} maxLength={100} onChange={(e) => { setPage(0); setLocationFilter(e.target.value); }} placeholder="City or area" className={fieldClass('mt-1 !h-10')} />
            </label>
            <label className="text-xs font-semibold text-sec">Maximum daily budget
              <input type="number" min="0.01" step="0.01" value={maxBudget} onChange={(e) => { setPage(0); setMaxBudget(e.target.value); }} placeholder="Any budget" className={fieldClass('mt-1 !h-10')} />
            </label>
            <label className="text-xs font-semibold text-sec">Requests starting by
              <DatePicker label="Requests starting by" value={endDate} min={todayIso()} onChange={(date) => { setPage(0); setEndDate(date); }} className="mt-1" />
            </label>
            <label className="text-xs font-semibold text-sec">Requests ending after
              <DatePicker label="Requests ending after" value={startDate} min={todayIso()} onChange={(date) => { setPage(0); setStartDate(date); }} className="mt-1" />
            </label>
            <label className="text-xs font-semibold text-sec">Sort by
              <select value={sort} onChange={(e) => { setPage(0); setSort(e.target.value as typeof sort); }} className={fieldClass('mt-1 !h-10')}>
                <option value="newest">Newest</option><option value="earliest">Earliest dates</option><option value="budget">Budget (low to high)</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">Date filters show overlapping rental windows. Offers are checked against listing availability before they are saved.</p>
          {!requests ? <RequestSkeleton /> : requests.length === 0 ? (
            <EmptyState icon={<Search size={21} />} title="No open requests match those filters"
              description="Try a wider location, another category or a different date range."
              actionLabel="Clear filters" onAction={() => {
                setSearch(''); setCategoryId(''); setLocationFilter(''); setStartDate(''); setEndDate(''); setMaxBudget(''); setPage(0);
              }} />
          ) : <div className="space-y-3">
            {requests.map((request) => <RequestCard key={request.id} request={request}
              responseCount={responseCounts[request.id] ?? 0}
              matchingListings={listingMatches[request.id]??[]}
              active={activeRequest === request.id}
              onOffer={() => setActiveRequest(activeRequest === request.id ? null : request.id)}
              onOfferSent={async () => { setActiveRequest(null); await reload(); selectTab('offers'); }}
              myListings={ownerListings}
            />)}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <span className="text-sm text-sec">{total} requests · page {page + 1} of {pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} icon={<ChevronLeft size={15} />} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page + 1 >= pages} trailingIcon={<ChevronRight size={15} />} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </div>
            </div>
          </div>}
        </>}

        {tab === 'mine' && enabled && <>
          <div className="flex justify-end">
            <Button size="sm" icon={<Plus size={15} />} onClick={() => navigate({ name: 'need-something' })}>Post request</Button>
          </div>
          {myRequests === null ? <RequestSkeleton /> : visibleMine.length === 0 ? (
            <EmptyState icon={<PackagePlus size={21} />} title="You haven't requested an item yet"
              description="Tell nearby owners what you need and when you need it."
              actionLabel="Request an item" onAction={() => navigate({ name: 'need-something' })} />
          ) : <div className="space-y-3">{visibleMine.map((request) => (
            <MyRequestCard key={request.id} request={request} responseCount={responseCounts[request.id] ?? 0}
              matchingListings={listingMatches[request.id] ?? []}
              offers={filteredNegotiations.filter((negotiation) => negotiation.item_request_id === request.id)}
              currentUserId={user.id} myListings={ownerListings} allowCounter={enabled}
              onRefresh={() => void reload()} />
          ))}</div>}
        </>}

        {tab === 'offers' && (enabled || privateOffersEnabled) && <>
          <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={() => void reload()}>Refresh offers</Button></div>
          {!negotiations ? <RequestSkeleton /> : filteredNegotiations.length === 0 ? (
            <EmptyState icon={<MessageSquare size={21} />} title="No offers or negotiations yet"
              description="Owner offers and listing negotiations will appear here." />
          ) : <div className="space-y-3">{filteredNegotiations.map((negotiation) => (
            <NegotiationCard key={negotiation.id} negotiation={negotiation} currentUserId={user.id}
              myListings={ownerListings} busy={busyId === negotiation.id}
              allowCounter={negotiation.item_request_id ? enabled : privateOffersEnabled}
              setBusy={(value) => setBusyId(value ? negotiation.id : null)}
              onRefresh={() => void reload()} onError={setError} />
          ))}</div>}
        </>}
      </div>
    </div>
  );
}

function RequestCard({ request, responseCount, matchingListings, active, onOffer, onOfferSent, myListings }: {
  request: ItemRequest; responseCount: number; matchingListings: OwnerListing[];
  active: boolean; onOffer: () => void; onOfferSent: () => Promise<void>; myListings: OwnerListing[];
}) {
  const category = request.categories?.name ?? 'Item';
  return <Surface className="p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-main font-display">{request.title}</h2>
          <Badge>{category}</Badge>
        </div>
        <p className="mt-2 text-sm text-sec whitespace-pre-wrap">{request.description}</p>
        {request.reference_image_paths.length > 0 && <RequestImages paths={request.reference_image_paths} title={request.title} />}
        {request.intended_use && <p className="mt-2 text-xs text-sec"><strong>Intended use:</strong> {request.intended_use}</p>}
        {request.specifications && <p className="mt-1 text-xs text-sec"><strong>Specifications:</strong> {request.specifications}</p>}
        {request.additional_notes && <p className="mt-1 text-xs text-sec"><strong>Notes:</strong> {request.additional_notes}</p>}
      </div>
      <Button size="sm" onClick={onOffer} icon={<ArrowRight size={15} />}>{active ? 'Close offer form' : 'Make an offer'}</Button>
    </div>
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-sec">
      <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{dateLabel(request.preferred_start_date, request.preferred_end_date)}</span>
      <span className="inline-flex items-center gap-1"><MapPin size={13} />{request.location_label}</span>
      <span className="inline-flex items-center gap-1"><DollarSign size={13} />Budget: {money(request.max_daily_budget)}</span>
      <span>{request.requested_quantity} requested</span>
      <span>{responseCount} {responseCount === 1 ? 'response' : 'responses'}</span>
      <span className="inline-flex items-center gap-1"><Clock size={13} />Expires {new Date(request.expires_at).toLocaleDateString()}</span>
    </div>
    {matchingListings.length > 0 && <p className="mt-3 text-xs text-success">
      Available nearby fit: {matchingListings[0].title}. Category, coordinates, rental dates, quantity and budget match. Booking still revalidates availability.
    </p>}
    {active && <OfferComposer request={request} listings={myListings} onSent={onOfferSent} />}
  </Surface>;
}

function RequestImages({ paths, title }: { paths: string[]; title: string }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrls(null);
    setError(null);
    Promise.all(paths.map((path) => requestImageUrl(path)))
      .then((images) => { if (active) setUrls(images); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load request images.'); });
    return () => { active = false; };
  }, [paths]);

  if (error) return <Alert tone="warning" className="mt-3">Reference images could not be loaded: {error}</Alert>;
  if (!urls) return <p className="mt-3 text-xs text-sec" role="status">Loading reference images…</p>;
  return <div className="mt-3 flex flex-wrap gap-2">
    {urls.map((url, index) => <a key={paths[index]} href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={`Reference image ${index + 1} for ${title}`} className="h-20 w-20 rounded-card object-cover border border-app" />
    </a>)}
  </div>;
}

function OfferComposer({ request, listings, onSent }: {
  request: ItemRequest; listings: OwnerListing[]; onSent: () => Promise<void>;
}) {
  const { navigate } = useRouter();
  const key = useRef(crypto.randomUUID());
  const [listingId, setListingId] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [startDate, setStartDate] = useState(request.preferred_start_date);
  const [endDate, setEndDate] = useState(request.preferred_end_date);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matchingListings = listings.filter((listing) => listing.category_id === request.category_id
    && listing.available_quantity >= request.requested_quantity
    && (request.max_daily_budget == null || Number(listing.price_per_day) <= Number(request.max_daily_budget)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createMarketplaceOffer({
        requestId: request.id,
        listingId: listingId || null,
        startDate,
        endDate,
        dailyRate: Number(dailyRate),
        message,
        idempotencyKey: key.current,
      });
      await onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send your offer.');
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={(event) => void submit(event)} className="mt-4 pt-4 border-t border-app space-y-3">
    <h3 className="font-semibold text-main">Offer this item</h3>
    {!matchingListings.length && <Alert tone="info">
      You can propose an item you plan to list. The renter cannot accept until you publish and link a matching listing.
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigate({ name: 'create-listing' })}>Create a listing</Button>
    </Alert>}
    {matchingListings.length > 0 && <label className="block text-xs font-semibold text-sec">Link an existing listing (optional)
      <select value={listingId} onChange={(event) => setListingId(event.target.value)} className={fieldClass('mt-1 !h-10')}>
        <option value="">I'll publish a listing later</option>
        {matchingListings.map((listing) => <option key={listing.id} value={listing.id}>{listing.title} · ${Number(listing.price_per_day).toFixed(2)}/day</option>)}
      </select>
    </label>}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <label className="text-xs font-semibold text-sec">Your daily price
        <input required type="number" min="0.01" max="100000" step="0.01" value={dailyRate} onChange={(event) => setDailyRate(event.target.value)} className={fieldClass('mt-1')} />
      </label>
      <label className="text-xs font-semibold text-sec">Start date
        <DatePicker label="Start date" required min={todayIso()} value={startDate} onChange={setStartDate} className="mt-1" />
      </label>
      <label className="text-xs font-semibold text-sec">End date
        <DatePicker label="End date" required min={addDaysIso(startDate || todayIso(), 1)} value={endDate} onChange={setEndDate} className="mt-1" />
      </label>
    </div>
    <label className="block text-xs font-semibold text-sec">Message
      <textarea rows={2} maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} className={textareaClass('mt-1')} placeholder="Explain how your item fits the request." />
    </label>
    {error && <Alert tone="error">{error}</Alert>}
    <div className="flex justify-end"><Button type="submit" loading={busy} loadingLabel="Sending offer…" icon={<ArrowRight size={15} />}>Send offer</Button></div>
  </form>;
}

function MyRequestCard({ request, responseCount, matchingListings, offers, currentUserId, myListings, allowCounter, onRefresh }: {
  request: ItemRequest; responseCount?: number; matchingListings: OwnerListing[]; offers: MarketplaceNegotiation[];
  currentUserId: string; myListings: OwnerListing[]; allowCounter: boolean; onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = ['open', 'responses_received', 'negotiating'].includes(request.status) && new Date(request.expires_at) > new Date();

  async function cancel() {
    setBusy(true); setError(null);
    try { await closeItemRequest(request.id); onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not cancel this request.'); }
    finally { setBusy(false); }
  }

  return <Surface className="p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-main">{request.title}</h2><Badge tone={STATUS_TONE[request.status]}>{REQUEST_STATUS_LABEL[request.status]}</Badge></div>
        <p className="mt-2 text-sm text-sec line-clamp-3">{request.description}</p>
        {matchingListings.length > 0 && <p className="mt-2 text-xs font-medium text-success">{matchingListings.length} listing match{matchingListings.length === 1 ? '' : 'es'} available for your dates.</p>}
        {request.reference_image_paths.length > 0 && <RequestImages paths={request.reference_image_paths} title={request.title} />}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-sec">{responseCount ?? 0} offers</span>
        <Button size="sm" variant="ghost" aria-expanded={detailsOpen} aria-controls={`request-details-${request.id}`}
          onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? 'Hide details' : 'View details'}</Button>
      </div>
    </div>
    <p className="mt-3 text-xs text-sec">{dateLabel(request.preferred_start_date, request.preferred_end_date)} · {request.location_label} · {money(request.max_daily_budget)}</p>
    {detailsOpen && <MyRequestDetails request={request} matchingListings={matchingListings} offers={offers}
      currentUserId={currentUserId} myListings={myListings} allowCounter={allowCounter} onRefresh={onRefresh} onError={setError} />}
    {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    {editing && <RequestEditForm request={request} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onRefresh(); }} />}
    {!editing && active && <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit request</Button>
      <Button size="sm" variant="danger" loading={busy} onClick={() => void cancel()}>Cancel request</Button>
    </div>}
  </Surface>;
}

function MyRequestDetails({ request, matchingListings, offers, currentUserId, myListings, allowCounter, onRefresh, onError }: {
  request: ItemRequest; matchingListings: OwnerListing[]; offers: MarketplaceNegotiation[];
  currentUserId: string; myListings: OwnerListing[]; allowCounter: boolean; onRefresh: () => void; onError: (value: string | null) => void;
}) {
  const [events, setEvents] = useState<MarketplaceRequestEvent[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const rentalDays = Math.max(1, Math.round((Date.parse(`${request.preferred_end_date}T00:00:00Z`) - Date.parse(`${request.preferred_start_date}T00:00:00Z`)) / 86400000));

  useEffect(() => {
    let active = true;
    setEventsLoading(true);
    setEventsError(null);
    void fetchMarketplaceRequestEvents(request.id)
      .then((rows) => { if (active) setEvents(rows); })
      .catch((reason: unknown) => { if (active) setEventsError(reason instanceof Error ? reason.message : 'Could not load request history.'); })
      .finally(() => { if (active) setEventsLoading(false); });
    return () => { active = false; };
  }, [request.id]);

  return <section id={`request-details-${request.id}`} className="mt-4 space-y-5 border-t border-app pt-4" aria-label={`Details for ${request.title}`}>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted">Category</dt><dd className="mt-1 text-main">{request.categories?.name ?? 'Item'}</dd></div>
      <div><dt className="text-xs text-muted">Status</dt><dd className="mt-1 text-main">{REQUEST_STATUS_LABEL[request.status]}</dd></div>
      <div><dt className="text-xs text-muted">Rental dates</dt><dd className="mt-1 text-main">{dateLabel(request.preferred_start_date, request.preferred_end_date)}</dd></div>
      <div><dt className="text-xs text-muted">Requested quantity</dt><dd className="mt-1 text-main">{request.requested_quantity}</dd></div>
      <div><dt className="text-xs text-muted">Preferred area</dt><dd className="mt-1 text-main">{request.location_label}{request.radius_miles == null ? ' · any distance' : ` · within ${request.radius_miles} miles`}</dd></div>
      <div><dt className="text-xs text-muted">Maximum daily budget</dt><dd className="mt-1 text-main">{money(request.max_daily_budget)}</dd></div>
      <div><dt className="text-xs text-muted">Posted</dt><dd className="mt-1 text-main">{new Date(request.created_at).toLocaleString()}</dd></div>
      <div><dt className="text-xs text-muted">Expires</dt><dd className="mt-1 text-main">{new Date(request.expires_at).toLocaleString()}</dd></div>
    </dl>
    {(request.intended_use || request.specifications || request.additional_notes) && <div className="space-y-2 text-sm">
      {request.intended_use && <div><h3 className="font-semibold text-main">Intended use</h3><p className="mt-1 whitespace-pre-wrap text-sec">{request.intended_use}</p></div>}
      {request.specifications && <div><h3 className="font-semibold text-main">Specifications</h3><p className="mt-1 whitespace-pre-wrap text-sec">{request.specifications}</p></div>}
      {request.additional_notes && <div><h3 className="font-semibold text-main">Additional notes</h3><p className="mt-1 whitespace-pre-wrap text-sec">{request.additional_notes}</p></div>}
    </div>}
    <div className="space-y-2">
      <h3 className="font-semibold text-main">Matching listings</h3>
      {matchingListings.length === 0 ? <p className="text-sm text-sec">No listings currently match. Your request remains {REQUEST_STATUS_LABEL[request.status].toLowerCase()}.</p>
        : <ul className="space-y-2">{matchingListings.map((listing) => {
          const estimatedRental = Number(listing.price_per_day) * rentalDays * request.requested_quantity;
          return <li key={listing.id} className="rounded-card border border-app p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><a className="font-semibold text-accent underline" href={`/listing/${listing.id}`}>{listing.title}</a>
                <p className="mt-1 text-xs text-sec">${Number(listing.price_per_day).toFixed(2)}/day · {listing.location_label || 'Approximate area unavailable'}</p>
                <p className="mt-1 text-xs text-sec">Estimated rental before fees and deposit: ${estimatedRental.toFixed(2)}. Availability is rechecked when you book.</p>
                {request.max_daily_budget !== null && <p className="mt-1 text-xs text-success">Within your daily budget</p>}
              </div>
              <a className="inline-flex min-h-11 items-center text-sm font-semibold text-accent" href={`/listing/${listing.id}`}>View item <ArrowRight size={14} className="ml-1" /></a>
            </div>
          </li>;
        })}</ul>}
    </div>
    <div className="space-y-2">
      <h3 className="font-semibold text-main">Owner responses</h3>
      {offers.length === 0 ? <p className="text-sm text-sec">No owner offers yet.</p> : <div className="space-y-2">
        {offers.map((offer) => <NegotiationCard key={offer.id} negotiation={offer} currentUserId={currentUserId}
          myListings={myListings} busy={busyOfferId === offer.id} allowCounter={allowCounter}
          setBusy={(value) => setBusyOfferId(value ? offer.id : null)}
          onRefresh={onRefresh} onError={onError} />)}
      </div>}
    </div>
    <div className="space-y-2">
      <h3 className="font-semibold text-main">Request history</h3>
      {eventsLoading && <p role="status" className="text-sm text-sec">Loading request history…</p>}
      {eventsError && <Alert tone="error">{eventsError}</Alert>}
      {!eventsLoading && !eventsError && events?.length === 0 && <p className="text-sm text-sec">No status updates yet.</p>}
      {events && events.length > 0 && <ol className="space-y-2 border-l-2 border-app pl-4">{events.map((event) => <li key={event.id}>
        <p className="text-sm font-medium text-main">{requestEventLabel(event.event_type)}</p>
        <time className="text-xs text-muted" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
      </li>)}</ol>}
    </div>
  </section>;
}

function RequestEditForm({ request, onCancel, onSaved }: {
  request: ItemRequest; onCancel: () => void; onSaved: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState(request.title);
  const [description, setDescription] = useState(request.description);
  const [categoryId, setCategoryId] = useState(request.category_id);
  const [start, setStart] = useState(request.preferred_start_date);
  const [end, setEnd] = useState(request.preferred_end_date);
  const [location, setLocation] = useState(request.location_label);
  const [budget, setBudget] = useState(request.max_daily_budget == null ? '' : String(request.max_daily_budget));
  const [quantity, setQuantity] = useState(String(request.requested_quantity));
  const [intendedUse, setIntendedUse] = useState(request.intended_use ?? '');
  const [specifications, setSpecifications] = useState(request.specifications ?? '');
  const [notes, setNotes] = useState(request.additional_notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { listRequestCategories().then(setCategories).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load categories.')); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await updateItemRequest({
        ...request, title, description, category_id: categoryId, preferred_start_date: start,
        preferred_end_date: end, location_label: location, max_daily_budget: budget ? Number(budget) : null,
        requested_quantity: Number(quantity), intended_use: intendedUse || null,
        specifications: specifications || null, additional_notes: notes || null,
      });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save your changes.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void submit(event)} className="mt-4 pt-4 border-t border-app space-y-3">
    <h3 className="font-semibold text-main">Edit your request</h3>
    <div className="grid sm:grid-cols-2 gap-3">
      <label className="text-xs font-semibold text-sec">Item name<input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass('mt-1')} /></label>
      <label className="text-xs font-semibold text-sec">Category<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={fieldClass('mt-1')}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="text-xs font-semibold text-sec">Start date<DatePicker label="Start date" required min={todayIso()} value={start} onChange={setStart} className="mt-1" /></label>
      <label className="text-xs font-semibold text-sec">End date<DatePicker label="End date" required min={addDaysIso(start || todayIso(), 1)} value={end} onChange={setEnd} className="mt-1" /></label>
      <label className="text-xs font-semibold text-sec">Location<input required disabled={request.location_lat!=null} maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} className={fieldClass('mt-1')} />{request.location_lat!=null&&<span className="block mt-1 text-xs font-normal">For a different verified area, cancel this request and create a new one.</span>}</label>
      <label className="text-xs font-semibold text-sec">Maximum budget per day<input type="number" min="0.01" max="100000" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className={fieldClass('mt-1')} /></label>
      <label className="text-xs font-semibold text-sec">Quantity<input type="number" min="1" max="100" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={fieldClass('mt-1')} /></label>
      <label className="text-xs font-semibold text-sec sm:col-span-2">Description<textarea required minLength={10} maxLength={1200} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={textareaClass('mt-1')} /></label>
      <label className="text-xs font-semibold text-sec">Intended use<textarea maxLength={500} rows={2} value={intendedUse} onChange={(e) => setIntendedUse(e.target.value)} className={textareaClass('mt-1')} /></label>
      <label className="text-xs font-semibold text-sec">Specifications<textarea maxLength={500} rows={2} value={specifications} onChange={(e) => setSpecifications(e.target.value)} className={textareaClass('mt-1')} /></label>
      <label className="text-xs font-semibold text-sec sm:col-span-2">Additional notes<textarea maxLength={1200} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClass('mt-1')} /></label>
    </div>
    {error && <Alert tone="error">{error}</Alert>}
    <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save changes</Button></div>
  </form>;
}

function NegotiationCard({ negotiation, currentUserId, myListings, busy, allowCounter, setBusy, onRefresh, onError }: {
  negotiation: MarketplaceNegotiation; currentUserId: string; myListings: OwnerListing[];
  busy: boolean; allowCounter: boolean; setBusy: (value: boolean) => void; onRefresh: () => void; onError: (value: string | null) => void;
}) {
  const { navigate } = useRouter();
  const latest = [...(negotiation.negotiation_proposals ?? [])].sort((a, b) => b.revision - a.revision)[0];
  const isRenter = negotiation.renter_id === currentUserId;
  const otherId = isRenter ? negotiation.owner_id : negotiation.renter_id;
  const awaitingMe = latest?.proposed_to === currentUserId && latest.status === 'pending';
  const authoredByMe = latest?.proposed_by === currentUserId && latest.status === 'pending';
  const [countering, setCountering] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [counterPrice, setCounterPrice] = useState(latest ? String(latest.daily_rate) : '');
  const [counterStart, setCounterStart] = useState(latest?.start_date ?? '');
  const [counterEnd, setCounterEnd] = useState(latest?.end_date ?? '');
  const [counterMessage, setCounterMessage] = useState('');

  async function respond(action: 'accept' | 'decline' | 'withdraw' | 'counter') {
    setBusy(true); onError(null);
    try {
      const result = await respondToMarketplaceOffer({
        negotiationId: negotiation.id, action,
        ...(action === 'counter' ? {
          dailyRate: Number(counterPrice), startDate: counterStart, endDate: counterEnd, message: counterMessage,
        } : {}),
      });
      if (result.bookingId) {
        navigate({ name: 'confirmation', id: result.bookingId });
        return;
      }
      setCountering(false);
      onRefresh();
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Could not update this offer.'); }
    finally { setBusy(false); }
  }

  async function linkListing() {
    setBusy(true); onError(null);
    try { await linkRequestOfferListing(negotiation.id, linkId); onRefresh(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'Could not link the listing.'); }
    finally { setBusy(false); }
  }

  async function messageOther() {
    setBusy(true); onError(null);
    try {
      const conversationId = await getOrCreateConversation({
        currentUserId, otherUserId: otherId,
        ...(negotiation.listing_id ? { listingId: negotiation.listing_id } : {}),
        ...(negotiation.booking_id ? { bookingId: negotiation.booking_id } : {}),
      });
      navigate({ name: 'conversation', id: conversationId });
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Could not open messages.'); }
    finally { setBusy(false); }
  }

  const listingChoices = myListings.filter((listing) => !negotiation.item_requests
    || (listing.category_id === negotiation.item_requests.category_id
      && listing.available_quantity >= negotiation.item_requests.requested_quantity
      && (negotiation.item_requests.max_daily_budget == null
        || Number(listing.price_per_day) <= Number(negotiation.item_requests.max_daily_budget))));
  return <Surface className="p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-main">{negotiation.item_requests?.title ?? negotiation.listings?.title ?? 'Rental offer'}</h2>
        <p className="mt-1 text-xs text-sec">{isRenter ? 'Owner offer' : 'Renter offer'} · revision {latest?.revision ?? 0}</p>
      </div>
      <Badge tone={STATUS_TONE[negotiation.status]}>{negotiation.status.replace(/_/g, ' ')}</Badge>
    </div>
    {negotiation.listings && <p className="mt-2 text-sm text-main">Linked listing: {negotiation.listings.title}
      <span className="text-xs text-sec"> · advertised ${Number(negotiation.listings.price_per_day).toFixed(2)}/day</span>
    </p>}
    {negotiation.item_requests && <p className="mt-1 text-xs text-sec">Request location: {negotiation.item_requests.location_label}</p>}
    {latest && <p className="mt-2 text-xs text-sec">Current proposal: ${Number(latest.daily_rate).toFixed(2)}/day · {dateLabel(latest.start_date, latest.end_date)} · expires {new Date(latest.expires_at).toLocaleString()}</p>}

    <ol className="mt-4 space-y-2 border-l-2 border-app pl-4" aria-label="Offer revision history">
      {[...(negotiation.negotiation_proposals ?? [])].sort((a, b) => a.revision - b.revision).map((proposal: NegotiationProposal) => (
        <li key={proposal.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent border-2 border-card" />
          <p className="text-sm font-semibold text-main">${Number(proposal.daily_rate).toFixed(2)}/day
            <span className="ml-2 text-xs font-normal text-sec">{proposal.proposed_by === currentUserId ? 'You proposed' : 'Other participant proposed'} · {proposal.status}</span>
          </p>
          <p className="text-xs text-sec mt-0.5">{dateLabel(proposal.start_date, proposal.end_date)} · {new Date(proposal.created_at).toLocaleString()}</p>
          {proposal.message && <p className="text-sm text-sec mt-1 whitespace-pre-wrap">{proposal.message}</p>}
        </li>
      ))}
    </ol>

    {negotiation.item_request_id && !negotiation.listing_id && !isRenter && ['pending', 'countered'].includes(negotiation.status) && (
      <div className="mt-4 p-3 rounded-card bg-subtle">
        <p className="text-sm font-semibold text-main">Link a published listing before this offer can be accepted.</p>
        {listingChoices.length ? <div className="flex flex-wrap gap-2 mt-2">
          <select aria-label="Choose published listing" value={linkId} onChange={(event) => setLinkId(event.target.value)} className={fieldClass('flex-1 !h-10')}>
            <option value="">Select one of your listings</option>{listingChoices.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <Button size="sm" disabled={!linkId} loading={busy} onClick={() => void linkListing()}>Link listing</Button>
        </div> : <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigate({ name: 'create-listing' })}>Create a listing</Button>}
      </div>
    )}
    {negotiation.item_request_id && !negotiation.listing_id && isRenter && ['pending', 'countered'].includes(negotiation.status)
      && <Alert tone="info" className="mt-3">The owner needs to link a published listing before you can accept this offer.</Alert>}
    {negotiation.booking_id && <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate({ name: 'confirmation', id: negotiation.booking_id! })}>
      View resulting booking
    </Button>}

    {countering && <div className="mt-4 p-3 rounded-card bg-subtle space-y-3">
      <h3 className="font-semibold text-sm text-main">Counteroffer</h3>
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="text-xs font-semibold text-sec">Daily price<input type="number" min="0.01" max="100000" step="0.01" value={counterPrice} onChange={(e) => setCounterPrice(e.target.value)} className={fieldClass('mt-1')} /></label>
        <label className="text-xs font-semibold text-sec">Start<DatePicker label="Start" required min={todayIso()} value={counterStart} onChange={setCounterStart} className="mt-1" /></label>
        <label className="text-xs font-semibold text-sec">End<DatePicker label="End" required min={addDaysIso(counterStart || todayIso(), 1)} value={counterEnd} onChange={setCounterEnd} className="mt-1" /></label>
      </div>
      <label className="text-xs font-semibold text-sec">Message<textarea rows={2} maxLength={1000} value={counterMessage} onChange={(e) => setCounterMessage(e.target.value)} className={textareaClass('mt-1')} /></label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => setCountering(false)}>Cancel</Button>
        <Button size="sm" loading={busy} onClick={() => void respond('counter')}>Send counteroffer</Button>
      </div>
    </div>}

    <div className="mt-4 flex flex-wrap gap-2 border-t border-app pt-3">
      {awaitingMe && (negotiation.listing_id || negotiation.item_request_id === null) && <>
        <Button size="sm" disabled={!negotiation.listing_id} loading={busy} onClick={() => void respond('accept')} icon={<Check size={14} />}>
          Accept and create booking
        </Button>
        {allowCounter && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setCountering((value) => !value)}>Counter</Button>}
        <Button size="sm" variant="danger" loading={busy} onClick={() => void respond('decline')}>Decline</Button>
      </>}
      {authoredByMe && <Button size="sm" variant="danger" loading={busy} onClick={() => void respond('withdraw')}>Withdraw offer</Button>}
      <Button size="sm" variant="ghost" disabled={busy} icon={<MessageSquare size={14} />} onClick={() => void messageOther()}>Message participant</Button>
    </div>
  </Surface>;
}

function RequestSkeleton() {
  return <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((index) =>
    <Skeleton key={index} className="h-36 w-full" rounded="rounded-card-lg" />)}</div>;
}

export function NeedSomethingPage() {
  const { user, openSignIn } = useAuth();
  const { back, navigate } = useRouter();
  const requestId = useRef(crypto.randomUUID());
  const idempotencyKey = useRef(crypto.randomUUID());
  const { enabled, loading: flagLoading, error: flagError, reload: reloadFlag } = useFeatureFlag('item_requests');
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [intendedUse, setIntendedUse] = useState('');
  const [startDate, setStartDate] = useState(addDaysIso(todayIso(), 1));
  const [endDate, setEndDate] = useState(addDaysIso(todayIso(), 2));
  const [location, setLocation] = useState('');
  const [selectedArea,setSelectedArea]=useState<MarketplaceLocation|null>(null);
  const [areaChoices,setAreaChoices]=useState<MarketplaceLocation[]>([]);
  const [findingArea,setFindingArea]=useState(false);
  const [radius,setRadius]=useState<number|null>(5);
  const [existingMatches,setExistingMatches]=useState<Listing[]|null>(null);
  const [reviewedMatches,setReviewedMatches]=useState(false);
  const [budget, setBudget] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [specifications, setSpecifications] = useState('');
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  useEffect(()=>{
    setReviewedMatches(false);
    setExistingMatches(null);
  },[title,categoryId,startDate,endDate,budget,quantity,selectedArea,radius]);

  useEffect(() => {
    let cancelled = false;
    listRequestCategories()
      .then((rows) => {
        if (cancelled) return;
        setCategories(rows);
        setCategoryId('');
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load request settings.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedArea) { setError('Choose a city or postal code so nearby owners can find your request.'); return; }
    if (!user) { openSignIn(); return; }
    if (!acknowledged) { setError('Confirm that your request details will be visible to signed-in owners.'); return; }
    setBusy(true); setError(null);
    try {
      if(!selectedArea||selectedArea.latitude===undefined||selectedArea.longitude===undefined)throw new Error('Find and select your preferred city or postal code before posting.');
      const matches=await searchListings({keyword:title,categoryId,latitude:selectedArea.latitude,longitude:selectedArea.longitude,
        radiusMiles:radius,startDate,endDate,maxPrice:budget?Number(budget):undefined,pageSize:5});
      setExistingMatches(matches.rows.map(toUiListing));
      if(matches.rows.length>0&&!reviewedMatches)return;
      await createItemRequest({
        id: requestId.current, idempotencyKey: idempotencyKey.current,
        categoryId, title, description, intendedUse, startDate, endDate, location,
        maxDailyBudget: budget ? Number(budget) : null,
        quantity: Number(quantity), specifications, notes, images,
        latitude:selectedArea.latitude,longitude:selectedArea.longitude,radiusMiles:radius,country:selectedArea.country,
      }, user.id);
      setComplete(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not post your request.'); }
    finally { setBusy(false); }
  }

  if (flagError) return <div className="max-w-2xl mx-auto px-4 py-10"><Alert tone="error" title="Could not load request settings">
    {flagError}<Button size="sm" variant="secondary" className="mt-3" onClick={reloadFlag}>Try again</Button>
  </Alert></div>;
  if (loading || flagLoading) return <div className="max-w-2xl mx-auto px-4 py-8 space-y-3" aria-busy="true"><Skeleton className="h-8 w-52" /><Skeleton className="h-96 w-full" rounded="rounded-card-lg" /></div>;
  if (error && categories.length === 0) return <div className="max-w-2xl mx-auto px-4 py-10"><Alert tone="error">{error}</Alert></div>;
  if (!enabled) return <div className="max-w-xl mx-auto px-4 py-12"><EmptyState title="Item requests are not enabled yet"
    description="An authorized administrator can enable the item_requests feature flag after the backend migration is installed." /></div>;
  if (complete) return <div className="max-w-xl mx-auto px-4 py-12 sm:py-16">
    <Surface className="p-5 sm:p-7">
      <div className="grid place-items-center w-12 h-12 rounded-full bg-success-soft text-success"><Check size={23} /></div>
      <h1 className="mt-5 text-2xl font-bold text-main font-display">Your request is posted</h1>
      <p className="mt-2 text-sm text-sec">Nearby owners can review it and send you an offer. You can track replies in your requests.</p>
      <dl className="mt-5 divide-y divide-app rounded-card-lg border border-app px-4">
        <div className="py-3"><dt className="text-xs text-muted">Item</dt><dd className="mt-1 font-semibold text-main">{title}</dd></div>
        <div className="py-3"><dt className="text-xs text-muted">Rental dates</dt><dd className="mt-1 text-sm text-main">{new Date(`${startDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} – {new Date(`${endDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</dd></div>
        <div className="py-3"><dt className="text-xs text-muted">Preferred area</dt><dd className="mt-1 text-sm text-main">{location}</dd></div>
      </dl>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <Button onClick={() => navigate({ name: 'requests', tab: 'mine' })}>View my requests</Button>
        <Button variant="secondary" onClick={() => navigate({ name: 'search' })}>Continue exploring</Button>
      </div>
    </Surface>
  </div>;

  return <div className="animate-fade-in pb-20 md:pb-10">
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
      <button onClick={back} className="inline-flex items-center gap-1.5 text-sm text-sec mb-4 hover:text-main"><ArrowLeft size={16} /> Back</button>
      <SectionHeader as="h1" title="Request an item" subtitle="Share what you need and owners can respond with a listing and price." className="mb-6" />
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Surface className="p-4 sm:p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-sec">Item name<span className="text-error"> *</span>
              <input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Projector" className={fieldClass('mt-1')} />
            </label>
            <label className="text-xs font-semibold text-sec">Category<span className="text-error"> *</span>
              <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={fieldClass('mt-1')}>
                <option value="" disabled>Choose a category</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs font-semibold text-sec">Description<span className="text-error"> *</span>
            <textarea required minLength={10} maxLength={1200} rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the item and any key requirements." className={textareaClass('mt-1')} />
            <span className="block text-right text-[11px] font-normal text-muted">{description.length}/1,200</span>
          </label>
          <label className="block text-xs font-semibold text-sec">Intended use (optional)
            <input maxLength={500} value={intendedUse} onChange={(e) => setIntendedUse(e.target.value)} placeholder="What will you use it for?" className={fieldClass('mt-1')} />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-sec">Rental start<span className="text-error"> *</span>
              <DatePicker label="Rental start" required min={addDaysIso(todayIso(), 1)} value={startDate} onChange={setStartDate} className="mt-1" />
            </label>
            <label className="text-xs font-semibold text-sec">Rental end<span className="text-error"> *</span>
              <DatePicker label="Rental end" required min={addDaysIso(startDate || todayIso(), 1)} value={endDate} onChange={setEndDate} className="mt-1" />
            </label>
            <label className="text-xs font-semibold text-sec">Preferred area<span className="text-error"> *</span>
              <input required maxLength={200} value={location} onChange={(e) => {setLocation(e.target.value);setSelectedArea(null);setAreaChoices([]);setReviewedMatches(false);}} placeholder="City or postal code" className={fieldClass('mt-1')} />
              <Button type="button" size="sm" variant="secondary" className="mt-2" loading={findingArea} onClick={async()=>{
                setFindingArea(true);setError(null);
                try{
                  const cities=await findCities(location);
                  setAreaChoices(cities);
                  if(!cities.length)throw new Error('No matching city or postal code was found. Try another area.');
                }catch(error){setError(error instanceof Error?error.message:'Could not look up this area.');}
                finally{setFindingArea(false);}
              }}>Find area</Button>
              {selectedArea&&<span role="status" className="block mt-1 text-xs text-success">Verified search area selected.</span>}
            </label>
            <label className="text-xs font-semibold text-sec">Search radius<select value={radius??'unlimited'} onChange={event=>{setRadius(event.target.value==='unlimited'?null:Number(event.target.value));setReviewedMatches(false);}} className={fieldClass('mt-1')}>
              {[5,10,25,50].map(miles=><option key={miles} value={miles}>{miles} miles</option>)}<option value="unlimited">Unlimited distance</option>
            </select></label>
            <label className="text-xs font-semibold text-sec">Maximum daily budget (optional)
              <span className="relative block mt-1"><DollarSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input type="number" min="0.01" max="100000" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Any budget" className={fieldClass('pl-9')} />
              </span>
            </label>
            <label className="text-xs font-semibold text-sec">Quantity
              <input type="number" min="1" max="100" step="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={fieldClass('mt-1')} />
            </label>
            <label className="text-xs font-semibold text-sec">Specifications / accessories (optional)
              <input maxLength={500} value={specifications} onChange={(e) => setSpecifications(e.target.value)} placeholder="Sizes, required accessories…" className={fieldClass('mt-1')} />
            </label>
          </div>
          {areaChoices.length>0&&<div className="flex flex-wrap gap-2" role="group" aria-label="Choose request area">{areaChoices.map((area,index)=><Button key={`${area.city}:${index}`} type="button" size="sm" variant="secondary" onClick={()=>{
            setSelectedArea(area);setLocation(locationLabel(area));setAreaChoices([]);setReviewedMatches(false);
          }}>{locationLabel(area)}</Button>)}</div>}
          {existingMatches!==null&&<div className="rounded-card border border-app p-3">
            <p role="status" className="text-sm font-semibold text-main">{existingMatches.length?'Existing listings may meet your request. Review these or confirm that you still want to post.':'No matching listings found for this keyword, category, area, dates and budget.'}</p>
            <ul className="mt-2 space-y-2">{existingMatches.map(listing=><li key={listing.id}><a href={`/listing/${listing.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">{listing.title} · ${listing.pricePerDay}/day (opens a new tab)</a></li>)}</ul>
            {existingMatches.length>0&&<label className="flex gap-2 items-start text-sm text-sec mt-3"><input type="checkbox" checked={reviewedMatches} onChange={event=>setReviewedMatches(event.target.checked)}/>I reviewed these listings and still want to post my request.</label>}
          </div>}
          <label className="block text-xs font-semibold text-sec">Additional notes (optional)
            <textarea maxLength={1200} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClass('mt-1')} />
          </label>
          <label className="block text-xs font-semibold text-sec">Reference images (optional, up to 4; JPEG, PNG or WebP, 5 MB each)
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setImages(Array.from(e.target.files ?? []).slice(0, 4))} className="block mt-2 w-full text-sm text-sec file:mr-3 file:rounded-card file:border file:border-app file:bg-subtle file:px-3 file:py-2 file:text-xs file:font-semibold file:text-main" />
            {images.length > 0 && <span className="block mt-2 text-xs text-sec">{images.map((image) => image.name).join(', ')}</span>}
          </label>
          <p className="flex items-center gap-2 text-xs text-sec"><Clock size={14} /> Requests are public to signed-in owners and expire after 30 days.</p>
          <label className="flex items-start gap-2 text-sm text-sec">
            <input type="checkbox" required checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
            <span>I understand this request is visible to signed-in owners while it is open.</span>
          </label>
        </Surface>
        {error && <Alert tone="error" title="Request was not posted">{error}</Alert>}
        <Button type="submit" fullWidth loading={busy} loadingLabel="Posting your request…" icon={<ArrowRight size={16} />}>Post request</Button>
        <p className="text-center text-xs text-muted">No payment is due to post a request. Any accepted offer still follows YBuy's normal checkout and payment verification.</p>
      </form>
    </div>
  </div>;
}
