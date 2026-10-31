# Layouts - app shell, header, navigation, footer (full source)

Render order for every routed page except `/access` and `/admin` (`src/App.tsx` -> `AppContent`):

```
<ThemeProvider><AuthProvider><LocationProvider><RouterProvider>
  [yellow test-environment banner when VITE_TEST_ENVIRONMENT=true]
  <div class="min-h-screen bg-app">
    <Header/>          sticky top bar (src/components/nav.tsx)
    <BiddingTicker/>   dark live-offer strip under the header, feature flag 'bidding' (src/components/bidding-ticker.tsx)
    <main class="pb-[calc(4rem+safe-area)] md:pb-0"><Suspense> page, fades in, keyed by user + route </Suspense></main>
    <BottomNav/>       phone-only fixed tab bar + floating "List an item" button (src/components/nav.tsx)
    <SignInDialog/>    global auth dialog (src/components/sign-in-dialog.tsx)
  </div>
  <VpnNotice/>
</RouterProvider></LocationProvider></AuthProvider></ThemeProvider>
```

- `/admin` renders `AdminPage` (own sidebar shell, `src/pages/admin/admin-page.tsx`) without Header/BottomNav, inside `RequireAuth`.
- `/access` renders `AccessPage` alone (no shell).
- Out-of-scope routes (`item-passport`, `protection` while `SHOW_OUT_OF_SCOPE_PAGES=false`) render `OutOfScopePage` inside Header/BottomNav.
- Protected pages are wrapped in `RequireAuth` (`src/components/require-auth.tsx`).
- No global footer: only the home page renders one (`Footer` in `src/pages/home.tsx`, excerpt below).
- Page frame: header and home sections use `max-w-[1400px] mx-auto px-4 sm:px-6`; listing detail uses `max-w-[1280px] mx-auto px-4 sm:px-6`.

### Header (current, pre-redesign) at a glance
- Desktop (md+): sticky `bg-app` bar, h-16 / sm:h-[4.5rem], bottom border appears after scrolling. Left: BrandLogo (`src/assets/ybuy-logo.png`; phones show `ybuy-icon.png`). Center: Browse / Requests & offers / Bidding (active item gets an animated 3px ink underline). Right: primary pill "List an item"; signed in: notification bell with unread count, admin shield (admins, lg+), "Account" pill with avatar + dropdown (Bookings, Messages, Saved items, Your profile, Admin console, Switch account, Sign out); signed out: secondary pill "Sign in / Join".
- Phone: hamburger opens a full-height sheet with large serif nav items + "List an item"; BottomNav tabs Home, Browse, Bookings, Messages, Account + floating round "+" (List an item).

## src/main.tsx - entry

- File: `src/main.tsx` - 10 lines in file
- Mounts <App/> in StrictMode and imports src/index.css.

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

## index.html - document shell

- File: `index.html` - 18 lines in file
- Root HTML, favicon/manifest/social image.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico?v=20261026" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YBuy</title>
    <meta property="og:image" content="/ybuy-social.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="/ybuy-social.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## src/App.tsx - providers, route switch and page shell

- File: `src/App.tsx` - 147 lines in file
- AppContent renders Header, BiddingTicker, main page slot, BottomNav, SignInDialog; App wraps providers + test banner + VpnNotice.

