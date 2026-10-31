import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowRight, Bell, ChevronDown, Compass, Heart, LayoutGrid, List, Menu, MessageSquare, Package, Plus, ShieldCheck, UserRound, Wallet, X } from 'lucide-react';
import { currentUser } from '@/data';
import { Bidding, BidRoom } from './bidding';
import { Admin, States } from './admin';
import { Messages, Notifications, Profile, Requests } from './account';
import { Browse, Details, Favorites, Home } from './marketplace';
import { ListingWizard, Owner, Payouts } from './owning';
import { Checkout, Confirmation, Rentals } from './renting';
import { href, pages, parseRoute, PreviewProvider, usePreview, type PageName } from './state';
import { Action, Avatar, Button, Field, Modal } from './ui';
import './preview.css';

const workPages: PageName[] = ['renter', 'owner', 'listings', 'payouts', 'messages', 'notifications', 'profile', 'admin'];
const workNav = [
  { group: 'Rent', entries: [['renter', 'My rentals', Package], ['favorites', 'Saved items', Heart]] },
  { group: 'Lend', entries: [['owner', 'Owner overview', LayoutGrid], ['listings', 'My listings', List], ['payouts', 'Earnings & payouts', Wallet]] },
  { group: 'Account', entries: [['messages', 'Messages', MessageSquare], ['notifications', 'Notifications', Bell], ['profile', 'Profile & settings', UserRound]] },
] as const;
function Shell() {
  const store = usePreview();
  const { feedback, setFeedback } = store;
  const [route, setRoute] = useState(parseRoute);
  const [screens, setScreens] = useState(false);
  const [menu, setMenu] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const [email, setEmail] = useState('john@example.com');
  useEffect(() => {
    const change = () => { setRoute(parseRoute()); setMenu(false); setScreens(false); window.scrollTo(0, 0); requestAnimationFrame(() => { const main = document.querySelector('main'); if (main) { main.tabIndex = -1; main.focus({ preventScroll: true }); } }); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 5500);
    return () => window.clearTimeout(timer);
  }, [feedback, setFeedback]);
  const unread = store.notices.filter((n) => !n.read).length;
  const workspace = workPages.includes(route.name);
  const page = (() => {
    switch (route.name) {
      case 'home': return <Home />;
      case 'search': return <Browse />;
      case 'listing': return <Details key={route.id} id={route.id ?? 'l1'} />;
      case 'bidding': return <Bidding />;
      case 'auction': return <BidRoom key={route.id} id={route.id ?? 'a1'} />;
      case 'requests': return <Requests />;
      case 'checkout': return <Checkout key={route.id} id={route.id ?? 'l1'} />;
      case 'confirmation': return <Confirmation id={route.id ?? store.bookings[0]?.id} />;
      case 'renter': return <Rentals />;
      case 'favorites': return <Favorites />;
      case 'owner': return <Owner />;
      case 'listings': return <Owner listingView />;
      case 'create': return <ListingWizard key={route.id ?? 'new'} editId={route.id} />;
      case 'payouts': return <Payouts />;
      case 'messages': return <Messages id={route.id} />;
      case 'notifications': return <Notifications />;
      case 'profile': return <Profile />;
      case 'admin': return <Admin key={route.id} section={route.id} />;
      case 'states': return <States />;
    }
  })();
  const nav = <>{[['search', 'Explore'], ['bidding', 'Live bidding'], ['requests', 'Requests']] .map(([name, label]) => <a key={name} href={href(name as PageName)} aria-current={route.name === name ? 'page' : undefined}>{label}</a>)}</>;
  const sampleId = (name: PageName) => name === 'listing' || name === 'checkout' ? 'l1' : name === 'auction' ? 'a1' : name === 'confirmation' ? store.bookings[0]?.id : undefined;
  return <div className="p1">
    <a href="#p1-main" className="p1-skip">Skip to content</a>
    <div className="p1-preview-bar"><span><b>Preview 1</b> · Sample data only. No payments, emails or backend calls.</span><div><a href="/preview">Original preview</a><button type="button" onClick={() => setScreens(true)}>All screens <LayoutGrid size={13} aria-hidden="true" /></button></div></div>
    {store.adminSettings.maintenance && <div role="status" className="p1-maintenance">Demo maintenance notice: a little tune-up, without interrupting your plans.</div>}
    <header className="p1-header"><div className="p1-container p1-header-inner"><a href={href('home')} className="p1-logo" aria-label="YBuy home">YBuy<span /></a><nav className="p1-main-nav" aria-label="Main navigation">{nav}</nav><div className="p1-header-actions"><Action to="create" variant="secondary" className="p1-list-link"><Plus size={16} aria-hidden="true" /> List an item</Action><a className="p1-icon p1-header-bell" href={href('notifications')} aria-label={`${unread} unread notifications`}><Bell size={20} aria-hidden="true" />{unread > 0 && <i />}</a>{store.signedIn ? <a href={href('renter')} className="p1-account-link" aria-label="Open your workspace"><Avatar src={currentUser.avatar} name={store.profile.name} size={31} /><ChevronDown size={14} aria-hidden="true" /></a> : <Button variant="quiet" onClick={() => setSignIn(true)}>Sign in</Button>}<button type="button" className="p1-icon p1-mobile-only" aria-label="Open navigation" onClick={() => setMenu(true)}><Menu size={23} aria-hidden="true" /></button></div></div></header>
    <div id="p1-main" className={workspace ? 'p1-workspace p1-container' : ''}>
      {workspace && <aside className="p1-sidebar"><div className="p1-workspace-name"><Avatar src={currentUser.avatar} name={store.profile.name} size={35} /><div><strong>{store.profile.name.split(' ')[0]}’s workspace</strong><span>Rent a little. Lend a little.</span></div></div><nav aria-label="Workspace navigation">{workNav.map((group) => <div key={group.group}><p>{group.group}</p>{group.entries.map(([name, label, Icon]) => <a key={name} href={href(name)} aria-current={route.name === name ? 'page' : undefined}><Icon size={17} aria-hidden="true" />{label}{name === 'notifications' && unread > 0 && <span>{unread}</span>}</a>)}</div>)}<div><p>Preview tools</p><a href={href('admin')} aria-current={route.name === 'admin' ? 'page' : undefined}><ShieldCheck size={17} aria-hidden="true" />Admin workspace</a><button type="button" onClick={() => setScreens(true)}><LayoutGrid size={17} aria-hidden="true" />All screens</button></div></nav><a className="p1-workspace-discovery" href={href('search')}><Compass size={20} aria-hidden="true" /><span>Another good plan?<small>Find what you need nearby.</small></span><ArrowRight size={16} aria-hidden="true" /></a></aside>}
      <div className={workspace ? 'p1-work-canvas' : ''}>{page}</div>
    </div>
    {!workspace && <footer className="p1-footer p1-container"><div><a href={href('home')} className="p1-logo">YBuy<span /></a><p>Less owning. More doing.</p></div><nav aria-label="Footer navigation"><a href={href('search')}>Find a rental</a><a href={href('create')}>List an item</a><a href={href('requests')}>Ask the community</a><button type="button" onClick={() => setScreens(true)}>Explore all screens</button></nav><small>Interactive design preview · Sample imagery and people · Changes reset on reload</small></footer>}
    <Modal open={screens} onClose={() => setScreens(false)} title="One product. Every good journey." description="Explore the complete clickable preview. All changes stay in this session and reset on reload." wide><div className="p1-screen-index">{['Discover', 'Rent', 'Lend', 'Account', 'Admin', 'Preview'].map((group) => <section key={group}><h2>{group}</h2>{pages.filter((p) => p[2] === group).map(([name, label]) => <a key={name} href={href(name, sampleId(name))} onClick={() => setScreens(false)}>{label}<ArrowRight size={16} aria-hidden="true" /></a>)}</section>)}</div></Modal>
    <Modal open={menu} onClose={() => setMenu(false)} title="Where’s the next good plan?" description="Browse rentals or open your workspace."><nav className="p1-mobile-navigation" aria-label="Mobile navigation">{nav}<a href={href('renter')}>My rentals</a><a href={href('favorites')}>Saved items</a><a href={href('owner')}>Owner workspace</a><a href={href('messages')}>Messages</a><a href={href('profile')}>Profile & settings</a><a href={href('admin')}>Admin preview</a><button type="button" onClick={() => { setMenu(false); setScreens(true); }}>All screens</button></nav></Modal>
    <Modal open={signIn} onClose={() => setSignIn(false)} title="More doing starts with hello." description="Demo sign-in only. Use a sample email. This does not authenticate or send anything."><form onSubmit={(e) => { e.preventDefault(); store.setSignedIn(true); store.setProfile((p) => ({ ...p, email })); setSignIn(false); store.notify('Demo signed in. Let’s make a good plan.', true); }}><Field label="Sample email"><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field><Button type="submit" className="p1-full">Continue with sample email</Button></form><div className="p1-social-demo"><p className="p1-muted">Preview social sign-in (not connected)</p>{['Google', 'Apple'].map((provider) => <Button key={provider} variant="secondary" onClick={() => { store.setSignedIn(true); setSignIn(false); store.notify(`${provider} demo sign-in complete. No account connected.`); }}>Continue with {provider}</Button>)}</div></Modal>
    {store.feedback && <div className="p1-toast" key={store.feedback.id} role="status"><div>{store.feedback.party && <div className="p1-confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--x': `${(i * 37 % 300) - 150}px`, '--rotate': `${i * 43}deg`, '--delay': `${i * 25}ms` } as CSSProperties} />)}</div>}<span>{store.feedback.message}</span><button type="button" className="p1-icon" aria-label="Dismiss message" onClick={() => store.setFeedback(null)}><X size={17} aria-hidden="true" /></button></div></div>}
  </div>;
}
export default function PreviewApp() { return <PreviewProvider><Shell /></PreviewProvider>; }
