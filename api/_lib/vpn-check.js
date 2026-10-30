export async function isVpnDetectionEnabled(supabaseUrl, anonKey) {
  if (!supabaseUrl || !anonKey) throw new Error('Feature flags unavailable');

  const url = new URL('/rest/v1/feature_flags', supabaseUrl);
  url.searchParams.set('select', 'enabled');
  url.searchParams.set('key', 'eq.vpn_detection');

  const response = await fetch(url, {
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Feature flags unavailable');

  const flags = await response.json();
  if (!Array.isArray(flags)) throw new Error('Feature flags unavailable');
  return flags[0]?.enabled === true;
}

export async function checkVpn(ip, apiKey) {
  if (!apiKey) throw new Error('VPN lookup key is not configured');

  const url = new URL('https://api.ipapi.is/');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(ip ? { q: ip } : {}), key: apiKey }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('VPN check unavailable');

  const result = await response.json();
  if (typeof result.is_vpn !== 'boolean') throw new Error('VPN check unavailable');
  return result.is_vpn;
}