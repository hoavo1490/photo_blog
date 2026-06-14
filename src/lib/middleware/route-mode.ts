// Classifies an incoming request before any DB or auth work happens.
// Pure function -- easy to unit-test, easy to reason about.
//
// Three modes:
//   * 'admin'         -- /admin/* and the auth flow paths. Session required;
//                        responses never cached.
//   * 'public-tenant' -- everything else on a known tenant host. Cacheable
//                        for GETs without a session cookie.
//   * 'asset'         -- static files served by the @cloudflare adapter's
//                        ASSETS binding. Middleware short-circuits these.

export type RequestMode = 'admin' | 'public-tenant' | 'asset';

export interface ClassifyInput {
  pathname: string;
}

// Astro's CF adapter serves static assets via the ASSETS binding from
// /_astro/* and a handful of root files.
// /robots.txt is generated dynamically from a route, so it's NOT in here
// -- only build-time static files served from the ASSETS binding belong.
// /img/* is a Worker-served image proxy with its own cache headers; it
// has no use for tenant resolution or DB drivers, so it skips the
// middleware pipeline like an asset.
const STATIC_PREFIXES = ['/_astro/', '/_image/', '/favicon.ico', '/img/', '/fonts/'];

// Path prefixes that put a request into the admin branch. Every admin route
// either lives under /admin/* or is part of the auth flow.
const ADMIN_PATHS = ['/admin', '/login', '/logout'];
const ADMIN_PREFIXES = ['/admin/', '/auth/'];

export function classifyRoute(input: ClassifyInput): RequestMode {
  for (const p of STATIC_PREFIXES) {
    if (input.pathname.startsWith(p)) return 'asset';
  }
  if (ADMIN_PATHS.includes(input.pathname)) return 'admin';
  for (const p of ADMIN_PREFIXES) {
    if (input.pathname.startsWith(p)) return 'admin';
  }
  return 'public-tenant';
}

/** Public requests that mutate state (POST, PUT, DELETE) bypass the cache. */
export function isCacheableMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}
