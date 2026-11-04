import { useRouter } from '@/router';
import {
  Activity, BarChart3, Banknote, CalendarCheck, CreditCard, Flag, Gavel, Gift, LayoutDashboard,
  LifeBuoy, Lock, Package, ScrollText, Search, Shield, ShieldCheck, SlidersHorizontal, Star, Tags, Users,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useAdminAccess, type AdminAccess, type AdminPermission } from '@/admin/api';
import { cn } from '@/lib/utils';
import { OverviewSection } from '@/admin/legacy-pages/overview';
import { BookingsSection, ListingsSection, PaymentsSection, PayoutsSection, ReviewsSection, UsersSection } from '@/admin/legacy-pages/resources';
import { CategoriesSection, FlagsSection, SettingsSection } from '@/admin/legacy-pages/config';
import { AdminsSection, AuditSection, IntegrationsSection } from '@/admin/legacy-pages/governance';
import { PageHeader } from '@/components/operations/shared';
import { CasesSection } from '@/components/operations/cases';
import { PromotionsSection } from '@/admin/legacy-pages/promotions';
import { RefundsSection } from '@/admin/legacy-pages/refunds';
import { ItemRequestsSection } from '@/admin/legacy-pages/marketplace';
import { CustomerInvestigationsSection } from '@/admin/legacy-pages/investigations';
import '@/admin/legacy-pages/admin-page.css';

type Icon = LucideIcon;
interface NavItem { id: string; label: string; icon: Icon; permission?: AdminPermission; anyPermission?: AdminPermission[]; superOnly?: boolean; pending?: string }

const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, permission: 'analytics.view' },
  ] },
  { title: 'Moderation', items: [
    { id: 'listings', label: 'Listings', icon: Package, permission: 'listings.moderate' },
    { id: 'requests', label: 'Item requests', icon: Search, permission: 'listings.moderate' },
    { id: 'reviews', label: 'Reviews', icon: Star, permission: 'reviews.moderate' },
  ] },
  { title: 'Members', items: [
    { id: 'users', label: 'Users', icon: Users, permission: 'users.manage' },
    { id: 'investigations', label: 'Customer investigations', icon: ShieldCheck, permission: 'fraud.investigate' },
  ] },
  { title: 'Disputes', items: [
    { id: 'disputes', label: 'Disputes & claims', icon: Gavel, permission: 'disputes.manage' },
    { id: 'support', label: 'Support tickets', icon: LifeBuoy, permission: 'support.manage' },
  ] },
  { title: 'Reporting', items: [
    { id: 'bookings', label: 'Bookings', icon: CalendarCheck, permission: 'bookings.view' },
    { id: 'payments', label: 'Payments', icon: CreditCard, permission: 'payments.view' },
    { id: 'payouts', label: 'Payouts', icon: Banknote, permission: 'payouts.view' },
    { id: 'refunds', label: 'Refund requests', icon: CreditCard, anyPermission: ['refunds.issue', 'refunds.approve', 'refunds.senior'] },
  ] },
  { title: 'Settings', items: [
    { id: 'promotions', label: 'Promotions & rewards', icon: Gift, anyPermission: ['promotions.manage', 'credits.manage'] },
    { id: 'categories', label: 'Categories', icon: Tags, permission: 'categories.manage' },
    { id: 'settings', label: 'Global settings', icon: SlidersHorizontal, permission: 'config.manage' },
    { id: 'flags', label: 'Feature flags', icon: Flag, permission: 'flags.manage' },
    { id: 'integrations', label: 'Integrations & health', icon: Activity, permission: 'integrations.view' },
    { id: 'audit', label: 'Audit log', icon: ScrollText, permission: 'audit.view' },
    { id: 'admins', label: 'Administrators', icon: ShieldCheck, permission: 'admins.manage' },
    { id: 'insurance', label: 'Insurance & protection', icon: Shield, pending: 'Insurance and protection options' },
    { id: 'analytics', label: 'Analytics & exports', icon: BarChart3, pending: 'Reports and CSV exports beyond the overview' },
  ] },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);
const can = (access: AdminAccess, item: NavItem) => item.superOnly ? access.role === 'super_admin' : item.anyPermission
  ? item.anyPermission.some((permission) => access.permissions.includes(permission))
  : !item.permission || access.permissions.includes(item.permission);

