export interface LocalLoginProfile {
  id: string;
  name: string;
  role: 'Owner' | 'Renter' | 'Admin' | 'Super Admin';
}

export const LOCAL_PROFILE_LOGIN = import.meta.env.DEV && import.meta.env.VITE_LOCAL_PROFILE_LOGIN === true
  && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export async function loadLocalProfiles(): Promise<LocalLoginProfile[]> {
  const response = await fetch('/api/local-profiles', { cache: 'no-store' });
  if (!response.ok) throw new Error('Local profiles are unavailable. Start local Supabase and retry.');
  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.length !== 22 || data.some((item) =>
    !item || typeof item.id !== 'string' || typeof item.name !== 'string'
    || !['Owner', 'Renter', 'Admin', 'Super Admin'].includes(item.role))) {
    throw new Error('Local profile list is invalid. Restart the local development server.');
  }
  return data;
}
