// Cookie utilities for the session cookie.
//
// The cookie holds ONLY the opaque session UUID. The `sessions` table is
// the source of truth -- revocation, expiry, last-used-at all live there.
// This means the cookie is meaningless to anyone who steals it without
// also stealing a live row in `sessions`, and revoking the row instantly
// invalidates every device.

export const SESSION_COOKIE_NAME = 'riovv_sid';

const DEFAULT_MAX_AGE_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

export interface SessionCookieOptions {
  /** undefined for localhost/dev; set in production to 'editor.riovv.com' or the apex */
  domain?: string;
  /** false in dev (HTTP localhost); true everywhere else */
  secure: boolean;
  /** Days until expiry */
  maxAgeDays?: number;
}

/** Read the session id from the Cookie header. Returns null if absent or empty. */
export function readSessionId(headers: Headers): string | null {
  const cookie = headers.get('cookie');
  if (!cookie) return null;
  // Cookies are `name=value; name2=value2`. Splitting on ';' is the
  // canonical parse -- RFC 6265 forbids ';' in cookie values so this is
  // unambiguous.
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(idx + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

function buildAttributes(opts: SessionCookieOptions, maxAgeSeconds: number): string {
  const parts = [`Path=/`, `HttpOnly`, `SameSite=Lax`];
  if (opts.secure) parts.push('Secure');
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

/** Build a Set-Cookie value for a fresh login. */
export function buildSessionCookie(sessionId: string, opts: SessionCookieOptions): string {
  const days = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const maxAge = days * SECONDS_PER_DAY;
  return `${SESSION_COOKIE_NAME}=${sessionId}; ${buildAttributes(opts, maxAge)}`;
}

/** Build a Set-Cookie value that clears the cookie (Max-Age=0). */
export function buildClearCookie(opts: SessionCookieOptions): string {
  return `${SESSION_COOKIE_NAME}=; ${buildAttributes(opts, 0)}`;
}

// Canonical UUID v4-ish: 8-4-4-4-12 hex characters. We don't actually
// require v4 -- PostgreSQL's gen_random_uuid() returns v4 but any 36-char
// hex-with-dashes shape would be accepted.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns whether the parsed cookie value looks like a valid UUID. Defense
 *  against random cookie tampering -- callers can skip the DB lookup. */
export function looksLikeSessionId(s: string): boolean {
  return UUID_RE.test(s);
}
