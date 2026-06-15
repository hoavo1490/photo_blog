// Tenant resolution helpers. Phase 5 wraps `sites.findByHost` with the
// 301-redirect-on-historic-host policy the master plan requires.

import type { SqlDriver } from '../db/driver';
import { findByHost, type SiteHostMatch } from '../db/sites';

export interface ResolveTenantResult {
  kind: 'current' | 'historic' | 'unknown';
  site: SiteHostMatch | null;
}

/** Resolve the tenant for a given public host. Returns:
 *   - { kind: 'current', site } when host is the current custom_domain
 *   - { kind: 'historic', site } when host appears in site_domain_history
 *     (caller should 301 to site.customDomain + same path/query)
 *   - { kind: 'unknown', site: null } when host matches no tenant
 *
 * The resolution is cached at the edge for 5 minutes per host -- the
 * site -> host mapping changes only on tenant config edits, so a
 * short TTL is plenty. Without this, every page request paid ~50ms
 * for the same DB lookup on cold edge cache.
 */
const TENANT_CACHE_TTL_SEC = 300;

/** caches.default is a Workers runtime API. Tests run under Node where
 *  it doesn't exist; gracefully degrade to no-cache so the integration
 *  tests still hit the DB directly. */
function getDefaultCache(): Cache | null {
  try {
    return (caches as unknown as { default: Cache }).default;
  } catch {
    return null;
  }
}

export async function resolveTenant(
  driver: SqlDriver,
  host: string,
): Promise<ResolveTenantResult> {
  const cache = getDefaultCache();
  const cacheKey = cache && new Request(`https://_riovv_cache_/tenant/${encodeURIComponent(host)}`);
  if (cache && cacheKey) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return (await cached.json()) as ResolveTenantResult;
    }
  }
  const match = await findByHost(driver, host);
  const result: ResolveTenantResult = match
    ? { kind: match.isCurrentHost ? 'current' : 'historic', site: match }
    : { kind: 'unknown', site: null };
  if (cache && cacheKey && result.kind === 'current') {
    await cache.put(cacheKey, new Response(JSON.stringify(result), {
      headers: { 'cache-control': `public, max-age=${TENANT_CACHE_TTL_SEC}` },
    }));
  }
  return result;
}

/** Build the redirect URL when a request hits an historic host.
 *  Preserves path and search so deep links migrate cleanly. */
export function historicRedirectUrl(input: {
  currentHost: string;
  pathname: string;
  search: string;
}): string {
  return `https://${input.currentHost}${input.pathname}${input.search}`;
}
