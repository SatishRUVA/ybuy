const siteVariant = import.meta.env.VITE_SITE_VARIANT;
const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
export type AdminPortalRole = 'admin' | 'super_admin';
export const ADMIN_PORTAL = siteVariant === 'admin'
  || (siteVariant === 'combined' && /^\/(?:admin|super-admin)(?:\/|$)/.test(pathname));
export const ADMIN_PORTAL_ROLE: AdminPortalRole = pathname.startsWith('/super-admin') ? 'super_admin' : 'admin';
export const ADMIN_PORTAL_URL = siteVariant === 'combined'
  ? '/admin'
  : import.meta.env.VITE_ADMIN_PORTAL_URL || 'https://ybuy-admin.vercel.app';
export function adminPortalUrl(role: AdminPortalRole) {
  return siteVariant === 'combined' ? role === 'super_admin' ? '/super-admin' : '/admin' : ADMIN_PORTAL_URL;
}
