import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bell, Check, ChevronDown, Eye, EyeOff, Heart, Home, LayoutGrid, Menu, MessageSquare, PackagePlus, Search, User, X, Calendar } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { ProviderIcon } from '@/components/provider-icon';
import { categories } from '@/data';
import { Confetti } from './confetti';
import { PContext, DEFAULT_SEARCH, SCREENS, type PRoute, type RouteName, type SearchState } from './ctx';
import { defaultAvail, type Avail } from './dates';
import { Btn, EASE } from './ui';
import { HomeScreen } from './screens/home';
import { SearchScreen } from './screens/search';
import { ListingScreen } from './screens/listing';
import { CheckoutScreen, ConfirmationScreen } from './screens/booking';
import { RenterScreen, OwnerScreen } from './screens/dashboards';
import { CreateScreen } from './screens/create';
import { BiddingScreen, AuctionScreen } from './screens/bidding';
import { RequestsScreen } from './screens/requests';
import { MessagesScreen, NotificationsScreen } from './screens/inbox';
import { FavoritesScreen, ProfileScreen } from './screens/account';
import { AdminScreen } from './screens/admin';
import { StatesScreen } from './screens/states';

const NAMES = new Set<RouteName>(SCREENS.map((screen) => screen.name));

function parseHash(): PRoute {
  const [name, ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (NAMES.has(name as RouteName)) return { name: name as RouteName, id: rest.length ? decodeURIComponent(rest.join('/')) : undefined };
  return { name: 'home' };
}

function Screen({ route }: { route: PRoute }) {
  switch (route.name) {
    case 'search': return <SearchScreen />;
    case 'listing': return <ListingScreen id={route.id ?? 'l1'} />;
    case 'checkout': return <CheckoutScreen id={route.id ?? 'l1'} />;
    case 'confirmation': return <ConfirmationScreen id={route.id ?? 'l1'} />;
    case 'renter': return <RenterScreen />;
    case 'owner': return <OwnerScreen />;
    case 'create': return <CreateScreen key={route.id ?? 'new'} editId={route.id} />;
    case 'bidding': return <BiddingScreen />;
    case 'auction': return <AuctionScreen id={route.id ?? 'a1'} />;
    case 'requests': return <RequestsScreen />;
    case 'messages': return <MessagesScreen />;
    case 'notifications': return <NotificationsScreen />;
    case 'favorites': return <FavoritesScreen />;
    case 'profile': return <ProfileScreen />;
    case 'admin': return <AdminScreen />;
    case 'states': return <StatesScreen />;
    default: return <HomeScreen />;
  }
}

export default function PreviewApp() {
  const reduce = useReducedMotion();
  const [route, setRoute] = useState<PRoute>(parseHash);
  const [favs, setFavs] = useState<Set<string>>(new Set(['l1', 'l4']));
  const [search, setSearchState] = useState<SearchState>(DEFAULT_SEARCH);
  const [availMap, setAvailMap] = useState<Record<string, Avail>>({});
  const setSearch = useCallback((patch: Partial<SearchState>) => setSearchState((previous) => ({ ...previous, ...patch })), []);
  const availFor = useCallback((id: string) => availMap[id] ?? defaultAvail(id), [availMap]);
  const setAvail = useCallback((id: string, next: Avail) => setAvailMap((previous) => ({ ...previous, [id]: next })), []);
  const [toastState, setToastState] = useState<{ message: string; headline?: string; tone: 'quiet' | 'party'; key: number } | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();

  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); setMenuOpen(false); setAccountOpen(false); setIndexOpen(false); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: MouseEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [accountOpen]);

  const go = useCallback((name: RouteName, id?: string) => {
    window.location.hash = `/${name}${id ? `/${encodeURIComponent(id)}` : ''}`;
  }, []);
  const burstTimer = useRef<number>();
  const toast = useCallback((message: string) => {
    setToastState({ message, tone: 'quiet', key: Date.now() });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastState(null), 2600);
  }, []);
  const celebrate = useCallback((message: string, headline = 'Nice one!') => {
    setToastState({ message, headline, tone: 'party', key: Date.now() });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastState(null), 4200);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBurst(Date.now());
      window.clearTimeout(burstTimer.current);
      burstTimer.current = window.setTimeout(() => setBurst(null), 3200);
    }
  }, []);
  const toggleFav = useCallback((id: string) => {
    setFavs((previous) => {
      const next = new Set(previous);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const ctx = useMemo(() => ({ route, go, toast, celebrate, favs, toggleFav, openSignIn: () => setSignInOpen(true), search, setSearch, availFor, setAvail }), [route, go, toast, celebrate, favs, toggleFav, search, setSearch, availFor, setAvail]);

  const links: { label: string; to: RouteName; match: RouteName[] }[] = [
    { label: 'Browse', to: 'search', match: ['search', 'listing', 'checkout', 'confirmation'] },
    { label: 'Requests & offers', to: 'requests', match: ['requests'] },
    { label: 'Bidding', to: 'bidding', match: ['bidding', 'auction'] },
  ];
  const accountItems: { label: string; to: RouteName; icon: typeof Home }[] = [
    { label: 'Your rentals', to: 'renter', icon: Calendar },
    { label: 'Owner workspace', to: 'owner', icon: LayoutGrid },
    { label: 'Messages', to: 'messages', icon: MessageSquare },
    { label: 'Saved items', to: 'favorites', icon: Heart },
    { label: 'Profile & trust', to: 'profile', icon: User },
    { label: 'Admin workspace', to: 'admin', icon: LayoutGrid },
  ];
  const bottom: { label: string; to: RouteName; icon: typeof Home; match: RouteName[] }[] = [
    { label: 'Home', to: 'home', icon: Home, match: ['home'] },
    { label: 'Browse', to: 'search', icon: Search, match: ['search', 'listing', 'checkout', 'confirmation'] },
    { label: 'Rentals', to: 'renter', icon: Calendar, match: ['renter', 'owner'] },
    { label: 'Messages', to: 'messages', icon: MessageSquare, match: ['messages'] },
    { label: 'Account', to: 'profile', icon: User, match: ['profile', 'favorites', 'notifications', 'admin'] },
  ];

  return (
    <PContext.Provider value={ctx}>
      <div className="min-h-screen bg-app text-main">
        <div role="status" className="bg-[var(--ink)] px-4 py-2 text-center text-xs font-semibold text-white sm:text-sm">
          Design preview · sample data only · nothing is saved or charged
        </div>

        <header className="sticky top-0 z-40 bg-app">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 sm:h-[4.5rem] sm:px-6">
            <button type="button" onClick={() => go('home')} aria-label="YBuy home" className="shrink-0"><BrandLogo compact /></button>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {links.map((link) => {
                const active = link.match.includes(route.name);
                return (
                  <button key={link.label} type="button" onClick={() => go(link.to)} aria-current={active ? 'page' : undefined} className={`relative h-10 px-3.5 text-sm font-semibold ${active ? 'text-main' : 'text-sec hover:text-main'}`}>
                    {link.label}
                    {active && <motion.span layoutId={reduce ? undefined : 'p-underline'} aria-hidden="true" className="absolute inset-x-3.5 bottom-0 h-[3px] rounded-full bg-[var(--accent)]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
                  </button>
                );
              })}
            </nav>
            <div className="flex items-center gap-2">
              <Btn size="sm" icon={<PackagePlus size={16} aria-hidden="true" />} onClick={() => go('create')} className="hidden sm:inline-flex">List an item</Btn>
              <button type="button" onClick={() => go('notifications')} aria-label="Notifications, 3 unread" className="relative grid h-11 w-11 place-items-center rounded-full bg-subtle hover:bg-[var(--border)]">
                <Bell size={18} aria-hidden="true" />
                <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">3</span>
              </button>
              <div ref={accountRef} className="relative hidden sm:block">
                <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-haspopup="menu" aria-expanded={accountOpen} aria-label="Account" className="inline-flex h-11 items-center gap-2 rounded-full bg-subtle pl-1.5 pr-3.5 text-sm font-semibold hover:bg-[var(--border)]">
                  <img src="https://images.pexels.com/photos/1462630/pexels-photo-1462630.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop" alt="" className="h-8 w-8 rounded-full object-cover" />
                  John <ChevronDown size={15} aria-hidden="true" className={accountOpen ? 'rotate-180' : ''} />
                </button>
                <AnimatePresence>
                  {accountOpen && (
                    <motion.div role="menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15, ease: EASE }} className="absolute right-0 top-full z-50 mt-2 w-64 rounded-[1.25rem] bg-card p-2 shadow-pop">
                      {accountItems.map((item) => (
                        <button key={item.label} type="button" role="menuitem" onClick={() => go(item.to)} className="flex min-h-11 w-full items-center gap-3 rounded-[0.9rem] px-3 text-left text-sm font-semibold hover:bg-subtle">
                          <item.icon size={17} aria-hidden="true" />{item.label}
                        </button>
                      ))}
                      <div className="my-1 h-px bg-[var(--border)]" />
                      <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); setSignInOpen(true); }} className="flex min-h-11 w-full items-center rounded-[0.9rem] px-3 text-left text-sm text-sec hover:bg-subtle">Sign in / switch account</button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} className="grid h-11 w-11 place-items-center rounded-full bg-subtle md:hidden">
                {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {menuOpen && (
            <div className="absolute inset-x-0 top-full z-40 h-[calc(100dvh-4rem)] overflow-y-auto bg-app md:hidden">
              <div className="space-y-1 px-4 pb-28 pt-4">
                {[...links.map((l) => ({ label: l.label, to: l.to })), { label: 'Saved items', to: 'favorites' as RouteName }, { label: 'Owner workspace', to: 'owner' as RouteName }, { label: 'Admin workspace', to: 'admin' as RouteName }].map((item, index) => (
                  <motion.button key={item.label} type="button" initial={reduce ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: index * 0.04, ease: EASE }} onClick={() => go(item.to)} className="flex min-h-16 w-full items-center px-1 font-editorial text-[2.6rem] leading-none tracking-[-0.02em]">
                    {item.label}
                  </motion.button>
                ))}
                <Btn full size="lg" onClick={() => go('create')} className="mt-6" icon={<PackagePlus size={18} aria-hidden="true" />}>List an item</Btn>
              </div>
            </div>
          )}
        </header>

        <main className="pb-24 md:pb-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${route.name}/${route.id ?? ''}`} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
              <Screen route={route} />
            </motion.div>
          </AnimatePresence>
        </main>

        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-app bg-app pb-[env(safe-area-inset-bottom)] md:hidden">
          <div className="flex h-16 items-stretch justify-around">
            {bottom.map((item) => {
              const active = item.match.includes(route.name);
              return (
                <button key={item.label} type="button" onClick={() => go(item.to)} aria-current={active ? 'page' : undefined} className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${active ? 'text-main' : 'text-sec'}`}>
                  <span className="relative grid h-8 w-14 place-items-center">
                    {active && <motion.span layoutId={reduce ? undefined : 'p-pill'} aria-hidden="true" className="absolute inset-0 rounded-full bg-[var(--ink)]" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
                    <item.icon size={20} aria-hidden="true" className={`relative ${active ? 'text-white' : ''}`} />
                  </span>
                  <span className="text-[11px] font-semibold">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <button type="button" onClick={() => setIndexOpen(true)} className="fixed bottom-24 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--ink)] px-5 text-sm font-semibold text-white shadow-pop md:bottom-6 md:right-6">
          <LayoutGrid size={16} aria-hidden="true" />All screens
        </button>

        <AnimatePresence>
          {indexOpen && <ScreenIndex onClose={() => setIndexOpen(false)} onPick={(name, id) => { setIndexOpen(false); go(name, id); }} current={route.name} />}
          {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} onDone={() => { setSignInOpen(false); celebrate('Good to see you again. Your saved items are right where you left them.', 'Welcome back, John'); }} />}
          {toastState && (
            <motion.div
              key={toastState.key}
              role="status"
              initial={{ opacity: 0, y: 28, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              className={`fixed inset-x-0 bottom-24 z-[90] mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-full py-2.5 pl-2.5 pr-6 shadow-pop md:bottom-8 ${toastState.tone === 'party' ? 'bg-[var(--highlight)] text-[var(--ink)]' : 'bg-[var(--ink)] text-white'}`}
            >
              <motion.span
                aria-hidden="true"
                initial={{ rotate: -30, scale: 0.4 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 14, delay: 0.1 }}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${toastState.tone === 'party' ? 'bg-[var(--ink)] text-[var(--highlight)]' : 'bg-white/15 text-white'}`}
              >
                <Check size={20} strokeWidth={3} />
              </motion.span>
              <span className="min-w-0">
                {toastState.headline && <span className="block font-display text-base font-extrabold leading-tight">{toastState.headline}</span>}
                <span className={`block text-sm leading-snug ${toastState.headline ? 'opacity-80' : 'font-semibold'}`}>{toastState.message}</span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        {burst && <Confetti key={burst} />}
      </div>
    </PContext.Provider>
  );
}

function Overlay({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] grid place-items-center bg-[#163D34]/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div role="dialog" aria-modal="true" aria-label={label} initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24 }} transition={{ duration: 0.3, ease: EASE }} className="max-h-[96dvh] w-full max-w-[58rem] overflow-y-auto rounded-[1.75rem] bg-card shadow-xl">
        {children}
      </motion.div>
    </motion.div>
  );
}

function ScreenIndex({ onClose, onPick, current }: { onClose: () => void; onPick: (name: RouteName, id?: string) => void; current: RouteName }) {
  const groups = [...new Set(SCREENS.map((screen) => screen.group))];
  return (
    <Overlay onClose={onClose} label="All screens">
      <div className="p-6 sm:p-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-editorial text-5xl leading-none">All screens</h2>
            <p className="mt-2 text-sec">Every screen is clickable. Filters, steps, forms and toggles work on sample data.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-subtle"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group} aria-label={group}>
              <h3 className="font-display text-sm font-bold text-sec">{group}</h3>
              <ul className="mt-2 space-y-1">
                {SCREENS.filter((screen) => screen.group === group).map((screen) => (
                  <li key={screen.label}>
                    <button type="button" onClick={() => onPick(screen.name, screen.id)} className={`w-full rounded-[1rem] px-4 py-3 text-left hover:bg-subtle ${current === screen.name ? 'bg-subtle' : ''}`}>
                      <span className="block font-semibold">{screen.label}</span>
                      <span className="block text-sm text-sec">{screen.note}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Overlay>
  );
}

function SignInModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [show, setShow] = useState(false);
  const image = categories.find((category) => category.id === 'camping')?.image ?? categories[0].image;
  const field = 'mt-1 h-12 w-full rounded-[0.9rem] border border-[var(--border-strong)] bg-card px-4 text-base';
  return (
    <Overlay onClose={onClose} label="Sign in">
      <div className="grid md:grid-cols-[5fr_6fr]">
        <aside aria-hidden="true" className="relative hidden overflow-hidden bg-[var(--ink)] text-white md:block">
          <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#163D34]/50" />
          <div className="relative flex h-full flex-col justify-end p-10">
            <p className="font-editorial text-6xl leading-[0.95] tracking-[-0.02em]">Rent what you need. Share what you own.</p>
            <p className="mt-3 text-sm text-white/90">One account for renting and listing.</p>
          </div>
        </aside>
        <form className="relative p-6 sm:p-8" onSubmit={(event) => { event.preventDefault(); onDone(); }}>
          <button type="button" onClick={onClose} aria-label="Close sign-in" className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-sec hover:bg-subtle"><X size={20} aria-hidden="true" /></button>
          <h2 className="pr-10 font-display text-3xl font-bold tracking-tight">{mode === 'in' ? 'Welcome to YBuy' : 'Create your account'}</h2>
          <p className="mb-5 mt-1.5 text-[15px] text-sec">One account to rent items and list your own.</p>
          <div className="space-y-2">
            {(['google', 'apple', 'facebook'] as const).map((provider) => (
              <Btn key={provider} tone="outline" full icon={<ProviderIcon provider={provider} />} onClick={onDone}>Continue with {provider[0].toUpperCase() + provider.slice(1)}</Btn>
            ))}
          </div>
          <div className="my-4 flex items-center gap-3 text-xs text-sec"><span className="h-px flex-1 bg-[var(--border)]" /><span>or use email</span><span className="h-px flex-1 bg-[var(--border)]" /></div>
          <div className="space-y-3">
            {mode === 'up' && <label className="block text-sm font-semibold">Full name<input className={field} autoComplete="name" required /></label>}
            <label className="block text-sm font-semibold">Email<input className={field} type="email" autoComplete="email" required /></label>
            <label className="block text-sm font-semibold">Password
              <span className="relative block">
                <input className={`${field} pr-12`} type={show ? 'text' : 'password'} minLength={8} autoComplete="current-password" required />
                <button type="button" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow((value) => !value)} className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center text-sec">{show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
              </span>
            </label>
            <Btn type="submit" size="lg" full>{mode === 'in' ? 'Sign in' : 'Create account'}</Btn>
            <div className="flex items-center justify-between">
              <button type="button" className="min-h-11 text-sm font-semibold text-accent hover:underline">Forgot password?</button>
              <button type="button" onClick={() => setMode(mode === 'in' ? 'up' : 'in')} className="min-h-11 text-sm font-semibold text-accent hover:underline">{mode === 'in' ? 'New to YBuy? Create an account' : 'Have an account? Sign in'}</button>
            </div>
          </div>
        </form>
      </div>
    </Overlay>
  );
}
