import { createContext, useContext, useState, type ReactNode } from 'react';
import { auctions, conversations, currentUser, listings as fixtures, myBookings, needRequests, rentalRequests, type Listing } from '@/data';
import { addDays, defaultAvail, eachDay, lockedDays, parseIso, toIso, todayIso, type Avail } from '../preview/dates';
import { DEFAULT_SEARCH, type SearchState } from '../preview/ctx';

export const pages = [
  ['home', 'Home', 'Discover'], ['search', 'Browse rentals', 'Discover'], ['listing', 'Item details', 'Discover'],
  ['bidding', 'Live bidding', 'Discover'], ['auction', 'Bidding room', 'Discover'], ['requests', 'Community requests', 'Discover'],
  ['checkout', 'Booking', 'Rent'], ['confirmation', 'Booking result', 'Rent'], ['renter', 'My rentals', 'Rent'],
  ['favorites', 'Saved items', 'Rent'], ['owner', 'Owner overview', 'Lend'], ['listings', 'My listings', 'Lend'],
  ['create', 'Create a listing', 'Lend'], ['payouts', 'Earnings & payouts', 'Lend'], ['messages', 'Messages', 'Account'],
  ['notifications', 'Notifications', 'Account'], ['profile', 'Profile & settings', 'Account'], ['admin', 'Admin workspace', 'Admin'],
  ['states', 'Interface states', 'Preview'],
] as const;
export type PageName = typeof pages[number][0];
export interface Route { name: PageName; id?: string }
export const href = (name: PageName, id?: string) => {
  if (window.location.pathname.startsWith('/preview-1')) return `#/${name}${id ? `/${encodeURIComponent(id)}` : ''}`;
  const key = id ? encodeURIComponent(id) : '';
  const paths: Record<PageName, string> = {
    home: '/', search: '/search', listing: `/listing/${key}`, bidding: '/bidding', auction: `/auction/${key}`,
    requests: '/requests', checkout: `/checkout/${key}`, confirmation: `/confirmation/${key}`,
    renter: '/dashboard?tab=renting', favorites: '/favorites', owner: '/dashboard?tab=lending',
    listings: '/dashboard/listings', create: id ? `/edit-listing/${key}` : '/create-listing',
    payouts: '/payouts', messages: id ? `/messages/${key}` : '/messages', notifications: '/notifications',
    profile: '/profile', admin: id ? `/admin/${key}` : '/admin', states: '/guidelines',
  };
  return paths[name];
};
export function parseRoute(): Route {
  const [name, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  const match = pages.find((p) => p[0] === name);
  if (!match) return { name: 'home' };
  try { return { name: match[0], id: id ? decodeURIComponent(id) : undefined }; }
  catch { return { name: 'states', id: 'invalid-route' }; }
}

export interface DemoBooking {
  id: string; listingId: string; start: string; end: string; total: number;
  status: 'pending' | 'approved' | 'upcoming' | 'active' | 'past' | 'cancelled';
  pickup: 'pickup' | 'delivery'; note: string; disputed?: boolean; issue?: string; resolved?: boolean;
}
export interface DemoBid { id: string; amount: number; mine: boolean }
export interface BidRoom { bids: DemoBid[]; count: number; closes: number; phase: 'live' | 'decision' | 'payment' | 'confirmed'; selected?: string }
export interface Notice { id: string; title: string; body: string; read: boolean; to: PageName; itemId?: string }

export function availabilityProblem(avail: Avail, locked: string[] = []): string | null {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && toIso(parseIso(value)) === value;
  if (!validDate(avail.start) || !validDate(avail.end) || avail.end <= avail.start) return 'Choose a start and end for your availability window.';
  const days = eachDay(avail.start, avail.end);
  if (days.length > 30) return 'Your listing can be open for at most 30 calendar days.';
  if (locked.some((d) => d < avail.start || d > avail.end || avail.blocked.includes(d))) return 'Keep confirmed rental days inside your window and unblocked.';
  if (!days.some((d) => !avail.blocked.includes(d) && !locked.includes(d))) return 'Keep at least one unbooked day open.';
  return null;
}

function useStore() {
  const [items, setItems] = useState<Listing[]>(() => fixtures.map((l, i) => ({ ...l, listingStatus: i === 5 || i === 6 ? 'pending_approval' : 'published' })));
  const [search, updateSearch] = useState<SearchState>(DEFAULT_SEARCH);
  const [availability, setAvailability] = useState<Record<string, Avail>>({});
  const [saved, setSaved] = useState(['l1', 'l4']);
  const [bookings, setBookings] = useState<DemoBooking[]>(() => myBookings.map((b, i) => ({
    id: b.id, listingId: b.listing.id, start: addDays(todayIso(), i === 1 ? -1 : 3 + i * 3),
    end: addDays(todayIso(), i === 1 ? 2 : 5 + i * 3), status: b.status, total: b.total, pickup: 'pickup', note: '',
  })));
  const [ownerRequests, setOwnerRequests] = useState(() => rentalRequests.map((r, i) => ({
    ...r, startDate: addDays(todayIso(), 2 + i * 4), endDate: addDays(todayIso(), 4 + i * 4),
  })));
  const [requests, setRequests] = useState(() => needRequests.map((r, i) => ({ ...r, when: `${addDays(todayIso(), i + 2)} – ${addDays(todayIso(), i + 4)}` })));
  const [requestMatches, setRequestMatches] = useState<Record<string, string[]>>({});
  const [userStatuses, setUserStatuses] = useState<Record<string, 'active' | 'suspended'>>({});
  const [adminSettings, setAdminSettings] = useState({ maintenance: false, reviewNewListings: true, emailUpdates: true });
  const [claimStatuses, setClaimStatuses] = useState<Record<string, 'resolved' | 'under-review'>>({});
  const [threads, setThreads] = useState(() => conversations.map((c) => ({ ...c, messages: [...c.messages] })));
  const [rooms, setRooms] = useState<Record<string, BidRoom>>(() => Object.fromEntries(auctions.map((a) => [a.id, {
    bids: a.bids.map((b) => ({ id: b.id, amount: b.amount, mine: false })), count: 0,
    closes: Date.now() + a.endsInHours * 3600000, phase: 'live',
  }])));
  const [profile, setProfile] = useState({ name: currentUser.name, bio: currentUser.bio, email: 'john@example.com', phone: '(214) 555-0123', updates: true });
  const [signedIn, setSignedIn] = useState(true);
  const [notices, setNotices] = useState<Notice[]>([
    { id: 'n1', title: 'Your pickup is coming up', body: 'Check your dates and arrange pickup with the owner.', read: false, to: 'renter' },
    { id: 'n2', title: 'A new request is waiting', body: 'Review your next rental request in the owner workspace.', read: false, to: 'owner' },
    { id: 'n3', title: 'New message from Alex', body: 'The camera kit is ready when you are.', read: false, to: 'messages' },
  ]);
  const [feedback, setFeedback] = useState<{ message: string; party: boolean; id: number } | null>(null);
  const notify = (message: string, party = false) => setFeedback({ message, party, id: Date.now() });
  const addNotice = (title: string, body: string, to: PageName, itemId?: string) => setNotices((prev) => [
    { id: crypto.randomUUID(), title, body, to, itemId, read: false }, ...prev,
  ]);
  const lockedFor = (id: string) => [...new Set([
    ...(fixtures.some((l) => l.id === id) ? lockedDays(id) : []),
    ...bookings.filter((b) => b.listingId === id && ['upcoming', 'active'].includes(b.status)).flatMap((b) => eachDay(b.start, b.end)),
  ])];
  const availFor = (id: string) => {
    if (availability[id]) return availability[id];
    const base = defaultAvail(id), locked = lockedFor(id);
    const start = [base.start, ...locked].sort()[0], end = addDays(start, 29);
    return { start, end, blocked: base.blocked.filter((d) => d >= start && d <= end && !locked.includes(d)) };
  };
  const blockedFor = (id: string) => new Set([...availFor(id).blocked, ...lockedFor(id)]);
  const setSearch = (patch: Partial<SearchState>) => updateSearch((s) => ({ ...s, ...patch }));
  const toggleSaved = (id: string) => setSaved((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const saveAvailability = (id: string, next: Avail) => {
    const problem = availabilityProblem(next, lockedFor(id));
    if (problem) { notify(problem); return false; }
    setAvailability((prev) => ({ ...prev, [id]: next }));
    return true;
  };
  const availableRange = (id: string, start: string, end: string) => {
    const a = availFor(id);
    return Boolean(start && end && end > start && start >= todayIso() && start >= a.start && end <= a.end
      && eachDay(start, end).every((d) => !blockedFor(id).has(d)));
  };
  const firstRange = (id: string, length = 2) => {
    const a = availFor(id);
    for (let d = a.start > todayIso() ? a.start : todayIso(); d <= a.end; d = addDays(d, 1)) {
      const end = addDays(d, length);
      if (availableRange(id, d, end)) return { start: d, end };
    }
    return { start: '', end: '' };
  };
  return {
    items, setItems, search, setSearch, saved, toggleSaved, bookings, setBookings, availability, availFor, lockedFor,
    blockedFor, saveAvailability, availableRange, firstRange, ownerRequests, setOwnerRequests, requests, setRequests,
    threads, setThreads, rooms, setRooms, profile, setProfile, signedIn, setSignedIn, notices, setNotices,
    requestMatches, setRequestMatches, userStatuses, setUserStatuses, adminSettings, setAdminSettings, claimStatuses, setClaimStatuses,
    feedback, setFeedback, notify, addNotice,
  };
}
type Store = ReturnType<typeof useStore>;
const Context = createContext<Store | null>(null);
export function useOptionalPreview() { return useContext(Context); }
export function PreviewProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function usePreview() {
  const store = useContext(Context);
  if (!store) throw new Error('Preview-1 provider is missing.');
  return store;
}
