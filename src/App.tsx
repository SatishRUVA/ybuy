import { Fragment, lazy, Suspense } from 'react';
import './index.css';
import '@/styles/preview-one.css';
import { ThemeProvider } from '@/theme-context';
import { AuthProvider, useAuth } from '@/auth-context';
import { LocationProvider } from '@/location-context';
import { RequireAuth } from '@/components/require-auth';
import { SignInDialog } from '@/components/sign-in-dialog';
import { RouterProvider, useRouter } from '@/router';
import { ProductionPreviewHeader as Header, ProductionPreviewFooter as Footer, ProductionPreviewSidebar as WorkspaceSidebar } from '@/components/preview-navigation';
import { PreviewMarketplace } from '@/components/preview-marketplace';
import { OutOfScopePage } from '@/pages/out-of-scope';
import { AccessPage } from '@/pages/access';
import { VpnNotice } from '@/components/vpn-notice';
import { BiddingTicker } from '@/components/bidding-ticker';
import { SHOW_OUT_OF_SCOPE_PAGES, OUT_OF_SCOPE_ROUTES } from '@/lib/feature-flags';
import { AdminDestination } from '@/components/admin-destination';

const ConfirmationPage = lazy(() => import('@/pages/checkout').then(({ ConfirmationPage: page }) => ({ default: page })));
const PreviewRentals = lazy(() => import('@/components/preview-rentals').then(({ PreviewRentals: page }) => ({ default: page })));
const PreviewOwner = lazy(() => import('@/components/preview-owning').then(({ PreviewOwner: page }) => ({ default: page })));
const PreviewPayouts = lazy(() => import('@/components/preview-owning').then(({ PreviewPayouts: page }) => ({ default: page })));
const PreviewListingWizard = lazy(() => import('@/components/preview-owning').then(({ PreviewListingWizard: page }) => ({ default: page })));
const CheckInPage = lazy(() => import('@/pages/check-in-out').then(({ CheckInPage: page }) => ({ default: page })));
const CheckOutPage = lazy(() => import('@/pages/check-in-out').then(({ CheckOutPage: page }) => ({ default: page })));
const ItemPassportPage = lazy(() => import('@/pages/passport').then(({ ItemPassportPage: page }) => ({ default: page })));
const ClaimsPage = lazy(() => import('@/pages/claims').then(({ ClaimsPage: page }) => ({ default: page })));
const ClaimDetailPage = lazy(() => import('@/pages/claims').then(({ ClaimDetailPage: page }) => ({ default: page })));
const SupportPage = lazy(() => import('@/pages/support').then(({ SupportPage: page }) => ({ default: page })));
const WalletPage = lazy(() => import('@/pages/wallet').then(({ WalletPage: page }) => ({ default: page })));
const PreviewNotifications = lazy(() => import('@/components/preview-account').then(({ PreviewNotifications: page }) => ({ default: page })));
const PreviewMessages = lazy(() => import('@/components/preview-account').then(({ PreviewMessages: page }) => ({ default: page })));
const PreviewRequests = lazy(() => import('@/components/preview-account').then(({ PreviewRequests: page }) => ({ default: page })));
const PreviewNeedSomething = lazy(() => import('@/components/preview-account').then(({ PreviewNeedSomething: page }) => ({ default: page })));
const ProtectionPage = lazy(() => import('@/pages/protection').then(({ ProtectionPage: page }) => ({ default: page })));
const PreviewProfile = lazy(() => import('@/components/preview-account').then(({ PreviewProfile: page }) => ({ default: page })));
const PreviewBidding = lazy(() => import('@/components/preview-bidding').then(({ PreviewBidding: page }) => ({ default: page })));
const PreviewBidRoom = lazy(() => import('@/components/preview-bidding').then(({ PreviewBidRoom: page }) => ({ default: page })));
const GuidelinesPage = lazy(() => import('@/pages/guidelines').then(({ GuidelinesPage: page }) => ({ default: page })));

function isWorkspaceRoute(route: ReturnType<typeof useRouter>['route']) {
  return ['dashboard', 'renter-dashboard', 'owner-dashboard', 'owner-listings', 'owner-payouts', 'check-in', 'check-out',
    'item-passport', 'claims', 'claim-detail', 'support', 'wallet', 'trust-profile', 'messaging', 'conversation',
    'notifications', 'admin'].includes(route.name);
}

