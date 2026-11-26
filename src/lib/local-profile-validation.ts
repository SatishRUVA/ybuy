export type LocalProfileRole = 'Owner' | 'Renter' | 'Admin' | 'Super Admin';
export type LocalProfile = { id: string; name: string; role: LocalProfileRole };

export function isValidLocalProfileList(
  data: unknown,
  mode: 'admin' | 'hosted' | 'local',
  allowedAdminRole: 'Admin' | 'Super Admin' = 'Admin',
): data is LocalProfile[] {
  const maxProfiles = mode === 'admin' ? 2 : mode === 'hosted' ? 12 : 10;
  const allowedRoles = mode === 'admin'
    ? [allowedAdminRole]
    : mode === 'local' ? ['Owner', 'Renter'] : ['Owner', 'Renter', 'Admin', 'Super Admin'];
  return Array.isArray(data)
    && data.length > 0
    && data.length <= maxProfiles
    && data.every((item) =>
      Boolean(item)
      && typeof item === 'object'
      && 'id' in item && typeof item.id === 'string'
      && 'name' in item && typeof item.name === 'string'
      && 'role' in item && allowedRoles.includes(item.role as LocalProfileRole))
    && (mode !== 'local' || (
      data.filter(item => item.role === 'Owner').length === 5
      && data.filter(item => item.role === 'Renter').length === 5
      && new Set(data.map(item => item.id)).size === 10
    ));
}
