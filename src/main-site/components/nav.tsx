import { useEffect, useState } from 'react';
import { MessageSquare, User, Menu, Home, Search, Plus, PackagePlus, Calendar, Heart, LogOut, ShieldCheck, Bell, Gavel } from 'lucide-react';
import { useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { useAdminAccess } from '@/lib/admin-access';
import { ThemeSwitcher } from '@/main-site/components/search';
import { Alert, Button } from '@/main-site/components/ui';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';
import { subscribeToNotifications, unreadNotificationCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { BrandLogo } from '@/main-site/components/brand-logo';
import { Dialog, DialogTrigger, DialogTitle, DialogDescription, SheetContent } from '@/main-site/components/shadcn/dialog';
import { WorkspaceNavigation } from '@/main-site/components/workspace-navigation';

function Wordmark({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-11 min-w-11 items-center gap-2.5 shrink-0" aria-label="YBuy home">
      <BrandLogo compact />
    </button>
  );
}
export function Header({ workspace = false, focused = false }: { workspace?: boolean; focused?: boolean }) {
  const { route, navigate } = useRouter();
  const { user, profile, loading, error, signInOpen, authBusy, openSignIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const adminAccess = useAdminAccess();
  const rentalWorkspace = ['dashboard', 'renter-dashboard', 'owner-dashboard', 'owner-listings', 'owner-payouts'].includes(route.name);

  // A route change while the sheet is open would otherwise leave it covering the new page.
  useEffect(() => { setMenuOpen(false); }, [route, user?.id]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1280px)');
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

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
    setMenuOpen(false);
    navigate(next);
  }

  function signIn() {
    setMenuOpen(false);
    openSignIn();
  }

  const navItems: { label: string; route: Route; icon: typeof Home }[] = [
    { label: 'Home', route: { name: 'home' }, icon: Home },
    { label: 'Browse', route: { name: 'search' }, icon: Search },
    { label: 'Requests', route: { name: 'requests' }, icon: PackagePlus },
    { label: 'Bidding', route: { name: 'bidding' }, icon: Gavel },
    { label: 'Bookings', route: { name: 'dashboard' }, icon: Calendar },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare },
  ];

  const isActive = (r: Route) => {
    if (r.name === 'requests') return route.name === 'requests';
    if (r.name === 'bidding') return route.name === 'bidding' || route.name === 'bidding-detail' || route.name === 'auction';
    if (r.name === 'dashboard') return route.name === 'dashboard' || route.name === 'renter-dashboard' || route.name === 'owner-dashboard';
    return route.name === r.name;
  };

  if (focused) {
    return (
      <header className="sticky top-0 z-40 glass-nav glass-nav-top border-b border-app">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
          <Wordmark onClick={() => navigate({ name: 'home' })} />
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'dashboard' })}>Back to bookings</Button>
        </div>
        {error && !signInOpen && <div role="alert" className="px-4 pb-3"><Alert tone="error">{error}</Alert></div>}
      </header>
    );
  }

  return (
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
      <header className="sticky top-0 z-40 glass-nav glass-nav-top border-b border-app">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16 gap-4">
            <Wordmark onClick={() => navigate({ name: 'home' })} />

            <nav className={`${workspace ? 'hidden' : 'hidden md:flex'} items-center gap-0.5`} aria-label="Main">
              {navItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => go(item.route)}
                  aria-current={isActive(item.route) ? 'page' : undefined}
                  className={`${item.label === 'Bookings' || item.label === 'Messages' ? 'hidden xl:inline-flex' : 'inline-flex'} relative px-2 xl:px-3 h-11 rounded-card text-sm font-semibold transition-colors duration-fast ${
                    isActive(item.route) ? 'text-main bg-subtle' : 'text-sec hover:text-main hover:bg-subtle'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={<PackagePlus size={16} />}
                onClick={() => go({ name: 'create-listing' })}
                className={rentalWorkspace ? 'hidden' : 'hidden xl:inline-flex'}
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
                    className="relative grid h-11 w-11 place-items-center rounded-card border border-app bg-card text-sec transition-colors duration-fast hover:border-strong hover:text-accent"
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
                      className="hidden sm:grid place-items-center w-11 h-11 rounded-card border border-app bg-card text-sec hover:text-accent hover:border-strong transition-colors duration-fast"
                    >
                      <ShieldCheck size={18} />
                    </button>
                  )}
                  <button
                    onClick={() => go({ name: 'favorites' })}
                    aria-label="Saved items"
                    aria-current={route.name === 'favorites' ? 'page' : undefined}
                    className="grid place-items-center w-11 h-11 rounded-card border border-app bg-card text-sec hover:text-favorite hover:border-strong transition-colors duration-fast"
                  >
                    <Heart size={18} />
                  </button>
                  <button
                    onClick={() => go({ name: 'trust-profile' })}
                    aria-label="Account"
                    aria-current={route.name === 'trust-profile' ? 'page' : undefined}
                    className="hidden sm:inline-flex h-11 items-center gap-2 rounded-card border border-app bg-card px-1.5 pr-3 text-sm font-semibold text-main hover:border-strong transition-colors duration-fast"
                  >
                    {profile?.avatar_url
                      ? <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      : <span className="grid place-items-center w-7 h-7 rounded-full bg-subtle"><User size={16} className="text-sec" /></span>}
                    <span>Account</span>
                  </button>
                </>
              ) : (
                <Button size="sm" variant="secondary" disabled={loading} onClick={signIn}>Sign in / Join</Button>
              )}

              <DialogTrigger asChild>
                <button
                  aria-label="Open menu"
                  className="xl:hidden grid shrink-0 place-items-center w-11 h-11 rounded-card hover:bg-subtle transition-colors duration-fast"
                >
                  <Menu size={20} className="text-main" />
                </button>
              </DialogTrigger>
            </div>
          </div>
        </div>

        {error && !signInOpen && <div role="alert" className="max-w-[1400px] mx-auto px-4 sm:px-6 pb-3"><Alert tone="error">{error}</Alert></div>}

      </header>
      <SheetContent className="left-auto right-0 w-80 max-w-full overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="border-b border-app px-5 py-5 pr-14">
          <DialogTitle>Navigation</DialogTitle>
          <DialogDescription>Browse rentals and manage your account.</DialogDescription>
        </div>
        {user && <WorkspaceNavigation label="Menu" onNavigate={() => setMenuOpen(false)} />}
        <div className="px-4 py-3 space-y-1">
          {!user && <nav aria-label="Menu">{navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => go(item.route)}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3 h-12 rounded-card text-sm font-semibold transition-colors duration-fast ${
                  isActive(item.route) ? 'text-accent bg-accent-soft' : 'text-sec hover:bg-subtle'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}</nav>}
          <Button fullWidth icon={<PackagePlus size={18} />} onClick={() => go({ name: 'create-listing' })} className="mt-2">
            List an item
          </Button>
          {user ? (
            <>
              {adminAccess.access && (
                <Button fullWidth size="sm" variant="ghost" icon={<ShieldCheck size={16} />} onClick={() => go({ name: 'admin' })} className="mt-1">
                  Admin console
                </Button>
              )}
              <Button fullWidth size="sm" variant="ghost" onClick={signIn}>Switch account</Button>
              <Button fullWidth size="sm" variant="ghost" loading={authBusy === 'sign-out'} icon={<LogOut size={16} />} onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <Button fullWidth variant="secondary" disabled={loading} onClick={signIn}>Sign in / Join</Button>
          )}
        </div>
      </SheetContent>
    </Dialog>
  );
}

/** Keep the listing shortcut clear of page actions and preference controls. */
const ROUTES_WITHOUT_FAB = new Set<Route['name']>(['listing', 'checkout', 'create-listing', 'edit-listing', 'need-something', 'conversation', 'notifications', 'dashboard', 'renter-dashboard', 'owner-dashboard', 'owner-listings', 'owner-payouts']);

export function BottomNav() {
  const { route, navigate } = useRouter();
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass-nav glass-nav-bottom border-t border-app pb-[env(safe-area-inset-bottom)]" aria-label="Main">
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
                className={`relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors duration-fast ${
                  active ? 'text-accent' : 'text-sec'
                }`}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                <span className="text-[10px] font-semibold">{item.label}</span>
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
