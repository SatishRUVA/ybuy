import { useRouter, type Route } from '@/router';
import { useAuth } from '@/auth-context';
import { useAdminAccess } from '@/lib/admin-access';
import { ArrowRight, Compass, Heart, LayoutGrid, List, MessageSquare, ShieldCheck, UserRound, Wallet, Bell, Package, LifeBuoy } from 'lucide-react';
import './workspace-sidebar.css';

type Entry = { label: string; route: Route; icon: typeof Package; active?: (route: Route) => boolean };

const renting: Entry[] = [
  { label: 'My rentals', route: { name: 'dashboard', tab: 'renting' }, icon: Package, active: (route) => route.name === 'dashboard' && route.tab !== 'lending' },
  { label: 'Saved items', route: { name: 'favorites' }, icon: Heart },
];
const lending: Entry[] = [
  { label: 'Owner overview', route: { name: 'dashboard', tab: 'lending' }, icon: LayoutGrid, active: (route) => route.name === 'dashboard' && route.tab === 'lending' },
  { label: 'My listings', route: { name: 'owner-listings' }, icon: List, active: (route) => route.name === 'owner-listings' },
  { label: 'Earnings & payouts', route: { name: 'owner-payouts' }, icon: Wallet },
];
const account: Entry[] = [
  { label: 'Messages', route: { name: 'messaging' }, icon: MessageSquare },
  { label: 'Notifications', route: { name: 'notifications' }, icon: Bell },
  { label: 'Profile & settings', route: { name: 'trust-profile' }, icon: UserRound },
  { label: 'Wallet', route: { name: 'wallet' }, icon: Wallet },
  { label: 'Support', route: { name: 'support' }, icon: LifeBuoy },
  { label: 'Rental disputes', route: { name: 'claims' }, icon: ShieldCheck },
];

function isActive(route: Route, entry: Entry) {
  return entry.active?.(route) ?? (route.name === entry.route.name
    || (entry.route.name === 'messaging' && route.name === 'conversation')
    || (entry.route.name === 'claims' && route.name === 'claim-detail'));
}

export function WorkspaceSidebar() {
  const { route, navigate } = useRouter();
  const { profile } = useAuth();
  const adminAccess = useAdminAccess();
  const groups = [
    { title: 'Rent', entries: renting },
    { title: 'Lend', entries: lending },
    { title: 'Account', entries: account },
    ...(adminAccess.access ? [{ title: 'Administration', entries: [{ label: 'Admin workspace', route: { name: 'admin' } as Route, icon: ShieldCheck }] }] : []),
  ];

  return (
    <aside className="p1-sidebar" aria-label="Workspace">
      <button type="button" className="p1-workspace-name account-workspace-identity" onClick={() => navigate({ name: 'trust-profile' })}>
        {profile?.avatar_url
          ? <img className="p1-avatar" src={profile.avatar_url} alt="" />
          : <span className="p1-avatar account-workspace-avatar"><UserRound size={18} aria-hidden="true" /></span>}
        <div><strong>{profile?.full_name ? `${profile.full_name.split(' ')[0]}’s workspace` : 'Your workspace'}</strong><span>Rent a little. Lend a little.</span></div>
      </button>
      <nav aria-label="Workspace navigation">
        {groups.map((group) => (
          <div key={group.title}>
            <p>{group.title}</p>
            {group.entries.map((entry) => {
              const Icon = entry.icon;
              return <button type="button" key={entry.label} aria-current={isActive(route, entry) ? 'page' : undefined}
                onClick={() => navigate(entry.route)}>
                <Icon size={17} aria-hidden="true" />{entry.label}
              </button>;
            })}
          </div>
        ))}
      </nav>
      <button type="button" className="p1-workspace-discovery account-workspace-discovery" onClick={() => navigate({ name: 'search' })}>
        <Compass size={19} aria-hidden="true" />
        <span>Another good plan?<small>Find what you need nearby.</small></span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
