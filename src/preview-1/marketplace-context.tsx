import { createContext, useContext, type ReactNode } from 'react';
import type { Category, Listing } from '@/data';
import type { SearchState } from '../preview/ctx';
import type { Avail } from '../preview/dates';
import { href, useOptionalPreview, type PageName } from './state';

export interface MarketplaceStore {
  production: boolean;
  items: Listing[];
  categories: Category[];
  search: SearchState;
  setSearch: (patch: Partial<SearchState>) => void;
  saved: string[];
  toggleSaved: (id: string) => void;
  availFor: (id: string) => Avail;
  blockedFor: (id: string) => Set<string>;
  availableRange: (id: string, start: string, end: string) => boolean;
  firstRange: (id: string, length?: number) => { start: string; end: string };
  navigate: (name: PageName, id?: string) => void;
  contact: (item: Listing) => void;
  distance: (item: Listing) => number;
  rentalQuote: (item: Listing, days: number) => { rental: number; fee: number; insurance?: number; tax?: number };
  checkout?: {
    create: (params: { listingId: string; startDate: string; endDate: string; deliveryMode: 'pickup' | 'delivery'; renterNote: string }) => Promise<{ id: string; paymentRequired: boolean; taxAmount: number; sandboxTax: boolean; rentalTotal: number; total: number }>;
    pay: (id: string) => Promise<void>;
    options?: ReactNode;
  };
  loading: boolean;
  error: string | null;
  retry: () => void;
  total: number;
  hasMore: boolean;
  loadMore: () => void;
}

const Context = createContext<MarketplaceStore | null>(null);
export function MarketplaceProvider({ value, children }: { value: MarketplaceStore; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMarketplace(): MarketplaceStore {
  const production = useContext(Context);
  const preview = useOptionalPreview();
  if (production) return production;
  if (!preview) throw new Error('Marketplace provider is missing.');
  return {
    ...preview, production: false, categories: [], loading: false, error: null,
    total: preview.items.length, hasMore: false, retry: () => {}, loadMore: () => {},
    navigate: (name, id) => { window.location.hash = href(name, id); },
    contact: (item) => {
      let thread = preview.threads.find((row) => row.name === item.owner.name);
      if (!thread) {
        thread = {
          id: crypto.randomUUID(), name: item.owner.name, avatar: item.owner.avatar,
          listingTitle: item.title, listingImage: item.images[0], lastMessage: 'Start a conversation about this rental.',
          lastTime: 'Now', unread: 0, messages: [],
        };
        const created = thread;
        preview.setThreads((rows) => [created, ...rows]);
      }
      window.location.hash = href('messages', thread.id);
    },
    distance: (item) => item.distance,
    rentalQuote: (item, days) => ({ rental: item.pricePerDay * days, fee: Math.round(item.pricePerDay * days * 0.1) }),
  };
}
