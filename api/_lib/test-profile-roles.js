const HOSTED_PROFILE_ROLES = new Map([
  ...['owner', 'renter'].flatMap(role =>
    Array.from({ length: 5 }, (_, index) => [`${role}${index + 1}@example.test`, role === 'owner' ? 'Owner' : 'Renter'])),
  ['admin@example.test', 'Admin'],
  ['super-admin@example.test', 'Super Admin'],
]);

const ADMIN_ROLE_BY_PROFILE = new Map([
  ['Admin', 'admin'],
  ['Super Admin', 'super_admin'],
]);

export function hostedProfileRole(email, adminRecord) {
  const profileRole = HOSTED_PROFILE_ROLES.get(email);
  if (!profileRole) return null;
  const expectedAdminRole = ADMIN_ROLE_BY_PROFILE.get(profileRole);
  if (!expectedAdminRole) return adminRecord ? null : profileRole;
  return adminRecord?.active === true && adminRecord.role === expectedAdminRole ? profileRole : null;
}
