import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth-context';

const ADMIN_PERMISSIONS = [
  'analytics.view', 'users.manage', 'listings.moderate', 'bookings.view', 'payments.view',
  'payouts.view', 'reviews.moderate', 'categories.manage', 'audit.view', 'integrations.view',
  'config.manage', 'flags.manage', 'admins.manage', 'disputes.manage', 'support.manage',
  'promotions.manage', 'credits.manage', 'refunds.issue', 'refunds.approve', 'refunds.senior', 'fraud.investigate',
] as const;
export type AdminPermission = typeof ADMIN_PERMISSIONS[number];

export interface AdminAccess {
  role: 'super_admin' | 'admin';
  permissions: AdminPermission[];
}

export interface AdminAccessState {
  access: AdminAccess | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

function isAdminAccess(value: unknown): value is AdminAccess {
  return Boolean(value && typeof value === 'object' && 'role' in value
    && (value.role === 'admin' || value.role === 'super_admin') && 'permissions' in value
    && Array.isArray(value.permissions)
    && value.permissions.every(permission => ADMIN_PERMISSIONS.some(known => known === permission)));
}

export function useAdminAccess(): AdminAccessState {
  const { user } = useAuth();
  const [state, setState] = useState<{ userId: string; access: AdminAccess | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function fetchAccess() {
      const { data, error } = await supabase.rpc('get_my_admin_access');
      if (error) throw new Error(error.message);
      const access: unknown = data;
      if (access !== null && !isAdminAccess(access)) throw new Error('Administrator access response is invalid.');
      return access;
    }
    fetchAccess().then(access => {
      if (active) setState({ userId: user.id, access, error: null });
    }).catch((error: unknown) => {
      if (active) setState({ userId: user.id, access: null, error: error instanceof Error ? error.message : 'Could not verify administrator access.' });
    });
    return () => { active = false; };
  }, [user, attempt]);

  return {
    access: user && state?.userId === user.id ? state.access : null,
    loading: Boolean(user && state?.userId !== user.id),
    error: user && state?.userId === user.id ? state.error : null,
    retry: () => setAttempt(value => value + 1),
  };
}
