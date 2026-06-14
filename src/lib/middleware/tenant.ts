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
 */
export async function resolveTenant(
  driver: SqlDriver,
  host: string,
): Promise<ResolveTenantResult> {
  const match = await findByHost(driver, host);
  if (!match) return { kind: 'unknown', site: null };
  return { kind: match.isCurrentHost ? 'current' : 'historic', site: match };
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
