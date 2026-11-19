import { useState } from 'react';
import {
  ArrowLeft, BarChart3, Banknote, CalendarCheck, CreditCard, Gift, LayoutDashboard,
  Gavel, LifeBuoy, Lock, Menu, Package, Search, Shield, ShieldCheck, Star, Tags, Users, SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from '@/router';
import { Badge, EmptyState, IconButton } from '@/main-site/components/ui';
import { Skeleton } from '@/main-site/components/skeleton';
import { useAdminAccess, type AdminAccess, type AdminPermission } from '@/admin/api';
import { Dialog, DialogDescription, DialogTitle, SheetContent } from '@/main-site/components/shadcn/dialog';
import { cn } from '@/lib/utils';
import { OverviewSection } from '@/admin/pages/overview';
import { BookingsSection, ListingsSection, PaymentsSection, PayoutsSection, ReviewsSection, UsersSection } from '@/admin/pages/resources';
import { CategoriesSection, SettingsSection } from '@/admin/pages/config';
import { PageHeader } from '@/main-site/components/operations/shared';
import { CasesSection } from '@/main-site/components/operations/cases';
import { PromotionsSection } from '@/admin/pages/promotions';
import { RefundsSection } from '@/admin/pages/refunds';
import { ItemRequestsSection } from '@/admin/pages/marketplace';
import { CustomerInvestigationsSection } from '@/admin/pages/investigations';
import { AdminGlobalSearch } from '@/admin/pages/admin-search';
import { ActionCenter } from '@/admin/pages/action-center';
import { Booking360, Customer360 } from '@/admin/pages/record-details';

type Icon = LucideIcon;
interface NavItem { id: string; label: string; icon: Icon; permission?: AdminPermission; anyPermission?: AdminPermission[]; pending?: string }

const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Daily Operations', items: [
    { id: 'overview', label: 'Action Center', icon: LayoutDashboard, anyPermission: [
      'analytics.view', 'users.manage', 'listings.moderate', 'bookings.view', 'payments.view', 'payouts.view',
      'disputes.manage', 'support.manage', 'refunds.issue', 'refunds.approve', 'refunds.senior',
      'fraud.investigate', 'reviews.moderate', 'categories.manage', 'promotions.manage', 'credits.manage',
      'audit.view', 'integrations.view', 'config.manage', 'flags.manage', 'admins.manage',
    ] },
    { id: 'listings', label: 'Listings', icon: Package, permission: 'listings.moderate' },
    { id: 'requests', label: 'Item requests', icon: Search, permission: 'listings.moderate' },
    { id: 'bookings', label: 'Bookings', icon: CalendarCheck, permission: 'bookings.view' },
  ] },
  { title: 'Customer Care', items: [
    { id: 'users', label: 'Users', icon: Users, permission: 'users.manage' },
    { id: 'investigations', label: 'Customer investigations', icon: ShieldCheck, permission: 'fraud.investigate' },
    { id: 'disputes', label: 'Disputes & claims', icon: Gavel, permission: 'disputes.manage' },
    { id: 'support', label: 'Support tickets', icon: LifeBuoy, permission: 'support.manage' },
    { id: 'reviews', label: 'Reviews', icon: Star, permission: 'reviews.moderate' },
  ] },
  { title: 'Financial Operations', items: [
    { id: 'payments', label: 'Payments', icon: CreditCard, permission: 'payments.view' },
    { id: 'payouts', label: 'Payouts', icon: Banknote, permission: 'payouts.view' },
    { id: 'refunds', label: 'Refund requests', icon: CreditCard, anyPermission: ['refunds.issue', 'refunds.approve', 'refunds.senior'] },
  ] },
  { title: 'Growth & management', items: [
    { id: 'promotions', label: 'Promotions & rewards', icon: Gift, anyPermission: ['promotions.manage', 'credits.manage'] },
    { id: 'categories', label: 'Categories', icon: Tags, permission: 'categories.manage' },
    { id: 'settings', label: 'Settings', icon: SlidersHorizontal, permission: 'config.manage' },
    { id: 'insurance', label: 'Insurance & protection', icon: Shield, pending: 'Insurance and protection options' },
    { id: 'analytics', label: 'Analytics & exports', icon: BarChart3, permission: 'analytics.view' },
  ] },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);
const can = (access: AdminAccess, item: NavItem) => item.anyPermission
  ? item.anyPermission.some((permission) => access.permissions.includes(permission))
  : !item.permission || access.permissions.includes(item.permission);

