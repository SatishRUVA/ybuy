import { useEffect, useState } from 'react';
import { User, Menu, Search, PackagePlus, LogOut, ShieldCheck, Gavel, Home, Calendar, Users, ArrowRight } from 'lucide-react';
import { useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { useAdminAccess } from '@/lib/admin-access';
import { ThemeSwitcher } from '@/main-site/components/search';
import { Alert, Button } from '@/main-site/components/ui';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';
import { subscribeToNotifications, unreadNotificationCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { Dialog, DialogTrigger, DialogTitle, DialogDescription, SheetContent } from '@/main-site/components/shadcn/dialog';
import { WorkspaceNavigation } from '@/main-site/components/workspace-navigation';

function Wordmark({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="site-wordmark flex min-h-11 min-w-11 items-center gap-2.5 shrink-0" aria-label="YBuy home">
      <span className="reference-wordmark"><span aria-hidden="true">y</span>ybuy</span>
    </button>
  );
}
export function Header({ focused = false }: { focused?: boolean }) {
  const { route, navigate } = useRouter();
  const { user, profile, loading, error, signInOpen, authBusy, openSignIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const adminAccess = useAdminAccess();
  const itemRequests = useFeatureFlag('item_requests');
  const adminRoute: Route = adminAccess.access?.role === 'super_admin' ? { name: 'super-admin' } : { name: 'admin' };

  // A route change while the sheet is open would otherwise leave it covering the new page.
  useEffect(() => { setMenuOpen(false); }, [route, user?.id]);

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

  const navItems: { label: string; route: Route; icon: typeof Search }[] = [
    { label: 'Explore', route: { name: 'home' }, icon: Home },
    { label: 'Browse', route: { name: 'search' }, icon: Search },
    { label: 'My rentals', route: { name: 'dashboard', tab: 'renting' }, icon: Calendar },
    { label: 'Lend', route: { name: 'dashboard', tab: 'lending' }, icon: PackagePlus },
    ...(itemRequests.enabled ? [{ label: 'Community', route: { name: 'requests', tab: 'browse' } as Route, icon: Users }] : []),
    { label: 'Bidding', route: { name: 'bidding' }, icon: Gavel },
  ];

  const isActive = (r: Route) => {
    if (r.name === 'search') return route.name === 'search' || route.name === 'listing';
    if (r.name === 'bidding') return route.name === 'bidding' || route.name === 'bidding-detail' || route.name === 'auction';
    if (r.name === 'dashboard') return route.name === 'dashboard' && route.tab === r.tab;
    return route.name === r.name;
  };

  if (focused) {
    return (
      <header className="ybuy-site-header sticky top-0 z-40 border-b border-app">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
          <Wordmark onClick={() => navigate({ name: 'home' })} />
        </div>
        {error && !signInOpen && <div role="alert" className="px-4 pb-3"><Alert tone="error">{error}</Alert></div>}
      </header>
    );
  }

  return (
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
      <header className="ybuy-site-header sticky top-0 z-40 border-b border-app">
        <div className="site-header-inner">
          <Wordmark onClick={() => navigate({ name: 'home' })} />

          <nav className="site-main-navigation" aria-label="Main">
            {navItems.filter((item) => item.label !== 'Bidding').map((item) => (
              <button
                key={item.label}
                onClick={() => go(item.route)}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className="site-main-navigation-link"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="site-header-actions">
            <button type="button" className="site-header-search" aria-label="Search nearby" onClick={() => go({ name: 'search' })}>
              <Search size={16} aria-hidden="true" />
              <span>Search nearby</span>
              <span className="site-header-search-go"><ArrowRight size={15} aria-hidden="true" /></span>
            </button>

            {SHOW_DEMO_THEMES && <ThemeSwitcher />}

            <DialogTrigger asChild>
              <button
                type="button"
                aria-label="Open menu"
                aria-current={route.name === 'trust-profile' ? 'page' : undefined}
                className="site-menu-trigger"
              >
                <Menu size={20} aria-hidden="true" />
                <span className="site-menu-trigger-divider" aria-hidden="true" />
                <span className="site-menu-avatar">
                  {profile?.avatar_url
                    ? <img src={profile.avatar_url} alt="" />
                    : <User size={16} aria-hidden="true" />}
                </span>
                {user && unreadCount !== null && unreadCount > 0 && <span aria-hidden="true" className="site-menu-unread">{unreadCount > 99 ? '99+' : unreadCount}</span>}
                {user && <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                  {unreadCount === null ? 'Unread notification count unavailable' : `${unreadCount} unread notifications`}
                </span>}
              </button>
            </DialogTrigger>
          </div>
        </div>

        {error && !signInOpen && <div role="alert" className="max-w-[1400px] mx-auto px-4 sm:px-6 pb-3"><Alert tone="error">{error}</Alert></div>}

      </header>
      <SheetContent className="workspace-navigation-sheet overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="site-menu-heading">
          <DialogTitle>Navigation</DialogTitle>
          <DialogDescription>Browse YBuy and manage your rentals, listings, and account.</DialogDescription>
        </div>
        {user
          ? <WorkspaceNavigation label="Workspace navigation" onNavigate={() => setMenuOpen(false)} />
          : <nav className="site-menu-navigation" aria-label="Menu">{navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => go(item.route)}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className="site-menu-link"
              >
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}</nav>}
        <div className="site-menu-actions">
          <Button fullWidth icon={<PackagePlus size={18} />} onClick={() => go({ name: 'create-listing' })}>
            List an item
          </Button>
          {user ? (
            <>
              {(adminAccess.access?.role === 'admin' || adminAccess.access?.role === 'super_admin') && (
                <Button fullWidth size="sm" variant="ghost" icon={<ShieldCheck size={16} />} onClick={() => go(adminRoute)} className="mt-1">
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
