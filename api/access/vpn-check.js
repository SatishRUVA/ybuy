import { checkVpn, isVpnDetectionEnabled } from '../_lib/vpn-check.js';

export const config = { runtime: 'edge' };

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function handler(request) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  try {
    const enabled = await isVpnDetectionEnabled(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    );
    if (!enabled) return json(200, { enabled: false, isVpn: false });

    const ip = request.headers.get('x-vercel-forwarded-for')?.trim()
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (!ip) return json(503, { error: 'VPN check unavailable' });

    const apiKey = process.env.IPAPI_IS_KEY;
    if (!apiKey) return json(503, { error: 'VPN check unavailable' });
    return json(200, { enabled: true, isVpn: await checkVpn(ip, apiKey) });
  } catch {
    return json(502, { error: 'VPN check unavailable' });
  }
}