function Nav({ access, active, onSelect }: { access: AdminAccess; active: string; onSelect: (id: string) => void }) {
  const activeGroup = GROUPS.find((group) => group.items.some((item) => item.id === active));
  return (
    <nav aria-label="Admin" className="admin-console__nav">
      <div className="p1-tabs p1-space-bottom" aria-label="Admin sections">
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => can(access, item));
          if (!items.length) return null;
          return <button key={group.title} type="button"
            aria-pressed={activeGroup === group}
            onClick={() => onSelect(items[0].id)}>{group.title}</button>;
        })}
      </div>
      <ul className="admin-console__nav-list" aria-label="Administrator tools">
              {ALL_ITEMS.filter((item) => can(access, item)).map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(i.id)} aria-current={active === i.id ? 'page' : undefined}
                    className={cn(
                      'admin-console__nav-item',
                      active === i.id ? 'bg-accent-soft text-accent' : 'text-sec hover:bg-subtle hover:text-main',
                    )}
                  >
                    <i.icon size={16} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">{i.label}</span>
                    {i.pending && <span className="ml-auto text-xs font-medium text-muted">Soon</span>}
                  </button>
                </li>
              ))}
            </ul>
    </nav>
  );
}

function Section({ id }: { id: string }) {
  switch (id) {
    case 'overview': return <OverviewSection />;
    case 'users': return <UsersSection />;
    case 'investigations': return <CustomerInvestigationsSection />;
    case 'listings': return <ListingsSection />;
    case 'requests': return <ItemRequestsSection />;
    case 'bookings': return <BookingsSection />;
    case 'disputes': return <CasesSection kind="dispute" />;
    case 'support': return <CasesSection kind="support" />;
    case 'promotions': return <PromotionsSection />;
    case 'refunds': return <RefundsSection />;
    case 'reviews': return <ReviewsSection />;
    case 'categories': return <CategoriesSection />;
    case 'payments': return <PaymentsSection />;
    case 'payouts': return <PayoutsSection />;
    case 'settings': return <SettingsSection />;
    case 'flags': return <FlagsSection />;
    case 'integrations': return <IntegrationsSection />;
    case 'audit': return <AuditSection />;
    case 'admins': return <AdminsSection />;
    default: {
      const item = ALL_ITEMS.find((i) => i.id === id);
      return (
        <>
          <PageHeader title={item?.label ?? 'Not found'} />
          <EmptyState icon={<Lock size={20} />} title="Not available yet" description={`${item?.pending ?? 'This area'} has not been built. It will appear here when that module ships — nothing is simulated.`} />
        </>
      );
    }
  }
}

export function AdminPage({ section }: { section?: string }) {
  const { navigate } = useRouter();
  const { access, loading, error, retry } = useAdminAccess();

  if (loading) {
    return <div className="max-w-5xl mx-auto px-4 py-10 space-y-4" aria-busy="true"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" rounded="rounded-card-lg" /></div>;
  }
  if (error) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <EmptyState icon={<Lock size={20} />} title="Could not verify administrator access" description={error} actionLabel="Try again" onAction={retry} />
      </div>
    );
  }
  if (access === null) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <EmptyState icon={<Lock size={20} />} title="Administrator access required" description="Your account does not have access to the admin console." actionLabel="Back to YBuy" onAction={() => navigate({ name: 'home' })} />
      </div>
    );
  }

  const granted = ALL_ITEMS.filter((i) => (i.permission || i.anyPermission || i.superOnly) && can(access, i));
  const active = ALL_ITEMS.find((i) => i.id === section && can(access, i)) ?? granted[0];
  if (!active) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <EmptyState icon={<Lock size={20} />} title="No permissions granted" description="You are an administrator, but no permissions have been granted yet. Ask a super admin." actionLabel="Back to YBuy" onAction={() => navigate({ name: 'home' })} />
      </div>
    );
  }
  const select = (id: string) => navigate({ name: 'admin', section: id });
  const group = GROUPS.find((item) => item.items.some((entry) => entry.id === active.id))?.title;
  const headline = group === 'Moderation' ? 'Good listings start here.'
    : group === 'Members' ? 'The people behind the gear.'
    : group === 'Disputes' ? 'Make room for a fair outcome.'
    : group === 'Reporting' ? 'A clear view of the marketplace.'
    : group === 'Settings' ? 'Platform settings, thoughtfully.'
    : 'Keep the good plans running.';

  return (
    <main className="admin-console p1-work-page">
      <header className="p1-page-head">
        <div><h1>{headline}</h1><p>Review live marketplace activity. Access and actions are limited to your administrator permissions.</p></div>
      </header>
      <div className="admin-console__layout">
        <Nav access={access} active={active.id} onSelect={select} />
        <section className={`admin-console__main admin-console__main--${active.id}`} aria-label={active.label}>
          <Section key={active.id} id={active.id} />
        </section>
      </div>
    </main>
  );
}
