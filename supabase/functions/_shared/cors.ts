// Shared CORS handling for the browser-callable Edge Functions.
//
// APP_ORIGIN is a comma-separated allowlist, e.g.
//   https://ybuy.vercel.app,http://localhost:5173
// A request's Origin is echoed back only when it is on the list. When APP_ORIGIN is unset the
// functions stay permissive (`*`), which is the previous behavior and only suitable for development.
const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type, x-notification-worker-secret';

function allowedOrigins(): string[] {
  return (Deno.env.get('APP_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** The origin used to build redirect URLs (e.g. Stripe return links): never an unlisted origin. */
export function trustedOrigin(req: Request): string {
  const allowed = allowedOrigins();
  const requestOrigin = req.headers.get('origin') ?? '';
  if (allowed.length === 0) return requestOrigin;
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
}

function corsHeaders(req: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  });
  const allowed = allowedOrigins();
  const requestOrigin = req.headers.get('origin');
  if (allowed.length === 0) headers.set('Access-Control-Allow-Origin', '*');
  else if (requestOrigin && allowed.includes(requestOrigin)) headers.set('Access-Control-Allow-Origin', requestOrigin);
  return headers;
}

/** Wraps a handler: answers preflights and adds the right CORS headers to every response. */
export function withCors(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const response = await handler(req);
    const headers = new Headers(response.headers);
    cors.forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
