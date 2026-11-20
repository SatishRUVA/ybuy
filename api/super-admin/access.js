import { handleAdminAccess } from '../admin/access.js';

export const config = { runtime: 'edge' };

export default function handler(request) {
  return handleAdminAccess(request, 'super_admin');
}
