import { ADMIN_PORTAL, ADMIN_PORTAL_ROLE } from '@/lib/admin-portal';

export interface LocalLoginProfile {
  id: string;
  name: string;
  role: 'Owner' | 'Renter' | 'Admin' | 'Super Admin';
}

export const LOCAL_PROFILE_LOGIN = import.meta.env.DEV && import.meta.env.VITE_LOCAL_PROFILE_LOGIN === true
  && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const hostedProfileHosts = new Set([
  'ybuy-redesign-v1.vercel.app',
  'ybuy-e2e-test.vercel.app',
  ...(import.meta.env.VITE_TEST_PROFILE_HOSTS ?? '').split(','),
].map(host => host.trim().toLowerCase()).filter(Boolean));
export const HOSTED_PROFILE_LOGIN = import.meta.env.VITE_TEST_PROFILE_LOGIN === 'true'
  && import.meta.env.VITE_TEST_ENVIRONMENT === 'true'
  && hostedProfileHosts.has(window.location.hostname.toLowerCase());
export const PROFILE_LOGIN = ADMIN_PORTAL || LOCAL_PROFILE_LOGIN || HOSTED_PROFILE_LOGIN;
export const PROFILE_ENDPOINT = ADMIN_PORTAL
  ? ADMIN_PORTAL_ROLE === 'super_admin' ? '/api/super-admin/profiles' : '/api/admin/profiles'
  : HOSTED_PROFILE_LOGIN ? '/api/test-profiles' : '/api/local-profiles';

export async function loadLocalProfiles(): Promise<LocalLoginProfile[]> {
  const response = await fetch(PROFILE_ENDPOINT, { cache: 'no-store' });
  if (response.status === 401 && ADMIN_PORTAL) throw new Error('Verify your administrator authenticator code before selecting a profile.');
  if (response.status === 401 && HOSTED_PROFILE_LOGIN) throw new Error('Verify your tester security code before selecting a profile.');
  if (!response.ok && ADMIN_PORTAL) {
    const body: unknown = await response.json();
    throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : 'Administrator profiles are unavailable. Please retry.');
  }
  if (!response.ok) throw new Error(HOSTED_PROFILE_LOGIN
    ? 'Tester profiles are unavailable. Verify that the site administrator has configured tester access.'
    : 'Local profiles are unavailable. Start local Supabase and retry.');
  const data: unknown = await response.json();
  const allowedAdminProfileRole = ADMIN_PORTAL_ROLE === 'super_admin' ? 'Super Admin' : 'Admin';
  if (!Array.isArray(data) || (ADMIN_PORTAL ? data.length === 0 || data.length > 2
    : HOSTED_PROFILE_LOGIN ? data.length === 0 || data.length > 10 : data.length !== 22) || data.some((item) =>
    !item || typeof item.id !== 'string' || typeof item.name !== 'string'
    || !(ADMIN_PORTAL ? [allowedAdminProfileRole] : HOSTED_PROFILE_LOGIN ? ['Owner', 'Renter']
      : ['Owner', 'Renter', 'Admin', 'Super Admin']).includes(item.role))) {
    throw new Error(ADMIN_PORTAL || HOSTED_PROFILE_LOGIN ? 'Test profile list is invalid. Contact the site administrator.'
      : 'Local profile list is invalid. Restart the local development server.');
  }
  return data;
}
