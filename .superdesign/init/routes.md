# Routes

Routing is config-based and custom (no React Router): `src/router.tsx` defines a `Route` union, `routeToPath()` / `pathToRoute()` (real paths, no hash), `RouterProvider` (pushState + popstate, scroll to top) and `useRouter()` (`route`, `navigate`, `back`). `src/App.tsx` `AppContent` switches on `route.name`; every page except Home, OutOfScope and Access is `React.lazy`-loaded. Unknown paths fall back to Home.

Layout key: Shell = Header + BiddingTicker + page + BottomNav + SignInDialog (see layouts.md).

| URL path | Route name | Component | File | Access | Layout |
|---|---|---|---|---|---|
| `/` | home | HomePage | `src/pages/home.tsx` | public | Shell |
| `/search?q&category&start&end&radius&lat&lng&loc...` | search | SearchPage | `src/pages/search.tsx` | public | Shell |
| `/listing/:id` | listing | ListingPage | `src/pages/listing.tsx` | public | Shell |
| `/checkout/:id?start&end&qty` | checkout | CheckoutPage | `src/pages/checkout.tsx` | RequireAuth | Shell |
| `/confirmation/:id` | confirmation | ConfirmationPage | `src/pages/checkout.tsx` | RequireAuth | Shell |
| `/dashboard?tab=renting\|lending` (legacy `/dashboard/owner\|renter`) | dashboard (renter-dashboard, owner-dashboard alias) | BookingsPage | `src/pages/dashboards.tsx` | RequireAuth | Shell |
| `/create-listing` | create-listing | CreateListingPage | `src/pages/create-listing.tsx` | RequireAuth | Shell |
| `/edit-listing/:id` | edit-listing | CreateListingPage (editId) | `src/pages/create-listing.tsx` | RequireAuth | Shell |
| `/check-in/:id` | check-in | CheckInPage | `src/pages/check-in-out.tsx` | RequireAuth | Shell |
| `/check-out/:id` | check-out | CheckOutPage | `src/pages/check-in-out.tsx` | RequireAuth | Shell |
| `/item-passport/:id` | item-passport | ItemPassportPage (out of scope -> OutOfScopePage) | `src/pages/passport.tsx` | RequireAuth | Shell |
| `/claims`, `/claims/:id` | claims, claim-detail | ClaimsPage, ClaimDetailPage | `src/pages/claims.tsx` | RequireAuth | Shell |
| `/support`, `/support/:id` | support | SupportPage | `src/pages/support.tsx` | RequireAuth | Shell |
| `/wallet` | wallet | WalletPage | `src/pages/wallet.tsx` | RequireAuth | Shell |
| `/profile` | trust-profile | TrustProfilePage | `src/pages/trust-profile.tsx` | RequireAuth | Shell |
| `/messages`, `/messages/:id` | messaging, conversation | MessagingPage, ConversationPage | `src/pages/messaging.tsx` | RequireAuth | Shell |
| `/requests?tab=browse\|mine\|offers` | requests | RequestsPage | `src/pages/requests.tsx` | RequireAuth | Shell |
| `/need-something` | need-something | NeedSomethingPage | `src/pages/requests.tsx` | public (sign-in on submit) | Shell |
| `/favorites` | favorites | FavoritesPage | `src/pages/favorites.tsx` | RequireAuth | Shell |
| `/protection` | protection | ProtectionPage (out of scope -> OutOfScopePage) | `src/pages/protection.tsx` | public | Shell |
| `/notifications` | notifications | NotificationsPage | `src/pages/notifications.tsx` | RequireAuth | Shell |
| `/bidding` | bidding | BiddingPage | `src/pages/bidding.tsx` | public | Shell |
| `/bidding/:id` | bidding-detail | BiddingDetailPage | `src/pages/bidding.tsx` | public | Shell |
| `/auction/:id` | auction | AuctionPage | `src/pages/bidding.tsx` | public | Shell |
| `/guidelines` | guidelines | GuidelinesPage | `src/pages/guidelines.tsx` | public | Shell |
| `/admin`, `/admin/:section` | admin | AdminPage | `src/pages/admin/admin-page.tsx` | RequireAuth + admin permissions | Admin sidebar shell (no Header) |
| `/access` | access | AccessPage | `src/pages/access.tsx` | public | none |
| any other path | home | HomePage | `src/pages/home.tsx` | public | Shell |

