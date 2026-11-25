import { lazy, Suspense, useEffect } from 'react';
import { ThemeProvider } from '@/theme-context';
import { AuthProvider, useAuth } from '@/auth-context';
import { LocationProvider } from '@/location-context';
import { RequireAuth } from '@/main-site/components/require-auth';
import { SignInDialog } from '@/main-site/components/sign-in-dialog';
import { RouterProvider, useRouter } from '@/router';
import { Header } from './components/nav';
import { HomePage } from './pages/home';
import { OutOfScopePage } from '@/main-site/pages/out-of-scope';
import { AccessPage } from '@/main-site/pages/access';
import { VpnNotice } from '@/main-site/components/vpn-notice';
import { PageLoading } from '@/main-site/components/skeleton';
import { SHOW_OUT_OF_SCOPE_PAGES, OUT_OF_SCOPE_ROUTES } from '@/lib/feature-flags';
import { UUID_RE } from '@/lib/text-safety';
import { AdminDestination } from '@/components/admin-destination';
import './index.css';
import './theme.css';
import './workspace.css';

const SearchPage = lazy(() => import('@/main-site/pages/search').then(({ SearchPage: page }) => ({ default: page })));
const ListingPage = lazy(() => import('@/main-site/pages/listing').then(({ ListingPage: page }) => ({ default: page })));
const CheckoutPage = lazy(() => import('@/main-site/pages/checkout').then(({ CheckoutPage: page }) => ({ default: page })));
const ConfirmationPage = lazy(() => import('@/main-site/pages/checkout').then(({ ConfirmationPage: page }) => ({ default: page })));
const BookingsPage = lazy(() => import('@/main-site/pages/dashboards').then(({ BookingsPage: page }) => ({ default: page })));
const CreateListingPage = lazy(() => import('@/main-site/pages/create-listing').then(({ CreateListingPage: page }) => ({ default: page })));
const CheckInPage = lazy(() => import('@/main-site/pages/check-in-out').then(({ CheckInPage: page }) => ({ default: page })));
const CheckOutPage = lazy(() => import('@/main-site/pages/check-in-out').then(({ CheckOutPage: page }) => ({ default: page })));
const ItemPassportPage = lazy(() => import('@/main-site/pages/passport').then(({ ItemPassportPage: page }) => ({ default: page })));
const ClaimsPage = lazy(() => import('@/main-site/pages/claims').then(({ ClaimsPage: page }) => ({ default: page })));
const ClaimDetailPage = lazy(() => import('@/main-site/pages/claims').then(({ ClaimDetailPage: page }) => ({ default: page })));
const SupportPage = lazy(() => import('@/main-site/pages/support').then(({ SupportPage: page }) => ({ default: page })));
const WalletPage = lazy(() => import('@/main-site/pages/wallet').then(({ WalletPage: page }) => ({ default: page })));
const NotificationsPage = lazy(() => import('@/main-site/pages/notifications').then(({ NotificationsPage: page }) => ({ default: page })));
const MessagingPage = lazy(() => import('@/main-site/pages/messaging').then(({ MessagingPage: page }) => ({ default: page })));
const ConversationPage = lazy(() => import('@/main-site/pages/messaging').then(({ ConversationPage: page }) => ({ default: page })));
const RequestsPage = lazy(() => import('@/main-site/pages/requests').then(({ RequestsPage: page }) => ({ default: page })));
const RequestMatchesPage = lazy(() => import('@/main-site/pages/request-matches').then(({ RequestMatchesPage: page }) => ({ default: page })));
const NeedSomethingPage = lazy(() => import('@/main-site/pages/requests').then(({ NeedSomethingPage: page }) => ({ default: page })));
const FavoritesPage = lazy(() => import('@/main-site/pages/favorites').then(({ FavoritesPage: page }) => ({ default: page })));
const ProtectionPage = lazy(() => import('@/main-site/pages/protection').then(({ ProtectionPage: page }) => ({ default: page })));
const TrustProfilePage = lazy(() => import('@/main-site/pages/trust-profile').then(({ TrustProfilePage: page }) => ({ default: page })));
const BiddingPage = lazy(() => import('@/main-site/pages/bidding').then(({ BiddingPage: page }) => ({ default: page })));
const BiddingDetailPage = lazy(() => import('@/main-site/pages/bidding').then(({ BiddingDetailPage: page }) => ({ default: page })));
const GuidelinesPage = lazy(() => import('@/main-site/pages/guidelines').then(({ GuidelinesPage: page }) => ({ default: page })));