function AppContent() {
  const { route } = useRouter();
  const { user } = useAuth();
  const directTemplate = ['home', 'search', 'listing', 'favorites', 'checkout', 'confirmation', 'dashboard',
    'renter-dashboard', 'owner-dashboard', 'owner-listings', 'owner-payouts', 'create-listing', 'edit-listing',
    'notifications', 'messaging', 'conversation', 'requests', 'need-something', 'trust-profile', 'bidding',
    'bidding-detail', 'auction', 'admin'].includes(route.name);
  const PageContainer = directTemplate ? 'div' : 'main';
  const workspace = Boolean(user) && isWorkspaceRoute(route);

  if (route.name === 'access') return <AccessPage />;

  if (OUT_OF_SCOPE_ROUTES.has(route.name) && !SHOW_OUT_OF_SCOPE_PAGES) {
    return (
      <div className="p1">
        <Header />
        <main><OutOfScopePage /></main>
        <SignInDialog />
      </div>
    );
  }

  let page: React.ReactNode;
  switch (route.name) {
    case 'home':
    case 'search':
    case 'listing': page = <PreviewMarketplace key={JSON.stringify(route)} />; break;
    case 'checkout': page = <RequireAuth><PreviewMarketplace key={JSON.stringify(route)} /></RequireAuth>; break;
    case 'confirmation': page = <RequireAuth><ConfirmationPage id={route.id} /></RequireAuth>; break;
    case 'dashboard': page = <RequireAuth>{route.tab === 'lending' ? <PreviewOwner /> : <PreviewRentals />}</RequireAuth>; break;
    case 'renter-dashboard': page = <RequireAuth><PreviewRentals /></RequireAuth>; break;
    case 'owner-dashboard': page = <RequireAuth><PreviewOwner /></RequireAuth>; break;
    case 'owner-listings': page = <RequireAuth><PreviewOwner listingView /></RequireAuth>; break;
    case 'owner-payouts': page = <RequireAuth><PreviewPayouts /></RequireAuth>; break;
    case 'create-listing': page = <RequireAuth><PreviewListingWizard /></RequireAuth>; break;
    case 'edit-listing': page = <RequireAuth><PreviewListingWizard key={route.id} editId={route.id} /></RequireAuth>; break;
    case 'check-in': page = <RequireAuth><CheckInPage id={route.id} /></RequireAuth>; break;
    case 'check-out': page = <RequireAuth><CheckOutPage id={route.id} /></RequireAuth>; break;
    case 'item-passport': page = <RequireAuth><ItemPassportPage id={route.id} /></RequireAuth>; break;
    case 'claims': page = <RequireAuth><ClaimsPage /></RequireAuth>; break;
    case 'claim-detail': page = <RequireAuth><ClaimDetailPage id={route.id} /></RequireAuth>; break;
    case 'support': page = <RequireAuth><SupportPage id={route.id} /></RequireAuth>; break;
    case 'wallet': page = <RequireAuth><WalletPage /></RequireAuth>; break;
    case 'notifications': page = <RequireAuth><PreviewNotifications /></RequireAuth>; break;
    case 'messaging': page = <RequireAuth><PreviewMessages /></RequireAuth>; break;
    case 'conversation': page = <RequireAuth><PreviewMessages key={route.id} id={route.id} /></RequireAuth>; break;
    case 'requests': page = <RequireAuth><PreviewRequests initialTab={route.tab ?? 'browse'} /></RequireAuth>; break;
    case 'favorites': page = <RequireAuth><PreviewMarketplace /></RequireAuth>; break;
    case 'need-something': page = <PreviewNeedSomething />; break;
    case 'protection': page = <ProtectionPage />; break;
    case 'trust-profile': page = <RequireAuth><PreviewProfile /></RequireAuth>; break;
    case 'bidding': page = <PreviewBidding />; break;
    case 'bidding-detail':
    case 'auction': page = <PreviewBidRoom key={route.id} id={route.id} />; break;
    case 'admin': page = <AdminDestination />; break;
    case 'guidelines': page = <GuidelinesPage />; break;
    default: page = <PreviewMarketplace />; break;
  }

  return (
    <div className="p1">
      <a href="#p1-main" className="p1-skip">Skip to content</a>
      <Header />
      <BiddingTicker />
      <PageContainer id="p1-main" tabIndex={-1} className={workspace ? 'p1-workspace p1-container' : undefined}>
        {workspace && <WorkspaceSidebar />}
        <div className={workspace ? 'p1-work-canvas' : undefined}>
          <Suspense fallback={<div role="status" className="min-h-[50vh] p-8 text-sec">Loading page...</div>}>
            {directTemplate ? <Fragment key={`${user?.id ?? 'anonymous'}:${route.name}`}>{page}</Fragment>
              : <div key={`${user?.id ?? 'anonymous'}:${route.name}`} className="animate-page-fade">{page}</div>}
          </Suspense>
        </div>
      </PageContainer>
      {!isWorkspaceRoute(route) && <Footer />}
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
                Test environment - synthetic accounts and sandbox payments only. Notification email delivery is disabled.
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
