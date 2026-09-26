import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'dashboard'; tab?: 'renting' | 'lending' }
  | { name: 'search'; category?: string; q?: string; lat?: number; lng?: number; locationLabel?: string; start?: string; end?: string }
  | { name: 'listing'; id: string }
  | { name: 'checkout'; id: string; startDate?: string; endDate?: string; quantity?: number }
  | { name: 'confirmation'; id: string }
  | { name: 'renter-dashboard' }
  | { name: 'owner-dashboard' }
  | { name: 'create-listing' }
  | { name: 'check-in'; id: string }
  | { name: 'check-out'; id: string }
  | { name: 'item-passport'; id: string }
  | { name: 'claims' }
  | { name: 'claim-detail'; id: string }
  | { name: 'trust-profile' }
  | { name: 'messaging' }
  | { name: 'conversation'; id: string }
  | { name: 'requests' }
  | { name: 'favorites' }
  | { name: 'need-something' }
  | { name: 'protection' }
  | { name: 'notifications' }
  | { name: 'bidding' }
  | { name: 'auction'; id: string }
  | { name: 'guidelines' };

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
    case 'search': {
      const params = new URLSearchParams();
      if (route.category) params.set('category', route.category);
      if (route.q) params.set('q', route.q);
      if (route.lat != null && route.lng != null) {
        params.set('lat', String(route.lat));
        params.set('lng', String(route.lng));
      }
      if (route.locationLabel) params.set('loc', route.locationLabel);
      if (route.start !== undefined) params.set('start', route.start);
      if (route.end !== undefined) params.set('end', route.end);
      const qs = params.toString();
      return qs ? `/search?${qs}` : '/search';
    }
    case 'listing': return `/listing/${route.id}`;
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
    case 'create-listing': return '/create-listing';
    case 'check-in': return `/check-in/${route.id}`;
    case 'check-out': return `/check-out/${route.id}`;
    case 'item-passport': return `/item-passport/${route.id}`;
    case 'claims': return '/claims';
    case 'claim-detail': return `/claims/${route.id}`;
    case 'trust-profile': return '/profile';
    case 'messaging': return '/messages';
    case 'conversation': return `/messages/${route.id}`;
    case 'requests': return '/requests';
    case 'favorites': return '/favorites';
    case 'need-something': return '/need-something';
    case 'protection': return '/protection';
    case 'notifications': return '/notifications';
    case 'bidding': return '/bidding';
    case 'auction': return `/auction/${route.id}`;
    case 'guidelines': return '/guidelines';
  }
}

function pathToRoute(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  const [first, second] = parts;
  switch (first) {
    case undefined: return { name: 'home' };
    case 'search': {
      const qp = new URLSearchParams(search);
      const lat = Number(qp.get('lat'));
      const lng = Number(qp.get('lng'));
      return {
        name: 'search',
        category: qp.get('category') ?? undefined,
        q: qp.get('q') ?? undefined,
        lat: Number.isFinite(lat) && qp.has('lat') ? lat : undefined,
        lng: Number.isFinite(lng) && qp.has('lng') ? lng : undefined,
        locationLabel: qp.get('loc') ?? undefined,
        start: qp.get('start') ?? undefined,
        end: qp.get('end') ?? undefined,
      };
    }
    case 'listing': return second ? { name: 'listing', id: second } : { name: 'home' };
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
      if (second === 'owner') return { name: 'dashboard', tab: 'lending' };
      if (second === 'renter') return { name: 'dashboard', tab: 'renting' };
      return { name: 'dashboard', tab: params.get('tab') === 'lending' ? 'lending' : 'renting' };
    }
    case 'create-listing': return { name: 'create-listing' };
    case 'check-in': return second ? { name: 'check-in', id: second } : { name: 'home' };
    case 'check-out': return second ? { name: 'check-out', id: second } : { name: 'home' };
    case 'item-passport': return second ? { name: 'item-passport', id: second } : { name: 'home' };
    case 'claims': return second ? { name: 'claim-detail', id: second } : { name: 'claims' };
    case 'profile': return { name: 'trust-profile' };
    case 'messages': return second ? { name: 'conversation', id: second } : { name: 'messaging' };
    case 'requests': return { name: 'requests' };
    case 'favorites': return { name: 'favorites' };
    case 'need-something': return { name: 'need-something' };
    case 'protection': return { name: 'protection' };
    case 'notifications': return { name: 'notifications' };
    case 'bidding': return { name: 'bidding' };
    case 'auction': return second ? { name: 'auction', id: second } : { name: 'home' };
    case 'guidelines': return { name: 'guidelines' };
    default: return { name: 'home' };
  }
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
