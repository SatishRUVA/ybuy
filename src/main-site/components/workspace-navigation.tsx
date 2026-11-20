import { Calendar, Gavel, Gift, Heart, LifeBuoy, List, MessageSquare, PackagePlus, Search, ShieldCheck, User, Wallet, Bell } from 'lucide-react';
import { useRouter, type Route } from '@/router';

type Entry = { label: string; route: Route; icon: typeof Search; active?: (route: Route) => boolean };

const navigationGroups: { title: string; entries: Entry[] }[] = [
  { title: 'Your rentals', entries: [
    { label: 'Browse rentals', route: { name: 'search' }, icon: Search,
      active: route => route.name === 'search' || route.name === 'listing' },
    { label: 'My rentals', route: { name: 'dashboard', tab: 'renting' }, icon: Calendar,
      active: route => route.name === 'renter-dashboard' || (route.name === 'dashboard' && route.tab !== 'lending') },
    { label: 'My listings', route: { name: 'owner-listings' }, icon: List,
      active: route => route.name === 'owner-listings' },
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare,
      active: route => route.name === 'messaging' || route.name === 'conversation' },
  ] },
  { title: 'Explore', entries: [
    { label: 'Bidding', route: { name: 'bidding' }, icon: Gavel,
      active: route => ['bidding', 'bidding-detail', 'auction'].includes(route.name) && !(route.name === 'bidding' && route.view === 'my-bids') },
    { label: 'My bids', route: { name: 'bidding', view: 'my-bids' }, icon: Gavel,
      active: route => route.name === 'bidding' && route.view === 'my-bids' },
    { label: 'Saved items', route: { name: 'favorites' }, icon: Heart },
    { label: 'My item requests', route: { name: 'requests', tab: 'mine' }, icon: PackagePlus,
      active: route => route.name === 'requests' && Boolean(route.matches || route.tab === 'mine' || route.tab === 'offers') },
  ] },
  { title: 'Lending', entries: [
    { label: 'Lending activity', route: { name: 'dashboard', tab: 'lending' }, icon: Calendar,
      active: route => route.name === 'owner-dashboard' || (route.name === 'dashboard' && route.tab === 'lending') },
    { label: 'Earnings & payouts', route: { name: 'owner-payouts' }, icon: Wallet,
      active: route => route.name === 'owner-payouts' },
    { label: 'Renter requests', route: { name: 'requests', tab: 'browse' }, icon: Search,
      active: route => route.name === 'requests' && !route.matches && (!route.tab || route.tab === 'browse') },
  ] },
  { title: 'Account & help', entries: [
    { label: 'Notifications', route: { name: 'notifications' }, icon: Bell },
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
  const { route, navigate } = useRouter();
  return (
    <nav aria-label={label} className="workspace-navigation">
      {navigationGroups.map(group => (
        <div key={group.title} className="workspace-navigation-group">
          <p>{group.title}</p>
          {group.entries.map(entry => (
            <button type="button" key={entry.label} aria-current={isCurrent(entry, route) ? 'page' : undefined}
              onClick={() => { onNavigate?.(); navigate(entry.route); }}>
              <entry.icon size={16} aria-hidden="true" />
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