## Key pages (current render)

- `/` Home (`HomePage`): editorial hero ("Don't buy it. Rent it." in Instrument Serif, subcopy "Cameras, camping gear, tools and party supplies from people close by, for exactly the days you need them.", links Ask for something / Rent out yours), hero `SearchBar` (keyword, location, radius, dates) with trust points (Secure sign-in, Secure checkout, Owner approval before payment), animated 3-column category photo wall with luggage-style price tags; "Browse by category" horizontal tiles + "More"; "Featured rentals" ink band; "Close to you" / "Around <city>" shelf; "Just arrived" shelf; optional Mock bidding (flag); "How YBuy works" (Discover, Request, Rent, Return as notched ticket stubs); "Can't find it? Ask for it." marquee + Request an item; "Rent out what you already own" ink band + List an item; Footer.
- `/search` (`SearchPage`): search control, filters (category, dates, distance, price, instant book), sort, results grid of ListingCard/ListingCardWide, Leaflet map with price pins, empty/error states.
- `/listing/:id` (`ListingPage`): breadcrumb; title + rating + pickup area + verified owner + Save/Share; gallery left; sticky booking panel right (price/day, rental dates range picker, rental options 1/3/7/30 days, availability checks, approximate pickup area, quantity "1 unit", estimated rental cost: rate x days, service fee, insurance (flag), tax not yet calculated; refundable security deposit box; security hold "No card hold placed"; estimated total; "Request to book" or "Book instantly"; "No charge until the owner approves."); details: trust strip, section tabs (Overview, Specifications, Availability, Reviews, Similar items), About this item, Specifications, What's included, Condition (+ owner-declared value note), Meet the owner (avatar, name, Identity verified, rating, Message owner), Pickup and delivery (exact address after confirmation), Cancellation, Reviews; Similar rentals grid; phone sticky booking bar.
- `/checkout/:id` + `/confirmation/:id`: dates, price breakdown, promo code, payment; confirmation status ("Payment is not confirmed yet" until verified).
- `/dashboard`: "Your rentals and the items you lend, in one place." Renting tab (upcoming, active, past rentals) and Lending tab (My listings, availability, earnings, requests).
- `/create-listing`: multi-step owner listing form (photos, details, price, availability, pickup/delivery, review, submit for approval).
- `/bidding`, `/bidding/:id`, `/auction/:id`: live auctions list, auction detail, bid panel; mock bidding demo when flagged.
- `/requests`, `/need-something`: wanted board ("Ask for something you can't find, or offer a rental that fits.") and request form.

## Router source

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readSearchState, searchStateParams, type SearchState } from '@/lib/search-state';

export type Route =
  | { name: 'home' }
  | { name: 'dashboard'; tab?: 'renting' | 'lending' }
  | ({ name: 'search'; lat?: number; lng?: number; locationLabel?: string } & Partial<SearchState>)
  | { name: 'listing'; id: string }
  | { name: 'checkout'; id: string; startDate?: string; endDate?: string; quantity?: number }
  | { name: 'confirmation'; id: string }
  | { name: 'renter-dashboard' }
  | { name: 'owner-dashboard' }
  | { name: 'create-listing' }
  | { name: 'edit-listing'; id: string }
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
  | { name: 'requests'; tab?: 'browse' | 'mine' | 'offers' }
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
    case 'edit-listing': return `/edit-listing/${route.id}`;
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
    case 'requests': return route.tab && route.tab !== 'browse' ? `/requests?tab=${route.tab}` : '/requests';
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
    case 'edit-listing': return second ? { name: 'edit-listing',id: second } : { name: 'owner-dashboard' };
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
    case 'support': return { name: 'support', id: second };
    case 'wallet': return { name: 'wallet' };
    case 'profile': return { name: 'trust-profile' };
    case 'messages': return second ? { name: 'conversation', id: second } : { name: 'messaging' };
    case 'requests': {
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
```
