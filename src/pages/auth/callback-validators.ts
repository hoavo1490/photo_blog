// Pure validators for /auth/callback. Extracted to a separate module so
// they can be unit-tested without spinning up an Astro APIContext.
//
// Two responsibilities:
//   * `safeNext` -- only allow same-origin relative paths. Reject
//     protocol-relative `//evil.com` and backslash variants and any
//     absolute URL whose origin differs from `origin`.
//   * `parseStateNonce` / `OAUTH_STATE_COOKIE_NAME` -- support CSRF
//     verification by carrying a server-issued nonce inside the OAuth
//     `state` and matching it against a short-lived HttpOnly cookie.

/** Name of the OAuth CSRF cookie set by /login and read by /auth/callback. */
export const OAUTH_STATE_COOKIE_NAME = 'riovv_oauth_state';

/** TTL for the OAuth state cookie. 5 minutes is plenty -- the OAuth round
 *  trip is sub-second under normal conditions. */
export const OAUTH_STATE_COOKIE_MAX_AGE_SECONDS = 5 * 60;

const FALLBACK = '/admin';

/** Return `next` if it resolves to the SAME ORIGIN as `origin`; otherwise
 *  fall back to `/admin`. Defends against:
 *    - `next=//evil.com`     (protocol-relative; URL parser treats this
 *                             as a different origin once resolved)
 *    - `next=/\evil.com`     (browsers normalize the backslash to '/',
 *                             matching //evil.com)
 *    - `next=https://evil.com` (absolute external URL)
 *  Only relative paths whose `new URL(next, origin).origin === origin`
 *  are accepted. */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (typeof next !== 'string' || next.length === 0) return FALLBACK;
  // Backslashes are normalized to '/' by browser URL parsers, which means
  // `/\evil.com` becomes a protocol-relative reference. WHATWG URL also
  // does this, but be explicit: refuse strings that contain a backslash
  // in the authority slot.
  if (next.includes('\\')) return FALLBACK;
  let resolved: URL;
  try {
    resolved = new URL(next, origin);
  } catch {
    return FALLBACK;
  }
  if (resolved.origin !== new URL(origin).origin) return FALLBACK;
  // Preserve querystring + hash; drop the origin so we redirect relatively.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/** Parse the base64-encoded JSON `state` and return its nonce.
 *  Returns null when state is missing, malformed, or has no `n` field. */
export function parseStateNonce(stateRaw: string | null): string | null {
  if (!stateRaw) return null;
  try {
    const parsed = JSON.parse(atob(stateRaw)) as { n?: unknown };
    return typeof parsed.n === 'string' && parsed.n.length > 0 ? parsed.n : null;
  } catch {
    return null;
  }
}

/** Parse a cookie header for the OAuth state nonce. */
export function readOAuthStateCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name !== OAUTH_STATE_COOKIE_NAME) continue;
    const value = part.slice(idx + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

interface BuildCookieOpts {
  secure: boolean;
  domain?: string;
}

/** Build the Set-Cookie value for the OAuth state nonce. Short-lived
 *  HttpOnly + SameSite=Lax so the cookie returns on the GitHub redirect
 *  but is unreadable from JS. */
export function buildOAuthStateCookie(nonce: string, opts: BuildCookieOpts): string {
  const parts = [`${OAUTH_STATE_COOKIE_NAME}=${nonce}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  parts.push(`Max-Age=${OAUTH_STATE_COOKIE_MAX_AGE_SECONDS}`);
  return parts.join('; ');
}

/** Build the Set-Cookie value that clears the OAuth state cookie. */
export function buildClearOAuthStateCookie(opts: BuildCookieOpts): string {
  const parts = [`${OAUTH_STATE_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  parts.push('Max-Age=0');
  return parts.join('; ');
}
