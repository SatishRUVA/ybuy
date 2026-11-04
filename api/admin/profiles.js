import {
  ADMIN_FIXTURES, adminConfigured, adminDb, adminEnabled, adminJson, readAdminRole,
} from '../_lib/admin-access.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (!adminEnabled(request)) return adminJson(404, { error: 'Not found.' });
  if (!['GET', 'POST'].includes(request.method)) return adminJson(405, { error: 'Method not allowed.' });
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) {
    return adminJson(403, { error: 'Same-origin profile selection required.' });
  }
  if (!adminConfigured()) return adminJson(503, { error: 'Administrator access is not configured.' });
  const role = await readAdminRole(request);
  if (!role) return adminJson(401, { error: 'Administrator verification expired. Enter your authenticator code again.' });
  try {
    const db = adminDb();
    const users = [];
    for (let page = 1; ; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      users.push(...data.users.filter(user => ADMIN_FIXTURES.get(user.email) === role
        && user.app_metadata.local_test_fixture === 'ybuy-local-lifecycle-v1'));
      if (data.users.length < 1000) break;
    }
    if (!users.length) return adminJson(503, { error: 'No administrator test profiles are provisioned for this role.' });
    const { data: admins, error } = await db.from('admin_users').select('user_id, role, active').in('user_id', users.map(user => user.id));
    if (error) throw error;
    const allowed = users.filter(user => admins.some(admin => admin.user_id === user.id && admin.role === role && admin.active === true));
    if (!allowed.length) return adminJson(503, { error: 'No active test profiles have the required administrator role.' });
    if (request.method === 'GET') return adminJson(200, allowed.map(user => ({
      id: user.id, name: user.user_metadata.full_name || user.email,
      role: role === 'admin' ? 'Admin' : 'Super Admin',
    })));
    let body;
    try { body = await request.json(); } catch { return adminJson(400, { error: 'Choose a valid administrator profile.' }); }
    const user = allowed.find(user => user.id === body?.id);
    if (!user) return adminJson(403, { error: 'This profile is not authorized by your verified role.' });
    const { data, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email: user.email });
    if (linkError) throw linkError;
    if (data.user.id !== user.id || !data.properties.hashed_token) throw new Error('Administrator login identity mismatch.');
    console.log(JSON.stringify({ event: 'admin_profile_selected', role, userId: user.id }));
    return adminJson(200, { tokenHash: data.properties.hashed_token });
  } catch (error) {
    console.error('Administrator profile selection failed:', error instanceof Error ? error.message : 'Backend profile error');
    return adminJson(502, { error: 'Could not load or select administrator profiles. Please retry.' });
  }
}
