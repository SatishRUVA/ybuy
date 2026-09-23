import { useState } from 'react';
import { MessageSquare, User, Menu, X, Home, Search, Plus, Calendar, Inbox, Gavel, Heart } from 'lucide-react';
import { useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { ThemeSwitcher } from '@/components/search';
import { SHOW_OUT_OF_SCOPE_PAGES, SHOW_DEMO_THEMES } from '@/lib/feature-flags';
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

export function Header() {
  const { route, navigate } = useRouter();
  const { user, profile, signInWithGoogle, roleState, activeRole, setActiveRole } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  function go(next: Route) {
    if (!user && PROTECTED_ROUTES.has(next.name)) {
      void signInWithGoogle();
      return;
    }
    navigate(next);
  }

  const navItems: { label: string; route: Route; icon: typeof Home }[] = [
    { label: 'Explore', route: { name: 'home' }, icon: Home },
    { label: 'Search', route: { name: 'search' }, icon: Search },
    ...(SHOW_OUT_OF_SCOPE_PAGES ? [{ label: 'Requests', route: { name: 'requests' } as Route, icon: Inbox }] : []),
    { label: 'Favorites', route: { name: 'favorites' }, icon: Heart },
    ...(SHOW_OUT_OF_SCOPE_PAGES ? [{ label: 'Bidding', route: { name: 'bidding' } as Route, icon: Gavel }] : []),
    { label: 'Bookings', route: { name: 'dashboard' }, icon: Calendar },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare },
  ];

  const isActive = (r: Route) => {
    if (r.name === 'dashboard') return route.name === 'dashboard' || route.name === 'renter-dashboard' || route.name === 'owner-dashboard';
    return route.name === r.name;
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-app/90 backdrop-blur-lg border-b border-app">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16 gap-4">
            <button onClick={() => navigate({ name: 'home' })} className="flex items-center gap-2 shrink-0">
              <img src={logo} alt="YBuy" className="w-9 h-9 rounded-card-lg object-cover shadow-card" />
              <span className="font-bold text-lg text-main font-display hidden sm:inline">YBuy</span>
            </button>

            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                return (
                  <button
                    key={item.label}
                    onClick={() => go(item.route)}
                    className={`px-3.5 py-2 rounded-card-lg text-sm font-medium transition-colors ${
                      isActive(item.route) ? 'text-accent bg-accent-soft' : 'text-sec hover:text-main hover:bg-subtle'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <button
                onClick={() => go({ name: 'create-listing' })}
                className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-card-lg bg-accent text-accent-text text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                <Plus size={16} />
                List
              </button>
              {user && roleState?.isMultiRole && (
                <div className="hidden sm:flex items-center gap-1 rounded-card-lg border border-app p-1">
                  <button
                    onClick={() => setActiveRole('renter')}
                    className={`px-2 py-1 rounded-card text-xs font-medium ${activeRole === 'renter' ? 'bg-accent-soft text-accent' : 'text-sec hover:bg-subtle'}`}
                  >
                    Renter
                  </button>
                  <button
                    onClick={() => setActiveRole('owner')}
                    className={`px-2 py-1 rounded-card text-xs font-medium ${activeRole === 'owner' ? 'bg-accent-soft text-accent' : 'text-sec hover:bg-subtle'}`}
                  >
                    Owner
                  </button>
                </div>
              )}
              {SHOW_DEMO_THEMES && <ThemeSwitcher />}
              <button
                onClick={() => (user ? go({ name: 'trust-profile' }) : void signInWithGoogle())}
                className="p-2 rounded-card-lg hover:bg-subtle transition-colors"
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <User size={20} className="text-sec" />
                )}
              </button>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden p-2 rounded-card-lg hover:bg-subtle transition-colors"
              >
                {menuOpen ? <X size={20} className="text-main" /> : <Menu size={20} className="text-main" />}
              </button>
            </div>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-app bg-card animate-modal">
            <div className="px-4 py-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    onClick={() => { go(item.route); setMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-card-lg text-sm font-medium transition-colors ${
                      isActive(item.route) ? 'text-accent bg-accent-soft' : 'text-sec hover:bg-subtle'
                    }`}
                  >
                    <Icon size={18} />
                    {item.label}
                  </button>
                );
              })}
              <button
                onClick={() => { go({ name: 'create-listing' }); setMenuOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-card-lg text-sm font-medium text-accent bg-accent-soft"
              >
                <Plus size={18} />
                List an item
              </button>
              {user && roleState?.isMultiRole && (
                <div className="pt-1 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setActiveRole('renter')}
                    className={`px-3 py-2 rounded-card-lg text-xs font-medium ${activeRole === 'renter' ? 'bg-accent-soft text-accent' : 'text-sec border border-app'}`}
                  >
                    Use renter mode
                  </button>
                  <button
                    onClick={() => setActiveRole('owner')}
                    className={`px-3 py-2 rounded-card-lg text-xs font-medium ${activeRole === 'owner' ? 'bg-accent-soft text-accent' : 'text-sec border border-app'}`}
                  >
                    Use owner mode
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>
    </>
  );
}

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
    { label: 'Explore', route: { name: 'home' }, icon: Home },
    ...(SHOW_OUT_OF_SCOPE_PAGES ? [{ label: 'Bidding', route: { name: 'bidding' } as Route, icon: Gavel }] : [{ label: 'Favorites', route: { name: 'favorites' } as Route, icon: Heart }]),
    { label: 'Bookings', route: { name: 'dashboard' }, icon: Calendar },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare },
    { label: 'Profile', route: { name: 'trust-profile' }, icon: User },
  ];

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-app pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-16 px-2">
          {items.map((item) => {
            const Icon = item.icon;
            const active = item.route.name === 'dashboard'
              ? route.name === 'dashboard' || route.name === 'renter-dashboard' || route.name === 'owner-dashboard'
              : route.name === item.route.name;
            return (
              <button
                key={item.label}
                onClick={() => go(item.route)}
                className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-card transition-colors ${
                  active ? 'text-accent' : 'text-muted'
                }`}
              >
                <Icon size={20} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <button
        onClick={() => go({ name: 'create-listing' })}
        className="md:hidden fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-accent text-accent-text shadow-hover flex items-center justify-center hover:scale-110 transition-transform"
      >
        <Plus size={26} />
      </button>
    </>
  );
}
