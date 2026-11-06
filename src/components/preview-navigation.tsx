import { useEffect, useState } from 'react';
import { useAuth } from '@/auth-context';
import { useRouter, type Route } from '@/router';
import { useAdminAccess } from '@/lib/admin-access';
import { NOTIFICATIONS_CHANGED, subscribeToNotifications, unreadMessageCount, unreadNotificationCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { HOSTED_PROFILE_LOGIN, PROFILE_LOGIN } from '@/lib/local-profile-login';
import { PreviewFooter, PreviewHeader, PreviewSidebar, AdminLink } from '@/preview-1/navigation';
import { Button, ErrorNote, Modal } from '@/preview-1/ui';
import type { PageName } from '@/preview-1/state';

function pageName(route: Route): PageName {
  switch (route.name) {
    case 'dashboard': return route.tab === 'lending' ? 'owner' : 'renter';
    case 'renter-dashboard': return 'renter';
    case 'owner-dashboard': return 'owner';
    case 'owner-listings': return 'listings';
    case 'owner-payouts': return 'payouts';
    case 'create-listing':
    case 'edit-listing': return 'create';
    case 'trust-profile': return 'profile';
    case 'messaging':
    case 'conversation': return 'messages';
    case 'bidding-detail': return 'auction';
    default: return ['home', 'search', 'listing', 'bidding', 'auction', 'requests', 'checkout', 'confirmation', 'favorites', 'notifications', 'admin'].includes(route.name)
      ? route.name as PageName : 'renter';
  }
}

export function ProductionPreviewHeader() {
  const { route } = useRouter();
  const { user, profile, openSignIn, signOut, error: authError } = useAuth();
  const access = useAdminAccess();
  const [unread, setUnread] = useState<number | null>(null);
  const [unreadMessages, setUnreadMessages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id;
  useEffect(() => {
    let active = true;
    setUnread(userId ? null : 0); setUnreadMessages(userId ? null : 0); setError(null);
    if (!userId) return;
    const refresh = async () => {
      try {
        const [count, messageCount] = await Promise.all([unreadNotificationCount(userId), unreadMessageCount(userId)]);
        if (active) { setUnread(count); setUnreadMessages(messageCount); setError(null); }
      } catch (reason) {
        if (active) { setUnread(null); setUnreadMessages(null); setError(reason instanceof Error ? reason.message : 'Could not load notification counts.'); }
      }
    };
    void refresh();
    const channel = subscribeToNotifications(userId, () => { void refresh(); });
    const onChanged = () => { void refresh(); };
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged); void supabase.removeChannel(channel); };
  }, [userId]);
  return <>
    <PreviewHeader key={`${route.name}:${userId ?? 'anonymous'}`} route={pageName(route)} profile={{ name: profile?.full_name ?? 'Your', avatar: profile?.avatar_url ?? '', signedIn: Boolean(user) }}
      unread={unread} unreadMessages={unreadMessages} notificationCount signIn={openSignIn} signOut={signOut} profileSelection={PROFILE_LOGIN} extraNavigation={<>{access.access && <AdminLink />}<AccountTools admin={Boolean(access.access)} /></>} />
    {error && <div className="p1-container"><ErrorNote>{error}</ErrorNote></div>}
    {authError && <div className="p1-container"><ErrorNote>{authError}</ErrorNote></div>}
  </>;
}

export function ProductionPreviewSidebar() {
  const { route } = useRouter();
  const { user, profile } = useAuth();
  const access = useAdminAccess();
  return <PreviewSidebar route={pageName(route)} profile={{ name: profile?.full_name ?? 'Your', avatar: profile?.avatar_url ?? '', signedIn: Boolean(user) }}
    unread={null} tools={<AccountTools admin={Boolean(access.access)} />} />;
}

function AccountTools({ admin }: { admin: boolean }) {
  const { user, signOut, openSignIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <><a href="#account-tools" onClick={(event) => { event.preventDefault(); setOpen(true); }}>Help & account tools</a>
    <Modal open={open} onClose={() => setOpen(false)} title="Help & account tools" description="Manage your account and find help with a rental.">
      <nav className="p1-mobile-navigation" aria-label="Account tools"><a href="/wallet">Wallet & credits</a><a href="/claims">Claims & disputes</a>
        <a href="/support">Help & support</a><a href="/protection">Rental protection</a><a href="/guidelines">Community guidelines</a>
        <a href="/profile">Profile & security</a>{admin && <AdminLink />}</nav>
      {error && <ErrorNote>{error}</ErrorNote>}
      {user && PROFILE_LOGIN && <Button variant="secondary" disabled={busy} onClick={() => {
        setOpen(false); openSignIn();
      }}>{HOSTED_PROFILE_LOGIN ? 'Switch test profile' : 'Switch local profile'}</Button>}
      {user && <Button variant="secondary" disabled={busy} onClick={() => {
        setBusy(true); setError(null);
        void signOut().then(() => setOpen(false)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not sign out. Please try again.'))
          .finally(() => setBusy(false));
      }}>{busy ? 'Signing out…' : 'Sign out'}</Button>}
    </Modal></>;
}

export function ProductionPreviewFooter() {
  const access = useAdminAccess();
  return <PreviewFooter previewTools={<AccountTools admin={Boolean(access.access)} />} />;
}
