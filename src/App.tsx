import { ThemeProvider } from '@/theme-context';
import { AuthProvider } from '@/auth-context';
import { LocationProvider } from '@/location-context';
import { RequireAuth } from '@/components/require-auth';
import { RouterProvider, useRouter } from '@/router';
import { Header, BottomNav } from '@/components/nav';
import { HomePage } from '@/pages/home';
import { SearchPage } from '@/pages/search';
import { ListingPage } from '@/pages/listing';
import { CheckoutPage, ConfirmationPage } from '@/pages/checkout';
import { BookingsPage } from '@/pages/dashboards';
import { CreateListingPage } from '@/pages/create-listing';
import { CheckInPage, CheckOutPage } from '@/pages/check-in-out';
import { ItemPassportPage } from '@/pages/passport';
import { ClaimsPage, ClaimDetailPage } from '@/pages/claims';
import { MessagingPage, ConversationPage } from '@/pages/messaging';
import { RequestsPage, NeedSomethingPage } from '@/pages/requests';
import { FavoritesPage } from '@/pages/favorites';
import { ProtectionPage } from '@/pages/protection';
import { TrustProfilePage } from '@/pages/trust-profile';
import { BiddingPage, AuctionPage } from '@/pages/bidding';
import { OutOfScopePage } from '@/pages/out-of-scope';
import { GuidelinesPage } from '@/pages/guidelines';
import { SHOW_OUT_OF_SCOPE_PAGES, OUT_OF_SCOPE_ROUTES } from '@/lib/feature-flags';

function AppContent() {
  const { route } = useRouter();

  if (OUT_OF_SCOPE_ROUTES.has(route.name) && !SHOW_OUT_OF_SCOPE_PAGES) {
    return (
      <div className="min-h-screen bg-app">
        <Header />
        <main className="pb-16 md:pb-0"><OutOfScopePage /></main>
        <BottomNav />
      </div>
    );
  }

  let page: React.ReactNode;
  switch (route.name) {
    case 'home': page = <HomePage />; break;
    case 'search': page = (
      <SearchPage
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
    case 'check-in': page = <RequireAuth><CheckInPage id={route.id} /></RequireAuth>; break;
    case 'check-out': page = <RequireAuth><CheckOutPage id={route.id} /></RequireAuth>; break;
    case 'item-passport': page = <RequireAuth><ItemPassportPage id={route.id} /></RequireAuth>; break;
    case 'claims': page = <RequireAuth><ClaimsPage /></RequireAuth>; break;
    case 'claim-detail': page = <RequireAuth><ClaimDetailPage id={route.id} /></RequireAuth>; break;
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
      <main className="pb-16 md:pb-0"><div key={route.name} className="animate-page-fade">{page}</div></main>
      <BottomNav />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <LocationProvider>
          <RouterProvider>
            <AppContent />
          </RouterProvider>
        </LocationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
