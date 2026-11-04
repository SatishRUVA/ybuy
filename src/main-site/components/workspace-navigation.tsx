import { Calendar, Gavel, Heart, Home, LifeBuoy, List, MessageSquare, PackagePlus, Search, ShieldCheck, User, Wallet, Bell } from 'lucide-react';
import { useRouter, type Route } from '@/router';

type Entry = { label: string; route: Route; icon: typeof Home; active?: (route: Route) => boolean };

const groups: { title: string; entries: Entry[] }[] = [
  { title: 'Discover', entries: [
    { label: 'Home', route: { name: 'home' }, icon: Home },
    { label: 'Browse', route: { name: 'search' }, icon: Search },
    { label: 'Bidding', route: { name: 'bidding' }, icon: Gavel,
      active: route => ['bidding', 'bidding-detail', 'auction'].includes(route.name) },
  ] },
  { title: 'Rent', entries: [
    { label: 'My rentals', route: { name: 'dashboard', tab: 'renting' }, icon: Calendar,
      active: route => route.name === 'renter-dashboard' || (route.name === 'dashboard' && route.tab !== 'lending') },
    { label: 'Saved items', route: { name: 'favorites' }, icon: Heart },
    { label: 'Item requests', route: { name: 'requests', tab: 'mine' }, icon: PackagePlus,
      active: route => route.name === 'requests' && Boolean(route.matches || route.tab === 'mine' || route.tab === 'offers') },
  ] },
  { title: 'Lend', entries: [
    { label: 'Lending activity', route: { name: 'dashboard', tab: 'lending' }, icon: Calendar,
      active: route => route.name === 'owner-dashboard' || (route.name === 'dashboard' && route.tab === 'lending') },
    { label: 'My listings', route: { name: 'owner-listings' }, icon: List },
    { label: 'Earnings & payouts', route: { name: 'owner-payouts' }, icon: Wallet },
    { label: 'Nearby requests', route: { name: 'requests', tab: 'browse' }, icon: Search,
      active: route => route.name === 'requests' && !route.matches && (!route.tab || route.tab === 'browse') },
  ] },
  { title: 'Account', entries: [
    { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare,
      active: route => route.name === 'messaging' || route.name === 'conversation' },
    { label: 'Notifications', route: { name: 'notifications' }, icon: Bell },
    { label: 'Profile & settings', route: { name: 'trust-profile' }, icon: User },
    { label: 'Wallet', route: { name: 'wallet' }, icon: Wallet },
    { label: 'Support', route: { name: 'support' }, icon: LifeBuoy },
    { label: 'Rental disputes', route: { name: 'claims' }, icon: ShieldCheck,
      active: route => route.name === 'claims' || route.name === 'claim-detail' },
  ] },
];

export function WorkspaceNavigation({ onNavigate, label = 'Workspace navigation' }: {
  onNavigate?: () => void;
  label?: string;
}) {
  const { route, navigate } = useRouter();
  return (
    <nav aria-label={label} className="workspace-navigation">
      {groups.map(group => (
        <div key={group.title} className="workspace-navigation-group">
          <p>{group.title}</p>
          {group.entries.map(entry => (
            <button type="button" key={entry.label}
              aria-current={(entry.active?.(route) ?? (route.name === entry.route.name)) ? 'page' : undefined}
              onClick={() => { onNavigate?.(); navigate(entry.route); }}>
              <entry.icon size={17} aria-hidden="true" />
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function WorkspaceSidebar() {
  return (
    <aside className="workspace-sidebar" aria-label="Your workspace">
      <div className="workspace-sidebar-heading">
        <strong>Your workspace</strong>
        <span>Rent, lend, and stay up to date.</span>
      </div>
      <WorkspaceNavigation />
    </aside>
  );
}
