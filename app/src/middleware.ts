import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { createNeonDriver } from './lib/db/neon-driver';
import { classifyRoute, isCacheableMethod } from './lib/middleware/route-mode';
import { resolveTenant, historicRedirectUrl } from './lib/middleware/tenant';
import { readFromCache, writeToCache } from './lib/middleware/cache';
import { readSessionId, looksLikeSessionId } from './lib/auth/session-cookie';
import { loadSession } from './lib/auth/login-flow';

// Astro middleware. Runs for every non-asset request before the route
// renders. Splits responsibility three ways:
//
//   1. classifyRoute() decides admin vs public-tenant vs asset.
//   2. For public-tenant: resolve site by host, 301 if historic, edge-cache GETs.
//   3. For admin: resolve session, redirect to /login if missing.
//
// Bindings come from `cloudflare:workers` in Astro 6 + adapter v13.
// In dev / test the adapter wires miniflare bindings; in prod they come
// from wrangler.jsonc + Cloudflare dashboard secrets.

declare global {
  // Test escape hatch: integration tests can inject a SqlDriver here so
  // they don't need a real Neon connection. Production code never sets it.
  // eslint-disable-next-line no-var
  var __RIOVV_TEST_DRIVER__: import('./lib/db/driver').SqlDriver | undefined;
}

function driverFromEnv() {
  if (globalThis.__RIOVV_TEST_DRIVER__) return globalThis.__RIOVV_TEST_DRIVER__;
  const url = (env as unknown as { DATABASE_URL?: string }).DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not bound');
  return createNeonDriver(url);
}

function adminHostFromEnv(): string {
  const e = env as unknown as { ADMIN_HOST?: string };
  return (e.ADMIN_HOST ?? 'admin.riovv.com').toLowerCase();
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  const mode = classifyRoute({ host, pathname: url.pathname, adminHost: adminHostFromEnv() });

  // Static assets: pass through, no DB / no cache work.
  if (mode === 'asset') return next();

  // Lazily attach the driver -- both admin and public branches need it.
  const driver = driverFromEnv();
  context.locals.db = driver;

  if (mode === 'admin') {
    return handleAdmin(context, next);
  }

  return handlePublic(context, next, host);
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
  host: string,
) {
  const url = new URL(context.request.url);
  const resolved = await resolveTenant(context.locals.db!, host);

  if (resolved.kind === 'unknown') {
    return new Response('Site not found', { status: 404 });
  }

  if (resolved.kind === 'historic' && resolved.site?.customDomain) {
    // 301 to the current canonical domain, preserving path + query.
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

  // Cache only safe-method anonymous GETs.
  if (!isCacheableMethod(context.request.method)) {
    return next();
  }

  const tenantId = resolved.site!.id;
  const cached = await readFromCache((caches as unknown as { default: Cache }).default, {
    request: context.request,
    tenantId,
  });
  if (cached) return cached;

  const response = await next();
  if (response.status === 200) {
    return await writeToCache((caches as unknown as { default: Cache }).default, {
      request: context.request,
      tenantId,
      response,
    });
  }
  return response;
}
