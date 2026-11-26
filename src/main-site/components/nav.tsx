import { useEffect, useState } from 'react';
import { User, Menu, Search, PackagePlus, LogOut, ShieldCheck, Gavel, Home, Calendar, Users, Bell, MessageCircle } from 'lucide-react';
import { RouteLink, useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { useAdminAccess } from '@/lib/admin-access';
import { ThemeSwitcher } from '@/main-site/components/search';
import { Alert, Button } from '@/main-site/components/ui';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';
import { NOTIFICATIONS_CHANGED, subscribeToNotifications, unreadMessageCount, unreadNotificationCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useFeatureFlag } from '@/lib/use-feature-flags';
import { Dialog, DialogTrigger, DialogTitle, DialogDescription, SheetContent } from '@/main-site/components/shadcn/dialog';
import { WorkspaceNavigation } from '@/main-site/components/workspace-navigation';
import { LOCAL_PROFILE_LOGIN } from '@/lib/local-profile-login';
import { LocalTesterSelect } from '@/main-site/components/local-tester-select';

function Wordmark() {
  return (
    <RouteLink route={{ name: 'home' }} className="site-wordmark flex min-h-11 min-w-11 items-center gap-2.5 shrink-0" aria-label="YBuy home">
      <span className="reference-wordmark"><span aria-hidden="true">y</span>ybuy</span>
    </RouteLink>
  );
}
export function Header({ focused = false }: { focused?: boolean }) {
  const { route, navigate } = useRouter();
  const { user, profile, loading, error, signInOpen, authBusy, openSignIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const adminAccess = useAdminAccess();
  const itemRequests = useFeatureFlag('item_requests');
  const adminRoute: Route = adminAccess.access?.role === 'super_admin' ? { name: 'super-admin' } : { name: 'admin' };

  // A route change while the sheet is open would otherwise leave it covering the new page.
  useEffect(() => { setMenuOpen(false); }, [route, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setUnreadCount(0);
      setMessageCount(0);
      return;
    }
    let active = true;
    const refresh = async () => {
      const [notifications, messages] = await Promise.allSettled([unreadNotificationCount(user.id), unreadMessageCount(user.id)]);
      if (!active) return;
      setUnreadCount(notifications.status === 'fulfilled' ? notifications.value : null);
      setMessageCount(messages.status === 'fulfilled' ? messages.value : null);
    };
    const onChanged = () => { void refresh(); };
    void refresh();
    const channel = subscribeToNotifications(user.id, onChanged);
    const fallback = window.setInterval(onChanged, 60_000);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      active = false;
      window.clearInterval(fallback);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
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
    ...(itemRequests.enabled ? [{ label: 'Community requests', route: { name: 'requests', tab: 'browse' } as Route, icon: Users }] : []),
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
          <Wordmark />
        </div>
        {LOCAL_PROFILE_LOGIN && <div className="mx-auto max-w-[1400px] px-4 pb-3 sm:px-6"><LocalTesterSelect /></div>}
        {error && !signInOpen && <div role="alert" className="px-4 pb-3"><Alert tone="error">{error}</Alert></div>}
      </header>
    );
  }

  return (
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
      <header className="ybuy-site-header sticky top-0 z-40 border-b border-app">
        <div className="site-header-inner">
          <Wordmark />

          <nav className="site-main-navigation" aria-label="Main">
            {navItems.filter((item) => item.label !== 'My rentals' && item.label !== 'Lend').map((item) => (
              <RouteLink
                key={item.label}
                route={item.route}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className="site-main-navigation-link"
              >
                {item.label}
              </RouteLink>
            ))}
          </nav>

          <div className="site-header-actions">
            <RouteLink route={{ name: 'create-listing' }} className="site-header-list">List an item</RouteLink>

            {SHOW_DEMO_THEMES && <ThemeSwitcher />}

            {user && <>
              <RouteLink
                route={{ name: 'messaging' }}
                className="site-header-icon"
                aria-current={route.name === 'messaging' || route.name === 'conversation' ? 'page' : undefined}
                aria-label={messageCount ? `Messages, ${messageCount} unread` : 'Messages'}
              >
                <MessageCircle size={20} aria-hidden="true" />
                {!!messageCount && <span aria-hidden="true" className="site-menu-unread">{messageCount > 99 ? '99+' : messageCount}</span>}
              </RouteLink>
              <RouteLink
                route={{ name: 'notifications' }}
                className="site-header-icon site-header-bell"
                aria-current={route.name === 'notifications' ? 'page' : undefined}
                aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              >
                <Bell size={20} aria-hidden="true" />
                {!!unreadCount && <span aria-hidden="true" className="site-menu-unread">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </RouteLink>
            </>}

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
                {user && !!unreadCount && <span aria-hidden="true" className="site-menu-unread site-menu-unread-compact">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>
            </DialogTrigger>
            {user && <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {unreadCount === null ? 'Unread notification count unavailable' : `${unreadCount} unread notifications`}
            </span>}
          </div>
        </div>

        {LOCAL_PROFILE_LOGIN && <div className="mx-auto max-w-[1400px] px-4 pb-3 sm:px-6"><LocalTesterSelect /></div>}
        {error && !signInOpen && <div role="alert" className="max-w-[1400px] mx-auto px-4 sm:px-6 pb-3"><Alert tone="error">{error}</Alert></div>}

      </header>
      <SheetContent className="workspace-navigation-sheet overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="site-menu-heading">
          <DialogTitle>Menu</DialogTitle>
          <DialogDescription className="sr-only">Browse YBuy and manage your rentals, listings, and account.</DialogDescription>
          {user && profile?.full_name && <p className="site-menu-account">{profile.full_name}</p>}
        </div>
        <div className="site-menu-primary">
          <RouteLink route={{ name: 'create-listing' }} onNavigate={() => setMenuOpen(false)}
            className="ui-button inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card bg-accent px-4 py-2.5 text-sm font-semibold text-accent-text shadow-xs hover:bg-accent-hover">
            <PackagePlus size={18} aria-hidden="true" /> List an item
          </RouteLink>
          {itemRequests.enabled && <RouteLink route={{ name: 'need-something' }} onNavigate={() => setMenuOpen(false)}
            className="ui-button inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-app bg-card px-4 py-2.5 text-sm font-semibold text-main hover:bg-subtle">
            Request an item
          </RouteLink>}
        </div>
        {user
          ? <WorkspaceNavigation label="Workspace navigation" onNavigate={() => setMenuOpen(false)} />
          : <nav className="site-menu-navigation" aria-label="Menu">{navItems.map((item) => {
            const Icon = item.icon;
            return (
              <RouteLink
                key={item.label}
                route={item.route}
                onNavigate={() => setMenuOpen(false)}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className="site-menu-link"
              >
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </RouteLink>
            );
          })}</nav>}
        <div className="site-menu-actions">
          {!LOCAL_PROFILE_LOGIN && (user ? (
            <>
              {(adminAccess.access?.role === 'admin' || adminAccess.access?.role === 'super_admin') && (
                <Button fullWidth size="sm" variant="ghost" icon={<ShieldCheck size={16} />} onClick={() => go(adminRoute)} className="mt-1">
                  Admin console
                </Button>
              )}
              <Button fullWidth size="sm" variant="ghost" onClick={signIn}>{LOCAL_PROFILE_LOGIN ? 'Switch profile' : 'Switch account'}</Button>
              <Button fullWidth size="sm" variant="ghost" loading={authBusy === 'sign-out'} icon={<LogOut size={16} />} onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <Button fullWidth variant="secondary" disabled={loading} onClick={signIn}>Sign in / Join</Button>
          ))}
        </div>
      </SheetContent>
    </Dialog>
  );
}
