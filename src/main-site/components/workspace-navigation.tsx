import { Calendar, ChevronDown, Compass, Gavel, Gift, Heart, LifeBuoy, List, MessageSquare, PackagePlus, Search, ShieldCheck, User, Wallet, Bell } from 'lucide-react';
import { RouteLink, useRouter, type Route } from '@/router';

type Entry = { label: string; route: Route; icon: typeof Search; active?: (route: Route) => boolean };

const primaryEntries: Entry[] = [
    { label: 'Browse rentals', route: { name: 'search' }, icon: Search,
      active: route => route.name === 'search' || route.name === 'listing' },
    { label: 'My rentals', route: { name: 'dashboard', tab: 'renting' }, icon: Calendar,
      active: route => route.name === 'renter-dashboard' || (route.name === 'dashboard' && route.tab !== 'lending') },
    { label: 'Saved items', route: { name: 'favorites' }, icon: Heart },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare,
      active: route => route.name === 'messaging' || route.name === 'conversation' },
    { label: 'Notifications', route: { name: 'notifications' }, icon: Bell },
];

const navigationGroups: { title: string; icon: typeof Search; entries: Entry[] }[] = [
  { title: 'Lending', icon: PackagePlus, entries: [
    { label: 'My listings', route: { name: 'owner-listings' }, icon: List,
      active: route => route.name === 'owner-listings' },
    { label: 'Lending activity', route: { name: 'dashboard', tab: 'lending' }, icon: Calendar,
      active: route => route.name === 'owner-dashboard' || (route.name === 'dashboard' && route.tab === 'lending') },
    { label: 'Earnings & payouts', route: { name: 'owner-payouts' }, icon: Wallet,
      active: route => route.name === 'owner-payouts' },
    { label: 'Community requests', route: { name: 'requests', tab: 'browse' }, icon: Search,
      active: route => route.name === 'requests' && !route.matches && (!route.tab || route.tab === 'browse') },
  ] },
  { title: 'More to explore', icon: Compass, entries: [
    { label: 'Bidding', route: { name: 'bidding' }, icon: Gavel,
      active: route => ['bidding', 'bidding-detail', 'auction'].includes(route.name) && !(route.name === 'bidding' && route.view === 'my-bids') },
    { label: 'My bids', route: { name: 'bidding', view: 'my-bids' }, icon: Gavel,
      active: route => route.name === 'bidding' && route.view === 'my-bids' },
    { label: 'My item requests', route: { name: 'requests', tab: 'mine' }, icon: PackagePlus,
      active: route => route.name === 'requests' && Boolean(route.matches || route.tab === 'mine' || route.tab === 'offers') },
  ] },
  { title: 'Account & help', icon: User, entries: [
    { label: 'Profile & settings', route: { name: 'trust-profile' }, icon: User },
    { label: 'Points & rewards', route: { name: 'wallet' }, icon: Gift },
    { label: 'Support', route: { name: 'support' }, icon: LifeBuoy },
    { label: 'Rental disputes', route: { name: 'claims' }, icon: ShieldCheck,
      active: route => route.name === 'claims' || route.name === 'claim-detail' },
  ] },
];

function isCurrent(entry: Entry, route: Route) {
  return entry.active?.(route) ?? route.name === entry.route.name;
}

export function WorkspaceNavigation({ onNavigate, label = 'Workspace navigation' }: {
  onNavigate?: () => void;
  label?: string;
}) {
  const { route } = useRouter();
  const renderEntry = (entry: Entry) => (
    <RouteLink route={entry.route} key={entry.label} aria-current={isCurrent(entry, route) ? 'page' : undefined}
      onNavigate={onNavigate}>
      <entry.icon size={18} aria-hidden="true" />
      <span>{entry.label}</span>
    </RouteLink>
  );
  return (
    <nav aria-label={label} className="workspace-navigation">
      <div className="workspace-navigation-primary">{primaryEntries.map(renderEntry)}</div>
      {navigationGroups.map(group => (
        <details key={group.title} className="workspace-navigation-group" open={group.entries.some(entry => isCurrent(entry, route))}>
          <summary>
            <group.icon size={18} aria-hidden="true" />
            <span>{group.title}</span>
            <ChevronDown size={16} aria-hidden="true" className="workspace-navigation-chevron" />
          </summary>
          <div className="workspace-navigation-submenu">{group.entries.map(renderEntry)}</div>
        </details>
      ))}
    </nav>
  );
}

