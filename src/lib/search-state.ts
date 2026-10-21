import type { SearchSortBy } from '@/lib/listings';

export const SEARCH_RADII = [5, 10, 25, 50] as const;
export type SearchRadius = typeof SEARCH_RADII[number] | null;

export interface SearchState {
  q: string;
  category?: string;
  start: string;
  end: string;
  radius: SearchRadius;
  maxPrice: number;
  minRating: number;
  verifiedOnly: boolean;
  instantOnly: boolean;
  protectionOnly: boolean;
  deliveryOnly: boolean;
  sortBy: SearchSortBy | 'rating';
}

export function parseSearchRadius(value: string | null): SearchRadius {
  if (value === 'any') return null;
  return SEARCH_RADII.find((radius) => String(radius) === value) ?? 5;
}

export function readSearchState(params: URLSearchParams): SearchState {
  const price = Number(params.get('maxPrice'));
  const rating = Number(params.get('minRating'));
  const sort = params.get('sort');
  return {
    q: params.get('q') ?? '',
    category: params.get('category') || undefined,
    start: params.get('start') ?? '',
    end: params.get('end') ?? '',
    radius: parseSearchRadius(params.get('radius')),
    maxPrice: Number.isFinite(price) && price >= 10 && price <= 200 ? price : 200,
    minRating: Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : 0,
    verifiedOnly: params.get('verified') === '1',
    instantOnly: params.get('instant') === '1',
    protectionOnly: params.get('protection') === '1',
    deliveryOnly: params.get('delivery') === '1',
    sortBy: sort === 'newest' || sort === 'price-low' || sort === 'price-high' || sort === 'distance' || sort === 'rating' ? sort : 'recommended',
  };
}

export function searchStateParams(state: Partial<SearchState>): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category) params.set('category', state.category);
  if (state.start) params.set('start', state.start);
  if (state.end) params.set('end', state.end);
  params.set('radius', state.radius === null ? 'any' : String(state.radius ?? 5));
  if (state.maxPrice !== undefined && state.maxPrice < 200) params.set('maxPrice', String(state.maxPrice));
  if (state.minRating) params.set('minRating', String(state.minRating));
  if (state.verifiedOnly) params.set('verified', '1');
  if (state.instantOnly) params.set('instant', '1');
  if (state.protectionOnly) params.set('protection', '1');
  if (state.deliveryOnly) params.set('delivery', '1');
  if (state.sortBy && state.sortBy !== 'recommended') params.set('sort', state.sortBy);
  return params;
}

const STORAGE_KEY = 'ybuy-search-state';

export function savedSearchState(): SearchState {
  try {
    return readSearchState(new URLSearchParams(sessionStorage.getItem(STORAGE_KEY) ?? ''));
  } catch (error) {
    console.warn('Could not restore search preferences.', error);
    return readSearchState(new URLSearchParams());
  }
}

export function saveSearchState(state: SearchState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, searchStateParams(state).toString());
  } catch (error) {
    console.warn('Could not save search preferences; the search URL is still available.', error);
  }
}