```tsx
import { lazy, Suspense } from 'react';
import { ThemeProvider } from '@/theme-context';
import { AuthProvider, useAuth } from '@/auth-context';
import { LocationProvider } from '@/location-context';
import { RequireAuth } from '@/components/require-auth';
import { SignInDialog } from '@/components/sign-in-dialog';
import { RouterProvider, useRouter } from '@/router';
import { Header, BottomNav } from '@/components/nav';
import { HomePage } from '@/pages/home';
import { OutOfScopePage } from '@/pages/out-of-scope';
import { AccessPage } from '@/pages/access';
import { BiddingTicker } from '@/components/bidding-ticker';
import { VpnNotice } from '@/components/vpn-notice';
import { SHOW_OUT_OF_SCOPE_PAGES, OUT_OF_SCOPE_ROUTES } from '@/lib/feature-flags';

const SearchPage = lazy(() => import('@/pages/search').then(({ SearchPage: page }) => ({ default: page })));
const ListingPage = lazy(() => import('@/pages/listing').then(({ ListingPage: page }) => ({ default: page })));
const CheckoutPage = lazy(() => import('@/pages/checkout').then(({ CheckoutPage: page }) => ({ default: page })));
const ConfirmationPage = lazy(() => import('@/pages/checkout').then(({ ConfirmationPage: page }) => ({ default: page })));
const BookingsPage = lazy(() => import('@/pages/dashboards').then(({ BookingsPage: page }) => ({ default: page })));
const CreateListingPage = lazy(() => import('@/pages/create-listing').then(({ CreateListingPage: page }) => ({ default: page })));
const CheckInPage = lazy(() => import('@/pages/check-in-out').then(({ CheckInPage: page }) => ({ default: page })));
const CheckOutPage = lazy(() => import('@/pages/check-in-out').then(({ CheckOutPage: page }) => ({ default: page })));
const ItemPassportPage = lazy(() => import('@/pages/passport').then(({ ItemPassportPage: page }) => ({ default: page })));
const ClaimsPage = lazy(() => import('@/pages/claims').then(({ ClaimsPage: page }) => ({ default: page })));
const ClaimDetailPage = lazy(() => import('@/pages/claims').then(({ ClaimDetailPage: page }) => ({ default: page })));
const SupportPage = lazy(() => import('@/pages/support').then(({ SupportPage: page }) => ({ default: page })));
const WalletPage = lazy(() => import('@/pages/wallet').then(({ WalletPage: page }) => ({ default: page })));
const NotificationsPage = lazy(() => import('@/pages/notifications').then(({ NotificationsPage: page }) => ({ default: page })));
const MessagingPage = lazy(() => import('@/pages/messaging').then(({ MessagingPage: page }) => ({ default: page })));
const ConversationPage = lazy(() => import('@/pages/messaging').then(({ ConversationPage: page }) => ({ default: page })));
const RequestsPage = lazy(() => import('@/pages/requests').then(({ RequestsPage: page }) => ({ default: page })));
const NeedSomethingPage = lazy(() => import('@/pages/requests').then(({ NeedSomethingPage: page }) => ({ default: page })));
const FavoritesPage = lazy(() => import('@/pages/favorites').then(({ FavoritesPage: page }) => ({ default: page })));
const ProtectionPage = lazy(() => import('@/pages/protection').then(({ ProtectionPage: page }) => ({ default: page })));
const TrustProfilePage = lazy(() => import('@/pages/trust-profile').then(({ TrustProfilePage: page }) => ({ default: page })));
const BiddingPage = lazy(() => import('@/pages/bidding').then(({ BiddingPage: page }) => ({ default: page })));
const BiddingDetailPage = lazy(() => import('@/pages/bidding').then(({ BiddingDetailPage: page }) => ({ default: page })));
const AuctionPage = lazy(() => import('@/pages/bidding').then(({ AuctionPage: page }) => ({ default: page })));
const GuidelinesPage = lazy(() => import('@/pages/guidelines').then(({ GuidelinesPage: page }) => ({ default: page })));
const AdminPage = lazy(() => import('@/pages/admin/admin-page').then(({ AdminPage: page }) => ({ default: page })));

function AppContent() {
  const { route } = useRouter();
  const { user } = useAuth();

  if (route.name === 'access') return <AccessPage />;

  if (route.name === 'admin') {
    return (
      <>
        <RequireAuth><Suspense fallback={<div className="min-h-[50vh]" />}><AdminPage section={route.section} /></Suspense></RequireAuth>
        <SignInDialog />
      </>
    );
  }

  if (OUT_OF_SCOPE_ROUTES.has(route.name) && !SHOW_OUT_OF_SCOPE_PAGES) {
    return (
      <div className="min-h-screen bg-app">
        <Header />
        <main className="pb-[calc(4rem_+_env(safe-area-inset-bottom))] md:pb-0"><OutOfScopePage /></main>
        <BottomNav />
        <SignInDialog />
      </div>
    );
  }

  let page: React.ReactNode;
  switch (route.name) {
    case 'home': page = <HomePage />; break;
    case 'search': page = (
      <SearchPage
        key={JSON.stringify(route)}
        initialFilters={route}
        initialCategory={route.category}
        initialQuery={route.q}
        initialCoords={route.lat != null && route.lng != null ? { lat: route.lat, lng: route.lng } : undefined}
        initialLocationLabel={route.locationLabel}
        initialStartDate={route.start}
        initialEndDate={route.end}
      />
    ); break;
    case 'listing': page = <ListingPage id={route.id} />; break;
    case 'checkout': page = <RequireAuth><CheckoutPage id={route.id} startDate={route.startDate} endDate={route.endDate} /></RequireAuth>; break;
    case 'confirmation': page = <RequireAuth><ConfirmationPage id={route.id} /></RequireAuth>; break;
    case 'dashboard': page = <RequireAuth><BookingsPage initialTab={route.tab ?? 'renting'} /></RequireAuth>; break;
    case 'renter-dashboard': page = <RequireAuth><BookingsPage initialTab="renting" /></RequireAuth>; break;
    case 'owner-dashboard': page = <RequireAuth><BookingsPage initialTab="lending" /></RequireAuth>; break;
    case 'create-listing': page = <RequireAuth><CreateListingPage /></RequireAuth>; break;
    case 'edit-listing': page = <RequireAuth><CreateListingPage key={route.id} editId={route.id} /></RequireAuth>; break;
    case 'check-in': page = <RequireAuth><CheckInPage id={route.id} /></RequireAuth>; break;
    case 'check-out': page = <RequireAuth><CheckOutPage id={route.id} /></RequireAuth>; break;
    case 'item-passport': page = <RequireAuth><ItemPassportPage id={route.id} /></RequireAuth>; break;
    case 'claims': page = <RequireAuth><ClaimsPage /></RequireAuth>; break;
    case 'claim-detail': page = <RequireAuth><ClaimDetailPage id={route.id} /></RequireAuth>; break;
    case 'support': page = <RequireAuth><SupportPage id={route.id} /></RequireAuth>; break;
    case 'wallet': page = <RequireAuth><WalletPage /></RequireAuth>; break;
    case 'notifications': page = <RequireAuth><NotificationsPage /></RequireAuth>; break;
    case 'messaging': page = <RequireAuth><MessagingPage /></RequireAuth>; break;
    case 'conversation': page = <RequireAuth><ConversationPage id={route.id} /></RequireAuth>; break;
    case 'requests': page = <RequireAuth><RequestsPage initialTab={route.tab ?? 'browse'} /></RequireAuth>; break;
    case 'favorites': page = <RequireAuth><FavoritesPage /></RequireAuth>; break;
    // Let visitors prepare a request before signing in; NeedSomethingPage opens
    // the auth dialog on submit so the in-progress form stays mounted.
    case 'need-something': page = <NeedSomethingPage />; break;
    case 'protection': page = <ProtectionPage />; break;
    case 'trust-profile': page = <RequireAuth><TrustProfilePage /></RequireAuth>; break;
    case 'bidding': page = <BiddingPage />; break;
    case 'bidding-detail': page = <BiddingDetailPage key={route.id} id={route.id} />; break;
    case 'auction': page = <AuctionPage id={route.id} />; break;
    case 'guidelines': page = <GuidelinesPage />; break;
    default: page = <HomePage />; break;
  }

  return (
    <div className="min-h-screen bg-app">
      <Header />
      <BiddingTicker />
      <main className="pb-[calc(4rem_+_env(safe-area-inset-bottom))] md:pb-0"><Suspense fallback={<div className="min-h-[50vh]" />}>{<div key={`${user?.id ?? 'anonymous'}:${route.name}`} className="animate-page-fade">{page}</div>}</Suspense></main>
      <BottomNav />
      <SignInDialog />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <LocationProvider>
          <RouterProvider>
            {import.meta.env.VITE_TEST_ENVIRONMENT === 'true' && (
              <div role="status" className="bg-warning-soft text-warning px-4 py-2 text-center text-sm font-semibold">
                Test environment - synthetic accounts and sandbox payments only. Test emails go to the designated test inbox.
              </div>
            )}
            <AppContent />
            <VpnNotice />
          </RouterProvider>
        </LocationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
```

## src/components/nav.tsx - Header and BottomNav

- File: `src/components/nav.tsx` - 352 lines in file
- Sticky top bar and phone bottom navigation (see summary above).

