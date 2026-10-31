import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MessageSquare, User, Menu, X, Home, Search, Plus, PackagePlus, Calendar, Heart, LogOut, ShieldCheck, Bell, Gavel, ChevronDown } from 'lucide-react';
import { useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { useAdminAccess } from '@/lib/admin';
import { ThemeSwitcher } from '@/components/search';
import { Alert, Button } from '@/components/ui';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';
import { subscribeToNotifications, unreadNotificationCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { BrandLogo } from '@/components/brand-logo';

function Wordmark({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 shrink-0" aria-label="YBuy home">
      <BrandLogo compact />
    </button>
  );
}
export function Header() {
  const { route, navigate } = useRouter();
  const { user, profile, loading, error, signInOpen, authBusy, openSignIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const reduce = useReducedMotion();
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const adminAccess = useAdminAccess();

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [accountOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // A route change while the sheet is open would otherwise leave it covering the new page.
  useEffect(() => { setMenuOpen(false); setAccountOpen(false); }, [route, user?.id]);

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

  const navItems: { label: string; route: Route; icon: typeof Home }[] = [
    { label: 'Browse', route: { name: 'search' }, icon: Search },
    { label: 'Requests & offers', route: { name: 'requests' }, icon: PackagePlus },
    { label: 'Bidding', route: { name: 'bidding' }, icon: Gavel },
  ];

  // Personal destinations live behind the account menu so the bar stays short.
  const accountItems: { label: string; route: Route; icon: typeof Home }[] = [
    { label: 'Bookings', route: { name: 'dashboard' }, icon: Calendar },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare },
    { label: 'Saved items', route: { name: 'favorites' }, icon: Heart },
    { label: 'Your profile', route: { name: 'trust-profile' }, icon: User },
  ];

  const isActive = (r: Route) => {
    if (r.name === 'requests') return route.name === 'requests';
    if (r.name === 'bidding') return route.name === 'bidding' || route.name === 'bidding-detail' || route.name === 'auction';
    if (r.name === 'dashboard') return route.name === 'dashboard' || route.name === 'renter-dashboard' || route.name === 'owner-dashboard';
    return route.name === r.name;
  };

  return (
    <header className={`sticky top-0 z-40 bg-app border-b transition-colors duration-standard ${scrolled || menuOpen ? 'border-app' : 'border-transparent'}`}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 sm:h-[4.5rem] gap-4">
          <Wordmark onClick={() => navigate({ name: 'home' })} />

          <nav className="hidden md:flex items-center gap-1" aria-label="Main">
            {navItems.map((item) => {
              const active = isActive(item.route);
              return (
                <button
                  key={item.label}
                  onClick={() => go(item.route)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative px-3.5 h-10 text-sm font-semibold transition-colors duration-fast ${active ? 'text-main' : 'text-sec hover:text-main'}`}
                >
                  {item.label}
                  {active && (
                    <motion.span
                      layoutId={reduce ? undefined : 'nav-underline'}
                      aria-hidden="true"
                      className="absolute inset-x-3.5 bottom-0 h-[3px] rounded-full bg-[var(--ink)]"
                      transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<PackagePlus size={16} />}
              onClick={() => go({ name: 'create-listing' })}
              className="hidden sm:inline-flex !rounded-full"
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
                  className="relative grid h-11 w-11 place-items-center rounded-full bg-subtle text-main transition-colors duration-fast hover:bg-[var(--border)]"
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
                    className="hidden lg:grid place-items-center w-11 h-11 rounded-full bg-subtle text-main hover:bg-[var(--border)] transition-colors duration-fast"
                  >
                    <ShieldCheck size={18} />
                  </button>
                )}
                <div
                  ref={accountRef}
                  className="relative hidden sm:block"
                  onKeyDown={(event) => { if (event.key === 'Escape') setAccountOpen(false); }}
                >
                  <button
                    onClick={() => setAccountOpen((open) => !open)}
                    aria-label="Account"
                    aria-haspopup="menu"
                    aria-expanded={accountOpen}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-subtle pl-1.5 pr-3.5 text-sm font-semibold text-main hover:bg-[var(--border)] transition-colors duration-fast"
                  >
                    {profile?.avatar_url
                      ? <img src={profile.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      : <span className="grid place-items-center w-8 h-8 rounded-full bg-card"><User size={16} className="text-main" /></span>}
                    <span>Account</span>
                    <ChevronDown size={15} aria-hidden="true" className={`transition-transform duration-fast ${accountOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {accountOpen && (
                    <motion.div
                      role="menu"
                      aria-label="Account"
                      initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 top-full z-50 mt-2 w-64 rounded-[1.25rem] bg-card p-2 shadow-pop"
                    >
                      {accountItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.label}
                            role="menuitem"
                            onClick={() => go(item.route)}
                            className="flex w-full items-center gap-3 rounded-[0.9rem] px-3 min-h-11 text-left text-sm font-semibold text-main hover:bg-subtle"
                          >
                            <Icon size={17} aria-hidden="true" />{item.label}
                          </button>
                        );
                      })}
                      {adminAccess.access && (
                        <button role="menuitem" onClick={() => go({ name: 'admin' })} className="flex w-full items-center gap-3 rounded-[0.9rem] px-3 min-h-11 text-left text-sm font-semibold text-main hover:bg-subtle">
                          <ShieldCheck size={17} aria-hidden="true" />Admin console
                        </button>
                      )}
                      <div className="my-1 h-px bg-[var(--border)]" />
                      <button role="menuitem" onClick={() => { setAccountOpen(false); openSignIn(); }} className="flex w-full items-center gap-3 rounded-[0.9rem] px-3 min-h-11 text-left text-sm text-sec hover:bg-subtle">
                        Switch account
                      </button>
                      <button role="menuitem" disabled={authBusy === 'sign-out'} onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-[0.9rem] px-3 min-h-11 text-left text-sm text-sec hover:bg-subtle disabled:opacity-60">
                        <LogOut size={17} aria-hidden="true" />Sign out
                      </button>
                    </motion.div>
                  )}
                </div>
              </>
            ) : (
              <Button size="sm" variant="secondary" disabled={loading} onClick={openSignIn} className="!rounded-full">Sign in / Join</Button>
            )}

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              className="md:hidden grid place-items-center w-11 h-11 rounded-full bg-subtle hover:bg-[var(--border)] transition-colors duration-fast"
            >
              {menuOpen ? <X size={20} className="text-main" /> : <Menu size={20} className="text-main" />}
            </button>
          </div>
        </div>
      </div>

      {error && !signInOpen && <div role="alert" className="max-w-[1400px] mx-auto px-4 sm:px-6 pb-3"><Alert tone="error">{error}</Alert></div>}

      {menuOpen && (
        <div className="md:hidden absolute inset-x-0 top-full z-40 h-[calc(100dvh-4rem)] overflow-y-auto bg-app animate-modal">
          <div className="px-4 pt-4 pb-28 space-y-1">
            {[...navItems, ...(user ? accountItems.filter((item) => item.label !== 'Your profile') : [])].map((item, index) => (
              <motion.button
                key={item.label}
                initial={reduce ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.04 * index, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => go(item.route)}
                aria-current={isActive(item.route) ? 'page' : undefined}
                className="w-full flex items-center justify-between px-1 min-h-16 font-editorial text-[2.6rem] leading-none tracking-[-0.02em] text-main"
              >
                {item.label}
                {isActive(item.route) && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--ink)]" />}
              </motion.button>
            ))}
            <Button fullWidth icon={<PackagePlus size={18} />} onClick={() => go({ name: 'create-listing' })} className="mt-6 !rounded-full">
              List an item
            </Button>
            {user && (
              <>
                {adminAccess.access && (
                  <Button fullWidth size="sm" variant="ghost" icon={<ShieldCheck size={16} />} onClick={() => go({ name: 'admin' })} className="mt-1">
                    Admin console
                  </Button>
                )}
                <Button fullWidth size="sm" variant="ghost" icon={<User size={16} />} onClick={() => go({ name: 'trust-profile' })} className="mt-1">
                  Account
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

/** Keep the listing shortcut clear of page actions and preference controls. */
const ROUTES_WITHOUT_FAB = new Set<Route['name']>(['listing', 'checkout', 'create-listing', 'conversation', 'notifications']);

export function BottomNav() {
  const { route, navigate } = useRouter();
  const reduce = useReducedMotion();
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-app border-t border-app pb-[env(safe-area-inset-bottom)]" aria-label="Main">
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
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors duration-fast ${
                  active ? 'text-main' : 'text-sec'
                }`}
              >
                <span className="relative grid h-8 w-14 place-items-center">
                  {active && (
                    <motion.span
                      layoutId={reduce ? undefined : 'bottom-pill'}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-[var(--ink)]"
                      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                    />
                  )}
                  <Icon size={20} strokeWidth={active ? 2.4 : 2} className={`relative ${active ? 'text-white' : ''}`} />
                </span>
                <span className="text-[11px] font-semibold">{item.label}</span>
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