function AppContent() {
  const { route } = useRouter();
  const { user } = useAuth();
  useEffect(() => {
    const titles: Record<typeof route.name, string> = {
      home: 'Home', search: 'Explore rentals', listing: 'Rental', checkout: 'Checkout',
      confirmation: 'Booking confirmation', dashboard: 'My rentals', 'renter-dashboard': 'My rentals',
      'owner-dashboard': 'Lending', 'owner-listings': 'My listings', 'owner-payouts': 'Earnings and payouts',
      'create-listing': 'List an item', 'edit-listing': 'Edit listing', 'check-in': 'Check in',
      'check-out': 'Check out', 'item-passport': 'Item passport', claims: 'Rental disputes',
      'claim-detail': 'Rental dispute', support: 'Support', wallet: 'Points and rewards',
      notifications: 'Notifications', messaging: 'Messages', conversation: 'Conversation',
      requests: 'Item requests', favorites: 'Saved items', 'need-something': 'Request an item',
      protection: 'Protection', 'trust-profile': 'Profile and settings', bidding: 'Bidding',
      'bidding-detail': 'Bidding', auction: 'Bidding', guidelines: 'Guidelines', admin: 'Admin',
      'super-admin': 'Super admin', access: 'Access',
    };
    document.title = `${route.name === 'dashboard' && route.tab === 'lending' ? 'Lending' : titles[route.name]} | YBuy`;
  }, [route]);
  const skipLink = <a href="#main-content" className="skip-link">Skip to content</a>;
  const focused = ['checkout', 'confirmation', 'create-listing', 'edit-listing', 'need-something', 'check-in', 'check-out'].includes(route.name);

  if (route.name === 'access') return <AccessPage />;

  if (route.name === 'admin' || route.name === 'super-admin') {
    return <AdminDestination role={route.name === 'super-admin' ? 'super_admin' : 'admin'} />;
  }

  if (OUT_OF_SCOPE_ROUTES.has(route.name) && !SHOW_OUT_OF_SCOPE_PAGES) {
    return (
      <div className="min-h-dvh flex flex-col bg-app">
        {skipLink}
        <Header />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 pb-8"><OutOfScopePage /></main>
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
    case 'listing': page = <ListingPage key={`${route.id}:${route.requestId ?? ''}`} id={route.id} requestId={route.requestId} />; break;
    case 'checkout': page = <RequireAuth><CheckoutPage key={`${route.id}:${route.startDate}:${route.endDate}:${route.quantity}`} id={route.id} startDate={route.startDate} endDate={route.endDate} quantity={route.quantity} /></RequireAuth>; break;
    case 'confirmation': page = <RequireAuth><ConfirmationPage id={route.id} /></RequireAuth>; break;
    case 'dashboard': page = <RequireAuth><BookingsPage initialTab={route.tab ?? 'renting'} /></RequireAuth>; break;
    case 'renter-dashboard': page = <RequireAuth><BookingsPage initialTab="renting" /></RequireAuth>; break;
    case 'owner-dashboard': page = <RequireAuth><BookingsPage initialTab="lending" /></RequireAuth>; break;
    case 'owner-listings': page = <RequireAuth><BookingsPage initialTab="lending" ownerView="listings" /></RequireAuth>; break;
    case 'owner-payouts': page = <RequireAuth><BookingsPage initialTab="lending" ownerView="earnings" /></RequireAuth>; break;
    case 'create-listing': page = <RequireAuth><CreateListingPage key={route.requestId ?? 'new'} requestId={route.requestId} /></RequireAuth>; break;
    case 'edit-listing': page = <RequireAuth><CreateListingPage key={`${route.id}:${route.requestId ?? ''}`} editId={route.id} requestId={route.requestId} /></RequireAuth>; break;
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
    case 'requests': page = route.matches && route.requestId
      ? <RequireAuth><RequestMatchesPage key={route.requestId} id={route.requestId} /></RequireAuth>
      : <RequestsPage initialTab={route.tab ?? 'browse'} />; break;
    case 'favorites': page = <RequireAuth><FavoritesPage /></RequireAuth>; break;
    // Let visitors prepare a request before signing in; NeedSomethingPage opens
    // the auth dialog on submit so the in-progress form stays mounted.
    case 'need-something': page = <NeedSomethingPage />; break;
    case 'protection': page = <ProtectionPage />; break;
    case 'trust-profile': page = <RequireAuth><TrustProfilePage /></RequireAuth>; break;
    case 'bidding': page = <BiddingPage />; break;
    case 'bidding-detail': page = <BiddingDetailPage key={route.id} id={route.id} />; break;
    case 'auction': page = UUID_RE.test(route.id) ? <BiddingDetailPage key={route.id} id={route.id} /> : <OutOfScopePage />; break;
    case 'guidelines': page = <GuidelinesPage />; break;
    default: page = <HomePage />; break;
  }

  return (
    <div className="min-h-dvh flex flex-col bg-app">
      {skipLink}
      <Header focused={focused} />
      <div className={focused ? 'workspace-focused' : 'min-w-0 flex-1'}>
        <div className="workspace-content">
          <main id="main-content" tabIndex={-1} className="min-w-0 pb-8">
            <Suspense fallback={<PageLoading />}>
              <div key={`${route.name === 'need-something' ? 'request-draft' : user?.id ?? 'anonymous'}:${route.name}`} className="animate-page-fade">{page}</div>
            </Suspense>
          </main>
        </div>
      </div>
      <SignInDialog />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider fixedTheme="main">
      <AuthProvider>
        <LocationProvider>
          <RouterProvider>
            <AppContent />
            <VpnNotice />
          </RouterProvider>
        </LocationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
