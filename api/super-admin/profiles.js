import { handleAdminProfiles } from '../admin/profiles.js';

export const config = { runtime: 'edge' };

export default function handler(request) {
  return handleAdminProfiles(request, 'super_admin');
}
