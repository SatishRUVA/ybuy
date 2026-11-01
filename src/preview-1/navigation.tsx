import { useState, type ReactNode } from 'react';
import { ArrowRight, Bell, ChevronDown, Compass, Heart, LayoutGrid, List, Menu, MessageSquare, Package, Plus, ShieldCheck, UserRound, Wallet } from 'lucide-react';
import { href, type PageName } from './state';
import { Action, Avatar, Button, Modal } from './ui';

const groups = [
  { group: 'Rent', entries: [['renter', 'My rentals', Package], ['favorites', 'Saved items', Heart]] },
  { group: 'Lend', entries: [['owner', 'Owner overview', LayoutGrid], ['listings', 'My listings', List], ['payouts', 'Earnings & payouts', Wallet]] },
  { group: 'Account', entries: [['messages', 'Messages', MessageSquare], ['notifications', 'Notifications', Bell], ['profile', 'Profile & settings', UserRound]] },
] as const;

export interface NavigationProfile { name: string; avatar: string; signedIn: boolean }
export function PreviewHeader({ route, profile, unread, signIn, extraNavigation }: {
  route: PageName; profile: NavigationProfile; unread: number | null; signIn: () => void; extraNavigation?: ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const nav = <>{([['home', 'Home'], ['search', 'Explore'], ['bidding', 'Live bidding'], ['requests', 'Requests']] as const).map(([name, label]) =>
    <a key={name} href={href(name)} aria-current={route === name ? 'page' : undefined}>{label}</a>)}</>;
  return <>
    <header className="p1-header"><div className="p1-container p1-header-inner">
      <a href={href('home')} className="p1-logo" aria-label="YBuy home">YBuy<span /></a>
      <nav className="p1-main-nav" aria-label="Main navigation">{nav}</nav>
      <div className="p1-header-actions">
        <Action to="create" variant="secondary" className="p1-list-link"><Plus size={16} aria-hidden="true" /> List an item</Action>
        <a className="p1-icon p1-header-bell" href={href('notifications')} aria-label={unread === null ? 'Notifications unavailable' : `${unread} unread notifications`}><Bell size={20} aria-hidden="true" />{unread !== null && unread > 0 && <i />}</a>
        {profile.signedIn ? <a href={href('renter')} className="p1-account-link" aria-label="Open your workspace"><Avatar src={profile.avatar} name={profile.name} size={31} /><ChevronDown size={14} aria-hidden="true" /></a>
          : <Button variant="quiet" onClick={signIn}>Sign in</Button>}
        <button type="button" className="p1-icon p1-mobile-only" aria-label="Open navigation" onClick={() => setMenu(true)}><Menu size={23} aria-hidden="true" /></button>
      </div>
    </div></header>
    <Modal open={menu} onClose={() => setMenu(false)} title="Where’s the next good plan?" description="Browse rentals or open your workspace.">
      <nav className="p1-mobile-navigation" aria-label="Mobile navigation">{nav}<a href={href('renter')}>My rentals</a><a href={href('favorites')}>Saved items</a><a href={href('owner')}>Owner workspace</a><a href={href('messages')}>Messages</a><a href={href('profile')}>Profile & settings</a>{extraNavigation}</nav>
    </Modal>
  </>;
}

export function PreviewSidebar({ route, profile, unread, tools }: {
  route: PageName; profile: NavigationProfile; unread: number | null; tools?: ReactNode;
}) {
  return <aside className="p1-sidebar">
    <div className="p1-workspace-name"><Avatar src={profile.avatar} name={profile.name} size={35} /><div><strong>{profile.name.split(' ')[0]}’s workspace</strong><span>Rent a little. Lend a little.</span></div></div>
    <nav aria-label="Workspace navigation">{groups.map((group) => <div key={group.group}><p>{group.group}</p>{group.entries.map(([name, label, Icon]) =>
      <a key={name} href={href(name)} aria-current={route === name ? 'page' : undefined}><Icon size={17} aria-hidden="true" />{label}{name === 'notifications' && unread !== null && unread > 0 && <span>{unread}</span>}</a>)}</div>)}{tools && <div><p>More tools</p>{tools}</div>}</nav>
    <a className="p1-workspace-discovery" href={href('search')}><Compass size={20} aria-hidden="true" /><span>Another good plan?<small>Find what you need nearby.</small></span><ArrowRight size={16} aria-hidden="true" /></a>
  </aside>;
}

export function PreviewFooter({ previewTools, note }: { previewTools?: ReactNode; note?: string }) {
  return <footer className="p1-footer p1-container"><div><a href={href('home')} className="p1-logo">YBuy<span /></a><p>Less owning. More doing.</p></div>
    <nav aria-label="Footer navigation"><a href={href('search')}>Find a rental</a><a href={href('create')}>List an item</a><a href={href('requests')}>Ask the community</a>{previewTools ?? <a href="/guidelines">Guidelines</a>}</nav>
    <small>{note ?? `© ${new Date().getFullYear()} YBuy`}</small>
  </footer>;
}

export function AdminLink() {
  return <a href={href('admin')}><ShieldCheck size={17} aria-hidden="true" />Admin workspace</a>;
}
