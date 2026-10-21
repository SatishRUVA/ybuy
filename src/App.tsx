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
    case 'requests': page = <RequireAuth><RequestsPage /></RequireAuth>; break;
    case 'favorites': page = <RequireAuth><FavoritesPage /></RequireAuth>; break;
    case 'need-something': page = <RequireAuth><NeedSomethingPage /></RequireAuth>; break;
    case 'protection': page = <ProtectionPage />; break;
    case 'trust-profile': page = <RequireAuth><TrustProfilePage /></RequireAuth>; break;
    case 'bidding': page = <BiddingPage />; break;
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
          </RouterProvider>
        </LocationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
