import type { AdminPortalRole } from './admin-portal';

export function adminPortalDestination(role: AdminPortalRole, base: string): string {
  return role === 'super_admin' ? `${base.replace(/\/+$/, '')}/super-admin` : base;
}