```tsx
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MessageSquare, User, Menu, X, Home, Search, Plus, PackagePlus, Calendar, Heart, LogOut, ShieldCheck, Bell, Gavel, ChevronDown } from 'lucide-react';
import { useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { useAdminAccess } from '@/lib/admin';
import { ThemeSwitcher } from '@/components/search';
import { Alert, Button } from '@/components/ui';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';
import { subscribeToNotifications, unreadNotificationCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { BrandLogo } from '@/components/brand-logo';

function Wordmark({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 shrink-0" aria-label="YBuy home">
      <BrandLogo compact />
    </button>
  );
}
export function Header() {
  const { route, navigate } = useRouter();
  const { user, profile, loading, error, signInOpen, authBusy, openSignIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const reduce = useReducedMotion();
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const adminAccess = useAdminAccess();

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [accountOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // A route change while the sheet is open would otherwise leave it covering the new page.
  useEffect(() => { setMenuOpen(false); setAccountOpen(false); }, [route, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setUnreadCount(0);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const count = await unreadNotificationCount(user.id);
        if (active) setUnreadCount(count);
      } catch {
        if (active) setUnreadCount(null);
      }
    };
    void refresh();
    const channel = subscribeToNotifications(user.id, () => { void refresh(); });
    const fallback = window.setInterval(() => { void refresh(); }, 60_000);
    return () => {
      active = false;
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  function go(next: Route) {
    navigate(next);
  }

  const navItems: { label: string; route: Route; icon: typeof Home }[] = [
    { label: 'Browse', route: { name: 'search' }, icon: Search },
    { label: 'Requests & offers', route: { name: 'requests' }, icon: PackagePlus },
    { label: 'Bidding', route: { name: 'bidding' }, icon: Gavel },
  ];

  // Personal destinations live behind the account menu so the bar stays short.
  const accountItems: { label: string; route: Route; icon: typeof Home }[] = [
    { label: 'Bookings', route: { name: 'dashboard' }, icon: Calendar },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare },
    { label: 'Saved items', route: { name: 'favorites' }, icon: Heart },
    { label: 'Your profile', route: { name: 'trust-profile' }, icon: User },
  ];

  const isActive = (r: Route) => {
    if (r.name === 'requests') return route.name === 'requests';
    if (r.name === 'bidding') return route.name === 'bidding' || route.name === 'bidding-detail' || route.name === 'auction';
    if (r.name === 'dashboard') return route.name === 'dashboard' || route.name === 'renter-dashboard' || route.name === 'owner-dashboard';
    return route.name === r.name;
  };

  return (
    <header className={`sticky top-0 z-40 bg-app border-b transition-colors duration-standard ${scrolled || menuOpen ? 'border-app' : 'border-transparent'}`}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 sm:h-[4.5rem] gap-4">
          <Wordmark onClick={() => navigate({ name: 'home' })} />

          <nav className="hidden md:flex items-center gap-1" aria-label="Main">
            {navItems.map((item) => {
              const active = isActive(item.route);
              return (
                <button
                  key={item.label}
                  onClick={() => go(item.route)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative px-3.5 h-10 text-sm font-semibold transition-colors duration-fast ${active ? 'text-main' : 'text-sec hover:text-main'}`}
                >
                  {item.label}
                  {active && (
                    <motion.span
                      layoutId={reduce ? undefined : 'nav-underline'}
                      aria-hidden="true"
                      className="absolute inset-x-3.5 bottom-0 h-[3px] rounded-full bg-[var(--ink)]"
                      transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<PackagePlus size={16} />}
              onClick={() => go({ name: 'create-listing' })}
              className="hidden sm:inline-flex !rounded-full"
            >
              List an item
            </Button>

            {SHOW_DEMO_THEMES && <ThemeSwitcher />}

            {user ? (
              <>
                <button
                  onClick={() => go({ name: 'notifications' })}
                  aria-label={unreadCount === null ? 'Notifications, unread count unavailable' : `Notifications, ${unreadCount} unread`}
                  aria-current={route.name === 'notifications' ? 'page' : undefined}
                  className="relative grid h-11 w-11 place-items-center rounded-full bg-subtle text-main transition-colors duration-fast hover:bg-[var(--border)]"
                >
                  <Bell size={18} aria-hidden="true" />
                  {unreadCount !== null && unreadCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-text">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>}
                  <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {unreadCount === null ? 'Unread notification count unavailable' : `${unreadCount} unread notifications`}
                  </span>
                </button>
                {adminAccess.access && (
                  <button
                    onClick={() => go({ name: 'admin' })}
                    aria-label="Admin console"
                    className="hidden lg:grid place-items-center w-11 h-11 rounded-full bg-subtle text-main hover:bg-[var(--border)] transition-colors duration-fast"
                  >
                    <ShieldCheck size={18} />
                  </button>
                )}
                <div
                  ref={accountRef}
                  className="relative hidden sm:block"
                  onKeyDown={(event) => { if (event.key === 'Escape') setAccountOpen(false); }}
                >
                  <button
                    onClick={() => setAccountOpen((open) => !open)}
                    aria-label="Account"
                    aria-haspopup="menu"
                    aria-expanded={accountOpen}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-subtle pl-1.5 pr-3.5 text-sm font-semibold text-main hover:bg-[var(--border)] transition-colors duration-fast"
                  >
                    {profile?.avatar_url
                      ? <img src={profile.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      : <span className="grid place-items-center w-8 h-8 rounded-full bg-card"><User size={16} className="text-main" /></span>}
                    <span>Account</span>
                    <ChevronDown size={15} aria-hidden="true" className={`transition-transform duration-fast ${accountOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {accountOpen && (
                    <motion.div
                      role="menu"
                      aria-label="Account"
                      initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 top-full z-50 mt-2 w-64 rounded-[1.25rem] bg-card p-2 shadow-pop"
                    >
                      {accountItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.label}
                            role="menuitem"
                            onClick={() => go(item.route)}
                            className="flex w-full items-center gap-3 rounded-[0.9rem] px-3 min-h-11 text-left text-sm font-semibold text-main hover:bg-subtle"
                          >
                            <Icon size={17} aria-hidden="true" />{item.label}
                          </button>
                        );
                      })}
                      {adminAccess.access && (
                        <button role="menuitem" onClick={() => go({ name: 'admin' })} className="flex w-full items-center gap-3 rounded-[0.9rem] px-3 min-h-11 text-left text-sm font-semibold text-main hover:bg-subtle">
                          <ShieldCheck size={17} aria-hidden="true" />Admin console
                        </button>
                      )}
                      <div className="my-1 h-px bg-[var(--border)]" />
                      <button role="menuitem" onClick={() => { setAccountOpen(false); openSignIn(); }} className="flex w-full items-center gap-3 rounded-[0.9rem] px-3 min-h-11 text-left text-sm text-sec hover:bg-subtle">
                        Switch account
                      </button>
                      <button role="menuitem" disabled={authBusy === 'sign-out'} onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-[0.9rem] px-3 min-h-11 text-left text-sm text-sec hover:bg-subtle disabled:opacity-60">
                        <LogOut size={17} aria-hidden="true" />Sign out
                      </button>
                    </motion.div>
                  )}
                </div>
              </>
            ) : (
              <Button size="sm" variant="secondary" disabled={loading} onClick={openSignIn} className="!rounded-full">Sign in / Join</Button>
            )}

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              className="md:hidden grid place-items-center w-11 h-11 rounded-full bg-subtle hover:bg-[var(--border)] transition-colors duration-fast"
            >
              {menuOpen ? <X size={20} className="text-main" /> : <Menu size={20} className="text-main" />}
            </button>
          </div>
        </div>
      </div>

      {error && !signInOpen && <div role="alert" className="max-w-[1400px] mx-auto px-4 sm:px-6 pb-3"><Alert tone="error">{error}</Alert></div>}

      {menuOpen && (
        <div className="md:hidden absolute inset-x-0 top-full z-40 h-[calc(100dvh-4rem)] overflow-y-auto bg-app animate-modal">
          <div className="px-4 pt-4 pb-28 space-y-1">
            {[...navItems, ...(user ? accountItems.filter((item) => item.label !== 'Your profile') : [])].map((item, index) => (
              <motion.button
                key={item.label}
                initial={reduce ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.04 * index, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => go(item.route)}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className="w-full flex items-center justify-between px-1 min-h-16 font-editorial text-[2.6rem] leading-none tracking-[-0.02em] text-main"
              >
                {item.label}
                {isActive(item.route) && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--ink)]" />}
              </motion.button>
            ))}
            <Button fullWidth icon={<PackagePlus size={18} />} onClick={() => go({ name: 'create-listing' })} className="mt-6 !rounded-full">
              List an item
            </Button>
            {user && (
              <>
                {adminAccess.access && (
                  <Button fullWidth size="sm" variant="ghost" icon={<ShieldCheck size={16} />} onClick={() => go({ name: 'admin' })} className="mt-1">
                    Admin console
                  </Button>
                )}
                <Button fullWidth size="sm" variant="ghost" icon={<User size={16} />} onClick={() => go({ name: 'trust-profile' })} className="mt-1">
                  Account
                </Button>
                <Button fullWidth size="sm" variant="ghost" icon={<Bell size={16} />} onClick={() => go({ name: 'notifications' })} className="mt-1">
                  Notifications{unreadCount !== null && unreadCount > 0 ? ` (${unreadCount > 99 ? '99+' : unreadCount} unread)` : ''}
                </Button>
                <Button fullWidth size="sm" variant="ghost" onClick={openSignIn}>Switch account</Button>
                <Button fullWidth size="sm" variant="ghost" loading={authBusy === 'sign-out'} icon={<LogOut size={16} />} onClick={() => void signOut()}>
                  Sign out
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

/** Keep the listing shortcut clear of page actions and preference controls. */
const ROUTES_WITHOUT_FAB = new Set<Route['name']>(['listing', 'checkout', 'create-listing', 'conversation', 'notifications']);

export function BottomNav() {
  const { route, navigate } = useRouter();
  const reduce = useReducedMotion();
  function go(next: Route) {
    navigate(next);
  }

  const items: { label: string; route: Route; icon: typeof Home }[] = [
    { label: 'Home', route: { name: 'home' }, icon: Home },
    { label: 'Browse', route: { name: 'search' }, icon: Search },
    { label: 'Bookings', route: { name: 'dashboard' }, icon: Calendar },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare },
    { label: 'Account', route: { name: 'trust-profile' }, icon: User },
  ];

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-app border-t border-app pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        <div className="flex items-stretch justify-around h-16">
          {items.map((item) => {
            const Icon = item.icon;
            const active = item.route.name === 'dashboard'
              ? route.name === 'dashboard' || route.name === 'renter-dashboard' || route.name === 'owner-dashboard'
              : route.name === item.route.name;
            return (
              <button
                key={item.label}
                onClick={() => go(item.route)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors duration-fast ${
                  active ? 'text-main' : 'text-sec'
                }`}
              >
                <span className="relative grid h-8 w-14 place-items-center">
                  {active && (
                    <motion.span
                      layoutId={reduce ? undefined : 'bottom-pill'}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-[var(--ink)]"
                      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                    />
                  )}
                  <Icon size={20} strokeWidth={active ? 2.4 : 2} className={`relative ${active ? 'text-white' : ''}`} />
                </span>
                <span className="text-[11px] font-semibold">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <button
        onClick={() => go({ name: 'create-listing' })}
        aria-label="List an item"
        className={`fixed bottom-[calc(4.75rem_+_env(safe-area-inset-bottom))] right-4 z-40 w-14 h-14 rounded-full bg-accent text-accent-text shadow-hover grid place-items-center active:scale-95 transition-transform duration-fast ${
          ROUTES_WITHOUT_FAB.has(route.name) ? 'hidden' : 'md:hidden'
        }`}
      >
        <Plus size={22} />
      </button>
    </>
  );
}
```

## src/components/bidding-ticker.tsx - BiddingTicker

- File: `src/components/bidding-ticker.tsx` - 209 lines in file
- Full-width ink strip with the top live rental bids (poll every 15s), pause motion and collapse controls; styles are .bid-banner* in src/index.css.

```tsx
import { useEffect, useId, useState } from 'react';
import { CalendarDays, ChevronUp, Flame, Package, Pause, Play, Tag, Zap } from 'lucide-react';
import { Alert, Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { BIDDING_SAMPLES } from '@/lib/bidding-samples';
import { useRouter } from '@/router';
import { auctionCountdown } from '@/lib/auction-countdown';

interface TopBid {
  listing_id: string;
  title: string;
  daily_rate: number;
  start_date: string;
  end_date: string;
  expires_at: string;
  image_url: string | null;
  synthetic?: boolean;
}

const DEMO_BADGES = [
  { label: 'HOT', Icon: Flame, tone: 'hot' },
  { label: 'POPULAR', Icon: Zap, tone: 'popular' },
  { label: 'GREAT DEAL', Icon: Tag, tone: 'deal' },
];

function dateAfter(days: number): string {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function createDemoOffers(now: number): TopBid[] {
  return BIDDING_SAMPLES.map((offer, index) => {
    const start = index * 4 + 5;
    return {
      ...offer,
      synthetic: true,
      start_date: dateAfter(start),
      end_date: dateAfter(start + 3),
      expires_at: new Date(now + 30 * 86400000).toISOString(),
    };
  });
}

function BidImage({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="bid-card-image">
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : <Package size={23} aria-hidden="true" />}
    </span>
  );
}

const formatDate = (value: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));

function timeToBid(expiresAt: string, now: number): string {
  return `${auctionCountdown(expiresAt, now)} left to bid`;
}

export function BiddingTicker() {
  const { navigate } = useRouter();
  const { enabled } = useFeatureFlag('bidding');
  const [rows, setRows] = useState<TopBid[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [motionStopped, setMotionStopped] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const testEnvironment = import.meta.env.VITE_TEST_ENVIRONMENT === 'true';
  const liveOffers = rows?.filter((row) => Date.parse(row.expires_at) > now) ?? [];
  const demoOffers = testEnvironment && rows !== null && liveOffers.length === 0 ? createDemoOffers(now) : [];
  const offers = liveOffers.length ? liveOffers : demoOffers;
  const isDemoFeed = liveOffers.length === 0 && demoOffers.length > 0;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function refresh() {
      const response = await supabase.rpc('get_top_listing_bids');
      if (!active) return;
      if (response.error) {
        setError(response.error.message);
        setRows([]);
        return;
      }
      if (!Array.isArray(response.data) || response.data.length > 5) {
        setError('The live bidding feed returned an invalid result.');
        setRows([]);
        return;
      }
      setError(null);
      setRows(response.data as TopBid[]);
      setNow(Date.now());
    }
    void refresh();
    const poll = window.setInterval(() => void refresh(), 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, retry]);

  if (!enabled) return null;
  return (
    <section aria-label="Top rental offers" className={`bid-banner${motionStopped ? ' bid-banner-stopped' : ''}${collapsed ? ' bid-banner-collapsed' : ''}`}>
      <div id={contentId} className="bid-banner-inner" hidden={collapsed}>
        {error ? (
          <div className="bid-banner-error">
            <Alert tone="error" title="Live offers unavailable">
              {error}
              <Button size="sm" variant="secondary" className="ml-2" onClick={() => setRetry((value) => value + 1)}>Retry offers</Button>
            </Alert>
          </div>
        ) : (
          <>
        <div className="bid-banner-heading">
          <div className="flex items-center gap-2">
          <a href="/bidding" className="bid-banner-live" onClick={event => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault(); navigate({ name: 'bidding' });
            }
          }}>
            <span aria-hidden="true" />
            LIVE BIDDING
          </a>
          <button type="button" className="bid-banner-motion" aria-label={motionStopped ? 'Resume bidding ribbon motion' : 'Pause bidding ribbon motion'} aria-pressed={motionStopped} onClick={() => setMotionStopped(value => !value)}>
            {motionStopped ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
          </button>
          </div>
          <h2>Top Offers</h2>
          <p className="bid-banner-subtitle">Auction bids · refreshes every 15 sec</p>
          {isDemoFeed && <span className="bid-banner-demo">TEST DATA</span>}
        </div>
        {rows === null ? (
          <p role="status" className="bid-banner-message">Loading top offers…</p>
        ) : offers.length === 0 ? (
          <p className="bid-banner-message">No eligible offers right now. <a className="underline font-semibold" href="/search">Explore listings</a></p>
        ) : (
          <div className="bid-banner-viewport" tabIndex={0} role="group" aria-label={isDemoFeed ? 'Sample rental offers' : 'Live rental offers'}>
            <div className="bid-banner-track">
              {[0, 1].map(copy => (
                <ul key={copy} className={`bid-banner-group${copy ? ' bid-banner-copy' : ''}`} aria-hidden={copy ? true : undefined}>
                  {offers.map((row, index) => {
                    const badge = row.synthetic ? DEMO_BADGES[index % DEMO_BADGES.length] : { label: 'LIVE OFFER', Icon: Tag, tone: 'deal' };
                    const card = (
                      <>
                        <span className="bid-card-rank">{String(index + 1).padStart(2, '0')}</span>
                        <span className={`bid-card-badge bid-card-badge-${badge.tone}`}>
                          <badge.Icon size={17} aria-hidden="true" />{badge.label}
                          {!row.synthetic && <time className="tnum" dateTime={row.expires_at} title={`Bidding closes ${new Date(row.expires_at).toLocaleString()}`}> · {timeToBid(row.expires_at, now)}</time>}
                        </span>
                        <BidImage key={row.image_url} url={row.image_url} />
                        <span className="bid-card-content">
                          <span className="bid-card-title" title={row.title}>{row.title}</span>
                          <span className="bid-card-dates"><CalendarDays size={20} aria-hidden="true" />{formatDate(row.start_date)} – {formatDate(row.end_date)}</span>
                          <span className="bid-card-price">${Number(row.daily_rate).toFixed(0)}<span> / day</span></span>
                        </span>
                      </>
                    );
                    return (
                      <li key={row.listing_id} className="bid-banner-item">
                        {row.synthetic ? (
                          <a href="/bidding" className="bid-card bid-card-demo" tabIndex={copy ? -1 : 0}
                            aria-label={`Demo offer ${index + 1}: ${row.title}. Browse sample bidding`}
                            onFocus={event => event.currentTarget.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })}
                          >{card}</a>
                        ) : (
                          <a
                            href={`/bidding/${row.listing_id}`}
                            className="bid-card"
                            title={row.title}
                            tabIndex={copy ? -1 : 0}
                            onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })}
                          >{card}</a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
          </div>
        )}
          </>
        )}
      </div>
      <button
        type="button"
        className="bid-banner-sleeve"
        aria-label={collapsed ? 'Expand bidding banner' : 'Minimize bidding banner'}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => setCollapsed(value => !value)}
      >
        {collapsed ? <span className="bid-banner-live"><span aria-hidden="true" />LIVE BIDDING</span> : <><ChevronUp size={16} aria-hidden="true" /><span>Hide</span></>}
      </button>
    </section>
  );
}
```

## src/components/require-auth.tsx - RequireAuth

- File: `src/components/require-auth.tsx` - 36 lines in file
- Auth gate wrapper for protected routes.

```tsx
import type { ReactNode } from 'react';
import { useAuth } from '@/auth-context';
import { EmptyState } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { LogIn } from 'lucide-react';

// Client-side gate for UX only - RLS is the real authorization boundary for all data access.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, openSignIn } = useAuth();

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" rounded="rounded-card-lg" />
        <Skeleton className="h-24 w-full" rounded="rounded-card-lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 animate-fade-in">
        <EmptyState
          icon={<LogIn size={20} />}
          title="Sign in to continue"
          description="One account for renting and lending. Sign in or create your account to continue where you left off."
          actionLabel="Sign in or create an account"
          onAction={openSignIn}
        />
      </div>
    );
  }

  return <>{children}</>;
}
```

## src/components/sign-in-dialog.tsx - SignInDialog

- File: `src/components/sign-in-dialog.tsx` - 155 lines in file
- Global sign-in / join dialog.

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/components/ui';
import { fieldClass } from '@/components/form-classes';
import { ProviderIcon } from '@/components/provider-icon';
import { AUTH_PROVIDER_LABELS, ENABLED_AUTH_PROVIDERS } from '@/lib/auth-providers';
import { categories } from '@/data';

const sideImage = categories.find((category) => category.id === 'camping')?.image ?? categories[0].image;

export function SignInDialog() {
  const reduce = useReducedMotion();
  const { user, error, signInOpen, passwordRecovery, authBusy, closeSignIn, authenticate, requestPasswordReset, finishPasswordReset, signInWithProvider } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!signInOpen || !dialog) return;
    setPassword('');
    setSubmitted(false);
    setResetMode(false);
    setResetSent(false);
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [signInOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(false);
    if (passwordRecovery) {
      await finishPasswordReset(password);
      setPassword('');
      return;
    }
    if (resetMode) {
      setResetSent(await requestPasswordReset(email));
      return;
    }
    const result = await authenticate(email, password, register ? fullName : undefined);
    setPassword('');
    if (result === 'confirmation-required') setSubmitted(true);
  }

  const socialVisible = !passwordRecovery && !resetMode;
  const linkButton = 'min-h-11 px-1 text-sm font-semibold text-accent hover:underline underline-offset-4 disabled:opacity-60';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="sign-in-title"
      aria-describedby="sign-in-description"
      onCancel={closeSignIn}
      className="w-[calc(100%_-_2rem)] max-w-[58rem] max-h-[96dvh] overflow-y-auto rounded-[1.75rem] bg-card text-main p-0 shadow-xl backdrop:bg-[#0C2A26]/70"
    >
      <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <aside aria-hidden="true" className="relative hidden md:block overflow-hidden bg-[var(--ink)] text-white">
          <img src={sideImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#0C2A26]/45" />
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex h-full flex-col justify-end p-10"
          >
            <p className="font-editorial text-6xl leading-[0.95] tracking-[-0.02em]">Rent what you need. Share what you own.</p>
            <p className="mt-3 max-w-xs text-sm text-white/90">One account for renting and listing.</p>
          </motion.div>
        </aside>

        <div className="relative p-6 sm:p-8">
          <button onClick={closeSignIn} aria-label="Close sign-in" className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-sec hover:bg-subtle hover:text-main">
            <X size={20} aria-hidden="true" />
          </button>
          <h2 id="sign-in-title" className="pr-10 font-display text-[1.75rem] font-bold leading-tight tracking-tight text-main sm:text-3xl">
            {passwordRecovery ? 'Choose a new password' : resetMode ? 'Reset your password' : register ? 'Create your account' : user ? 'Use another account' : 'Welcome to YBuy'}
          </h2>
          <p id="sign-in-description" className="mt-1.5 mb-5 text-[15px] leading-snug text-sec">
            {user ? `You're signed in as ${user.email}. Signing in switches accounts on this device.` : 'One account to rent items and list your own.'}
          </p>
          {error && <div role="alert" className="mb-3"><Alert tone="error">{error}</Alert></div>}
          {submitted && !error && <div className="mb-3"><Alert tone="info">Check your email for a confirmation link before signing in. If you already have an account, sign in instead.</Alert></div>}
          {resetSent && !error && <div className="mb-3"><Alert tone="info">If an account uses that email, a reset link is on its way. Check your inbox and spam folder.</Alert></div>}
          {passwordRecovery && <div className="mb-3"><Alert tone="info">Enter a new password for your YBuy account.</Alert></div>}

          {socialVisible && <>
            <div className="space-y-2">
              {ENABLED_AUTH_PROVIDERS.map((provider) => (
                <Button
                  key={provider}
                  type="button"
                  fullWidth
                  variant="secondary"
                  disabled={authBusy !== null}
                  icon={<ProviderIcon provider={provider} />}
                  onClick={() => void signInWithProvider(provider)}
                >
                  Continue with {AUTH_PROVIDER_LABELS[provider]}
                </Button>
              ))}
            </div>
            <div className="my-4 flex items-center gap-3 text-xs text-sec"><span className="h-px flex-1 bg-[var(--border)]" /><span>or use email</span><span className="h-px flex-1 bg-[var(--border)]" /></div>
          </>}

          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            {register && !resetMode && !passwordRecovery && <label className="block text-sm font-semibold">Full name
              <input className={fieldClass('mt-1')} autoComplete="name" required maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>}
            {!passwordRecovery && <label className="block text-sm font-semibold">Email
              <input className={fieldClass('mt-1')} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>}
            {!resetMode && <div>
              <label htmlFor="sign-in-password" className="block text-sm font-semibold">{passwordRecovery ? 'New password' : 'Password'}</label>
              <div className="relative mt-1">
                <input id="sign-in-password" className={fieldClass('pr-12')} type={showPassword ? 'text' : 'password'} autoComplete={register || passwordRecovery ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-sec hover:text-main">
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
              {register && !passwordRecovery && <p className="mt-1.5 text-xs text-sec">At least 8 characters. You may need to confirm your email.</p>}
            </div>}
            <Button type="submit" fullWidth size="lg" loading={authBusy === 'sign-in'} disabled={authBusy !== null} loadingLabel={passwordRecovery ? 'Updating password...' : resetMode ? 'Sending reset link...' : register ? 'Creating account...' : 'Signing in...'}>
              {passwordRecovery ? 'Update password' : resetMode ? 'Send reset link' : register ? 'Create account' : 'Sign in'}
            </Button>
            {!passwordRecovery && (
              <div className="flex items-center justify-between gap-2">
                {!resetMode && !register
                  ? <button type="button" className={linkButton} disabled={authBusy !== null} onClick={() => { setResetMode(true); setResetSent(false); }}>Forgot password?</button>
                  : <span />}
                <button type="button" className={linkButton} disabled={authBusy !== null} onClick={() => { setResetMode(false); setResetSent(false); setRegister(resetMode ? false : !register); setPassword(''); setSubmitted(false); }}>
                  {resetMode ? 'Back to sign in' : register ? 'Already have an account? Sign in' : 'New to YBuy? Create an account'}
                </button>
              </div>
            )}
          </form>
          <p className="mt-3 text-center text-xs leading-snug text-sec">Authentication is handled by Supabase. Bookings and saved items stay with their original account.</p>
        </div>
      </div>
    </dialog>
  );
}
```

## src/components/vpn-notice.tsx - VpnNotice

- File: `src/components/vpn-notice.tsx` - 78 lines in file
- Global VPN notice.

```tsx
import { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/shadcn/alert-dialog';
import { useFeatureFlag } from '@/lib/use-feature-flags';

const VPN_CHECK_KEY = 'ybuy-vpn-check:v2';

export function VpnNotice() {
  const { enabled } = useFeatureFlag('vpn_detection');
  const [open, setOpen] = useState(false);
  const requestStarted = useRef(false);

  useEffect(() => {
    if (!enabled || requestStarted.current) return;
    requestStarted.current = true;

    try {
      const previousCheck = sessionStorage.getItem(VPN_CHECK_KEY);
      if (previousCheck === 'clear' || previousCheck === 'dismissed') return;
      if (previousCheck === 'vpn') {
        setOpen(true);
        return;
      }
    } catch {
      // Continue without session storage when browser privacy settings block it.
    }

    void fetch('/api/access/vpn-check')
      .then(async (response) => {
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (typeof result !== 'object' || result === null || !('isVpn' in result) || typeof result.isVpn !== 'boolean') return;

        try {
          sessionStorage.setItem(VPN_CHECK_KEY, result.isVpn ? 'vpn' : 'clear');
        } catch {
          // The in-memory ref still prevents duplicate checks during this mount.
        }
        if (result.isVpn) setOpen(true);
      })
      .catch(() => undefined);
  }, [enabled]);

  return (
    <AlertDialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) {
        try {
          if (sessionStorage.getItem(VPN_CHECK_KEY) === 'vpn') sessionStorage.setItem(VPN_CHECK_KEY, 'dismissed');
        } catch {
          // Keep the dialog usable when browser privacy settings block storage.
        }
      }
    }}>
      <AlertDialogContent className="w-[calc(100%_-_2rem)] max-w-[330px] rounded-card-xl px-5 py-6 text-center sm:px-6">
        <div aria-hidden="true" className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-warning-soft text-warning">
          <ShieldAlert size={30} strokeWidth={1.8} />
        </div>
        <AlertDialogTitle className="text-center text-xl">VPN detected</AlertDialogTitle>
        <AlertDialogDescription className="mt-2 text-center leading-relaxed">
          We detected that you may be using a VPN. VPN use can affect location estimates and access to some services. Please turn off your VPN and try again.
        </AlertDialogDescription>
        <AlertDialogFooter className="mt-5">
          <AlertDialogCancel className="inline-flex min-h-12 w-full items-center justify-center rounded-card bg-accent px-6 py-3 text-[15px] font-semibold leading-snug text-accent-text shadow-xs transition-colors duration-fast ease-out hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            OK
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

## src/pages/admin/admin-page.tsx - Admin shell

- File: `src/pages/admin/admin-page.tsx` - 191 lines in file
- Admin console layout: grouped sidebar navigation + section content (no public Header).

```tsx
import { useState } from 'react';
import {
  Activity, ArrowLeft, BarChart3, Banknote, CalendarCheck, CreditCard, Flag, Gavel, Gift, LayoutDashboard,
  LifeBuoy, Lock, Menu, Package, ScrollText, Search, Shield, ShieldCheck, SlidersHorizontal, Star, Tags, Users,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from '@/router';
import { Badge, EmptyState, IconButton } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useAdminAccess, type AdminAccess, type AdminPermission } from '@/lib/admin';
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/components/shadcn/dialog';
import { cn } from '@/lib/utils';
import { OverviewSection } from './overview';
import { BookingsSection, ListingsSection, PaymentsSection, PayoutsSection, ReviewsSection, UsersSection } from './resources';
import { CategoriesSection, FlagsSection, SettingsSection } from './config';
import { AdminsSection, AuditSection, IntegrationsSection } from './governance';
import { PageHeader } from './shared';
import { CasesSection } from './cases';
import { PromotionsSection } from './promotions';
import { RefundsSection } from './refunds';
import { ItemRequestsSection } from './marketplace';
import { CustomerInvestigationsSection } from './investigations';

type Icon = LucideIcon;
interface NavItem { id: string; label: string; icon: Icon; permission?: AdminPermission; anyPermission?: AdminPermission[]; superOnly?: boolean; pending?: string }

const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Operations', items: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, permission: 'analytics.view' },
    { id: 'users', label: 'Users', icon: Users, permission: 'users.manage' },
    { id: 'investigations', label: 'Customer investigations', icon: ShieldCheck, permission: 'fraud.investigate' },
    { id: 'listings', label: 'Listings', icon: Package, permission: 'listings.moderate' },
    { id: 'requests', label: 'Item requests', icon: Search, permission: 'listings.moderate' },
    { id: 'bookings', label: 'Bookings', icon: CalendarCheck, permission: 'bookings.view' },
    { id: 'disputes', label: 'Disputes & claims', icon: Gavel, permission: 'disputes.manage' },
    { id: 'support', label: 'Support tickets', icon: LifeBuoy, permission: 'support.manage' },
    { id: 'promotions', label: 'Promotions & rewards', icon: Gift, anyPermission: ['promotions.manage', 'credits.manage'] },
    { id: 'reviews', label: 'Reviews', icon: Star, permission: 'reviews.moderate' },
    { id: 'categories', label: 'Categories', icon: Tags, permission: 'categories.manage' },
  ] },
  { title: 'Finance', items: [
    { id: 'payments', label: 'Payments', icon: CreditCard, permission: 'payments.view' },
    { id: 'payouts', label: 'Payouts', icon: Banknote, permission: 'payouts.view' },
    { id: 'refunds', label: 'Refund requests', icon: CreditCard, anyPermission: ['refunds.issue', 'refunds.approve', 'refunds.senior'] },
  ] },
  { title: 'Super admin', items: [
    { id: 'settings', label: 'Global settings', icon: SlidersHorizontal, permission: 'config.manage' },
    { id: 'flags', label: 'Feature flags', icon: Flag, permission: 'flags.manage' },
    { id: 'integrations', label: 'Integrations & health', icon: Activity, permission: 'integrations.view' },
    { id: 'audit', label: 'Audit log', icon: ScrollText, permission: 'audit.view' },
    { id: 'admins', label: 'Administrators', icon: ShieldCheck, permission: 'admins.manage' },
  ] },
  { title: 'Coming with their modules', items: [
    { id: 'insurance', label: 'Insurance & protection', icon: Shield, pending: 'Insurance and protection options' },
    { id: 'analytics', label: 'Analytics & exports', icon: BarChart3, pending: 'Reports and CSV exports beyond the overview' },
  ] },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);
const can = (access: AdminAccess, item: NavItem) => item.superOnly ? access.role === 'super_admin' : item.anyPermission
  ? item.anyPermission.some((permission) => access.permissions.includes(permission))
  : !item.permission || access.permissions.includes(item.permission);

function Nav({ access, active, onSelect }: { access: AdminAccess; active: string; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Admin" className="p-3 space-y-5">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => can(access, i));
        if (items.length === 0) return null;
        return (
          <div key={g.title}>
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.title}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.id}>
                  <button
                    onClick={() => onSelect(i.id)} aria-current={active === i.id ? 'page' : undefined}
                    className={cn(
                      'w-full flex items-center gap-2.5 rounded-card px-3 py-2 text-sm font-medium text-left transition-colors duration-fast',
                      active === i.id ? 'bg-accent-soft text-accent' : 'text-sec hover:bg-subtle hover:text-main',
                    )}
                  >
                    <i.icon size={16} className="shrink-0" />
                    <span className="truncate">{i.label}</span>
                    {i.pending && <span className="ml-auto text-[10px] font-semibold uppercase text-muted">Soon</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Section({ id }: { id: string }) {
  switch (id) {
    case 'overview': return <OverviewSection />;
    case 'users': return <UsersSection />;
    case 'investigations': return <CustomerInvestigationsSection />;
    case 'listings': return <ListingsSection />;
    case 'requests': return <ItemRequestsSection />;
    case 'bookings': return <BookingsSection />;
    case 'disputes': return <CasesSection kind="dispute" />;
    case 'support': return <CasesSection kind="support" />;
    case 'promotions': return <PromotionsSection />;
    case 'refunds': return <RefundsSection />;
    case 'reviews': return <ReviewsSection />;
    case 'categories': return <CategoriesSection />;
    case 'payments': return <PaymentsSection />;
    case 'payouts': return <PayoutsSection />;
    case 'settings': return <SettingsSection />;
    case 'flags': return <FlagsSection />;
    case 'integrations': return <IntegrationsSection />;
    case 'audit': return <AuditSection />;
    case 'admins': return <AdminsSection />;
    default: {
      const item = ALL_ITEMS.find((i) => i.id === id);
      return (
        <>
          <PageHeader title={item?.label ?? 'Not found'} />
          <EmptyState icon={<Lock size={20} />} title="Not available yet" description={`${item?.pending ?? 'This area'} has not been built. It will appear here when that module ships — nothing is simulated.`} />
        </>
      );
    }
  }
}

export function AdminPage({ section }: { section?: string }) {
  const { navigate } = useRouter();
  const { access, loading, error, retry } = useAdminAccess();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) {
    return <div className="max-w-5xl mx-auto px-4 py-10 space-y-4" aria-busy="true"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" rounded="rounded-card-lg" /></div>;
  }
  if (error) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <EmptyState icon={<Lock size={20} />} title="Could not verify administrator access" description={error} actionLabel="Try again" onAction={retry} />
      </div>
    );
  }
  if (access === null) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <EmptyState icon={<Lock size={20} />} title="Administrator access required" description="Your account does not have access to the admin console." actionLabel="Back to YBuy" onAction={() => navigate({ name: 'home' })} />
      </div>
    );
  }

  const granted = ALL_ITEMS.filter((i) => (i.permission || i.anyPermission || i.superOnly) && can(access, i));
  const active = ALL_ITEMS.find((i) => i.id === section && can(access, i)) ?? granted[0];
  if (!active) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <EmptyState icon={<Lock size={20} />} title="No permissions granted" description="You are an administrator, but no permissions have been granted yet. Ask a super admin." actionLabel="Back to YBuy" onAction={() => navigate({ name: 'home' })} />
      </div>
    );
  }
  const select = (id: string) => { setMenuOpen(false); navigate({ name: 'admin', section: id }); };

  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-40 h-14 flex items-center gap-3 px-4 bg-card border-b border-app">
        <IconButton label="Open admin menu" variant="ghost" size="sm" className="lg:hidden" onClick={() => setMenuOpen(true)}><Menu size={18} /></IconButton>
        <button onClick={() => navigate({ name: 'home' })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-sec hover:text-main transition-colors duration-fast">
          <ArrowLeft size={15} /> Back to YBuy
        </button>
        <h1 className="font-display font-bold text-main ml-2 hidden sm:block">Admin console</h1>
        <Badge tone="accent" className="ml-auto">{access.role.replace('_', ' ')}</Badge>
      </header>
      <div className="lg:grid lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto bg-card border-r border-app">
          <Nav access={access} active={active.id} onSelect={select} />
        </aside>
        <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent>
            <DialogTitle className="sr-only">Admin navigation</DialogTitle>
            <DialogDescription className="sr-only">Choose an admin section</DialogDescription>
            <div className="pt-10"><Nav access={access} active={active.id} onSelect={select} /></div>
          </SheetContent>
        </Dialog>
        <main className="min-w-0 px-4 sm:px-6 py-6 max-w-[1200px] w-full">
          <Section key={active.id} id={active.id} />
        </main>
      </div>
    </div>
  );
}
```

## src/pages/home.tsx - Footer (home page only)

- File: `src/pages/home.tsx` (lines 718-736) - 736 lines in file
- Logo + footer links (Browse, List an item, Guidelines) + giant editorial "YBuy" wordmark + copyright.

```tsx
/* ─────────────────── Footer ─────────────────── */

function Footer({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <footer className="overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <BrandLogo />
          <nav aria-label="Footer" className="flex items-center gap-6 text-sm text-sec">
            <button type="button" onClick={() => onNavigate({ name: 'search' })} className="min-h-11 hover:text-main transition-colors duration-fast">Browse</button>
            <button type="button" onClick={() => onNavigate({ name: 'create-listing' })} className="min-h-11 hover:text-main transition-colors duration-fast">List an item</button>
            <button type="button" onClick={() => onNavigate({ name: 'guidelines' })} className="min-h-11 hover:text-main transition-colors duration-fast">Guidelines</button>
          </nav>
        </div>
        <p className="py-6 text-sm text-muted">© {new Date().getFullYear()} YBuy</p>
      </div>
    </footer>
  );
}
```
