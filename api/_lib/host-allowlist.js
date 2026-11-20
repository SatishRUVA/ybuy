export function isAllowedHostname(hostname, configuredHosts = '', defaultHosts = []) {
  if (typeof hostname !== 'string' || !hostname.trim()) return false;

  const allowedHosts = new Set([
    ...defaultHosts,
    ...(typeof configuredHosts === 'string' ? configuredHosts.split(',') : []),
  ].map(host => host.trim().toLowerCase()).filter(Boolean));

  return allowedHosts.has(hostname.trim().toLowerCase());
}
