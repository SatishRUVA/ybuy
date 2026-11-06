import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readSearchState, searchStateParams, type SearchState } from '@/lib/search-state';
import { UUID_RE } from '@/lib/text-safety';

export type Route =
  | { name: 'home' }
  | { name: 'dashboard'; tab?: 'renting' | 'lending' }
  | { name: 'owner-listings' }
  | { name: 'owner-payouts' }
  | ({ name: 'search'; lat?: number; lng?: number; locationLabel?: string } & Partial<SearchState>)
  | { name: 'listing'; id: string; requestId?: string }
  | { name: 'checkout'; id: string; startDate?: string; endDate?: string; quantity?: number }
  | { name: 'confirmation'; id: string }
  | { name: 'renter-dashboard' }
  | { name: 'owner-dashboard' }
  | { name: 'create-listing'; requestId?: string }
  | { name: 'edit-listing'; id: string; requestId?: string }
  | { name: 'check-in'; id: string }
  | { name: 'check-out'; id: string }
  | { name: 'item-passport'; id: string }
  | { name: 'claims' }
  | { name: 'claim-detail'; id: string }
  | { name: 'support'; id?: string }
  | { name: 'wallet' }
  | { name: 'trust-profile' }
  | { name: 'messaging' }
  | { name: 'conversation'; id: string }
  | { name: 'requests'; tab?: 'browse' | 'mine' | 'offers'; requestId?: string; matches?: boolean }
  | { name: 'favorites' }
  | { name: 'need-something' }
  | { name: 'protection' }
  | { name: 'notifications' }
  | { name: 'bidding' }
  | { name: 'bidding-detail'; id: string }
  | { name: 'auction'; id: string }
  | { name: 'guidelines' }
  | { name: 'admin'; section?: string }
  | { name: 'access' };

