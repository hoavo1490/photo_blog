// Tenant-scoped edge cache for public GET responses.
//
// Design choices (from the master plan's critic review):
//   * Cache key is explicitly `${tenantId}:${pathname}${search}` -- the
//     URL alone is NOT safe because two tenants on different hosts could
//     share a path and one's response could be served to the other.
//   * Requests carrying the session cookie SKIP the cache entirely so an
//     authenticated reader never sees a stale anonymous view (and vice
//     versa) -- the cache only ever holds anonymous responses.
//   * Short TTL (60s default) replaces explicit purge-on-write. Posts go
//     live within ~60s of save; no per-URL invalidation infra needed.
//     Phase 8 hardening can swap in KV-based versioning if needed.
//
// `caches.default` is a Workers runtime API. Tests for this module live
// in the workers pool so they exercise the real Cache API.

import { SESSION_COOKIE_NAME } from '../auth/session-cookie';

export interface CacheKeyInput {
  tenantId: string;
  pathname: string;
  search: string;
}

/** Build the canonical cache key URL. Uses an opaque internal host so the
 *  key cannot collide with a real outbound URL. */
export function buildCacheKey(input: CacheKeyInput): string {
  return `https://_riovv_cache_/${input.tenantId}${input.pathname}${input.search}`;
}

export function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get('cookie');
  if (!cookie) return false;
  // Match `riovv_sid=` boundary-aware: it must be at start of string,
  // or preceded by `; `. Avoids substring matches inside other cookie values.
  const re = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=`);
  return re.test(cookie);
}

export interface CacheableRequestInput {
  request: Request;
  tenantId: string;
}

/** True iff the response for this request may be served from / written to
 *  the public cache. Mutating methods, authenticated requests, and
 *  pragma-no-cache requests bypass. */
export function isCacheable(input: CacheableRequestInput): boolean {
  const m = input.request.method;
  if (m !== 'GET' && m !== 'HEAD') return false;
  if (hasSessionCookie(input.request)) return false;
  const cc = input.request.headers.get('cache-control') ?? '';
  if (/\bno-store\b|\bno-cache\b/.test(cc)) return false;
  return true;
}

/** Returns a cached response if one exists, else null. Caller renders fresh
 *  and may then call `writeToCache` to populate. */
export async function readFromCache(
  cache: Cache,
  input: CacheableRequestInput,
): Promise<Response | null> {
  if (!isCacheable(input)) return null;
  const url = buildCacheKey({
    tenantId: input.tenantId,
    pathname: new URL(input.request.url).pathname,
    search: new URL(input.request.url).search,
  });
  const cached = await cache.match(new Request(url));
  if (!cached) return null;
  // cache.match returns a Response with immutable headers. Astro's
  // prepareResponse tries to set content-type etc., which throws on an
  // immutable response. Rebuild a fresh Response so headers are writable.
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: new Headers(cached.headers),
  });
}

export interface WriteToCacheInput {
  request: Request;
  tenantId: string;
  response: Response;
  /** Max age in seconds. Default 60. */
  ttlSeconds?: number;
}

/** Persist a response to the cache. Mutates response headers to set
 *  Cache-Control. Returns a clone safe to also pass to the client. */
export async function writeToCache(cache: Cache, input: WriteToCacheInput): Promise<Response> {
  // 5min TTL on both browser and edge, plus a 1-day stale-while-revalidate
  // window so visitors keep getting an instant response while the edge
  // refreshes in the background. The previous 60s TTL was so short that
  // most requests still hit origin -- the new value lets the edge absorb
  // traffic spikes (which Google factors into Core Web Vitals scoring)
  // without making content noticeably stale (posts go live within 5min).
  const ttl = input.ttlSeconds ?? 300;
  // Only cache 200 HTML/XML/text bodies. Non-success responses get
  // returned untouched.
  if (input.response.status !== 200) return input.response;

  const headers = new Headers(input.response.headers);
  // Set both -- caches.default reads Cache-Control too, and downstream
  // CDNs (in front of the Worker) honor s-maxage. SWR=86400 lets stale
  // content serve immediately while a fresh fetch warms in the background.
  headers.set(
    'cache-control',
    `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=86400`,
  );

  const cacheable = new Response(input.response.body, {
    status: input.response.status,
    statusText: input.response.statusText,
    headers,
  });

  const url = buildCacheKey({
    tenantId: input.tenantId,
    pathname: new URL(input.request.url).pathname,
    search: new URL(input.request.url).search,
  });

  // Clone before put so we can return one copy to the client.
  await cache.put(new Request(url), cacheable.clone());
  return cacheable;
}
