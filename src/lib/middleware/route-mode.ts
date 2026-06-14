// Classifies an incoming request before any DB or auth work happens.
// Pure function -- easy to unit-test, easy to reason about.
//
// Three modes:
//   * 'admin'         -- the global admin host. Auth-gated, never cached.
//                        Session resolution required; tenant is whichever
//                        site the authenticated user picks via the URL.
//   * 'public-tenant' -- a tenant's public host (custom_domain or historic).
//                        Cacheable for GETs without a session cookie.
//                        Tenant resolved by `sites.findByHost`.
//   * 'asset'         -- static assets served by the @cloudflare adapter's
//                        ASSETS binding. Middleware short-circuits these.
//   * 'unknown-host'  -- a host that doesn't match admin and doesn't
//                        match any site. Caller decides 404 vs redirect.

export type RequestMode = 'admin' | 'public-tenant' | 'asset' | 'unknown-host';

export interface ClassifyInput {
  host: string;          // already lowercased by caller
  pathname: string;
  adminHost: string;     // env.ADMIN_HOST -- the SINGLE global admin host
}

// Astro's CF adapter serves static assets via the ASSETS binding from
// /dist/_astro/* (and a handful of root files). The adapter handles
// those before middleware runs, but if a static URL DOES hit middleware
// (custom domain edge case), we let it pass through untouched.
const STATIC_PREFIXES = ['/_astro/', '/_image/', '/favicon.ico', '/robots.txt'];

export function classifyRoute(input: ClassifyInput): RequestMode {
  for (const p of STATIC_PREFIXES) {
    if (input.pathname.startsWith(p)) return 'asset';
  }
  if (input.host === input.adminHost.toLowerCase()) return 'admin';
  // Any other host is a candidate public tenant -- caller verifies by DB lookup.
  // 'unknown-host' is returned later by the tenant resolver, not here.
  return 'public-tenant';
}

/** Public requests that mutate state (POST, PUT, DELETE) bypass the cache
 *  and force a fresh render. The editor's mutation surface lives under
 *  /admin so this is mostly defensive (e.g. webhooks). */
export function isCacheableMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}