interface RouterContextValue {
  route: Route;
  navigate: (route: Route) => void;
  back: () => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

/** Route <-> real URL path mapping so pages are deep-linkable (no `#` hash routes). */
function routeToPath(route: Route): string {
  switch (route.name) {
    case 'home': return '/';
    case 'dashboard': return route.tab ? `/dashboard?tab=${route.tab}` : '/dashboard';
    case 'owner-listings': return '/dashboard/listings';
    case 'owner-payouts': return '/payouts';
    case 'search': {
      const params = searchStateParams(route);
      if (route.lat != null && route.lng != null) {
        params.set('lat', String(route.lat));
        params.set('lng', String(route.lng));
      }
      if (route.locationLabel) params.set('loc', route.locationLabel);
      const qs = params.toString();
      return qs ? `/search?${qs}` : '/search';
    }
    case 'listing': return `/listing/${route.id}${route.requestId ? `?request=${encodeURIComponent(route.requestId)}` : ''}`;
    case 'checkout': {
      const params = new URLSearchParams();
      if (route.startDate) params.set('start', route.startDate);
      if (route.endDate) params.set('end', route.endDate);
      if (route.quantity && route.quantity !== 1) params.set('qty', String(route.quantity));
      const qs = params.toString();
      return `/checkout/${route.id}${qs ? `?${qs}` : ''}`;
    }
    case 'confirmation': return `/confirmation/${route.id}`;
    case 'renter-dashboard': return '/dashboard?tab=renting';
    case 'owner-dashboard': return '/dashboard?tab=lending';
    case 'create-listing': return `/create-listing${route.requestId ? `?request=${encodeURIComponent(route.requestId)}` : ''}`;
    case 'edit-listing': return `/edit-listing/${route.id}${route.requestId ? `?request=${encodeURIComponent(route.requestId)}` : ''}`;
    case 'check-in': return `/check-in/${route.id}`;
    case 'check-out': return `/check-out/${route.id}`;
    case 'item-passport': return `/item-passport/${route.id}`;
    case 'claims': return '/claims';
    case 'claim-detail': return `/claims/${route.id}`;
    case 'support': return route.id ? `/support/${route.id}` : '/support';
    case 'wallet': return '/wallet';
    case 'trust-profile': return '/profile';
    case 'messaging': return '/messages';
    case 'conversation': return `/messages/${route.id}`;
    case 'requests': return route.requestId && route.matches ? `/requests/${route.requestId}/matches`
      : route.tab && route.tab !== 'browse' ? `/requests?tab=${route.tab}` : '/requests';
    case 'favorites': return '/favorites';
    case 'need-something': return '/need-something';
    case 'protection': return '/protection';
    case 'notifications': return '/notifications';
    case 'bidding': return '/bidding';
    case 'bidding-detail': return `/bidding/${route.id}`;
    case 'auction': return `/auction/${route.id}`;
    case 'guidelines': return '/guidelines';
    case 'admin': return route.section ? `/admin/${route.section}` : '/admin';
    case 'access': return '/access';
  }
}

function pathToRoute(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  const [first, second] = parts;
  switch (first) {
    case 'edit-listing': return second ? { name: 'edit-listing',id: second, requestId: new URLSearchParams(search).get('request') ?? undefined } : { name: 'owner-dashboard' };
    case undefined: return { name: 'home' };
    case 'search': {
      const qp = new URLSearchParams(search);
      const lat = Number(qp.get('lat'));
      const lng = Number(qp.get('lng'));
      return {
        name: 'search',
        ...readSearchState(qp),
        lat: Number.isFinite(lat) && qp.has('lat') ? lat : undefined,
        lng: Number.isFinite(lng) && qp.has('lng') ? lng : undefined,
        locationLabel: qp.get('loc') ?? undefined,
      };
    }
    case 'listing': return second ? { name: 'listing', id: second, requestId: new URLSearchParams(search).get('request') ?? undefined } : { name: 'home' };
    case 'checkout': {
      if (!second) return { name: 'home' };
      const qp = new URLSearchParams(search);
      const qty = Number(qp.get('qty'));
      return {
        name: 'checkout',
        id: second,
        startDate: qp.get('start') ?? undefined,
        endDate: qp.get('end') ?? undefined,
        quantity: qty > 0 ? qty : undefined,
      };
    }
    case 'confirmation': return second ? { name: 'confirmation', id: second } : { name: 'home' };
    case 'dashboard': {
      const params = new URLSearchParams(search);
      if (second === 'listings') return { name: 'owner-listings' };
      if (second === 'owner') return { name: 'dashboard', tab: 'lending' };
      if (second === 'renter') return { name: 'dashboard', tab: 'renting' };
      return { name: 'dashboard', tab: params.get('tab') === 'lending' ? 'lending' : 'renting' };
    }
    case 'create-listing': return { name: 'create-listing', requestId: new URLSearchParams(search).get('request') ?? undefined };
    case 'check-in': return second ? { name: 'check-in', id: second } : { name: 'home' };
    case 'check-out': return second ? { name: 'check-out', id: second } : { name: 'home' };
    case 'item-passport': return second ? { name: 'item-passport', id: second } : { name: 'home' };
    case 'claims': return second ? { name: 'claim-detail', id: second } : { name: 'claims' };
    case 'support': return { name: 'support', id: second };
    case 'wallet': return { name: 'wallet' };
    case 'payouts': return { name: 'owner-payouts' };
    case 'profile': return { name: 'trust-profile' };
    case 'messages': return second ? { name: 'conversation', id: second } : { name: 'messaging' };
    case 'requests': {
      if (second && parts[2] === 'matches') return { name: 'requests', requestId: second, matches: true };
      const tab = new URLSearchParams(search).get('tab');
      return { name: 'requests', tab: tab === 'mine' || tab === 'offers' ? tab : 'browse' };
    }
    case 'favorites': return { name: 'favorites' };
    case 'need-something': return { name: 'need-something' };
    case 'protection': return { name: 'protection' };
    case 'notifications': return { name: 'notifications' };
    case 'bidding': return second ? { name: 'bidding-detail', id: second } : { name: 'bidding' };
    case 'auction': return second ? { name: 'auction', id: second } : { name: 'home' };
    case 'guidelines': return { name: 'guidelines' };
    case 'admin': return { name: 'admin', section: second };
    case 'access': return { name: 'access' };
    default: return { name: 'home' };
  }
}

export function notificationRoute(destination: string): Route | null {
  const match = /^([^?#]+)(\?[^#]*)?$/.exec(destination);
  if (!match) return null;
  const [, pathname, search = ''] = match;
  const staticPath = /^\/(dashboard(?:\/(?:listings|owner|renter))?|requests|bidding|profile|payouts|wallet|messages|support|claims)$/;
  const detail = /^\/(listing|bidding|auction|confirmation|messages|support|claims|check-in|check-out)\/([^/]+)$/.exec(pathname);
  const matches = /^\/requests\/([^/]+)\/matches$/.exec(pathname);
  if (!staticPath.test(pathname) && !(detail && UUID_RE.test(detail[2])) && !(matches && UUID_RE.test(matches[1]))) {
    return null;
  }
  return pathToRoute(pathname, search);
}

function replaceLegacyDashboardPath(nextRoute: Route) {
  if (nextRoute.name === 'dashboard' && /^\/dashboard\/(owner|renter)\/?$/.test(window.location.pathname)) {
    window.history.replaceState(null, '', routeToPath(nextRoute));
  }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => pathToRoute(window.location.pathname, window.location.search));

  const navigate = (r: Route) => {
    const next: Route = r.name === 'owner-dashboard'
      ? { name: 'dashboard', tab: 'lending' }
      : r.name === 'renter-dashboard'
        ? { name: 'dashboard', tab: 'renting' }
        : r;
    setRoute(next);
    window.history.pushState(null, '', routeToPath(next));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const back = () => window.history.back();

  useEffect(() => {
    replaceLegacyDashboardPath(pathToRoute(window.location.pathname, window.location.search));
    function onPopState() {
      const nextRoute = pathToRoute(window.location.pathname, window.location.search);
      setRoute(nextRoute);
      replaceLegacyDashboardPath(nextRoute);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  return (
    <RouterContext.Provider value={{ route, navigate, back }}>
      {children}
    </RouterContext.Provider>
  );
}


export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
