import { ACCESS_COOKIE_NAME, verifyAccessSession } from '../../api/_lib/access-session.js';

export const config = {
  path: '/*',
  excludedPath: [
    '/access',
    '/api/*',
    '/assets/*',
    '/favicon.ico',
    '/apple-touch-icon.png',
    '/icon-192.png',
    '/icon-512.png',
    '/site.webmanifest',
    '/ybuy-social.png',
  ],
};

function parseCookie(header, name) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export default async function accessGate(request, context) {
  const env = globalThis.Netlify.env;
  const adminPortal = env.get('YBUY_ADMIN_PORTAL') === 'true';
  const adminHost = (env.get('YBUY_ADMIN_HOST') || 'ybuy-admin.vercel.app').trim().toLowerCase();
  const hostname = new URL(request.url).hostname.toLowerCase();

  if (adminPortal && hostname !== adminHost) return new Response('Not found', { status: 404 });
  if (env.get('YBUY_TEMP_ACCESS_ENABLED') !== 'true') return context.next();

  const sessionSecret = env.get('YBUY_ACCESS_SESSION_SECRET');
  if (!sessionSecret) return new Response('Service temporarily unavailable', { status: 503 });

  const cookie = parseCookie(request.headers.get('cookie'), ACCESS_COOKIE_NAME);
  if (await verifyAccessSession(sessionSecret, cookie)) return context.next();

  const url = new URL(request.url);
  const accessUrl = new URL('/access', url.origin);
  const redirectTarget = `${url.pathname}${url.search}`;
  if (redirectTarget && redirectTarget !== '/') accessUrl.searchParams.set('redirect', redirectTarget);
  if (cookie) accessUrl.searchParams.set('expired', '1');
  return Response.redirect(accessUrl, 307);
}
