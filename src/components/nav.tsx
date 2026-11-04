import { useEffect, useState } from 'react';
import { MessageSquare, User, Menu, X, Search, Home, PackagePlus, LogOut, Bell, Gavel, ChevronDown } from 'lucide-react';
import { useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { useAdminAccess } from '@/lib/admin-access';
import { ThemeSwitcher } from '@/components/search';
import { Alert, Button } from '@/components/ui';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';
import { subscribeToNotifications, unreadNotificationCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { LOCAL_PROFILE_LOGIN } from '@/lib/local-profile-login';

function Wordmark({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="p1-logo" aria-label="YBuy home">
      YBuy<span />
    </button>
  );
}
export function Header() {
  const { route, navigate } = useRouter();
  const { user, profile, loading, error, signInOpen, authBusy, openSignIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const adminAccess = useAdminAccess();

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
    navigate(next);
  }

  const navItems: { label: string; route: Route; icon: typeof Search }[] = [
    { label: 'Home', route: { name: 'home' }, icon: Home },
    { label: 'Explore', route: { name: 'search' }, icon: Search },
    { label: 'Live bidding', route: { name: 'bidding' }, icon: Gavel },
    { label: 'Requests', route: { name: 'requests' }, icon: PackagePlus },
  ];

  const isActive = (r: Route) => {
    if (r.name === 'requests') return route.name === 'requests';
    if (r.name === 'bidding') return route.name === 'bidding' || route.name === 'bidding-detail' || route.name === 'auction';
    return route.name === r.name;
  };

  return (
    <header className="p1-header">
      <div className="p1-container">
        <div className="p1-header-inner">
          <Wordmark onClick={() => navigate({ name: 'home' })} />

          <nav className="p1-main-nav" aria-label="Main navigation">
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => go(item.route)}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className={`relative min-h-11 transition-colors duration-fast ${
                  isActive(item.route) ? 'font-semibold text-accent' : 'text-main hover:text-accent'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="p1-header-actions">
            <Button
              variant="secondary"
              icon={<PackagePlus size={16} />}
              onClick={() => go({ name: 'create-listing' })}
              className="p1-list-link"
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
                  className="p1-icon p1-header-bell"
                >
                  <Bell size={18} aria-hidden="true" />
                  {unreadCount !== null && unreadCount > 0 && <i aria-hidden="true" />}
                  <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {unreadCount === null ? 'Unread notification count unavailable' : `${unreadCount} unread notifications`}
                  </span>
                </button>
                <button
                  onClick={() => LOCAL_PROFILE_LOGIN ? openSignIn() : go({ name: 'trust-profile' })}
                  aria-label="Account"
                  title={LOCAL_PROFILE_LOGIN ? 'Switch local profile' : 'Account'}
                  disabled={authBusy !== null}
                  aria-current={route.name === 'trust-profile' ? 'page' : undefined}
                  className="p1-account-link"
                >
                  {profile?.avatar_url
                    ? <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                    : <span className="grid place-items-center w-7 h-7 rounded-full bg-subtle"><User size={16} className="text-sec" /></span>}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </>
            ) : (
              <Button variant="ghost" disabled={loading} onClick={openSignIn}>{LOCAL_PROFILE_LOGIN ? 'Login' : 'Sign in'}</Button>
            )}

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              className="p1-icon p1-mobile-only"
            >
              {menuOpen ? <X size={20} className="text-main" /> : <Menu size={20} className="text-main" />}
            </button>
          </div>
        </div>
      </div>

      {error && !signInOpen && <div role="alert" className="max-w-[1400px] mx-auto px-4 sm:px-6 pb-3"><Alert tone="error">{error}</Alert></div>}

      {menuOpen && (
        <div className="md:hidden border-t border-app bg-card animate-modal">
          <div className="px-4 py-3 space-y-1">
            {navItems.map((item) => {
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
            })}
            <Button fullWidth icon={<PackagePlus size={18} />} onClick={() => go({ name: 'create-listing' })} className="mt-2">
              List an item
            </Button>
            {user && (
              <>
                <Button fullWidth size="sm" variant="ghost" icon={<PackagePlus size={16} />} onClick={() => go({ name: 'dashboard', tab: 'renting' })} className="mt-1">
                  My rentals
                </Button>
                <Button fullWidth size="sm" variant="ghost" icon={<MessageSquare size={16} />} onClick={() => go({ name: 'messaging' })} className="mt-1">
                  Messages
                </Button>
                <Button fullWidth size="sm" variant="ghost" icon={<User size={16} />} onClick={() => go({ name: 'dashboard', tab: 'lending' })} className="mt-1">
                  Owner workspace
                </Button>
                <Button fullWidth size="sm" variant="ghost" icon={<PackagePlus size={16} />} onClick={() => go({ name: 'owner-listings' })} className="mt-1">
                  My listings
                </Button>
                <Button fullWidth size="sm" variant="ghost" icon={<User size={16} />} onClick={() => go({ name: 'favorites' })} className="mt-1">
                  Saved items
                </Button>
                {adminAccess.access && <Button fullWidth size="sm" variant="ghost" onClick={() => go({ name: 'admin' })} className="mt-1">Admin workspace</Button>}
                <Button fullWidth size="sm" variant="ghost" icon={<User size={16} />} onClick={() => go({ name: 'trust-profile' })} className="mt-1">
                  Profile & settings
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

export function Footer() {
  const { navigate } = useRouter();
  return <footer className="p1-container p1-footer">
    <div><button className="p1-logo" onClick={() => navigate({ name: 'home' })}>YBuy<span /></button><p>Less owning. More doing.</p></div>
    <nav aria-label="Footer navigation">
      <button onClick={() => navigate({ name: 'search' })}>Find a rental</button>
      <button onClick={() => navigate({ name: 'create-listing' })}>List an item</button>
      <button onClick={() => navigate({ name: 'requests' })}>Ask the community</button>
      <button onClick={() => navigate({ name: 'guidelines' })}>Guidelines</button>
    </nav>
    <small>&copy; {new Date().getFullYear()} YBuy</small>
  </footer>;
}
