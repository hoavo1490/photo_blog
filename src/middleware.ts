import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { createNeonDriver } from './lib/db/neon-driver';
import { classifyRoute, isCacheableMethod } from './lib/middleware/route-mode';
import { resolveTenant, historicRedirectUrl } from './lib/middleware/tenant';
import { readFromCache, writeToCache } from './lib/middleware/cache';
import { readSessionId, looksLikeSessionId } from './lib/auth/session-cookie';
import { loadSession } from './lib/auth/login-flow';

// Astro middleware. Runs for every non-asset request before the route
// renders. Path-based split:
//
//   1. Assets pass through.
//   2. Tenant resolution by host happens for both admin and public
//      branches (the editor mutates the tenant identified by the host
//      it was reached from -- riovv.com/admin manages Rio's site).
//   3. Admin paths (/admin/*, /login, /logout, /auth/*) require a session.
//   4. Public paths edge-cache anonymous GETs.
//
// Bindings come from `cloudflare:workers` in Astro 6 + adapter v13.

declare global {
  // Test escape hatch -- integration tests inject a SqlDriver to avoid
  // a real Neon connection. Production code never sets this.
  // eslint-disable-next-line no-var
  var __RIOVV_TEST_DRIVER__: import('./lib/db/driver').SqlDriver | undefined;
}

function driverFromEnv() {
  if (globalThis.__RIOVV_TEST_DRIVER__) return globalThis.__RIOVV_TEST_DRIVER__;
  const url = (env as unknown as { DATABASE_URL?: string }).DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not bound');
  return createNeonDriver(url);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  const mode = classifyRoute({ pathname: url.pathname });

  if (mode === 'asset') return next();

  const driver = driverFromEnv();
  context.locals.db = driver;

  // Resolve tenant for both branches -- admin mutations are scoped to
  // whichever site owns the host the request landed on, and public reads
  // need the tenant to look up posts.
  const resolved = await resolveTenant(driver, host);
  if (resolved.kind === 'unknown') {
    return new Response('Site not found', { status: 404 });
  }
  if (resolved.kind === 'historic' && resolved.site?.customDomain) {
    return Response.redirect(
      historicRedirectUrl({
        currentHost: resolved.site.customDomain,
        pathname: url.pathname,
        search: url.search,
      }),
      301,
    );
  }
  context.locals.tenant = resolved.site!;

  if (mode === 'admin') return handleAdmin(context, next);
  return handlePublic(context, next, resolved.site!.id);
});

// ─── admin branch ───────────────────────────────────────────────────────────

async function handleAdmin(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
  next: Parameters<Parameters<typeof defineMiddleware>[0]>[1],
) {
  const url = new URL(context.request.url);
  const isLoginPath =
    url.pathname === '/login' ||
    url.pathname === '/auth/callback' ||
    url.pathname === '/logout';

  const sid = readSessionId(context.request.headers);
  if (sid && looksLikeSessionId(sid)) {
    const session = await loadSession(context.locals.db!, sid);
    if (session) context.locals.session = session;
  }

  if (!context.locals.session && !isLoginPath) {
    const next_ = url.pathname + url.search;
    return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(next_)}`, 302);
  }

  return next();
}

// ─── public branch ──────────────────────────────────────────────────────────

async function handlePublic(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
  next: Parameters<Parameters<typeof defineMiddleware>[0]>[1],
  tenantId: string,
) {
  if (!isCacheableMethod(context.request.method)) return next();

  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await readFromCache(cache, { request: context.request, tenantId });
  if (cached) return cached;

  const response = await next();
  if (response.status === 200) {
    return await writeToCache(cache, { request: context.request, tenantId, response });
  }
  return response;
}
