import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { createD1Driver } from './lib/db/d1-driver';
import { classifyRoute, isCacheableMethod } from './lib/middleware/route-mode';
import { resolveTenant, historicRedirectUrl } from './lib/middleware/tenant';
import { findBySlug } from './lib/db/sites';
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
  // Test escape hatch -- integration tests inject a SqlDriver (typically
  // PGLite) to avoid needing a real D1 binding. Production never sets this.
  // eslint-disable-next-line no-var
  var __RIOVV_TEST_DRIVER__: import('./lib/db/driver').SqlDriver | undefined;
}

function driverFromEnv() {
  if (globalThis.__RIOVV_TEST_DRIVER__) return globalThis.__RIOVV_TEST_DRIVER__;
  const e = env as unknown as { DB?: unknown };
  if (e.DB) return createD1Driver(e.DB as import('@cloudflare/workers-types').D1Database);
  throw new Error('No database: add a D1 binding (DB) to wrangler.jsonc');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  const mode = classifyRoute({ pathname: url.pathname });

  if (mode === 'asset') return next();

  // Dev-only bypass: set DEV_BYPASS_LOGIN=<githubLogin> in .dev.vars.
  // Short-circuits ALL Neon calls for admin routes so the admin UI renders
  // without a working DB or GitHub OAuth. Lists will be empty; UI is fully testable.
  const devLogin = (env as unknown as { DEV_BYPASS_LOGIN?: string }).DEV_BYPASS_LOGIN;
  if (devLogin && mode === 'admin') {
    const localSlug = (env as unknown as { LOCAL_SITE_SLUG?: string }).LOCAL_SITE_SLUG ?? 'dev';
    context.locals.db = { query: async () => [], exec: async () => {} };
    context.locals.session = { sessionId: 'dev', userId: 'dev-bypass', githubLogin: devLogin };
    context.locals.tenant = {
      id: 'dev-bypass', slug: localSlug, name: localSlug,
      customDomain: null, createdAt: new Date(), isCurrentHost: true,
    };
    return next();
  }

  const driver = driverFromEnv();
  context.locals.db = driver;

  // Resolve tenant for both branches -- admin mutations are scoped to
  // whichever site owns the host the request landed on, and public reads
  // need the tenant to look up posts.
  let resolved = await resolveTenant(driver, host);
  if (resolved.kind === 'unknown') {
    // Dev fallback: LOCAL_SITE_SLUG in .dev.vars lets localhost resolve to a site.
    const localSlug = (env as unknown as { LOCAL_SITE_SLUG?: string }).LOCAL_SITE_SLUG;
    if (localSlug) {
      const site = await findBySlug(driver, localSlug);
      if (site) resolved = { kind: 'current', site: { ...site, isCurrentHost: true } };
    }
  }
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
    // The session touch (refresh last_used_at) is fire-and-forget. On
    // Cloudflare Workers post-response work is terminated unless wrapped
    // in ctx.waitUntil, so we hand the adapter's ExecutionContext into
    // loadSession when available. In tests / non-Worker callers the
    // ctx is absent and loadSession falls back to fire-and-forget.
    //
    // Astro 6 renamed locals.runtime.ctx -> locals.cfContext on the
    // Cloudflare adapter. Read the new location, fall back to the old
    // one for back-compat in case we end up on an older adapter
    // somehow (and to keep tests that mock `runtime.ctx` working).
    const locals = context.locals as unknown as {
      cfContext?: { waitUntil(p: Promise<unknown>): void };
      runtime?: { ctx?: { waitUntil(p: Promise<unknown>): void } };
    };
    const cfCtx = locals.cfContext ?? locals.runtime?.ctx;
    const waitUntil = cfCtx ? cfCtx.waitUntil.bind(cfCtx) : undefined;
    const session = await loadSession(context.locals.db!, sid, waitUntil);
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
