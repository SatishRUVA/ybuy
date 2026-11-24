export type LocalProfileRole = 'Owner' | 'Renter' | 'Admin' | 'Super Admin';
export type LocalProfile = { id: string; name: string; role: LocalProfileRole };

export function isValidLocalProfileList(
  data: unknown,
  mode: 'admin' | 'hosted' | 'local',
  allowedAdminRole: 'Admin' | 'Super Admin' = 'Admin',
): data is LocalProfile[] {
  const maxProfiles = mode === 'admin' ? 2 : mode === 'hosted' ? 12 : 22;
  const allowedRoles = mode === 'admin'
    ? [allowedAdminRole]
    : ['Owner', 'Renter', 'Admin', 'Super Admin'];
  return Array.isArray(data)
    && data.length > 0
    && data.length <= maxProfiles
    && (mode !== 'local' ? true : data.length === 22)
    && data.every((item) =>
      Boolean(item)
      && typeof item === 'object'
      && 'id' in item && typeof item.id === 'string'
      && 'name' in item && typeof item.name === 'string'
      && 'role' in item && allowedRoles.includes(item.role as LocalProfileRole));
}
