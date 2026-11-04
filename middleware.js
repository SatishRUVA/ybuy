// Vercel Edge Middleware — runs before every request in `matcher`, ahead of the SPA rewrite in
// vercel.json. Framework-agnostic: no `@vercel/edge`/Next.js import, just the Fetch API.
import { verifyAccessSession, ACCESS_COOKIE_NAME } from './api/_lib/access-session.js';

export const config = {
  // Excludes the access page itself, its API, and static assets — everything else is gated.
  matcher: ['/((?!api/access|access$|assets/|favicon\\.ico|apple-touch-icon\\.png$|icon-(?:192|512)\\.png$|site\\.webmanifest$|ybuy-social\\.png$).*)'],
};

function parseCookie(header, name) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function next() {
  // The Vercel edge runtime treats this header as "continue to normal routing" for
  // framework-agnostic middleware (the same mechanism `@vercel/edge`'s next() uses internally).
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

export default async function middleware(request) {
  if (process.env.YBUY_ADMIN_PORTAL === 'true') {
    if (new URL(request.url).hostname !== 'ybuy-admin.vercel.app') return new Response('Not found', { status: 404 });
    return next();
  }
  if (process.env.YBUY_TEMP_ACCESS_ENABLED !== 'true') return next();

  const sessionSecret = process.env.YBUY_ACCESS_SESSION_SECRET;
  if (!sessionSecret) {
    // Fail closed: an enabled-but-misconfigured gate must never silently let traffic through.
    return new Response('Service temporarily unavailable', { status: 503 });
  }

  const cookie = parseCookie(request.headers.get('cookie'), ACCESS_COOKIE_NAME);
  const valid = await verifyAccessSession(sessionSecret, cookie);
  if (valid) return next();

  const url = new URL(request.url);
  const accessUrl = new URL('/access', url.origin);
  const redirectTarget = `${url.pathname}${url.search}`;
  if (redirectTarget && redirectTarget !== '/') accessUrl.searchParams.set('redirect', redirectTarget);
  // A present-but-invalid cookie means a session existed and lapsed, vs. never having one.
  if (cookie) accessUrl.searchParams.set('expired', '1');
  return Response.redirect(accessUrl, 307);
}
