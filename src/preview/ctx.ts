import { createContext, useContext } from 'react';
import type { Avail, Radius } from './dates';

export type RouteName =
  | 'home' | 'search' | 'listing' | 'checkout' | 'confirmation'
  | 'renter' | 'owner' | 'create' | 'bidding' | 'auction'
  | 'requests' | 'messages' | 'notifications' | 'favorites'
  | 'profile' | 'admin' | 'states';

export interface PRoute { name: RouteName; id?: string }

export type Sort = 'recommended' | 'price' | 'distance' | 'rating';

/** One shared search so filters survive navigating to a listing and back. */
export interface SearchState {
  q: string;
  cat: string;
  loc: string;
  radius: Radius;
  start: string;
  end: string;
  instant: boolean;
  openOnly: boolean;
  maxPrice: number;
  sort: Sort;
}

export const DEFAULT_SEARCH: SearchState = {
  q: '', cat: 'All', loc: 'Irving, TX', radius: 5, start: '', end: '', instant: false, openOnly: false, maxPrice: 130, sort: 'recommended',
};

export interface PCtx {
  route: PRoute;
  go: (name: RouteName, id?: string) => void;
  /** Quiet confirmation for small actions. */
  toast: (message: string) => void;
  /** Confetti plus a bright toast for the moments that deserve it. */
  celebrate: (message: string, headline?: string) => void;
  favs: Set<string>;
  toggleFav: (id: string) => void;
  openSignIn: () => void;
  search: SearchState;
  setSearch: (patch: Partial<SearchState>) => void;
  availFor: (listingId: string) => Avail;
  setAvail: (listingId: string, avail: Avail) => void;
}

export const PContext = createContext<PCtx | null>(null);

export function useP(): PCtx {
  const value = useContext(PContext);
  if (!value) throw new Error('Preview context missing');
  return value;
}

export const SCREENS: { name: RouteName; id?: string; label: string; group: string; note: string }[] = [
  { name: 'home', label: 'Homepage', group: 'Marketplace', note: 'Editorial discovery, search with place, radius and dates' },
  { name: 'search', label: 'Search & filters', group: 'Marketplace', note: 'Radius, date range, filters, sort, list and map' },
  { name: 'listing', id: 'l1', label: 'Listing details', group: 'Marketplace', note: 'Gallery, date range, price breakdown, trust' },
  { name: 'bidding', label: 'Bidding', group: 'Marketplace', note: 'Live offers with countdowns' },
  { name: 'auction', id: 'a1', label: 'Place a bid', group: 'Marketplace', note: 'Bid history and bid placement' },
  { name: 'requests', label: 'Requests & offers', group: 'Marketplace', note: 'Ask for items, make offers' },
  { name: 'checkout', id: 'l1', label: 'Booking', group: 'Renter', note: 'Dates, pickup, payment in three steps' },
  { name: 'confirmation', id: 'l1', label: 'Booking confirmed', group: 'Renter', note: 'Reassurance and next steps' },
  { name: 'renter', label: 'Your rentals', group: 'Renter', note: 'Upcoming, active and past rentals' },
  { name: 'favorites', label: 'Saved items', group: 'Renter', note: 'Heart anything, find it here' },
  { name: 'messages', label: 'Messages', group: 'Renter', note: 'Conversations with owners' },
  { name: 'notifications', label: 'Notifications', group: 'Renter', note: 'Grouped updates' },
  { name: 'owner', label: 'Owner workspace', group: 'Owner', note: 'Requests, availability, listings' },
  { name: 'create', label: 'List an item', group: 'Owner', note: 'Guided steps with a 30-day availability window' },
  { name: 'create', id: 'l1', label: 'Edit a listing', group: 'Owner', note: 'Change details, dates and blocked days later' },
  { name: 'profile', label: 'Profile & trust', group: 'Account', note: 'Verification and settings' },
  { name: 'admin', label: 'Admin workspace', group: 'Admin', note: 'Moderation queue, users, disputes' },
  { name: 'states', label: 'Loading, empty, error', group: 'Polish', note: 'Every state a user can meet' },
];
