import { useEffect, useState } from 'react';
import { MessageSquare, User, Menu, X, Home, Search, Plus, PackagePlus, Calendar, LogOut } from 'lucide-react';
import { useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { ThemeSwitcher } from '@/components/search';
import { Button } from '@/components/ui';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';
import logo from '@/assets/logo.png';

const PROTECTED_ROUTES = new Set<Route['name']>([
  'dashboard',
  'renter-dashboard',
  'owner-dashboard',
  'create-listing',
  'check-in',
  'check-out',
  'item-passport',
  'claims',
  'claim-detail',
  'trust-profile',
  'messaging',
  'conversation',
  'requests',
  'favorites',
  'need-something',
  'notifications',
]);

function Wordmark({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 shrink-0" aria-label="YBuy home">
      <img src={logo} alt="" className="w-9 h-9 rounded-card object-cover" />
      <span className="font-extrabold text-[19px] tracking-tight text-main font-display hidden sm:inline">YBuy</span>
    </button>
  );
}

export function Header() {
  const { route, navigate } = useRouter();
  const { user, profile, signInWithGoogle, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // A route change while the sheet is open would otherwise leave it covering the new page.
  useEffect(() => { setMenuOpen(false); }, [route]);

  function go(next: Route) {
    if (!user && PROTECTED_ROUTES.has(next.name)) {
      void signInWithGoogle();
      return;
    }
    navigate(next);
  }

  const navItems: { label: string; route: Route; icon: typeof Home }[] = [
    { label: 'Home', route: { name: 'home' }, icon: Home },
    { label: 'Browse', route: { name: 'search' }, icon: Search },
    { label: 'Bookings', route: { name: 'dashboard' }, icon: Calendar },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare },
  ];

  const isActive = (r: Route) => {
    if (r.name === 'dashboard') return route.name === 'dashboard' || route.name === 'renter-dashboard' || route.name === 'owner-dashboard';
    return route.name === r.name;
  };

  return (
    <header className="sticky top-0 z-40 glass-nav glass-nav-top border-b border-app">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 gap-4">
          <Wordmark onClick={() => navigate({ name: 'home' })} />

          <nav className="hidden md:flex items-center gap-0.5" aria-label="Main">
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => go(item.route)}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className={`relative px-3 h-9 rounded-card text-sm font-semibold transition-colors duration-fast ${
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
              className="hidden sm:inline-flex"
            >
              List an item
            </Button>

            {SHOW_DEMO_THEMES && <ThemeSwitcher />}

            {user ? (
              <button
                onClick={() => go({ name: 'trust-profile' })}
                aria-label="Account"
                aria-current={route.name === 'trust-profile' ? 'page' : undefined}
                className="hidden sm:inline-flex h-10 items-center gap-2 rounded-card border border-app bg-card px-1.5 pr-3 text-sm font-semibold text-main hover:border-strong transition-colors duration-fast"
              >
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                  : <span className="grid place-items-center w-7 h-7 rounded-full bg-subtle"><User size={16} className="text-sec" /></span>}
                <span>Account</span>
              </button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void signInWithGoogle()}>Sign in</Button>
            )}

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              className="md:hidden grid place-items-center w-9 h-9 rounded-card hover:bg-subtle transition-colors duration-fast"
            >
              {menuOpen ? <X size={20} className="text-main" /> : <Menu size={20} className="text-main" />}
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-app glass-nav animate-modal">
          <div className="px-4 py-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => go(item.route)}
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
                <Button fullWidth size="sm" variant="ghost" icon={<User size={16} />} onClick={() => go({ name: 'trust-profile' })} className="mt-1">
                  Account
                </Button>
                <Button fullWidth size="sm" variant="ghost" icon={<LogOut size={16} />} onClick={() => void signOut()}>
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

/** Routes that render their own sticky bottom action bar - the FAB would sit on top of it. */
const ROUTES_WITH_STICKY_CTA = new Set<Route['name']>(['listing', 'checkout', 'create-listing']);

export function BottomNav() {
  const { route, navigate } = useRouter();
  const { user, signInWithGoogle } = useAuth();

  function go(next: Route) {
    if (!user && PROTECTED_ROUTES.has(next.name)) {
      void signInWithGoogle();
      return;
    }
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
        className={`fixed bottom-[4.75rem] right-4 z-40 w-14 h-14 rounded-full bg-accent text-accent-text shadow-hover grid place-items-center active:scale-95 transition-transform duration-fast ${
          ROUTES_WITH_STICKY_CTA.has(route.name) ? 'hidden' : 'md:hidden'
        }`}
      >
        <Plus size={22} />
      </button>
    </>
  );
}