function Nav({ access, active, onSelect }: { access: AdminAccess; active: string; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Admin" className="p-3 space-y-5">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => can(access, i));
        if (items.length === 0) return null;
        return (
          <div key={g.title}>
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.title}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.id}>
                  <button
                    onClick={() => onSelect(i.id)} aria-current={active === i.id ? 'page' : undefined}
                    className={cn(
                      'w-full flex items-center gap-2.5 rounded-card px-3 py-2 text-sm font-medium text-left transition-colors duration-fast',
                      active === i.id ? 'bg-accent-soft text-accent' : 'text-sec hover:bg-subtle hover:text-main',
                    )}
                  >
                    <i.icon size={16} className="shrink-0" />
                    <span className="truncate">{i.label}</span>
                    {i.pending && <span className="ml-auto text-[10px] font-semibold uppercase text-muted">Soon</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Section({ id, recordId, access, onSelect }: {
  id: string; recordId?: string; access: AdminAccess; onSelect: (section: string, recordId?: string) => void;
}) {
  switch (id) {
    case 'overview': return <ActionCenter access={access} onSelect={onSelect} />;
    case 'analytics': return <OverviewSection />;
    case 'users': return recordId ? <Customer360 id={recordId} onSelect={onSelect} /> : <UsersSection />;
    case 'investigations': return <CustomerInvestigationsSection />;
    case 'listings': return <ListingsSection />;
    case 'requests': return <ItemRequestsSection />;
    case 'bookings': return recordId ? <Booking360 id={recordId} access={access} onSelect={onSelect} /> : <BookingsSection />;
    case 'disputes': return <CasesSection kind="dispute" initialId={recordId} onBackToQueue={() => onSelect('disputes')} />;
    case 'support': return <CasesSection kind="support" initialId={recordId} onBackToQueue={() => onSelect('support')} />;
    case 'promotions': return <PromotionsSection />;
    case 'refunds': return <RefundsSection />;
    case 'reviews': return <ReviewsSection />;
    case 'categories': return <CategoriesSection />;
    case 'settings': return <SettingsSection isSuperAdmin={access.role === 'super_admin'} />;
    case 'payments': return <PaymentsSection />;
    case 'payouts': return <PayoutsSection />;
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

export function AdminPage({ section, recordId }: { section?: string; recordId?: string }) {
  const { navigate } = useRouter();
  const { access, loading, error, retry } = useAdminAccess();
  const [menuOpen, setMenuOpen] = useState(false);

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
  if (access.role !== 'admin' && access.role !== 'super_admin') {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <EmptyState icon={<Lock size={20} />} title="Administrator access required" description="This portal is for Admin and Super Admin accounts only." actionLabel="Back to YBuy" onAction={() => navigate({ name: 'home' })} />
      </div>
    );
  }

  const granted = ALL_ITEMS.filter((i) => (i.permission || i.anyPermission) && can(access, i));
  const active = ALL_ITEMS.find((i) => i.id === section && can(access, i)) ?? granted[0];
  if (!active) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <EmptyState icon={<Lock size={20} />} title="No permissions granted" description="You are an administrator, but no permissions have been granted yet. Contact the platform team." actionLabel="Back to YBuy" onAction={() => navigate({ name: 'home' })} />
      </div>
    );
  }
  const select = (id: string, selectedRecordId?: string) => {
    setMenuOpen(false);
    navigate({ name: 'admin', section: id, recordId: selectedRecordId });
  };

  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-40 h-14 flex items-center gap-3 px-4 bg-card border-b border-app">
        <IconButton label="Open admin menu" variant="ghost" size="sm" className="lg:hidden" onClick={() => setMenuOpen(true)}><Menu size={18} /></IconButton>
        <a href="https://ybuy-e2e-test.vercel.app/" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-sec hover:text-main transition-colors duration-fast">
          <ArrowLeft size={15} /> Back to YBuy
        </a>
        <h1 className="font-display font-bold text-main ml-2 hidden sm:block">Admin console</h1>
        <AdminGlobalSearch access={access} onSelect={select} />
        <Badge tone="accent">{access.role.replace('_', ' ')}</Badge>
      </header>
      <div className="lg:grid lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto bg-card border-r border-app">
          <Nav access={access} active={active.id} onSelect={select} />
        </aside>
        <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent>
            <DialogTitle className="sr-only">Admin navigation</DialogTitle>
            <DialogDescription className="sr-only">Choose an admin section</DialogDescription>
            <div className="pt-10"><Nav access={access} active={active.id} onSelect={select} /></div>
          </SheetContent>
        </Dialog>
        <main className="min-w-0 px-4 sm:px-6 py-6 max-w-[1200px] w-full">
          <Section key={`${active.id}:${recordId ?? ''}`} id={active.id} recordId={recordId} access={access} onSelect={select} />
        </main>
      </div>
    </div>
  );
}
